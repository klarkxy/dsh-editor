import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import { writeTextFile } from 'dsh-manuscript/host-api'
import { createMemoryContext } from './test-helpers.ts'
import { compileProjectContext, compileProjectContextV2 } from './contracts.ts'
import { assembleProjectRules, installProjectContextHooks, retireLegacyContext } from './project-context-hooks.ts'

function session() {
  return Session.create(SessionId('rules-test'), [], {
    id: SessionId('rules-test'),
    version: SESSION_FORMAT_VERSION,
    createdAt: 1,
    cwd: '/workspace',
    agentPreset: 'dsh-editor',
    isSeeded: false,
  })
}
const emptyAssembly = (): PromptAssembly => ({ sections: [{ name: 'mode', text: 'generic mode' }], contexts: [], tools: [], variables: {} })

describe('rules and history on the actual host contracts', () => {
  it('replaces old packets in the replayable surface, preserving original transcript records', async () => {
    const s = session()
    const reader = async () => ({ ok: true as const, value: { text: 'STALE_SECRET', version: 'v1' } })
    const old = await compileProjectContext('原用户请求', reader)
    const newer = await compileProjectContextV2('后续请求', reader, { candidates: [] })
    for (const text of [old.serialized, '普通对话', newer.serialized]) s.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
    expect(retireLegacyContext(s)).toBe(2)
    expect(s.deriveMessages().map(m => m.content[0])).toEqual(['原用户请求', '普通对话', '后续请求'].map(text => ({ type: 'text', text })))
    expect(s.snapshotEvents().filter(e => e.type === 'user/message' && e.surfaceOp === 'append')).toHaveLength(3)
    expect(JSON.stringify(s.snapshotEvents())).toContain('STALE_SECRET')
    expect(JSON.stringify(s.deriveMessages())).not.toContain('STALE_SECRET')
    const resumed = Session.create(s.id, s.snapshotEvents(), s.header)
    expect(retireLegacyContext(resumed)).toBe(0)
    expect(resumed.deriveMessages()).toEqual(s.deriveMessages())
  })
  it('does not transform V3 or plain user JSON', () => {
    const s = session()
    for (const text of ['{"version":2}', '{"schema":"dsh-editor.project-context","version":3,"user_request":"继续"}']) s.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
    expect(retireLegacyContext(s)).toBe(0)
  })
  it('loads current root rules once, preserving literal templates and global preferences', async () => {
    const files = createMemoryContext({ 'AGENTS.md': '规则 {{model}} 与 {{ 未闭合', '世界书/不要读.md': 'SECRET' })
    const s = session()
    const ctx = { fs: files.fs, sessions: { get: () => s }, workspaceRegistry: { resolveByPath: async () => ({ path: '/workspace', sessionIds: ['rules-test'] }) }, sandboxPolicy: { resolve: () => files.policy }, get: (name: string) => name === 'settings' ? { get: () => ({ authorPreferences: '全局偏好', authorMemory: '全局侧写' }) } : undefined } as unknown as Context
    const first = await assembleProjectRules(ctx, emptyAssembly(), { session: s })
    expect(renderPrompt(first)).toContain('规则 {{model}} 与 {{ 未闭合')
    expect(renderPrompt(first)).toContain('全局偏好')
    const second = await assembleProjectRules(ctx, first, { session: s })
    expect(second.sections.filter(x => x.name === 'dsh-editor:project-rules')).toHaveLength(1)
    const target = await files.fs.resolve('AGENTS.md', { cwd: files.cwd }); const version = (await files.fs.stat(target))!.version
    await writeTextFile(files, 'AGENTS.md', '更新后的规则', version)
    expect(renderPrompt(await assembleProjectRules(ctx, emptyAssembly(), { session: s }))).toContain('更新后的规则')
    expect((files.fs as unknown as { readPaths: string[] }).readPaths.some(x => x.includes('世界书'))).toBe(false)
  })
  it('exposes the native observed read version without overriding rejected results', async () => {
    const handlers: Record<string, (...args: any[]) => any> = {}
    const ctx = { on: (name: string, fn: (...args: any[]) => any) => { handlers[name] = fn }, effect: () => {} } as unknown as Context
    installProjectContextHooks(ctx)
    const exec = { name: 'read', token: 'read-1', agent: { session: session() } }
    handlers['fs/observed']!({}, { kind: 'present', version: 'provider-version' }, exec)
    const result = await handlers['tools/post-execute']!(exec, { content: [{ type: 'text', text: 'source' }] }, async () => ({ kind: 'accept' }))
    expect(result.content[1].text).toContain('provider-version')
    handlers['fs/observed']!({}, { kind: 'present', version: 'new-version' }, exec)
    const blocked = await handlers['tools/post-execute']!(exec, { content: [] }, async () => ({ kind: 'block', feedback: [] }))
    expect(blocked).toEqual({ kind: 'block', feedback: [] })
  })
})
