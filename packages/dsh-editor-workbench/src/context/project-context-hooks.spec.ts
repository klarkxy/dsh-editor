import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it, vi } from 'vitest'
import { emptyBotState, type BotState } from '../bot/state.ts'
import { writeTextFile } from 'dsh-manuscript/host-api'
import { createMemoryContext } from '../test-helpers.ts'
import { compileProjectContext, compileProjectContextV2 } from '../contracts.ts'
import { assembleProjectRules, installProjectContextHooks, retireLegacyContext } from './project-context-hooks.ts'
import { WRITING_AGENT_PRESETS } from '../host-guard.ts'

let mockBotState: BotState = emptyBotState()
vi.mock('../bot/state.ts', async (importActual) => {
  const actual = await importActual<typeof import('../bot/state.ts')>()
  return { ...actual, loadBotState: vi.fn(async () => mockBotState) }
})

function session(agentPreset: string = 'dsh-editor-writing') {
  return Session.create(SessionId('rules-test'), [], {
    id: SessionId('rules-test'),
    version: SESSION_FORMAT_VERSION,
    createdAt: 1,
    cwd: '/workspace',
    agentPreset,
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
    const ctx = { fs: files.fs, sessions: { get: () => s }, workspaceRegistry: { resolveByPath: async () => ({ path: '/workspace', sessionIds: ['rules-test'] }) }, sandboxPolicy: { resolve: () => files.policy }, get: (name: string) => name === 'editorWritingPreferences' ? { read: () => ({ authorPreferences: '全局偏好', authorMemory: '全局侧写' }) } : undefined } as unknown as Context
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

  it('scopes prompt and read-version hooks to the writing preset allowlist', async () => {
    const handlers: Record<string, (...args: any[]) => any> = {}
    const ctx = { on: (name: string, fn: (...args: any[]) => any) => { handlers[name] = fn }, effect: () => {} } as unknown as Context
    installProjectContextHooks(ctx)
    const nextAssembly = async () => ({ ...emptyAssembly(), variables: { touched: 'yes' } })
    const missingPreset = { ...session(), header: { ...session().header, agentPreset: undefined } }
    for (const foreign of [session('standard'), session(''), session('blank'), missingPreset]) {
      const assembly = await handlers['system-prompt/assemble']!(emptyAssembly(), { agent: { session: foreign } }, nextAssembly)
      expect(assembly).toEqual({ ...emptyAssembly(), variables: { touched: 'yes' } })
      const decision = await handlers['agent/pre-step']!({ agent: { session: foreign }, signal: { throwIfAborted() {} } }, async () => ({ kind: 'enter' }))
      expect(decision).toEqual({ kind: 'enter' })
      const exec = { name: 'read', token: `foreign-${String(foreign.header.agentPreset)}`, agent: { session: foreign } }
      handlers['fs/observed']!({}, { kind: 'present', version: 'hidden-version' }, exec)
      const result = await handlers['tools/post-execute']!(exec, { content: [{ type: 'text', text: 'source' }] }, async () => ({ kind: 'accept' }))
      expect(result).toEqual({ kind: 'accept' })
    }
    for (const preset of WRITING_AGENT_PRESETS) {
      const exec = { name: 'read', token: `allow-${preset}`, agent: { session: session(preset) } }
      handlers['fs/observed']!({}, { kind: 'present', version: `version-${preset}` }, exec)
      const result = await handlers['tools/post-execute']!(exec, { content: [{ type: 'text', text: 'source' }] }, async () => ({ kind: 'accept' }))
      expect(result.content[1].text).toContain(`version-${preset}`)
    }
  })
})

describe('bot prompt freeze and handoff section', () => {
  it('returns the frozen assembly on later assembles despite changed preferences', async () => {
    const handlers: Record<string, (...args: any[]) => any> = {}
    const prefs: Record<string, unknown> = { authorPreferences: '第一版偏好' }
    const files = createMemoryContext({ 'AGENTS.md': '规则A' })
    const s = Session.create(SessionId('freeze-test'), [], { id: SessionId('freeze-test'), version: SESSION_FORMAT_VERSION, createdAt: 1, cwd: '/workspace', agentPreset: 'dsh-editor-writing', isSeeded: false })
    const ctx = {
      on: (name: string, fn: (...args: any[]) => any) => { handlers[name] = fn }, effect: () => {},
      fs: files.fs, sessions: { get: () => s },
      workspaceRegistry: { resolveByPath: async () => ({ path: '/workspace', sessionIds: ['freeze-test'] }) },
      sandboxPolicy: { resolve: () => files.policy },
      get: (name: string) => name === 'editorWritingPreferences' ? { read: () => prefs } : undefined,
    } as unknown as Context
    installProjectContextHooks(ctx)
    const next = async () => emptyAssembly()
    const first = await handlers['system-prompt/assemble']!(emptyAssembly(), { agent: { session: s } }, next)
    expect(renderPrompt(first)).toContain('第一版偏好')
    prefs.authorPreferences = '第二版偏好'
    const second = await handlers['system-prompt/assemble']!(emptyAssembly(), { agent: { session: s } }, next)
    expect(second.sections).toBe(first.sections)
    expect(second.variables).toBe(first.variables)
    expect(renderPrompt(second)).toContain('第一版偏好')
  })
})

describe('bot handoff section', () => {
  it('adds dsh-editor:handoff only when the segment records handoffText', async () => {
    const files = createMemoryContext({ 'AGENTS.md': '规则' })
    const make = (id: string) => Session.create(SessionId(id), [], { id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt: 1, cwd: '/workspace', agentPreset: 'dsh-editor-writing', isSeeded: false })
    const s = make('with-handoff')
    const ctx = {
      fs: files.fs, sessions: { get: () => s },
      workspaceRegistry: { resolveByPath: async () => ({ path: '/workspace', sessionIds: ['with-handoff', 'no-handoff'] }) },
      sandboxPolicy: { resolve: () => files.policy },
      get: () => undefined,
    } as unknown as Context
    mockBotState = emptyBotState()
    mockBotState.segments.push({ sessionId: 'with-handoff', startedAt: 1, reason: 'idle-expired', handoffMode: 'verbatim', handoffText: '交接文本体' })
    const assembly = await assembleProjectRules(ctx, emptyAssembly(), { session: s })
    expect(renderPrompt(assembly)).toContain('交接文本体')
    const other = make('no-handoff')
    const plain = await assembleProjectRules({ ...ctx, sessions: { get: () => other } } as unknown as Context, emptyAssembly(), { session: other })
    expect(plain.sections.some((section) => section.name === 'dsh-editor:handoff')).toBe(false)
    mockBotState = emptyBotState()
  })
})
