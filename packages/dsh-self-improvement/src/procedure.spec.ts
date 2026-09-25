import { describe, expect, it } from 'vitest'
import { detectLessonTriggers } from './detect.ts'
import { candidateRecord, draftFromTrigger, parseExtraction } from './extract.ts'
import { canAutoActivate, groundedProcedure, parseProcedure } from './procedure.ts'
import { assistantMessage, pluginMessage, toolCall, toolResult, userMessage, tables, session } from './fakes.ts'
import { SelfImprovementEngine } from './engine.ts'
import { MemoryRuntime } from '../../dsh-memory/src/service.ts'
import { createMemoryStore } from '../../dsh-memory/src/store.ts'
import { memoryRecordSchema } from '../../dsh-memory/src/storage.ts'
import { assertCreatable } from '../../dsh-memory/src/evidence.ts'
import type { LessonTrigger, MemoryRecord } from './contracts.ts'

const text = '以后修改正文前先读取最新版本，再核对修改范围。'
const instruction: LessonTrigger = { kind: 'human-instruction', titleHint: '局部修改', contentHint: text, evidence: [{ sessionId: 's', seq: 2, kind: 'user', excerpt: text }] }
const method = { origin: 'instruction' as const, goal: '安全局部修改', when: ['局部修改正文'], steps: ['读取最新版本', '检查修改范围'], avoid: ['覆盖未经确认的改动'], verify: ['比较修改前后的差异'] }

describe('procedural classification and activation', () => {
  it.each(['不对，主角叫林秋。', '我说的是蓝图，不是正文。', '请修改第三章。', '这一次先读取文件再修改。', '例如：以后修改正文前先读取最新版本。', '角色说：“以后修改正文前先读取最新版本。”'])('does not turn a fact, a one-off request or a quotation into a fallback skill: %s', contentHint => {
    expect(draftFromTrigger({ ...instruction, contentHint })).toBeUndefined()
  })

  it('splits mixed messages and stores only their explicit method clause', () => {
    const trigger = { ...instruction, contentHint: `蓝图是事件结构，不是正文。${text}` }
    const draft = draftFromTrigger(trigger)!
    expect(draft.procedure?.steps).toEqual([text])
    expect(draft.content).not.toContain('蓝图')
    expect(canAutoActivate(draft, trigger)).toBe(true)
    const record = candidateRecord(draft, trigger, '/book')
    expect(record).toMatchObject({ kind: 'lesson', status: 'candidate', source: 'self-improvement', procedure: { origin: 'instruction' } })
    expect(() => assertCreatable(record)).not.toThrow()
  })

  it('requires structured method fields, exact provenance and a real instruction quote', () => {
    const parse = (patch: Record<string, unknown> = {}) => parseExtraction(JSON.stringify({ kind: 'procedure', title: '局部修改', procedure: method, evidenceQuotes: [text], exceptions: [], ...patch }))
    const draft = parse()!
    expect('skip' in draft).toBe(false)
    if ('skip' in draft) return
    expect(groundedProcedure(draft, instruction)).toBe(true)
    expect(groundedProcedure({ ...draft, evidenceQuotes: ['伪造原话'] }, instruction)).toBe(false)
    expect(groundedProcedure({ ...draft, evidenceQuotes: ['正文'] }, instruction)).toBe(false)
    expect(parse({ kind: 'vocabulary' })).toBeUndefined()
    expect(parse({ procedure: { ...method, verify: [] } })).toBeUndefined()
    expect(parse({ procedure: { ...method, steps: [], avoid: [] } })).toBeUndefined()
    expect(parseProcedure({ ...method, origin: 'verified' })).toBeUndefined()
  })

  it('never auto-activates positive feedback or tool observations, and does not use tools as user instructions', () => {
    expect(canAutoActivate({ procedure: { ...method, origin: 'observation' } }, instruction)).toBe(false)
    const tool: LessonTrigger = { ...instruction, kind: 'tool-recovery', evidence: [{ sessionId: 's', seq: 4, kind: 'tool', excerpt: text }] }
    expect(canAutoActivate({ procedure: method }, tool)).toBe(false)
    expect(groundedProcedure({ procedure: method, evidenceQuotes: [text] }, tool)).toBe(false)
    expect(draftFromTrigger(tool)).toBeUndefined()
    expect(detectLessonTriggers([assistantMessage(1, '过程'), userMessage(2, '这个方法有效：先检查范围再局部修改。')], 's')[0]?.kind).toBe('human-feedback')
    expect(detectLessonTriggers([pluginMessage(1, text)], 's')).toEqual([])
    expect(detectLessonTriggers([userMessage(1, text)], 's')[0]?.kind).toBe('human-instruction')
  })

  it('stores new procedure records in the shared schema while rejecting cross-lane writes', () => {
    const draft = candidateRecord(draftFromTrigger(instruction)!, instruction, '/book')
    expect(memoryRecordSchema.safeParse({ ...draft, id: 'm', revision: 1, createdAt: 1, updatedAt: 1 }).success).toBe(true)
    expect(() => assertCreatable({ ...draft, kind: 'project-fact' })).toThrow()
    expect(() => assertCreatable({ ...draft, source: 'dream' })).toThrow()
    expect(() => assertCreatable({ ...draft, context: { subject: 'user', domain: 'general', key: '蓝图', aliases: [], observedAt: 1 } })).toThrow()
  })
})

describe('tool outcome correlation', () => {
  const fail = [toolCall(1, 'edit', 'a', { path: 'one.md', old: 'a', new: 'b' }), toolResult(2, 'a', true, 'not found')]
  it.each([
    { path: 'other.md', old: 'c', new: 'b' },
    { path: 'one.md', old: 'a', new: 'b' },
    {},
  ])('does not learn from another target, unchanged retry or unknown target: %j', args => {
    expect(detectLessonTriggers([...fail, toolCall(3, 'edit', 'b', args), toolResult(4, 'b', false, 'ok')], 's')).toEqual([])
  })
  it('requires the same human task, and correlates across a processing watermark without reprocessing successes', () => {
    const recovery = [toolCall(4, 'edit', 'b', { path: 'one.md', old: 'c', new: 'b' }), toolResult(5, 'b', false, 'ok')]
    expect(detectLessonTriggers([...fail, userMessage(3, '新的任务'), ...recovery], 's')).toEqual([])
    expect(detectLessonTriggers([...fail, ...recovery], 's', 2)[0]?.kind).toBe('tool-recovery')
    expect(detectLessonTriggers([...fail, ...recovery], 's', 5)).toEqual([])
  })
  it('does not mistake future assistant activity for evidence preceding a correction', () => {
    expect(detectLessonTriggers([userMessage(1, '不对，主角叫林秋。'), assistantMessage(2, '回复')], 's')).toEqual([])
  })
})

describe('context before method selection', () => {
  it('restores Chinese task context for continue, without enabling Dream or using another project', async () => {
    const memory = new MemoryRuntime({ store: createMemoryStore(), now: () => 100 })
    await memory.updateSettings({ injectEnabled: true, dreamIdleEnabled: false, idleMs: 900000 }, 0)
    await memory.create({ ...candidateRecord(draftFromTrigger(instruction)!, instruction, '/book'), status: 'active' })
    const activity: Omit<MemoryRecord, 'id' | 'revision' | 'createdAt' | 'updatedAt'> = {
      kind: 'activity', scope: { kind: 'project', projectId: '/book' }, status: 'active', title: '当前工作', content: '局部修改正文',
      tags: [], evidence: [], exceptions: [], source: 'user', expiresAt: 200,
    }
    await memory.create(activity)
    const store = tables()
    const engine = new SelfImprovementEngine({ memory: () => memory, ai: () => undefined, sessionOf: () => session('s', '/book', []), ...store, now: () => 100 })
    expect(await engine.recordsForInjection('/book', '继续')).toHaveLength(1)
    expect(await engine.recordsForInjection('/other', '继续')).toEqual([])
    const current = memory.status().records.find(record => record.kind === 'activity')!
    await memory.update(current.id, { expiresAt: 100 }, current.revision)
    expect(await engine.recordsForInjection('/book', '继续')).toEqual([])
  })
})
