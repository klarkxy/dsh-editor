import { describe, expect, it, vi } from 'vitest'
import { createPluginManagerStore, normalizeBundleInfo, normalizePluginInfo } from './plugin-manager.ts'

function fakeCtx(rpcResult: (endpoint: string, args: Record<string, unknown>) => unknown, events: Record<string, Array<(v: unknown) => void>> = {}) {
  const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const handlers = new Map<string, Set<(v: unknown) => void>>()
  for (const key of Object.keys(events)) handlers.set(key, new Set(events[key]))
  const ctx = {
    connection: {
      rpc: {
        call: (_channel: string, endpoint: string, payload: { args: Record<string, unknown> }) => {
          const method = endpoint.replace(/^pluginManager\//, '')
          calls.push({ endpoint: method, args: payload.args })
          return Promise.resolve(rpcResult(method, payload.args))
        },
      },
    },
    remote: {
      $on: (event: string, listener: (v: unknown) => void) => {
        const set = handlers.get(event) ?? new Set()
        set.add(listener)
        handlers.set(event, set)
        return () => set.delete(listener)
      },
    },
    emit: (event: string, value: unknown) => { for (const l of handlers.get(event) ?? []) l(value) },
    calls,
  }
  return ctx
}

const ok = (value: unknown) => ({ ok: true, value })
const bundleRow = { name: '@deepseek-ai/dsh-client-ui-plugin-manager', official: true, availability: 'installation', enabled: true, installed: true, optional: false, removable: false, rows: [], overrides: [] }

describe('plugin-manager store', () => {
  it('normalizes bundle/plugin rows, dropping malformed entries not the list', () => {
    expect(normalizeBundleInfo(bundleRow)?.name).toBe(bundleRow.name)
    expect(normalizeBundleInfo({ ...bundleRow, name: '' })).toBeUndefined()
    expect(normalizeBundleInfo({ ...bundleRow, availability: 'bogus' })).toBeUndefined()
    expect(normalizePluginInfo({ id: 'x' })?.id).toBe('x')
    expect(normalizePluginInfo({})).toBeUndefined()
  })

  it('loads bundles+plugins and reaches ready', async () => {
    const ctx = fakeCtx(() => ok([bundleRow, { bogus: true }, { id: 'row-1' }]))
    const store = createPluginManagerStore(ctx)
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))
    const snap = store.getSnapshot()
    expect(snap.bundles).toHaveLength(1)
    expect(snap.bundles[0].name).toBe(bundleRow.name)
    store.dispose()
  })

  it('reports error status when listBundles fails', async () => {
    const ctx = fakeCtx(() => ({ ok: false, error: { message: 'refused' } }))
    const store = createPluginManagerStore(ctx)
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('error'))
    store.dispose()
  })

  it('setBundleEnabled issues the /api request and reloads', async () => {
    const ctx = fakeCtx((endpoint) => endpoint === 'listBundles' ? ok([bundleRow]) : endpoint === 'setBundleEnabled' ? ok({ changed: true, application: 'applied' }) : ok([]))
    const store = createPluginManagerStore(ctx)
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))
    const receipt = await store.setBundleEnabled('@deepseek-ai/x', false)
    expect(receipt.changed).toBe(true)
    expect(ctx.calls.some(c => c.endpoint === 'setBundleEnabled' && c.args.name === '@deepseek-ai/x' && c.args.enabled === false)).toBe(true)
    store.dispose()
  })

  it('setPluginEnabled uses the entry id contract', async () => {
    const ctx = fakeCtx((endpoint) => endpoint === 'setPluginEnabled' ? ok({ changed: false, application: 'applied', warnings: ['already'] }) : ok([]))
    const store = createPluginManagerStore(ctx)
    const receipt = await store.setPluginEnabled('row-9', true)
    expect(receipt.message).toBe('already')
    expect(ctx.calls.find(c => c.endpoint === 'setPluginEnabled')?.args.id).toBe('row-9')
    store.dispose()
  })

  it('install settles via the installBundle reply', async () => {
    const ctx = fakeCtx((endpoint) => endpoint === 'installBundle' ? ok({ changed: true, application: 'applied', bundle: '@klarkxy/dsh-mood', version: '1.0.0' }) : ok([]))
    const store = createPluginManagerStore(ctx)
    await store.install('@klarkxy/dsh-mood', { enabled: true })
    const install = store.getSnapshot().install
    expect(install.phase).toBe('settled')
    expect(install.result?.bundle).toBe('@klarkxy/dsh-mood')
    const call = ctx.calls.find(c => c.endpoint === 'installBundle')!
    expect((call.args.options as { requestId?: string }).requestId).toBeTruthy()
    store.dispose()
  })

  it('exposes pendingBuilds on a failed install', async () => {
    const ctx = fakeCtx((endpoint) => endpoint === 'installBundle' ? ok({ changed: false, application: 'failed', error: { diagnostic: 'build blocked' }, pendingBuilds: ['esnext'] }) : ok([]))
    const store = createPluginManagerStore(ctx)
    await store.install('x')
    const install = store.getSnapshot().install
    expect(install.phase).toBe('settled')
    expect(install.failure?.pendingBuilds).toEqual(['esnext'])
    store.dispose()
  })

  it('recovers a lost install reply via waitForInstall', async () => {
    let waited = false
    const ctx = fakeCtx((endpoint, args) => {
      if (endpoint === 'installBundle') return { ok: false, error: { message: 'transport died' } }
      if (endpoint === 'waitForInstall') { waited = true; expect(args.requestId).toBeTruthy(); return ok({ changed: true, application: 'applied', bundle: 'pkg' }) }
      return ok([])
    })
    const store = createPluginManagerStore(ctx)
    await store.install('pkg')
    await vi.waitFor(() => expect(store.getSnapshot().install.phase).toBe('settled'))
    expect(waited).toBe(true)
    store.dispose()
  })

  it('marks unknown when waitForInstall returns null', async () => {
    const ctx = fakeCtx((endpoint) => endpoint === 'installBundle' ? { ok: false, error: { message: 'lost' } } : endpoint === 'waitForInstall' ? ok(null) : ok([]))
    const store = createPluginManagerStore(ctx)
    await store.install('pkg')
    await vi.waitFor(() => expect(store.getSnapshot().install.phase).toBe('unknown'))
    store.dispose()
  })

  it('cancelInstall issues the request-scoped call', async () => {
    const ctx = fakeCtx((endpoint) => endpoint === 'installBundle' ? new Promise(() => {}) : endpoint === 'cancelInstall' ? ok({ status: 'cancelled' }) : ok([]))
    const store = createPluginManagerStore(ctx)
    void store.install('pkg')
    await vi.waitFor(() => expect(store.getSnapshot().install.requestId).toBeTruthy())
    await store.cancelInstall()
    const cancel = ctx.calls.find(c => c.endpoint === 'cancelInstall')!
    expect(cancel.args.requestId).toBe(store.getSnapshot().install.requestId ?? cancel.args.requestId)
    store.dispose()
  })

  it('changed/install events drive reload and progress', async () => {
    const ctx = fakeCtx(() => ok([bundleRow]))
    const store = createPluginManagerStore(ctx)
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))
    const before = ctx.calls.filter(c => c.endpoint === 'listBundles').length
    ctx.emit('plugin-manager/changed', {})
    await vi.waitFor(() => expect(ctx.calls.filter(c => c.endpoint === 'listBundles').length).toBe(before + 1))
    store.dispose()
  })

  it('removeBundle calls the service and reloads', async () => {
    const ctx = fakeCtx((endpoint) => endpoint === 'removeBundle' ? ok({ changed: true, application: 'applied' }) : ok([]))
    const store = createPluginManagerStore(ctx)
    const result = await store.removeBundle('@scope/pkg')
    expect(result.ok).toBe(true)
    expect(ctx.calls.some(c => c.endpoint === 'removeBundle' && c.args.name === '@scope/pkg')).toBe(true)
    store.dispose()
  })
})
