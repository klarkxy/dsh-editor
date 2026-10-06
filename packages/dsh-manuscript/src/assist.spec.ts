import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { apply as applyAssist, inject as assistInject, name as assistName } from './assist.ts'
import type { ManuscriptAssist } from './assist-api.ts'
import type { StreamChunkLike } from './rpc/completion.ts'

const canonical = '/canonical/workspace'

async function* stopped(text: string): AsyncIterable<StreamChunkLike> {
  yield { type: 'text-delta', text }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

async function boot(options: { native?: boolean } = {}) {
  const ctx = new Context()
  const stream = vi.fn((_options: GenerateOptions) => stopped('窗上的雾'))
  ctx.provide('llm', {
    stream,
    async resolveCallConfig(config: unknown) { return config },
  })
  ctx.provide('storageDomain', {
    async open() {
      return { table: () => ({ get: () => undefined, async put() {} }), async close() {} }
    },
  })
  ctx.provide('connection', {})
  ctx.provide('webServer', { register: () => () => {} })
  if (options.native !== false) {
    ctx.provide('agents', { get: () => undefined })
    ctx.provide('sessionProjections', { stateOf: () => undefined })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'live-provider', model: 'live-model' }) })
    ctx.provide('editorWritingPreferences', { read: () => ({}) })
  }
  ctx.provide('sessions', {
    get: (id: string) => id === 'session-1'
      ? { id, header: { cwd: canonical }, requestHeader: () => ({ config: { provider: 'stale', model: 'stale' } }) }
      : undefined,
  })
  ctx.provide('workspaceRegistry', { resolveByPath: async () => ({ path: canonical, sessionIds: ['session-1'] }) })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: canonical, sessionId: 'session-1' }) })
  ctx.provide('fs', {
    async resolve() { return { targetKey: canonical, displayPath: canonical } },
    contains: () => true,
    async stat() { return { type: 'directory', version: 'root' } },
    async lstat() { return { type: 'directory', version: 'root' } },
    async readText() { return '' },
    async listDir() { return [] },
    async writeText() { throw new Error('assist must not write manuscript files') },
  })
  const assistFiber = ctx.plugin({ name: assistName, inject: [...assistInject], apply: applyAssist })
  await assistFiber
  return {
    ctx,
    stream,
    service: ctx.get('manuscriptAssist') as ManuscriptAssist,
    scope: ctx.get('manuscriptAiScope') as { active: boolean; signal: AbortSignal; dispose(): void },
    assistFiber,
  }
}

describe('manuscript assist on Cordis', () => {
  it('starts without registering retired purposes, calls the native default model, and aborts the local scope when the fiber unloads', async () => {
    const { stream, service, scope, assistFiber } = await boot()
    expect(scope.active).toBe(true)
    await expect(service.complete(
      'fim.complete',
      { sessionId: 'session-1', prefix: '雨', suffix: '' },
      { provider: 'forged', model: 'forged' },
      new AbortController().signal,
    )).resolves.toEqual({ text: '窗上的雾', route: 'dsh-llm' })
    const options = stream.mock.calls[0]?.[0]
    expect(options).toMatchObject({ provider: 'live-provider', model: 'live-model', maxTokens: 2048 })
    expect(options?.messages[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: expect.stringContaining('【光标前】\n雨') }] })
    expect(options?.messages[0]).not.toHaveProperty('source')
    expect(options?.system).toContain('【本项目协作规则】')
    expect(options?.provider).not.toBe('stale')
    expect(options?.provider).not.toBe('forged')
    await assistFiber.dispose()
    expect(scope.active).toBe(false)
    expect(scope.signal.aborted).toBe(true)
  })

  it('loads without optional native route services and ignores a retired writingAiMigration error', async () => {
    const { ctx, stream, service, assistFiber } = await boot({ native: false })
    ctx.provide('writingAiMigration', { ready: new Promise<void>(() => {}), error: '旧写作模型配置迁移失败。' })
    await expect(service.complete(
      'fim.complete',
      { sessionId: 'session-1', prefix: '雨', suffix: '' },
      { provider: 'forged', model: 'forged' },
      new AbortController().signal,
    )).rejects.toThrow('请先设置默认对话模型。')
    expect(stream).not.toHaveBeenCalled()
    await assistFiber.dispose()
  })
})
