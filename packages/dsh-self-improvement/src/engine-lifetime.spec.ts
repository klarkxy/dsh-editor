import { describe, expect, it } from 'vitest'
import { MemoryRuntime, defaultSettings } from '@klarkxy/dsh-memory'
import type { MemoryPersistedState } from '@klarkxy/dsh-memory/contracts'
import type { MemoryMutationOptions, MemoryQuery, MemoryRecord, MemoryService, NewMemoryRecord } from './contracts.ts'
import { SelfImprovementEngine } from './engine.ts'
import { assistantMessage, MemoryFake, session, tables, userMessage } from './fakes.ts'

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>(next => { resolve = next })
  return { promise, resolve: () => resolve() }
}

async function settle(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 80 && !pred(); i += 1) await Promise.resolve()
}

async function tick(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

function runtimeMemory(prefix = 'rt') {
  let n = 0
  let hold = false
  let waiting = 0
  let releaseHold = () => {}
  let state: MemoryPersistedState = {
    settings: defaultSettings(),
    records: [],
    tombstones: [],
    dreams: [],
  }
  const runtime = new MemoryRuntime({
    store: {
      load: () => structuredClone(state),
      async save(next) {
        if (hold) {
          waiting += 1
          await new Promise<void>(resolve => { releaseHold = resolve })
          waiting -= 1
        }
        state = structuredClone(next)
      },
    },
    now: () => 1_000,
    id: () => `${prefix}-${++n}`,
  })
  return {
    runtime,
    persist: () => state.records,
    holdSaves() { hold = true },
    releaseSaves() {
      hold = false
      releaseHold()
    },
    get waiting() { return waiting },
  }
}

function watchCalls(runtime: MemoryRuntime, method: 'create' | 'update' | 'promoteToGlobal') {
  let calls = 0
  const original = runtime[method].bind(runtime) as (...args: unknown[]) => Promise<unknown>
  Object.assign(runtime, {
    [method](...args: unknown[]) {
      calls += 1
      return original(...args)
    },
  })
  return { get calls() { return calls } }
}

class DeferredMemory implements MemoryService {
  lists = 0
  updates = 0
  creates = 0
  promotes = 0
  beforeList?: () => Promise<void>
  beforeUpdate?: () => Promise<void>
  beforePromote?: () => Promise<void>
  constructor(private readonly inner: MemoryService) {}
  async list(query: MemoryQuery) {
    this.lists += 1
    await this.beforeList?.()
    return this.inner.list(query)
  }
  async recall(query: MemoryQuery) {
    return this.inner.recall(query)
  }
  async create(record: NewMemoryRecord, options?: MemoryMutationOptions) {
    this.creates += 1
    return this.inner.create(record, options)
  }
  async update(
    id: string,
    patch: Partial<Pick<MemoryRecord, 'title' | 'content' | 'tags' | 'exceptions' | 'status' | 'expiresAt'>>,
    expectedRevision: number,
    options?: MemoryMutationOptions,
  ) {
    this.updates += 1
    await this.beforeUpdate?.()
    return this.inner.update(id, patch, expectedRevision, options)
  }
  async promoteToGlobal(id: string, expectedRevision: number, options?: MemoryMutationOptions) {
    this.promotes += 1
    await this.beforePromote?.()
    return this.inner.promoteToGlobal(id, expectedRevision, options)
  }
  async remove(id: string, expectedRevision: number, options?: MemoryMutationOptions) {
    return this.inner.remove(id, expectedRevision, options)
  }
}

const lessonDraft = (projectId = '/novel'): NewMemoryRecord => ({
  scope: { kind: 'project', projectId },
  kind: 'lesson',
  status: 'candidate',
  title: 'use relative paths',
  content: 'Keep paths relative to the project root.',
  tags: [],
  evidence: [{ sessionId: 's1', seq: 2, kind: 'user' }],
  exceptions: [],
  source: 'self-improvement',
})

function engineWith(memory: () => MemoryService | undefined, now = 50) {
  const store = tables()
  const sessions = new Map<string, ReturnType<typeof session>>()
  const impl = new SelfImprovementEngine({
    memory,
    ai: () => undefined,
    sessionOf: id => sessions.get(id),
    skills: store.skills,
    watermarks: store.watermarks,
    now: () => now,
  })
  return { impl, store, sessions }
}

const blockerDraft = (): NewMemoryRecord => ({
  scope: { kind: 'project', projectId: '/novel' },
  kind: 'preference',
  status: 'active',
  title: 'queue blocker',
  content: 'hold an unrelated persist',
  tags: [],
  evidence: [],
  exceptions: [],
  source: 'user',
})

async function candidateOn(runtime: MemoryRuntime, projectId = '/novel') {
  return runtime.create(lessonDraft(projectId))
}

async function lessonStatus(memory: MemoryService, id: string, projectId = '/novel') {
  const rows = await memory.list({ scope: { kind: 'project', projectId }, kinds: ['lesson'] })
  return rows.find(row => row.id === id)?.status
}

describe('engine mutation linearization', () => {
  it('acceptLesson after dispose during MemoryRuntime list does not persist active and does not return ok', async () => {
    const { runtime } = runtimeMemory()
    const created = await candidateOn(runtime)
    const { impl } = engineWith(() => runtime)
    const generation = impl.getGeneration()
    // 1. capture generation/Memory  2. await list  3. dispose  4. list continues  5. no update
    const pending = impl.acceptLesson(created.id, created.revision, 'project', '/novel')
    impl.dispose()
    const result = await pending
    expect(impl.getGeneration()).toBe(generation + 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code === 'DISABLED' || result.error.code === 'SUPERSEDED').toBe(true)
    expect(await lessonStatus(runtime, created.id)).toBe('candidate')
  })

  it('reject and revoke do not mutate MemoryRuntime after disable during list', async () => {
    const { runtime } = runtimeMemory('rej')
    const created = await candidateOn(runtime)
    const { impl } = engineWith(() => runtime)
    const pendingReject = impl.setLessonStatus(created.id, created.revision, 'rejected', '/novel')
    impl.dispose()
    const rejected = await pendingReject
    expect(rejected.ok).toBe(false)
    expect(await lessonStatus(runtime, created.id)).toBe('candidate')

    const { runtime: runtime2 } = runtimeMemory('rev')
    const live = await runtime2.create({ ...lessonDraft(), status: 'active' })
    const second = engineWith(() => runtime2)
    const pendingRevoke = second.impl.setLessonStatus(live.id, live.revision, 'revoked', '/novel')
    second.impl.dispose()
    const revoked = await pendingRevoke
    expect(revoked.ok).toBe(false)
    expect(await lessonStatus(runtime2, live.id)).toBe('active')
  })

  it('replacing Memory during list does not write the captured or replacement instance', async () => {
    const first = runtimeMemory('a')
    const second = runtimeMemory('b')
    const created = await candidateOn(first.runtime)
    let current: MemoryService | undefined = first.runtime
    const { impl } = engineWith(() => current)
    const hang = deferred()
    const gated = new DeferredMemory(first.runtime)
    gated.beforeList = () => hang.promise
    current = gated
    const pending = impl.acceptLesson(created.id, created.revision, 'project', '/novel')
    await settle(() => gated.lists > 0)
    current = second.runtime
    hang.resolve()
    const result = await pending
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MEMORY_UNAVAILABLE')
    expect(gated.updates).toBe(0)
    expect(await lessonStatus(first.runtime, created.id)).toBe('candidate')
    expect(await second.runtime.list({ scope: { kind: 'project', projectId: '/novel' }, kinds: ['lesson'] })).toEqual([])
  })

  it('does not return UI success for an in-flight Memory update after disable, and does not roll it back', async () => {
    const boxed = runtimeMemory('upd')
    const created = await candidateOn(boxed.runtime)
    const { impl } = engineWith(() => boxed.runtime)
    boxed.holdSaves()
    const pending = impl.acceptLesson(created.id, created.revision, 'project', '/novel')
    await settle(() => boxed.waiting > 0)
    impl.dispose()
    boxed.releaseSaves()
    const result = await pending
    expect(result.ok).toBe(false)
    expect(await lessonStatus(boxed.runtime, created.id)).toBe('active')
  })

  it('skill preview does not persist after disable during lesson read', async () => {
    const { runtime } = runtimeMemory('sk')
    const active = await runtime.create({ ...lessonDraft(), status: 'active' })
    const { impl, store } = engineWith(() => runtime)
    await store.watermarks.put('seed', { sessionId: 'seed', seq: 0, projectId: '/novel', updatedAt: 1 })
    const pending = impl.previewSkill([active.id])
    impl.dispose()
    const result = await pending
    expect(result.ok).toBe(false)
    expect([...store.skills.entries()]).toEqual([])
  })

  it('skill accept/export fail after disable during source revalidation and do not patch', async () => {
    const { runtime } = runtimeMemory('src')
    const active = await runtime.create({ ...lessonDraft(), status: 'active' })
    const { impl, store } = engineWith(() => runtime)
    await store.watermarks.put('seed', { sessionId: 'seed', seq: 0, projectId: '/novel', updatedAt: 1 })
    const preview = await impl.previewSkill([active.id])
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const pendingAccept = impl.acceptSkill(preview.value.id, preview.value.revision)
    impl.dispose()
    const accepted = await pendingAccept
    expect(accepted.ok).toBe(false)
    expect(store.skills.get(preview.value.id)?.status).toBe('preview')

    const again = runtimeMemory('exp')
    const live = await again.runtime.create({ ...lessonDraft(), status: 'active' })
    const other = engineWith(() => again.runtime)
    await other.store.watermarks.put('seed', { sessionId: 'seed', seq: 0, projectId: '/novel', updatedAt: 1 })
    const draft = await other.impl.previewSkill([live.id])
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    const pendingExport = other.impl.prepareSkillExport(draft.value.id, draft.value.revision)
    other.impl.dispose()
    const exported = await pendingExport
    expect(exported.ok).toBe(false)
  })

  it('does not return UI success after an in-flight skill put, and does not delete the already-written draft', async () => {
    const { runtime } = runtimeMemory('put')
    const active = await runtime.create({ ...lessonDraft(), status: 'active' })
    const { impl, store } = engineWith(() => runtime)
    await store.watermarks.put('seed', { sessionId: 'seed', seq: 0, projectId: '/novel', updatedAt: 1 })
    const hang = deferred()
    store.skills.beforePut = () => hang.promise
    const pending = impl.previewSkill([active.id])
    await settle(() => store.skills.puts > 0)
    impl.dispose()
    hang.resolve()
    const result = await pending
    expect(result.ok).toBe(false)
    expect(store.skills.puts).toBe(1)
    expect([...store.skills.entries()]).toHaveLength(1)
  })

  it('global accept during list disable leaves one project candidate and no extra global row', async () => {
    const memory = new MemoryFake()
    const hang = deferred()
    memory.beforeRead = () => hang.promise
    const created = await memory.create({
      ...lessonDraft(),
      expiresAt: 9_000,
      exceptions: ['vendor'],
    })
    const { impl } = engineWith(() => memory)
    const pending = impl.acceptLesson(created.id, created.revision, 'global', '/novel')
    impl.dispose()
    hang.resolve()
    const result = await pending
    expect(result.ok).toBe(false)
    expect(memory.promotes).toBe(0)
    expect(memory.records.size).toBe(1)
    expect(memory.records.get(created.id)).toMatchObject({
      id: created.id,
      revision: created.revision,
      status: 'candidate',
      scope: { kind: 'project', projectId: '/novel' },
      expiresAt: 9_000,
    })
    expect([...memory.records.values()].filter(item => item.scope.kind === 'global')).toEqual([])
  })

  it('in-flight promoteToGlobal after disable keeps one canonical id and does not return ok', async () => {
    const memory = new MemoryFake()
    const hang = deferred()
    memory.beforePromote = () => hang.promise
    const created = await memory.create({
      ...lessonDraft(),
      expiresAt: 9_000,
      evidence: [{ sessionId: 's1', seq: 2, kind: 'user', excerpt: '相对' }],
      exceptions: ['vendor'],
    })
    const { impl } = engineWith(() => memory)
    const pending = impl.acceptLesson(created.id, created.revision, 'global', '/novel')
    await settle(() => memory.promotes > 0)
    impl.dispose()
    hang.resolve()
    const result = await pending
    expect(result.ok).toBe(false)
    expect(memory.promotes).toBe(1)
    expect(memory.records.size).toBe(1)
    const row = memory.records.get(created.id)
    expect(row).toMatchObject({
      id: created.id,
      revision: created.revision + 1,
      status: 'active',
      scope: { kind: 'global' },
      expiresAt: 9_000,
      exceptions: ['vendor'],
    })
    expect(row?.evidence).toEqual(created.evidence)
    expect([...memory.records.values()].filter(item => item.status === 'active')).toHaveLength(1)
  })

  it('does not apply a MemoryRuntime update queued behind an unrelated save after dispose', async () => {
    const boxed = runtimeMemory('q')
    const created = await candidateOn(boxed.runtime)
    const { impl } = engineWith(() => boxed.runtime)
    boxed.holdSaves()
    const blocker = boxed.runtime.create(blockerDraft())
    await settle(() => boxed.waiting > 0)
    const queued = watchCalls(boxed.runtime, 'update')
    const pending = impl.acceptLesson(created.id, created.revision, 'project', '/novel')
    await settle(() => queued.calls > 0)
    impl.dispose()
    boxed.releaseSaves()
    await blocker
    const result = await pending
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code === 'DISABLED' || result.error.code === 'CANCELLED' || result.error.code === 'SUPERSEDED').toBe(true)
    expect(await lessonStatus(boxed.runtime, created.id)).toBe('candidate')
  })

  it('does not apply a queued MemoryRuntime update after Memory replacement', async () => {
    const first = runtimeMemory('r1')
    const second = runtimeMemory('r2')
    const created = await candidateOn(first.runtime)
    let current: MemoryService | undefined = first.runtime
    const { impl } = engineWith(() => current)
    first.holdSaves()
    const blocker = first.runtime.create(blockerDraft())
    await settle(() => first.waiting > 0)
    const queued = watchCalls(first.runtime, 'update')
    const pending = impl.acceptLesson(created.id, created.revision, 'project', '/novel')
    await settle(() => queued.calls > 0)
    current = second.runtime
    first.releaseSaves()
    await blocker
    const result = await pending
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MEMORY_UNAVAILABLE')
    expect(await lessonStatus(first.runtime, created.id)).toBe('candidate')
    expect(await second.runtime.list({ scope: { kind: 'project', projectId: '/novel' }, kinds: ['lesson'] })).toEqual([])
  })

  it('does not promote a queued global MemoryRuntime row after dispose', async () => {
    const boxed = runtimeMemory('g')
    const created = await boxed.runtime.create({ ...lessonDraft(), expiresAt: 9_000, exceptions: ['vendor'] })
    const { impl } = engineWith(() => boxed.runtime)
    boxed.holdSaves()
    const blocker = boxed.runtime.create(blockerDraft())
    await settle(() => boxed.waiting > 0)
    const queued = watchCalls(boxed.runtime, 'promoteToGlobal')
    const pending = impl.acceptLesson(created.id, created.revision, 'global', '/novel')
    await settle(() => queued.calls > 0)
    impl.dispose()
    boxed.releaseSaves()
    await blocker
    const result = await pending
    expect(result.ok).toBe(false)
    expect(boxed.persist()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: created.id,
        status: 'candidate',
        scope: { kind: 'project', projectId: '/novel' },
        expiresAt: 9_000,
        exceptions: ['vendor'],
      }),
    ]))
    expect(boxed.persist().filter(item => item.scope.kind === 'global')).toEqual([])
  })

  it('does not create an extract lesson queued behind an unrelated MemoryRuntime save after dispose', async () => {
    const boxed = runtimeMemory('ex')
    const { impl, sessions } = engineWith(() => boxed.runtime)
    sessions.set('s1', session('s1', '/novel', [
      assistantMessage(1, 'changed'),
      userMessage(2, '不对，应该用相对路径'),
    ]))
    boxed.holdSaves()
    const blocker = boxed.runtime.create(blockerDraft())
    await settle(() => boxed.waiting > 0)
    const queued = watchCalls(boxed.runtime, 'create')
    const pending = impl.extractFromSession(sessions.get('s1')!, new AbortController().signal, 'manual')
    await settle(() => queued.calls > 0)
    impl.dispose()
    boxed.releaseSaves()
    await blocker
    const result = await pending
    expect(result.ok).toBe(false)
    expect(boxed.persist().filter(item => item.kind === 'lesson')).toEqual([])
  })

  it('MemoryFake serialize queue rejects a following accept after disable without writing', async () => {
    const memory = new MemoryFake()
    const created = await memory.create(lessonDraft())
    const hang = deferred()
    memory.beforeCreate = () => hang.promise
    const { impl } = engineWith(() => memory)
    const blocker = memory.create({ ...lessonDraft(), title: 'blocker lesson' })
    await settle(() => memory.creates >= 2)
    const pending = impl.acceptLesson(created.id, created.revision, 'project', '/novel')
    await tick()
    impl.dispose()
    hang.resolve()
    await blocker
    const result = await pending
    expect(result.ok).toBe(false)
    expect(memory.updates).toBe(0)
    expect(memory.records.get(created.id)?.status).toBe('candidate')
  })
})
