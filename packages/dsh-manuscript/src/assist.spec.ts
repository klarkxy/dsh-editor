import { apply as applyAiServices, inject as aiInject, name as aiName, type AiServices } from '@klarkxy/dsh-ai-services'
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

async function boot() {
  const ctx = new Context()
  const stream = vi.fn((_options: GenerateOptions) => stopped('窗上的雾'))
  const migration: { ready?: Promise<void>; error?: string } = { ready: Promise.resolve() }
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
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('sessionProjections', { stateOf: () => undefined })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'live-provider', model: 'live-model' }) })
  ctx.provide('writingAiMigration', migration)
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
  const aiFiber = ctx.plugin({ name: aiName, inject: [...aiInject], apply: applyAiServices })
  await aiFiber
  const assistFiber = ctx.plugin({ name: assistName, inject: [...assistInject], apply: applyAssist })
  await assistFiber
  return {
    ctx,
    stream,
    migration,
    ai: ctx.get('aiServices') as AiServices,
    service: ctx.get('manuscriptAssist') as ManuscriptAssist,
    aiFiber,
    assistFiber,
  }
}

describe('manuscript assist on Cordis', () => {
  it('registers writing purposes, calls the resolved model, and clears them when the fiber unloads', async () => {
    const { stream, ai, service, aiFiber, assistFiber } = await boot()
    expect(ai.purposes().map((row) => [row.id, row.defaultTarget])).toEqual([
      ['manuscript.completion', { kind: 'role', role: 'weak' }],
      ['manuscript.rewrite', { kind: 'role', role: 'normal' }],
    ])
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
    await assistFiber.dispose()
    expect(ai.purposes()).toEqual([])
    await aiFiber.dispose()
  })

  it('waits for the one-time migration and then refuses calls when it failed', async () => {
    const { stream, migration, service, aiFiber, assistFiber } = await boot()
    let release!: () => void
    migration.ready = new Promise<void>((resolve) => { release = resolve })
    let settled = false
    const pending = service.complete(
      'fim.complete',
      { sessionId: 'session-1', prefix: '雨', suffix: '' },
      { provider: 'forged', model: 'forged' },
      new AbortController().signal,
    ).then((value) => { settled = true; return value })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(settled).toBe(false)
    expect(stream).not.toHaveBeenCalled()
    release()
    await expect(pending).resolves.toMatchObject({ text: '窗上的雾' })

    migration.error = '旧写作模型配置迁移失败。'
    await expect(service.complete(
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句' },
      { provider: 'forged', model: 'forged' },
      new AbortController().signal,
    )).rejects.toThrow('旧写作模型配置迁移失败。')
    expect(stream).toHaveBeenCalledTimes(1)
    await assistFiber.dispose()
    await aiFiber.dispose()
  })
})
