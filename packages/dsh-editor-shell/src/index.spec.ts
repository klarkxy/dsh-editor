import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { EditorWritingPreferences } from './writing-settings-contract.ts'

const mocks = vi.hoisted(() => ({ migrate: vi.fn(), registerRpc: vi.fn() }))
vi.mock('./writing-ai-migration.ts', () => ({ importWritingModels: mocks.migrate }))
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: mocks.registerRpc }))
import { apply } from './index.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function fixture(previous?: () => Promise<void>) {
  const loaderReady = deferred()
  const preferences = { read: () => ({}) } as EditorWritingPreferences
  if (previous) preferences.modelsReady = previous
  const loader = { await: vi.fn(() => loaderReady.promise), entries: () => [] }
  const services: Record<string, unknown> = { loader, editorWritingPreferences: preferences, storageDomain: {}, settings: {} }
  const cleanups: Array<() => void> = []
  let call!: (endpoint: string, payload?: unknown) => Promise<any>
  const disposeRpc = vi.fn()
  mocks.registerRpc.mockImplementation((_ctx, _channel, handler) => { call = handler; return disposeRpc })
  const ctx = {
    get: (name: string) => services[name],
    effect: (setup: () => unknown) => { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => void) },
  }
  return { ctx, preferences, loader, loaderReady, call: (endpoint: string) => call(endpoint), disposeRpc, dispose: () => { for (const cleanup of cleanups.reverse()) cleanup() } }
}
beforeEach(() => { mocks.migrate.mockReset().mockResolvedValue(undefined); mocks.registerRpc.mockReset() })

describe('model migration Loader lifecycle', () => {
  it('returns and serves capabilities before Loader readiness, then starts migration', async () => {
    const f = fixture()
    await expect(apply(f.ctx as never)).resolves.toBeUndefined()
    expect(mocks.registerRpc).toHaveBeenCalledOnce()
    expect(mocks.migrate).not.toHaveBeenCalled()
    await expect(f.call('capabilities.get')).resolves.toEqual({ ok: true, value: { features: {} } })
    let statusSettled = false
    const status = f.call('models.migration.status').then(result => { statusSettled = true; return result })
    let modelsSettled = false
    const models = f.preferences.modelsReady!().then(() => { modelsSettled = true })
    await Promise.resolve()
    expect(statusSettled).toBe(false)
    expect(modelsSettled).toBe(false)
    f.loaderReady.resolve()
    await models
    await expect(status).resolves.toEqual({ ok: true, value: {} })
    expect(mocks.migrate).toHaveBeenCalledOnce()
    f.dispose()
  })
  it('keeps migration failures visible to consumers and status until an explicit retry completes', async () => {
    mocks.migrate.mockRejectedValueOnce(new Error('legacy marker refused'))
    const f = fixture()
    await apply(f.ctx as never)
    f.loaderReady.resolve()
    await expect(f.preferences.modelsReady!()).rejects.toThrow('legacy marker refused')
    await expect(f.call('models.migration.status')).resolves.toMatchObject({ ok: true, value: { error: expect.stringContaining('legacy marker refused') } })
    expect(mocks.migrate).toHaveBeenCalledOnce()
    const retry = deferred()
    mocks.migrate.mockImplementationOnce(() => retry.promise)
    const retrying = f.call('models.migrate')
    await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalledTimes(2))
    let ready = false
    const pendingReady = f.preferences.modelsReady!().then(() => { ready = true })
    await Promise.resolve()
    expect(ready).toBe(false)
    retry.resolve()
    await expect(retrying).resolves.toEqual({ ok: true, value: {} })
    await pendingReady
    expect(ready).toBe(true)
    f.dispose()
  })
  it('removes its readiness on disposal and does not start a queued migration afterward', async () => {
    const f = fixture()
    await apply(f.ctx as never)
    const ownReady = f.preferences.modelsReady!
    f.dispose()
    expect(Object.hasOwn(f.preferences, 'modelsReady')).toBe(false)
    expect(f.disposeRpc).toHaveBeenCalledOnce()
    f.loaderReady.resolve()
    await expect(ownReady()).rejects.toThrow('已关闭')
    expect(mocks.migrate).not.toHaveBeenCalled()
  })
  it('restores a prior property and preserves a later readiness owner', async () => {
    const previous = async () => {}
    const f = fixture(previous)
    await apply(f.ctx as never)
    expect(f.preferences.modelsReady).not.toBe(previous)
    f.dispose()
    expect(f.preferences.modelsReady).toBe(previous)
    f.loaderReady.resolve()
    const other = fixture()
    await apply(other.ctx as never)
    const replacement = async () => {}
    other.preferences.modelsReady = replacement
    other.dispose()
    expect(other.preferences.modelsReady).toBe(replacement)
    other.loaderReady.resolve()
  })
  it.each(['models.migration.status', 'models.migrate'])('fails pending %s when its context is disposed before Loader readiness', async endpoint => {
    const f = fixture()
    await apply(f.ctx as never)
    const pending = f.call(endpoint)
    await Promise.resolve()
    f.dispose()
    f.loaderReady.resolve()
    await expect(pending).resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('已关闭') } })
    expect(mocks.migrate).not.toHaveBeenCalled()
  })
  it('uses an endpoint accepted by the actual published host RPC handler', async () => {
    const { registerHostRpc } = await vi.importActual<typeof import('@klarkxy/dsh-plugin-kit/host-rpc')>('@klarkxy/dsh-plugin-kit/host-rpc')
    const f = fixture()
    await apply(f.ctx as never)
    f.loaderReady.resolve()
    let handler!: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    const call = vi.fn((endpoint: string) => f.call(endpoint))
    registerHostRpc({
      connection: { requestRejection: () => undefined },
      webServer: { register: route => { handler = route.handler; return () => {} } },
    }, '/dsh-editor-shell', call)
    const request = async (endpoint: string) => {
      const body = JSON.stringify({ type: 'client-request', rpcId: 'fixture-request', method: endpoint, payload: {} })
      const req = Object.assign(Readable.from([body]), { method: 'POST', url: '/dsh-editor-shell/' + endpoint, headers: { 'content-type': 'application/json' } })
      const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, writeHead: vi.fn(), end: vi.fn() })
      await handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
      return res
    }
    const response = await request('models.migration.status')
    expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(JSON.parse(response.end.mock.calls[0]![0])).toEqual({ type: 'server-response', rpcId: 'fixture-request', result: { ok: true, value: {} } })
    expect(call).toHaveBeenCalledOnce()
    const invalid = await request('models.migration-status')
    expect(invalid.writeHead).toHaveBeenCalledWith(404)
    expect(call).toHaveBeenCalledOnce()
    f.dispose()
  })
  it('returns the current Host chat model and only its three route fields', async () => {
    const f = fixture()
    let model = 'first'
    f.preferences.read = () => ({
      chatModel: { provider: 'host', model, reasoningEffort: 'off', authorMemory: 'nested-private-data' },
      authorPreferences: 'private-author-preferences', authorMemory: 'private-author-memory',
      completionModel: { provider: 'other', model: 'completion' },
    }) as never
    await apply(f.ctx as never)
    f.loaderReady.resolve()
    await expect(f.call('models.migration.status')).resolves.toEqual({ ok: true, value: { chatModel: { provider: 'host', model: 'first', reasoningEffort: 'off' } } })
    model = 'latest'
    await expect(f.call('models.migrate')).resolves.toEqual({ ok: true, value: { chatModel: { provider: 'host', model: 'latest', reasoningEffort: 'off' } } })
    f.dispose()
  })
})
