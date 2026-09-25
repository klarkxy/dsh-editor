import { describe, expect, it } from 'vitest'
import type { AiFeatureScope, AuxiliaryResult, DreamPlan, MemoryPersistedState, MemoryQuery, MemoryRecord, NewMemoryRecord } from './contracts.ts'
import { defaultSettings } from './contracts.ts'
import { dreamSourceVersion } from './dream.ts'
import { MemoryError } from './errors.ts'
import { MemoryRuntime } from './service.ts'
import { createMemoryStore } from './store.ts'
import { MAX_MEMORY_DREAMS, MAX_MEMORY_RECORDS, MAX_MEMORY_TOMBSTONES, memoryStateSchema } from './storage.ts'

function draft(patch: Partial<NewMemoryRecord> = {}): NewMemoryRecord {
  return {
    scope: { kind: 'project', projectId: '/work/novel' },
    kind: 'preference',
    status: 'active',
    title: '语气',
    content: '克制',
    tags: [],
    evidence: [{ sessionId: 's1', seq: 1, kind: 'user', excerpt: '语气要克制' }],
    exceptions: [],
    source: 'user',
    ...patch,
  }
}

function runtime(options?: { failAfter?: number; ai?: AiFeatureScope; id?: () => string; store?: ReturnType<typeof createMemoryStore> }) {
  let n = 0
  const store = options?.store ?? createMemoryStore({ failAfter: options?.failAfter })
  return {
    store,
    memory: new MemoryRuntime({
      store,
      now: () => 1_000,
      id: options?.id ?? (() => `id-${++n}`),
      activateAi: () => options?.ai,
      createInjectMessage: payload => payload,
    }),
  }
}

function aiScope(run: AiFeatureScope['run']): AiFeatureScope {
  return {
    plugin: 'dsh-memory',
    get signal() { return new AbortController().signal },
    active: true,
    registerPurpose: () => () => {},
    run,
    dispose() {},
  }
}

function success(text: string, sourceVersion: string): AuxiliaryResult {
  return {
    text,
    receipt: {
      id: 'u1', plugin: 'dsh-memory', purpose: 'memory.dream', sourceVersion,
      status: 'success', attempts: 1, cost: null, startedAt: 1, finishedAt: 2,
    },
  }
}

function humanEnter(text: string) {
  return {
    kind: 'enter' as const,
    messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }],
  }
}

describe('storage CAS and lifecycle', () => {
  it('makes a record visible only after a successful persist', async () => {
    const { memory, store } = runtime({ failAfter: 1 })
    await expect(memory.create(draft())).rejects.toMatchObject({ code: 'MEMORY_SAVE_FAILED' })
    expect(store.snapshot().records).toEqual([])
    expect(memory.status().records).toEqual([])
    const created = await memory.create(draft())
    expect(created.id).toBe('id-2')
    expect(await memory.list({ scope: { kind: 'project', projectId: '/work/novel' } })).toHaveLength(1)
  })

  it('does not resurrect tombstoned ids and rejects stale revisions', async () => {
    const { memory, store } = runtime()
    const created = await memory.create(draft())
    await memory.remove(created.id, created.revision)
    expect(store.snapshot().tombstones).toEqual([{ id: created.id, deletedAt: 1_000, lastRevision: 1 }])
    await expect(memory.update(created.id, { title: 'x' }, created.revision)).rejects.toMatchObject({ code: 'MEMORY_TOMBSTONE' })
    const other = await memory.create(draft({ title: '别的' }))
    await expect(memory.update(other.id, { title: '新' }, 0)).rejects.toMatchObject({ code: 'MEMORY_CONFLICT' })
  })

  it('recalls active project plus global, excluding lessons and candidates', async () => {
    const { memory } = runtime()
    await memory.create(draft({ title: '项目偏好' }))
    await memory.create(draft({ scope: { kind: 'global' }, title: '全局偏好' }))
    await memory.create(draft({ kind: 'lesson', status: 'active', title: '教训', source: 'self-improvement' }))
    await memory.create(draft({ status: 'candidate', title: '候选', source: 'user' }))
    const recalled = await memory.recall({ scope: { kind: 'project', projectId: '/work/novel' }, query: '偏好' })
    expect(recalled.map(item => item.title).sort()).toEqual(['全局偏好', '项目偏好'])
  })

  it('cancels injection after disable and still preserves records', async () => {
    const { memory } = runtime()
    const created = await memory.create(draft())
    let nextCalls = 0
    const enter = humanEnter('语气要克制')
    const injected = await memory.handlePreStep({
      sessionId: 's1',
      session: { meta: { cwd: '/work/novel' } },
      signal: new AbortController().signal,
      next: async () => { nextCalls += 1; return enter },
    })
    expect(nextCalls).toBe(1)
    expect(injected.kind).toBe('enter')
    if (injected.kind === 'enter') expect(injected.messages[0]).toMatchObject({ source: { kind: 'plugin:@klarkxy/dsh-memory', plugin: '@klarkxy/dsh-memory' } })
    await memory.updateSettings({ injectEnabled: false, dreamIdleEnabled: false, idleMs: 15 * 60_000 }, 0)
    const stripped = await memory.handlePreStep({
      sessionId: 's1',
      session: { meta: { cwd: '/work/novel' } },
      signal: new AbortController().signal,
      next: async () => { nextCalls += 1; return injected },
    })
    expect(nextCalls).toBe(2)
    if (stripped.kind === 'enter') expect(stripped.messages.every(message => !message || typeof message !== 'object' || (message as { source?: { kind?: string } }).source?.kind !== 'plugin:@klarkxy/dsh-memory')).toBe(true)
    expect((await memory.list({ scope: { kind: 'project', projectId: '/work/novel' } })).map(item => item.id)).toEqual([created.id])
  })

  it('always calls next() even when rejected or disabled', async () => {
    const { memory } = runtime()
    await memory.updateSettings({ injectEnabled: false, dreamIdleEnabled: false, idleMs: 15 * 60_000 }, 0)
    const decision = await memory.handlePreStep({
      sessionId: 's1', session: {}, signal: new AbortController().signal,
      next: async () => ({ kind: 'reject' }),
    })
    expect(decision).toEqual({ kind: 'reject' })
  })
})

describe('dream CAS', () => {
  it('applies merges into active injectable records and supersedes the sources', async () => {
    const { memory } = runtime({
      ai: aiScope(async request => success(JSON.stringify({
        proposals: [{ title: '合并语气', content: '更克制', kind: 'preference', sourceIds: ['id-1'] }],
      }), request.sourceVersion)),
    })
    const created = await memory.create(draft())
    const plan = await memory.previewDream('s1', '/work/novel')
    expect(plan.status).toBe('preview')
    expect(plan.proposals).toHaveLength(1)
    expect(plan.sourceVersion).toMatch(/^[0-9a-f]{64}$/)
    const applied = await memory.applyDream(plan.id, plan.revision)
    expect(applied.status).toBe('applied')
    const derived = (await memory.list({ scope: { kind: 'project', projectId: '/work/novel' }, statuses: ['active'] }))
      .filter(item => item.source === 'dream')
    expect(derived).toHaveLength(1)
    expect(derived[0]?.status).toBe('active')
    expect(derived[0]?.basis).toEqual([{ id: created.id, revision: created.revision }])
    const recalled = await memory.recall({ scope: { kind: 'project', projectId: '/work/novel' }, query: '语气' })
    expect(recalled.map(item => item.id)).toContain(derived[0]!.id)
    expect(memory.status().records.find(item => item.id === created.id)?.status).toBe('superseded')
  })

  it('fails apply after correction or deletion and never resurrects', async () => {
    const { memory } = runtime({
      ai: aiScope(async request => success(JSON.stringify({
        proposals: [{ title: '合并', content: 'x', kind: 'preference', sourceIds: ['id-1'] }],
      }), request.sourceVersion)),
    })
    const created = await memory.create(draft())
    const plan = await memory.previewDream('s1', '/work/novel')
    await memory.update(created.id, { content: '已修正' }, created.revision)
    await expect(memory.applyDream(plan.id, plan.revision)).rejects.toBeInstanceOf(MemoryError)
    const plan2 = await memory.previewDream('s1', '/work/novel')
    await memory.remove(created.id, created.revision + 1)
    const stale = memory.status().dreams.find(item => item.id === plan2.id)
    expect(stale?.status).toBe('stale')
    await expect(memory.applyDream(plan2.id, stale?.revision ?? plan2.revision)).rejects.toBeInstanceOf(MemoryError)
    expect(await memory.list({ scope: { kind: 'project', projectId: '/work/novel' } })).toEqual([])
  })

  it('drops late dream results after disable', async () => {
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const { memory } = runtime({
      ai: aiScope(async request => {
        await blocked
        return success('{"proposals":[]}', request.sourceVersion)
      }),
    })
    await memory.create(draft())
    const pending = memory.previewDream('s1', '/work/novel')
    await memory.updateSettings({ injectEnabled: false, dreamIdleEnabled: false, idleMs: 15 * 60_000 }, 0)
    release()
    const plan = await pending
    expect(plan.status === 'stale' || plan.status === 'cancelled' || plan.status === 'preview').toBe(true)
    if (plan.status === 'preview') expect(plan.proposals).toEqual([])
  })
})

describe('idle dream auto-run', () => {
  it('applies a non-empty plan, stamps the attempt time, and injects the derived record immediately', async () => {
    const { memory } = runtime({
      ai: aiScope(async request => success(JSON.stringify({
        proposals: [{ title: '合并语气', content: '更克制', kind: 'preference', sourceIds: ['id-1'] }],
      }), request.sourceVersion)),
    })
    await memory.create(draft())
    const applied = await memory.runIdleDream('s1', '/work/novel', 'idle')
    expect(applied.status).toBe('applied')
    expect(memory.dreamLastAttemptAt).toBe(1_000)
    const derived = (await memory.list({ scope: { kind: 'project', projectId: '/work/novel' }, statuses: ['active'] }))
      .filter(item => item.source === 'dream')
    expect(derived).toHaveLength(1)
    const recalled = await memory.recall({ scope: { kind: 'project', projectId: '/work/novel' }, query: '语气' })
    expect(recalled.map(item => item.id)).toContain(derived[0]!.id)
    expect(memory.dreamMaterialCount()).toBe(0)
  })

  it('marks an empty plan as noop, stamps the attempt, and writes no candidates', async () => {
    const { memory } = runtime({
      ai: aiScope(async request => success('{"proposals":[]}', request.sourceVersion)),
    })
    await memory.create(draft())
    const plan = await memory.runIdleDream('s1', '/work/novel', 'idle')
    expect(plan.status).toBe('noop')
    expect(memory.status().dreams.find(item => item.id === plan.id)?.status).toBe('noop')
    expect(memory.dreamLastAttemptAt).toBe(1_000)
    expect(await memory.list({ scope: { kind: 'project', projectId: '/work/novel' }, statuses: ['candidate'] })).toEqual([])
  })

  it('stamps the attempt and records a failed dream when the model run fails', async () => {
    const { memory } = runtime({
      ai: aiScope(async request => ({
        text: '',
        receipt: {
          id: 'u1', plugin: 'dsh-memory', purpose: 'memory.dream', sourceVersion: request.sourceVersion,
          status: 'failed', attempts: 1, cost: null, startedAt: 1, finishedAt: 2, error: '模型调用失败。',
        },
      })),
    })
    await memory.create(draft())
    const plan = await memory.runIdleDream('s1', '/work/novel', 'idle')
    expect(plan.status).toBe('failed')
    expect(memory.dreamLastAttemptAt).toBe(1_000)
    expect(memory.status().dreams.filter(item => item.status === 'failed')).toHaveLength(1)
  })

  it('records a failed dream and backoff stamp when AI is unavailable', async () => {
    const { memory } = runtime()
    await memory.create(draft())
    await expect(memory.runIdleDream('s1', '/work/novel', 'idle')).rejects.toMatchObject({ code: 'MEMORY_AI_UNAVAILABLE' })
    expect(memory.dreamLastAttemptAt).toBe(1_000)
    const dreams = memory.status().dreams
    expect(dreams).toHaveLength(1)
    expect(dreams[0]?.status).toBe('failed')
    expect(dreams[0]?.snapshot).toEqual([])
  })

  it('keeps a stale plan stale when apply no longer validates, and still stamps the attempt', async () => {
    let now = 10
    let n = 0
    const memory = new MemoryRuntime({
      store: createMemoryStore(),
      now: () => now,
      id: () => `id-${++n}`,
      activateAi: () => aiScope(async request => {
        now = 2_000
        return success(JSON.stringify({
          proposals: [{ title: '合并', content: '更克制', kind: 'preference', sourceIds: ['id-1'] }],
        }), request.sourceVersion)
      }),
      createInjectMessage: payload => payload,
    })
    await memory.create(draft({ expiresAt: 1_000 }))
    const settled = await memory.runIdleDream('s1', '/work/novel', 'idle')
    expect(settled.status).toBe('stale')
    expect(memory.dreamLastAttemptAt).toBe(2_000)
    expect(memory.status().records.filter(item => item.source === 'dream')).toEqual([])
  })
})

describe('uuid restart, aggregate persist, basis, and inject races', () => {
  it('refuses sequential ids that collide after restart, and default ids stay unique', async () => {
    const store = createMemoryStore()
    const first = runtime({ store })
    const created = await first.memory.create(draft())
    expect(created.id).toBe('id-1')
    const restarted = runtime({ store })
    await expect(restarted.memory.create(draft({ title: '第二' }))).rejects.toMatchObject({ code: 'MEMORY_CONFLICT' })
    const uuidStore = createMemoryStore()
    const a = new MemoryRuntime({ store: uuidStore, now: () => 1 })
    const left = await a.create(draft())
    const b = new MemoryRuntime({ store: uuidStore, now: () => 1 })
    const right = await b.create(draft({ title: '另一条' }))
    expect(left.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(right.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(left.id).not.toBe(right.id)
    expect(uuidStore.snapshot().records.map(item => item.id).sort()).toEqual([left.id, right.id].sort())
  })

  it('does not reuse a tombstoned id after restart', async () => {
    const store = createMemoryStore()
    const first = runtime({ store, id: () => 'fixed-id' })
    const created = await first.memory.create(draft())
    await first.memory.remove(created.id, created.revision)
    const restarted = runtime({ store, id: () => 'fixed-id' })
    await expect(restarted.memory.create(draft({ title: '复活' }))).rejects.toMatchObject({ code: 'MEMORY_TOMBSTONE' })
    expect(restarted.memory.status().records).toEqual([])
  })

  it('persists apply supersede and accept in one aggregate write, and rolls back when save fails', async () => {
    const { memory, store } = runtime({
      ai: aiScope(async request => success(JSON.stringify({
        proposals: [{ title: '合并语气', content: '更克制', kind: 'preference', sourceIds: ['id-1'] }],
      }), request.sourceVersion)),
    })
    const source = await memory.create(draft())
    const plan = await memory.previewDream('s1', '/work/novel')
    const applied = await memory.applyDream(plan.id, plan.revision)
    expect(applied.status).toBe('applied')
    const derived = memory.status().records.find(item => item.source === 'dream')!
    expect(derived.status).toBe('active')
    expect(memory.status().records.find(item => item.id === source.id)?.status).toBe('superseded')
    const legacy = await memory.create(draft({
      status: 'candidate',
      title: '遗留候选',
      basis: [{ id: source.id, revision: source.revision + 1 }],
    }))
    store.failNext()
    await expect(memory.accept(legacy.id, legacy.revision)).rejects.toMatchObject({ code: 'MEMORY_SAVE_FAILED' })
    expect(store.snapshot().records.find(item => item.id === legacy.id)?.status).toBe('candidate')
    expect(store.snapshot().records.find(item => item.id === source.id)?.status).toBe('superseded')
    expect(memory.status().records.find(item => item.id === legacy.id)?.status).toBe('candidate')
    const accepted = await memory.accept(legacy.id, legacy.revision)
    expect(accepted.status).toBe('active')
    expect(memory.status().records.find(item => item.id === legacy.id)?.status).toBe('active')
  })

  it('revalidates exact basis revisions on adoption', async () => {
    const { memory } = runtime()
    const source = await memory.create(draft())
    const legacy = await memory.create(draft({
      status: 'candidate',
      title: '合并',
      content: '更克制',
      basis: [{ id: source.id, revision: source.revision }],
    }))
    await memory.update(source.id, { content: '已修正' }, source.revision)
    await expect(memory.accept(legacy.id, legacy.revision)).rejects.toMatchObject({ code: 'MEMORY_STALE' })
    expect(memory.status().records.find(item => item.id === legacy.id)?.status).toBe('candidate')
    expect(memory.status().records.find(item => item.id === source.id)?.status).toBe('active')
  })

  it('does not inject after await if injection was disabled mid-recall', async () => {
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    class SlowRecall extends MemoryRuntime {
      override async recall(query: MemoryQuery): Promise<MemoryRecord[]> {
        await blocked
        return super.recall(query)
      }
    }
    const slow = new SlowRecall({
      store: createMemoryStore(),
      now: () => 1_000,
      id: () => 'slow-1',
      createInjectMessage: payload => payload,
    })
    await slow.create(draft())
    const pending = slow.handlePreStep({
      sessionId: 's1',
      session: { meta: { cwd: '/work/novel' } },
      signal: new AbortController().signal,
      next: async () => humanEnter('语气克制'),
    })
    await slow.updateSettings({ injectEnabled: false, dreamIdleEnabled: false, idleMs: 15 * 60_000 }, 0)
    release()
    const decision = await pending
    expect(decision.kind).toBe('enter')
    if (decision.kind === 'enter') {
      expect(decision.messages.every(message => !message || typeof message !== 'object' || (message as { source?: { kind?: string } }).source?.kind !== 'plugin:@klarkxy/dsh-memory')).toBe(true)
    }
  })

  it('does not publish a partial dream apply when the aggregate save fails', async () => {
    const { memory, store } = runtime({
      ai: aiScope(async request => success(JSON.stringify({
        proposals: [{ title: '合并语气', content: '更克制', kind: 'preference', sourceIds: ['id-1'] }],
      }), request.sourceVersion)),
    })
    await memory.create(draft())
    const plan = await memory.previewDream('s1', '/work/novel')
    store.failNext()
    await expect(memory.applyDream(plan.id, plan.revision)).rejects.toMatchObject({ code: 'MEMORY_SAVE_FAILED' })
    expect(store.snapshot().records.filter(item => item.status === 'candidate')).toEqual([])
    expect(memory.status().records.filter(item => item.status === 'candidate')).toEqual([])
    expect(memory.status().dreams.find(item => item.id === plan.id)?.status).toBe('preview')
  })
})

describe('dream expiry liveness', () => {
  function clockRuntime() {
    let now = 10
    let n = 0
    let payload = ''
    const store = createMemoryStore()
    const memory = new MemoryRuntime({
      store,
      now: () => now,
      id: () => `id-${++n}`,
      activateAi: () => aiScope(async request => {
        payload = request.input
        return success(JSON.stringify({
          proposals: [{ title: '合并', content: '更克制', kind: 'preference', sourceIds: JSON.parse(request.input).records.map((row: { id: string }) => row.id) }],
        }), request.sourceVersion)
      }),
      createInjectMessage: item => item,
    })
    return {
      store,
      memory,
      input: () => payload,
      setNow(value: number) { now = value },
    }
  }

  it('omits already-expired sources from preview and model input', async () => {
    const clock = clockRuntime()
    clock.setNow(100)
    await clock.memory.create(draft({ title: '临时语气', content: '活动期间克制', expiresAt: 50 }))
    const live = await clock.memory.create(draft({ title: '长期语气', content: '一直克制' }))
    const plan = await clock.memory.previewDream('s1', '/work/novel')
    expect(plan.snapshot.map(entry => entry.id)).toEqual([live.id])
    const sent = JSON.parse(clock.input()) as { records: Array<{ id: string; expiresAt: number | null }> }
    expect(sent.records.map(row => row.id)).toEqual([live.id])
    expect(sent.records[0]?.expiresAt).toBeNull()
  })

  it('invalidates apply after now advances past source expiry and does not create a perpetual candidate', async () => {
    const clock = clockRuntime()
    const source = await clock.memory.create(draft({ title: '临时语气', content: '活动期间克制', expiresAt: 50 }))
    const plan = await clock.memory.previewDream('s1', '/work/novel')
    expect(plan.snapshot.map(entry => entry.id)).toEqual([source.id])
    clock.setNow(100)
    await expect(clock.memory.applyDream(plan.id, plan.revision)).rejects.toMatchObject({ code: 'MEMORY_STALE' })
    expect(clock.memory.status().records.filter(item => item.source === 'dream')).toEqual([])
    expect(await clock.memory.recall({ scope: { kind: 'project', projectId: '/work/novel' }, query: '临时语气' })).toEqual([])
  })

  it('stamps earliest source expiry on auto-apply and keeps the derivative active', async () => {
    const clock = clockRuntime()
    await clock.memory.create(draft({ title: '临时语气', content: '活动期间克制', expiresAt: 50 }))
    const plan = await clock.memory.previewDream('s1', '/work/novel')
    const applied = await clock.memory.applyDream(plan.id, plan.revision)
    expect(applied.status).toBe('applied')
    const derived = clock.memory.status().records.find(item => item.source === 'dream')
    expect(derived?.expiresAt).toBe(50)
    expect(derived?.status).toBe('active')
    clock.setNow(100)
    expect(clock.memory.status().records.find(item => item.source === 'dream')?.status).toBe('active')
    expect(await clock.memory.recall({ scope: { kind: 'project', projectId: '/work/novel' }, query: '克制' })).toEqual([])
  })

  it('recalls an applied derivative only until the inherited expiry', async () => {
    const clock = clockRuntime()
    await clock.memory.create(draft({ title: '临时语气', content: '活动期间克制', expiresAt: 80 }))
    const plan = await clock.memory.previewDream('s1', '/work/novel')
    await clock.memory.applyDream(plan.id, plan.revision)
    const derived = clock.memory.status().records.find(item => item.source === 'dream')!
    expect(derived.status).toBe('active')
    expect((await clock.memory.recall({ scope: { kind: 'project', projectId: '/work/novel' }, query: '克制' })).map(item => item.id)).toEqual([derived.id])
    clock.setNow(80)
    expect(await clock.memory.recall({ scope: { kind: 'project', projectId: '/work/novel' }, query: '克制' })).toEqual([])
  })
})

describe('promoteToGlobal', () => {
  it('promotes the same id in one persist and keeps evidence, exceptions, expiry, and basis', async () => {
    const { memory, store } = runtime()
    const created = await memory.create(draft({
      status: 'candidate',
      evidence: [{ sessionId: 's1', seq: 3, kind: 'user', excerpt: '克制' }],
      exceptions: ['对话里的玩笑除外'],
      expiresAt: 9_000,
      basis: [{ id: 'src-1', revision: 2 }],
    }))
    const promoted = await memory.promoteToGlobal(created.id, created.revision)
    expect(promoted).toMatchObject({
      id: created.id,
      status: 'active',
      scope: { kind: 'global' },
      expiresAt: 9_000,
      evidence: created.evidence,
      exceptions: created.exceptions,
      basis: [{ id: 'src-1', revision: 2 }],
      title: created.title,
      content: created.content,
    })
    expect(promoted.revision).toBe(created.revision + 1)
    expect(store.snapshot().records).toHaveLength(1)
    expect(store.snapshot().records[0]?.id).toBe(created.id)
    expect(store.snapshot().records[0]?.scope).toEqual({ kind: 'global' })
    const reopened = new MemoryRuntime({ store, now: () => 1_000 })
    const listed = await reopened.list({ scope: { kind: 'global' }, statuses: ['active'] })
    expect(listed).toEqual([expect.objectContaining({ id: created.id, expiresAt: 9_000, scope: { kind: 'global' } })])
  })

  it('rejects expired and stale revisions and does not change scope', async () => {
    const { memory, store } = runtime()
    const live = await memory.create(draft())
    await expect(memory.promoteToGlobal(live.id, 0)).rejects.toMatchObject({ code: 'MEMORY_CONFLICT' })
    expect(store.snapshot().records[0]?.scope).toEqual({ kind: 'project', projectId: '/work/novel' })
    const expired = await memory.create(draft({ title: '过期', expiresAt: 50 }))
    await expect(memory.promoteToGlobal(expired.id, expired.revision)).rejects.toMatchObject({ code: 'MEMORY_STALE' })
    expect(memory.status().records.find(item => item.id === expired.id)?.scope.kind).toBe('project')
    const rejected = await memory.create(draft({ title: '已拒绝', status: 'rejected' }))
    await expect(memory.promoteToGlobal(rejected.id, rejected.revision)).rejects.toMatchObject({ code: 'MEMORY_INVALID' })
  })

  it('does not publish a partial promote when the aggregate save fails, including after reopen', async () => {
    const { memory, store } = runtime()
    const created = await memory.create(draft({ expiresAt: 8_000, exceptions: ['旁白除外'] }))
    store.failNext()
    await expect(memory.promoteToGlobal(created.id, created.revision)).rejects.toMatchObject({ code: 'MEMORY_SAVE_FAILED' })
    expect(memory.status().records).toEqual([expect.objectContaining({
      id: created.id, revision: 1, scope: { kind: 'project', projectId: '/work/novel' }, expiresAt: 8_000,
    })])
    expect(store.snapshot().records).toEqual([expect.objectContaining({
      id: created.id, scope: { kind: 'project', projectId: '/work/novel' }, expiresAt: 8_000,
    })])
    const reopened = new MemoryRuntime({ store, now: () => 1_000 })
    expect(reopened.status().records).toEqual([expect.objectContaining({
      id: created.id, status: 'active', scope: { kind: 'project', projectId: '/work/novel' }, expiresAt: 8_000,
    })])
  })

  it('does not let a generic update expand project scope to global', async () => {
    const { memory } = runtime()
    const created = await memory.create(draft())
    const updated = await memory.update(created.id, { title: '仍是项目' }, created.revision)
    expect(updated.scope).toEqual({ kind: 'project', projectId: '/work/novel' })
    expect(updated.id).toBe(created.id)
  })
})

const guardedMutations = ['create', 'update', 'promoteToGlobal', 'remove'] as const

function queueGuarded(
  memory: MemoryRuntime,
  seed: MemoryRecord,
  kind: (typeof guardedMutations)[number],
  options: { signal?: AbortSignal; isCurrent?: () => boolean },
) {
  if (kind === 'create') return memory.create(draft({ title: '不该写入' }), options)
  if (kind === 'update') return memory.update(seed.id, { title: '已激活' }, seed.revision, options)
  if (kind === 'promoteToGlobal') return memory.promoteToGlobal(seed.id, seed.revision, options)
  return memory.remove(seed.id, seed.revision, options)
}

async function behindHeldCreate(kind: (typeof guardedMutations)[number]) {
  const { memory, store } = runtime()
  const seed = await memory.create(draft({
    title: '种子',
    expiresAt: 9_000,
    exceptions: ['旁白除外'],
  }))
  const hold = store.holdNextSave()
  const blocking = memory.create(draft({ title: '阻塞写入' }))
  await hold.started
  return { memory, store, seed, hold, blocking }
}

function expectSeedPreserved(store: ReturnType<typeof createMemoryStore>, seed: MemoryRecord) {
  expect(store.snapshot().records.find(row => row.id === seed.id)).toMatchObject({
    id: seed.id,
    title: '种子',
    revision: 1,
    expiresAt: 9_000,
    exceptions: ['旁白除外'],
    status: 'active',
    scope: { kind: 'project', projectId: '/work/novel' },
  })
  expect(store.snapshot().records.some(row => row.title === '不该写入')).toBe(false)
  expect(store.snapshot().tombstones).toEqual([])
}

describe('serialized mutation lifetime guards', () => {
  it('rejects expired isCurrent for queued create, update, promoteToGlobal, and remove without writing', async () => {
    for (const kind of guardedMutations) {
      const { memory, store, seed, hold, blocking } = await behindHeldCreate(kind)
      let allowed = true
      const queued = queueGuarded(memory, seed, kind, { isCurrent: () => allowed })
      allowed = false
      hold.release()
      await expect(queued).rejects.toMatchObject({ code: 'MEMORY_CANCELLED' })
      await blocking
      expect(memory.status().storageFailed).toBe(false)
      expectSeedPreserved(store, seed)
      expect(store.snapshot().records.some(row => row.title === '阻塞写入')).toBe(true)
    }
  })

  it('rejects an aborted signal for queued create, update, promoteToGlobal, and remove without writing', async () => {
    for (const kind of guardedMutations) {
      const { memory, store, seed, hold, blocking } = await behindHeldCreate(kind)
      const abort = new AbortController()
      const queued = queueGuarded(memory, seed, kind, { signal: abort.signal })
      abort.abort()
      hold.release()
      await expect(queued).rejects.toMatchObject({ code: 'MEMORY_CANCELLED' })
      await blocking
      expect(memory.status().storageFailed).toBe(false)
      expectSeedPreserved(store, seed)
    }
  })

  it('rejects isCurrent that throws for a queued update and does not mark storage failed', async () => {
    const { memory, store, seed, hold, blocking } = await behindHeldCreate('update')
    const queued = queueGuarded(memory, seed, 'update', { isCurrent: () => { throw new Error('lifetime lost') } })
    hold.release()
    await expect(queued).rejects.toMatchObject({ code: 'MEMORY_CANCELLED' })
    await blocking
    expect(memory.status().storageFailed).toBe(false)
    expectSeedPreserved(store, seed)
  })

  it('still applies an unguarded queued update after the held save completes', async () => {
    const { memory, store, seed, hold, blocking } = await behindHeldCreate('update')
    const queued = memory.update(seed.id, { title: '已改' }, seed.revision)
    hold.release()
    await blocking
    await expect(queued).resolves.toMatchObject({ id: seed.id, title: '已改', expiresAt: 9_000 })
    expect(store.snapshot().records.find(row => row.id === seed.id)?.title).toBe('已改')
  })
})

function seedRecord(id: string, patch: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id, revision: 1, scope: { kind: 'project', projectId: '/work/novel' }, kind: 'preference', status: 'active',
    title: '语气', content: '克制', tags: [], evidence: [], exceptions: [], source: 'user', createdAt: 1, updatedAt: 1,
    ...patch,
  }
}

function seedDream(id: string, patch: Partial<DreamPlan> = {}): DreamPlan {
  return {
    id, revision: 1, sessionId: 's1', status: 'applied', sourceVersion: 'v', snapshot: [], proposals: [],
    generation: 0, createdAt: 1, updatedAt: 1, ...patch,
  }
}

function filled(patch: Partial<MemoryPersistedState> = {}): MemoryPersistedState {
  return { settings: defaultSettings(), records: [], tombstones: [], dreams: [], ...patch }
}

function reopen(store: ReturnType<typeof createMemoryStore>, options?: { id?: () => string; ai?: AiFeatureScope }) {
  return new MemoryRuntime({
    store,
    now: () => 1_000,
    id: options?.id,
    activateAi: () => options?.ai,
    createInjectMessage: payload => payload,
  })
}

describe('bounded persist, capacity, and fail-closed history', () => {
  it('compacts enough terminal dream history so saved and reloaded state pass schema', async () => {
    const store = createMemoryStore({
      initial: filled({
        records: [seedRecord('src')],
        dreams: Array.from({ length: MAX_MEMORY_DREAMS + 40 }, (_, index) => seedDream(`hist-${index}`, {
          status: index % 2 ? 'cancelled' : 'applied',
          createdAt: index,
          updatedAt: index,
        })),
      }),
    })
    const memory = reopen(store, { id: () => 'fresh' })
    const created = await memory.create(draft({ title: '新条目' }))
    expect(created.id).toBe('fresh')
    expect(store.snapshot().dreams).toHaveLength(MAX_MEMORY_DREAMS)
    expect(memoryStateSchema.safeParse(store.snapshot()).success).toBe(true)
    const reloaded = reopen(store)
    expect(reloaded.status().records.map(item => item.id)).toEqual(['src', 'fresh'])
    expect(reloaded.status().dreams).toHaveLength(MAX_MEMORY_DREAMS)
    expect(memoryStateSchema.safeParse(store.snapshot()).success).toBe(true)
  })

  it('returns MEMORY_CAPACITY without storageFailed, preserves state, and recovers after delete or cancel', async () => {
    const records = Array.from({ length: MAX_MEMORY_RECORDS }, (_, index) => seedRecord(`rec-${index}`, {
      title: `条目${index}`,
    }))
    const store = createMemoryStore({ initial: filled({ records }) })
    const memory = reopen(store, { id: () => 'overflow' })
    await expect(memory.create(draft({ title: '超出' }))).rejects.toMatchObject({ code: 'MEMORY_CAPACITY' })
    expect(memory.status().storageFailed).toBe(false)
    expect(memory.status().records).toHaveLength(MAX_MEMORY_RECORDS)
    expect(store.snapshot().records).toHaveLength(MAX_MEMORY_RECORDS)
    expect(store.snapshot().records.some(item => item.id === 'overflow')).toBe(false)
    const settings = await memory.updateSettings({
      injectEnabled: true, dreamIdleEnabled: false, idleMs: 15 * 60_000,
    }, 0)
    expect(settings.revision).toBe(1)
    expect(memory.status().storageFailed).toBe(false)
    await memory.remove('rec-0', 1)
    const created = await memory.create(draft({ title: '腾出后写入' }))
    expect(created.id).toBe('overflow')
    expect(memory.status().storageFailed).toBe(false)
    expect(memoryStateSchema.safeParse(store.snapshot()).success).toBe(true)

    const dreamStore = createMemoryStore({
      initial: filled({
        records: [seedRecord('src')],
        dreams: Array.from({ length: MAX_MEMORY_DREAMS }, (_, index) => seedDream(`prev-${index}`, {
          status: 'preview', createdAt: index, updatedAt: index,
        })),
      }),
    })
    const dreaming = reopen(dreamStore, {
      id: () => 'new-dream',
      ai: aiScope(async request => success('{"proposals":[]}', request.sourceVersion)),
    })
    await expect(dreaming.previewDream('s1', '/work/novel')).rejects.toMatchObject({ code: 'MEMORY_CAPACITY' })
    expect(dreaming.status().storageFailed).toBe(false)
    expect(dreamStore.snapshot().dreams).toHaveLength(MAX_MEMORY_DREAMS)
    expect(dreamStore.snapshot().dreams.some(plan => plan.id === 'new-dream')).toBe(false)
    await dreaming.cancelDream('prev-0', 1)
    const plan = await dreaming.previewDream('s1', '/work/novel')
    expect(plan.id).toBe('new-dream')
    expect(plan.status).toBe('preview')
    expect(dreaming.status().storageFailed).toBe(false)
    expect(dreamStore.snapshot().dreams).toHaveLength(MAX_MEMORY_DREAMS)
    expect(dreamStore.snapshot().dreams.some(item => item.id === 'prev-0')).toBe(false)
    expect(memoryStateSchema.safeParse(dreamStore.snapshot()).success).toBe(true)
  })

  it('does not resurrect a referenced deletion through a stale dream after compact and reload', async () => {
    const snapshot = [{
      id: 'gone', revision: 1, status: 'active' as const, scope: { kind: 'project' as const, projectId: '/work/novel' },
    }]
    const store = createMemoryStore({
      initial: filled({
        records: [seedRecord('live')],
        tombstones: [
          { id: 'gone', deletedAt: 1, lastRevision: 1 },
          ...Array.from({ length: MAX_MEMORY_TOMBSTONES }, (_, index) => ({
            id: `free-${index}`, deletedAt: 2 + index, lastRevision: 1,
          })),
        ],
        dreams: [
          seedDream('stale-preview', {
            status: 'preview',
            createdAt: 10_000,
            updatedAt: 10_000,
            sourceVersion: dreamSourceVersion(snapshot),
            snapshot,
            proposals: [{
              title: '复活', content: '不该出现', kind: 'preference', tags: ['dream'], exceptions: [],
              evidence: [], sourceIds: ['gone'], scope: { kind: 'project', projectId: '/work/novel' },
            }],
          }),
          ...Array.from({ length: MAX_MEMORY_DREAMS }, (_, index) => seedDream(`old-${index}`, {
            status: 'applied', createdAt: index, updatedAt: index,
          })),
        ],
      }),
    })
    let nextId = 'gone'
    const memory = reopen(store, {
      id: () => nextId,
      ai: aiScope(async request => success('{"proposals":[]}', request.sourceVersion)),
    })
    await expect(memory.applyDream('stale-preview', 1)).rejects.toMatchObject({ code: 'MEMORY_TOMBSTONE' })
    expect(memory.status().records.map(item => item.id)).toEqual(['live'])
    expect(store.snapshot().records.map(item => item.id)).toEqual(['live'])
    expect(store.snapshot().tombstones.some(row => row.id === 'gone')).toBe(true)
    await expect(memory.create(draft({ title: '复活' }))).rejects.toMatchObject({ code: 'MEMORY_TOMBSTONE' })
    nextId = 'new-dream'
    const plan = await memory.previewDream('s1', '/work/novel')
    expect(plan.status).toBe('preview')
    expect(store.snapshot().dreams.some(item => item.id === 'stale-preview')).toBe(true)
    expect(store.snapshot().tombstones.some(row => row.id === 'gone')).toBe(true)
    expect(store.snapshot().tombstones.length).toBeLessThanOrEqual(MAX_MEMORY_TOMBSTONES)
    expect(memoryStateSchema.safeParse(store.snapshot()).success).toBe(true)
    const reloaded = reopen(store, { id: () => 'gone' })
    const stale = reloaded.status().dreams.find(item => item.id === 'stale-preview')
    expect(stale).toBeDefined()
    await expect(reloaded.applyDream('stale-preview', stale!.revision)).rejects.toBeInstanceOf(MemoryError)
    expect(reloaded.status().records.map(item => item.id)).toEqual(['live'])
    expect(reloaded.status().records.some(item => item.title === '复活')).toBe(false)
    await expect(reloaded.create(draft({ title: '复活' }))).rejects.toMatchObject({ code: 'MEMORY_TOMBSTONE' })
  })

  it('treats a missing source without a tombstone as stale and does not mint it back', async () => {
    const snapshot = [{
      id: 'missing', revision: 1, status: 'active' as const, scope: { kind: 'project' as const, projectId: '/work/novel' },
    }]
    const store = createMemoryStore({
      initial: filled({
        records: [seedRecord('live')],
        dreams: [seedDream('orphan-preview', {
          status: 'preview',
          sourceVersion: dreamSourceVersion(snapshot),
          snapshot,
          proposals: [{
            title: '补写', content: '不该出现', kind: 'preference', tags: ['dream'], exceptions: [],
            evidence: [], sourceIds: ['missing'], scope: { kind: 'project', projectId: '/work/novel' },
          }],
        })],
      }),
    })
    const memory = reopen(store, { id: () => 'minted-missing' })
    await expect(memory.applyDream('orphan-preview', 1)).rejects.toMatchObject({ code: 'MEMORY_STALE' })
    expect(memory.status().records.map(item => item.id)).toEqual(['live'])
    expect(store.snapshot().records.some(item => item.id === 'missing' || item.id === 'minted-missing')).toBe(false)
    expect(memory.status().storageFailed).toBe(false)
  })

  it('refuses applyDream bulk creation when records are full and production ids stay UUID without accepting an id', async () => {
    const source = seedRecord('src-1')
    const store = createMemoryStore({
      initial: filled({
        records: [
          source,
          ...Array.from({ length: MAX_MEMORY_RECORDS - 1 }, (_, index) => seedRecord(`full-${index}`)),
        ],
        dreams: [seedDream('ready', {
          status: 'preview',
          sourceVersion: dreamSourceVersion([{
            id: source.id, revision: source.revision, status: source.status, scope: source.scope,
          }]),
          snapshot: [{
            id: source.id, revision: source.revision, status: source.status, scope: source.scope,
          }],
          proposals: [{
            title: '合并', content: '更克制', kind: 'preference', tags: ['dream'], exceptions: [],
            evidence: [{ sessionId: 's1', seq: 0, kind: 'manual', excerpt: 'dream' }],
            sourceIds: [source.id], scope: source.scope,
          }],
        })],
      }),
    })
    const memory = reopen(store, { id: () => 'bulk-candidate' })
    await expect(memory.applyDream('ready', 1)).rejects.toMatchObject({ code: 'MEMORY_CAPACITY' })
    expect(memory.status().storageFailed).toBe(false)
    expect(memory.status().records).toHaveLength(MAX_MEMORY_RECORDS)
    expect(memory.status().dreams.find(item => item.id === 'ready')?.status).toBe('preview')
    expect(store.snapshot().records.some(item => item.id === 'bulk-candidate')).toBe(false)

    const uuidStore = createMemoryStore()
    const produced = new MemoryRuntime({ store: uuidStore, now: () => 1 })
    const left = await produced.create(draft())
    expect(left.id).toMatch(/^[0-9a-f-]{36}$/i)
    await expect(produced.create({ ...draft({ title: '带编号' }), id: 'custom-id' } as NewMemoryRecord & { id: string }))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID' })
    expect(uuidStore.snapshot().records.map(item => item.id)).toEqual([left.id])
  })
})

it('exposes a running Dream before model completion and rejects premature apply', async () => {
  let finish!: () => void
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  const held = new Promise<void>(resolve => { finish = resolve })
  const { memory } = runtime({ ai: aiScope(async request => {
    began()
    await held
    return success(JSON.stringify({ proposals: [] }), request.sourceVersion)
  }) })
  await memory.create(draft())
  const pending = memory.previewDream('s1', '/work/novel')
  await started
  const reading = await memory.readStatus('s1', '/work/novel')
  expect(reading.runningDreams).toEqual([reading.dreams[0]!.id])
  await expect(memory.applyDream(reading.dreams[0]!.id, reading.dreams[0]!.revision)).rejects.toMatchObject({ code: 'MEMORY_INVALID' })
  finish()
  await pending
  expect((await memory.readStatus('s1', '/work/novel')).runningDreams).toEqual([])
})
