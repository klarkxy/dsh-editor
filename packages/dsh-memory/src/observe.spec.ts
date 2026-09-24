import { describe, expect, it } from 'vitest'
import { ACTIVITY_RETENTION_MS, contextIdentity, humanObservations, OBSERVE_PURPOSE, parseObservations } from './observe.ts'
import { MemoryRuntime } from './service.ts'
import { createMemoryStore } from './store.ts'
import { defaultSettings, type AiFeatureScope, type AuxiliaryResult, type MemoryRecord } from './contracts.ts'
import { assertDreamApply, dreamSourceVersion, parseDreamText, snapshotRecords } from './dream.ts'

const scope = { kind: 'project' as const, projectId: '/book' }
const user = (seq: number, text: string, kind = 'user') => ({ type: 'user/message', seq, data: { source: { kind }, content: [{ type: 'text', text }] } })
const meaning = '我说的蓝图指事件结构，不是正文。'
const activity = '我最近正在修改第三章，周末计划完成。'
const term = { kind: 'vocabulary', title: '蓝图的用法', content: '蓝图指事件结构，不是正文。', subject: 'user', domain: 'general', key: '蓝图', aliases: [], evidence: [{ seq: 1, quote: meaning }] }
const task = { kind: 'activity', title: '修改第三章', content: '正在修改第三章，周末计划完成。', subject: 'user', domain: 'general', key: '第三章', aliases: [], activityStatus: 'in-progress', eventTime: '周末', evidence: [{ seq: 2, quote: activity }] }
const output = (...items: unknown[]) => JSON.stringify({ items })
const sig = () => new AbortController().signal
function result(text: string): AuxiliaryResult {
  return { text, receipt: { id: 'r', plugin: 'test', purpose: OBSERVE_PURPOSE, sourceVersion: 'v', status: 'success', attempts: 1, cost: null, startedAt: 1, finishedAt: 2 } }
}
function setup(run: AiFeatureScope['run'], store = createMemoryStore()) {
  let calls = 0, now = 100, serial = 0
  const ai: AiFeatureScope = { plugin: 'test', active: true, signal: sig(), dispose() {}, registerPurpose: () => () => {}, run: request => { calls++; return run(request) } }
  const memory = new MemoryRuntime({ store, now: () => now, id: () => `record-${++serial}`, activateAi: () => ai })
  const events = [user(1, meaning)]
  const session = { id: 's', header: { cwd: '/book' }, snapshotEvents: () => events }
  return { memory, store, events, session, calls: () => calls, advance: (time: number) => { now = time } }
}
function record(kind: 'vocabulary' | 'activity', id: string, patch: Partial<MemoryRecord> = {}): MemoryRecord {
  const draft = parseObservations(output(kind === 'activity' ? task : term), [{ seq: 1, text: meaning }, { seq: 2, text: activity }], 's', scope, 100)[0]!
  return { ...draft, id, revision: 1, createdAt: 100, updatedAt: 100, ...patch }
}

describe('human-only contextual observation', () => {
  it('excludes plugin, tool and assistant text and accepts only actual human sequence references', () => {
    expect(humanObservations({ snapshotEvents: () => [user(1, meaning), user(2, '注入', 'plugin:other'), { ...user(3, '模型声称'), type: 'assistant/message' }, user(-1, 'invalid')] })).toEqual([{ seq: 1, text: meaning }])
    expect(parseObservations(output({ ...term, evidence: [{ seq: 2, quote: meaning }] }), [{ seq: 1, text: meaning }], 's', scope, 100)).toEqual([])
    expect(parseObservations(output({ ...term, evidence: [{ seq: 1, quote: '伪造原话' }] }), [{ seq: 1, text: meaning }], 's', scope, 100)).toEqual([])
  })

  it('stores stable vocabulary separately from bounded activity and preserves literal event time', () => {
    const rows = parseObservations(output(term, task), [{ seq: 1, text: meaning }, { seq: 2, text: activity }], 's', scope, 100)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'vocabulary', scope, context: { observedAt: 100, key: '蓝图' } })
    expect(rows[0]?.expiresAt).toBeUndefined()
    expect(rows[1]).toMatchObject({ kind: 'activity', expiresAt: 100 + ACTIVITY_RETENTION_MS, context: { activityStatus: 'in-progress', eventTime: '周末' } })
    expect(contextIdentity(rows[0]!)).not.toBe(contextIdentity({ ...rows[0]!, context: { ...rows[0]!.context!, subject: 'another author' } }))
    expect(contextIdentity(rows[0]!)).not.toBe(contextIdentity({ ...rows[0]!, scope: { kind: 'project', projectId: '/other' } }))
  })

  it.each([
    { evidence: {} }, { evidence: 'not an array' }, { subject: 'invented author' }, { domain: 'invented domain' },
    { aliases: ['invented alias'] }, { kind: 'lesson' }, { key: 'not in quote' }, { eventTime: '2026-09-25' },
  ])('fails closed on malformed or ungrounded metadata: %j', patch => {
    expect(parseObservations(output({ ...term, ...patch }), [{ seq: 1, text: meaning }], 's', scope, 100)).toEqual([])
  })

  it('never infers completion from a future plan or a passed date', () => {
    expect(parseObservations(output({ ...task, activityStatus: 'completed' }), [{ seq: 2, text: activity }], 's', scope, Date.now())).toEqual([])
    const done = '第三章已经完成。'
    expect(parseObservations(output({ ...task, activityStatus: 'completed', eventTime: undefined, evidence: [{ seq: 3, quote: done }] }), [{ seq: 3, text: done }], 's', scope, 200)[0]?.context?.activityStatus).toBe('completed')
  })

  it.each(['第三章已经完成了吗？', '如果第三章已经完成，就休息。', '第三章尚未完成。'])('rejects negated or hypothetical completion: %s', quote => {
    const item = { ...task, activityStatus: 'completed', eventTime: undefined, evidence: [{ seq: 3, quote }] }
    expect(parseObservations(output(item), [{ seq: 3, text: quote }], 's', scope, 200)).toEqual([])
  })

  it('prefers the latest explicit update rather than model output order', () => {
    const newer = { ...term, content: '蓝图现指场景安排', evidence: [{ seq: 3, quote: '蓝图现指场景安排' }] }
    const rows = parseObservations(output(newer, term), [{ seq: 1, text: meaning }, { seq: 3, text: '蓝图现指场景安排' }], 's', scope, 200)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.content).toBe(newer.content)
  })
})

describe('portable observer lifecycle', () => {
  it('observes once, supersedes a matching identity, isolates scope, and does not refresh stale activity on continue', async () => {
    const env = setup(async request => {
      expect(request.purpose).toBe(OBSERVE_PURPOSE)
      return result(env.events.length === 1 ? output(term) : output(task))
    })
    await env.memory.observeSession('s', env.session, sig())
    await env.memory.observeSession('s', env.session, sig())
    expect(env.calls()).toBe(1)
    env.events.push(user(2, activity))
    await env.memory.observeSession('s', env.session, sig())
    const recalled = await env.memory.recall({ scope, query: '继续' })
    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.kind).toBe('activity')
    expect(await env.memory.recall({ scope: { kind: 'project', projectId: '/other' }, query: '继续' })).toEqual([])
    env.advance(100 + ACTIVITY_RETENTION_MS)
    env.events.push(user(3, '继续'))
    await env.memory.observeSession('s', env.session, sig())
    expect(env.calls()).toBe(2)
    expect(await env.memory.recall({ scope, query: '继续' })).toEqual([])
    expect((await env.memory.recall({ scope, query: '蓝图' }))[0]?.kind).toBe('vocabulary')
  })

  it('replaces recent state atomically while retaining auditable history', async () => {
    const paused = '我先暂停第三章。'
    const env = setup(async () => result(output(env.events.at(-1)?.seq === 2 ? task : { ...task, activityStatus: 'paused', content: '第三章已暂停', eventTime: undefined, evidence: [{ seq: 3, quote: paused }] })))
    env.events.splice(0, 1, user(2, activity))
    await env.memory.observeSession('s', env.session, sig())
    env.events.push(user(3, paused)); env.advance(200)
    await env.memory.observeSession('s', env.session, sig())
    expect(env.memory.status().records.map(row => row.status)).toEqual(['superseded', 'active'])
    const current = (await env.memory.recall({ scope, query: '继续' }))[0]!
    expect(current.context?.activityStatus).toBe('paused')
    expect(current.supersedes).toEqual(['record-1'])
  })

  it('does not replay removed evidence after restart', async () => {
    const env = setup(async () => result(output(term)))
    await env.memory.observeSession('s', env.session, sig())
    const saved = env.memory.status().records[0]!
    await env.memory.remove(saved.id, saved.revision)
    await env.memory.dispose()
    const restarted = setup(async () => result(output(term)), env.store)
    await restarted.memory.observeSession('s', restarted.session, sig())
    expect(restarted.calls()).toBe(0)
    expect(restarted.memory.status().records).toEqual([])
  })

  it.each(['delete', 'edit', 'disable', 'new-message', 'same-seq-edit', 'scope-change'] as const)('rejects stale observation after %s', async mutation => {
    let finish!: (value: AuxiliaryResult) => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const env = setup(async () => { started(); return new Promise(resolve => { finish = resolve }) })
    const draft = parseObservations(output(term), [{ seq: 1, text: meaning }], 's', scope, 100)[0]!
    const existing = await env.memory.create(draft)
    const pending = env.memory.observeSession('s', env.session, sig())
    await ready
    if (mutation === 'delete') await env.memory.remove(existing.id, existing.revision)
    if (mutation === 'edit') await env.memory.update(existing.id, { content: '手动修订' }, existing.revision)
    if (mutation === 'disable') await env.memory.updateSettings({ ...defaultSettings(), dreamIdleEnabled: false }, 0)
    if (mutation === 'new-message') env.events.push(user(2, '另一个任务'))
    if (mutation === 'same-seq-edit') env.events.splice(0, 1, user(1, '蓝图的解释已经修改'))
    if (mutation === 'scope-change') env.session.header.cwd = '/other'
    finish(result(output(term)))
    await pending
    expect(env.memory.status().records).toHaveLength(mutation === 'delete' ? 0 : 1)
    if (mutation === 'edit') expect(env.memory.status().records[0]?.content).toBe('手动修订')
    if (mutation === 'delete' || mutation === 'edit') {
      await env.memory.observeSession('s', env.session, sig())
      expect(env.calls()).toBe(1)
    }
  })

  it('deduplicates concurrent hooks and never falls back to raw text on malformed model output', async () => {
    const env = setup(async () => result('invalid JSON'))
    await Promise.all([env.memory.observeSession('s', env.session, sig()), env.memory.observeSession('s', env.session, sig())])
    expect(env.calls()).toBe(1)
    expect(env.memory.status().records).toEqual([])
    expect(env.store.snapshot().observations?.[0]?.seq).toBe(1)
  })

  it('fails closed without a native cwd and when persistence fails', async () => {
    const env = setup(async () => result(output(term)))
    await env.memory.observeSession('s', { snapshotEvents: () => env.events }, sig())
    expect(env.calls()).toBe(0)
    env.store.failNext()
    await expect(env.memory.observeSession('s', env.session, sig())).rejects.toMatchObject({ code: 'MEMORY_SAVE_FAILED' })
    expect(env.memory.status().records).toEqual([])
    expect(env.store.snapshot().observations).toBeUndefined()
  })
})

describe('Dream cannot launder contextual claims', () => {
  const a = record('vocabulary', 'a')
  const proposal = (sourceIds: string[], kind = 'vocabulary') => ({ title: '合并', content: '蓝图含义', kind, sourceIds })
  it('rejects lessons, cross-kind, cross-author, unknown sources and duplicate reuse', () => {
    const other = record('vocabulary', 'b', { context: { ...a.context!, subject: 'other' } })
    const taskRecord = record('activity', 'c')
    const snapshot = snapshotRecords([a, other, taskRecord])
    const parse = (proposals: unknown[]) => parseDreamText(JSON.stringify({ proposals }), snapshot, scope)
    expect(parse([proposal(['a', 'b'])])).toEqual([])
    expect(parse([proposal(['a', 'c'])])).toEqual([])
    expect(parse([proposal(['a', 'missing'])])).toEqual([])
    expect(parse([proposal(['a'], 'lesson')])).toEqual([])
    expect(parse([proposal(['a']), proposal(['a'])])).toHaveLength(1)
    expect(parse([proposal(['a'])])[0]?.context).toEqual(a.context)
  })

  it('rechecks persisted proposals and refuses lesson sources or forged context at apply time', () => {
    const snapshot = snapshotRecords([a])
    const proposals = parseDreamText(JSON.stringify({ proposals: [proposal(['a'])] }), snapshot, scope)
    const plan = { id: 'd', revision: 1, sessionId: 's', status: 'preview' as const, sourceVersion: dreamSourceVersion(snapshot), snapshot, proposals, generation: 1, createdAt: 1, updatedAt: 1 }
    expect(() => assertDreamApply(plan, new Map([['a', { ...a, kind: 'lesson' }]]), new Set(), 101)).toThrow()
    plan.proposals[0]!.context!.observedAt = 999
    expect(() => assertDreamApply(plan, new Map([['a', a]]), new Set(), 101)).toThrow()
  })

  it('does not automatically activate candidate sources or fabricate evidence for old manual records', async () => {
    let id = ''
    const env = setup(async () => result(JSON.stringify({ proposals: [proposal([id])] })))
    const draft = parseObservations(output(term), [{ seq: 1, text: meaning }], 's', scope, 100)[0]!
    const candidate = await env.memory.create({ ...draft, status: 'candidate' })
    id = candidate.id
    const plan = await env.memory.previewDream('s', '/book')
    await env.memory.applyDream(plan.id, plan.revision)
    expect(env.memory.status().records.filter(row => row.source === 'dream')[0]?.status).toBe('candidate')
    expect(await env.memory.recall({ scope, query: '蓝图' })).toEqual([])
    const manual = await env.memory.create({ ...draft, source: 'user', evidence: [] })
    id = manual.id
    const missingEvidence = await env.memory.previewDream('s', '/book')
    expect(missingEvidence.proposals).toEqual([])
    expect(env.memory.status().records.find(row => row.id === manual.id)?.status).toBe('active')
  })
})
