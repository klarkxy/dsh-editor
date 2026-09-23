import { describe, expect, it } from 'vitest'
import { MemoryRuntime, defaultSettings } from '@klarkxy/dsh-memory'
import type { MemoryPersistedState } from '@klarkxy/dsh-memory/contracts'
import { MEMORY_UNAVAILABLE_MESSAGE } from './contracts.ts'
import { SelfImprovementEngine } from './engine.ts'
import {
  MemoryFake, session, tables, toolCall, toolResult, userMessage, assistantMessage, lesson,
} from './fakes.ts'
import { isSelfImprovementLessonMessage } from './inject.ts'
import { downloadMarkdown } from './skills.ts'
import type { AiServices, AuxiliaryResult } from './contracts.ts'

function engine(memory?: MemoryFake, ai?: Pick<AiServices, 'activate'>, now = 50) {
  const store = tables()
  const sessions = new Map<string, ReturnType<typeof session>>()
  const impl = new SelfImprovementEngine({
    memory: () => memory,
    ai: () => ai,
    sessionOf: id => sessions.get(id),
    skills: store.skills,
    watermarks: store.watermarks,
    now: () => now,
  })
  return { impl, memory, sessions, store }
}

function liveSession(id: string, cwd: string, events: Parameters<typeof session>[2]) {
  return session(id, cwd, events)
}

function ephemeralMemory() {
  let n = 0
  let state: MemoryPersistedState = {
    settings: defaultSettings(),
    records: [],
    tombstones: [],
    dreams: [],
  }
  return new MemoryRuntime({
    store: {
      load: () => structuredClone(state),
      async save(next) { state = structuredClone(next) },
    },
    now: () => 1_000,
    id: () => `native-${++n}`,
  })
}

const relativeRequest = { source: { kind: 'user' as const }, content: [{ type: 'text' as const, text: 'please keep relative paths' }] }

describe('self-improvement engine', () => {
  it('surfaces an actionable error when Memory is missing', async () => {
    const { impl } = engine()
    const status = await impl.call('status', {}, new AbortController().signal)
    expect(status).toEqual({
      ok: true,
      value: expect.objectContaining({ memoryAvailable: false, memoryMessage: MEMORY_UNAVAILABLE_MESSAGE, lessons: [] }),
    })
    const accept = await impl.call('accept', { id: 'x', expectedRevision: 1 }, new AbortController().signal)
    expect(accept).toEqual({ ok: false, error: { code: 'MEMORY_UNAVAILABLE', message: MEMORY_UNAVAILABLE_MESSAGE } })
  })

  it('never injects candidates even when Memory.recall is sloppy, and rejects the wrong project', async () => {
    const memory = new MemoryFake()
    memory.looseRecall = true
    const candidate = await memory.create({
      scope: { kind: 'project', projectId: '/a' }, kind: 'lesson', status: 'candidate',
      title: 'cand', content: 'secret relative', tags: [], evidence: [{ sessionId: 's', seq: 1, kind: 'user' }],
      exceptions: [], source: 'self-improvement',
    })
    await memory.create({
      scope: { kind: 'project', projectId: '/b' }, kind: 'lesson', status: 'active',
      title: 'other', content: 'b relative', tags: [], evidence: [], exceptions: [], source: 'self-improvement',
    })
    const active = await memory.create({
      scope: { kind: 'project', projectId: '/a' }, kind: 'lesson', status: 'active',
      title: 'keep', content: 'relative', tags: [], evidence: [], exceptions: [], source: 'self-improvement',
    })
    const { impl, store } = engine(memory)
    await store.watermarks.put('seed-a', { sessionId: 'seed-a', seq: 0, projectId: '/a', updatedAt: 1 })
    await store.watermarks.put('seed-b', { sessionId: 'seed-b', seq: 0, projectId: '/b', updatedAt: 1 })
    const injected = await impl.recordsForInjection('/a', 'please keep relative paths')
    expect(injected.map(item => item.id)).toEqual([active.id])
    expect(injected.some(item => item.id === candidate.id)).toBe(false)
    const decision = await impl.applyPreStep(
      liveSession('s', '/a', [userMessage(1, 'please keep relative paths')]),
      { kind: 'enter', messages: [relativeRequest] },
      new AbortController().signal,
    )
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages.filter(isSelfImprovementLessonMessage)).toHaveLength(1)
    expect(JSON.stringify(decision.messages)).toContain('relative')
    expect(JSON.stringify(decision.messages)).not.toContain('secret')
    const foreign = await impl.acceptLesson(candidate.id, candidate.revision, 'project', '/other')
    expect(foreign).toMatchObject({ ok: false, error: { code: 'WRONG_SCOPE' } })
  })

  it('does not inject expired lessons that Memory.list still returns', async () => {
    const memory = new MemoryFake()
    const expired = await memory.create({
      scope: { kind: 'project', projectId: '/a' }, kind: 'lesson', status: 'active',
      title: 'old relative', content: 'relative expired', tags: [], evidence: [], exceptions: [],
      source: 'self-improvement', expiresAt: 10,
    })
    const live = await memory.create({
      scope: { kind: 'project', projectId: '/a' }, kind: 'lesson', status: 'active',
      title: 'keep relative', content: 'relative live', tags: [], evidence: [], exceptions: [],
      source: 'self-improvement',
    })
    const { impl } = engine(memory, undefined, 50)
    const listed = await impl.listAllLessons('/a')
    expect(listed.map(item => item.id).sort()).toEqual([expired.id, live.id].sort())
    expect((await impl.recordsForInjection('/a', 'relative paths')).map(item => item.id)).toEqual([live.id])
  })

  it('does not inject Memory records collected before Memory is disabled', async () => {
    const memory = new MemoryFake()
    await memory.create({
      scope: { kind: 'project', projectId: '/a' }, kind: 'lesson', status: 'active',
      title: 'keep relative', content: 'relative', tags: [], evidence: [], exceptions: [], source: 'self-improvement',
    })
    let current: MemoryFake | undefined = memory
    const store = tables()
    const impl = new SelfImprovementEngine({
      memory: () => current,
      ai: () => undefined,
      sessionOf: () => undefined,
      skills: store.skills,
      watermarks: store.watermarks,
      now: () => 50,
    })
    memory.beforeRead = async () => { current = undefined }
    const decision = await impl.applyPreStep(
      liveSession('s', '/a', [userMessage(1, 'please keep relative paths')]),
      { kind: 'enter', messages: [relativeRequest], startsRequestSeries: true },
      new AbortController().signal,
    )
    expect(decision).toMatchObject({ kind: 'enter', startsRequestSeries: true })
    if (decision.kind !== 'enter') return
    expect(decision.messages.filter(isSelfImprovementLessonMessage)).toHaveLength(0)
  })

  it('dedupes evidence and persists active lessons only', async () => {
    const memory = new MemoryFake()
    const { impl, sessions } = engine(memory)
    const events = [
      assistantMessage(1, 'changed'),
      userMessage(2, '不对，应该用相对路径'),
    ]
    sessions.set('s1', liveSession('s1', '/novel', events))
    const first = await impl.call('extract', { sessionId: 's1' }, new AbortController().signal)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const created = first.value as { created: Array<{ id: string; status: string }>; skipped: number }
    expect(created.created).toHaveLength(1)
    expect(created.created[0]?.status).toBe('active')
    expect(memory.updates).toBe(1)
    const second = await impl.call('extract', { sessionId: 's1' }, new AbortController().signal)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const again = second.value as { created: unknown[]; skipped: number }
    expect(again.created).toHaveLength(0)
    expect(again.skipped).toBeGreaterThanOrEqual(1)
    expect([...memory.records.values()].filter(item => item.status === 'active')).toHaveLength(1)
    expect([...memory.records.values()].filter(item => item.status === 'candidate')).toHaveLength(0)
  })

  it('counts a failed auto-activation as skipped and leaves a candidate the author can still accept', async () => {
    const memory = new MemoryFake()
    let updatesFail = true
    const originalUpdate = memory.update.bind(memory)
    memory.update = (id, patch, revision, options) => {
      if (!updatesFail) return originalUpdate(id, patch, revision, options)
      const error = new Error('memory disabled') as Error & { code?: string }
      error.code = 'MEMORY_DISABLED'
      return Promise.reject(error)
    }
    const { impl, sessions } = engine(memory)
    sessions.set('s1', liveSession('s1', '/novel', [
      assistantMessage(1, 'changed'),
      userMessage(2, '不对，应该用相对路径'),
    ]))
    const first = await impl.call('extract', { sessionId: 's1' }, new AbortController().signal)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.created).toHaveLength(0)
    expect(first.value.skipped).toBe(1)
    expect([...memory.records.values()].filter(item => item.status === 'candidate')).toHaveLength(1)
    updatesFail = false
    const stranded = [...memory.records.values()].find(item => item.status === 'candidate')!
    const accepted = await impl.acceptLesson(stranded.id, stranded.revision, 'project', '/novel')
    expect(accepted.ok).toBe(true)
    const again = await impl.call('extract', { sessionId: 's1' }, new AbortController().signal)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.created).toHaveLength(0)
    expect([...memory.records.values()]).toHaveLength(1)
  })

  it('rejects stale extraction after disable and stale revocation', async () => {
    const memory = new MemoryFake()
    let finish: ((result: AuxiliaryResult) => void) | undefined
    const ai: Pick<AiServices, 'activate'> = {
      activate: () => ({
        plugin: '@klarkxy/dsh-self-improvement', signal: new AbortController().signal, active: true,
        registerPurpose: () => () => {},
        dispose: () => {},
        run: () => new Promise(resolve => { finish = resolve }),
      }),
    }
    const { impl, sessions } = engine(memory, ai)
    sessions.set('s1', liveSession('s1', '/novel', [
      assistantMessage(1, 'x'),
      userMessage(2, '不要再写绝对路径'),
    ]))
    const pending = impl.call('extract', { sessionId: 's1' }, new AbortController().signal)
    for (let i = 0; i < 50 && !finish; i += 1) await Promise.resolve()
    expect(finish).toBeTypeOf('function')
    impl.dispose()
    finish?.({
      text: '{"title":"late","content":"should not land"}',
      receipt: {
        id: 'r', plugin: 'p', purpose: 'self-improvement.extract', sourceVersion: 'v',
        status: 'success', attempts: 1, cost: null, startedAt: 1, finishedAt: 2,
      },
    })
    const result = await pending
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code === 'SUPERSEDED' || result.error.code === 'DISABLED' || result.error.code === 'CANCELLED').toBe(true)
    expect([...memory.records.values()].some(item => item.title === 'late' && item.status === 'candidate')).toBe(false)

    const memory2 = new MemoryFake()
    const live = engine(memory2)
    await live.store.watermarks.put('seed', { sessionId: 'seed', seq: 0, projectId: '/novel', updatedAt: 1 })
    const stored = await memory2.create({
      scope: { kind: 'project', projectId: '/novel' }, kind: 'lesson', status: 'active',
      title: 'keep', content: 'x', tags: [], evidence: [], exceptions: [], source: 'self-improvement',
    })
    const stale = await live.impl.setLessonStatus(stored.id, stored.revision + 9, 'revoked')
    expect(stale.ok).toBe(false)
    const revoked = await live.impl.setLessonStatus(stored.id, stored.revision, 'revoked')
    expect(revoked.ok).toBe(true)
    expect((await live.impl.recordsForInjection('/novel', 'keep x')).map(item => item.id)).not.toContain(stored.id)
  })

  it('accepts globally on the same canonical id without a second record', async () => {
    const memory = new MemoryFake()
    const { impl, store } = engine(memory)
    await store.watermarks.put('seed', { sessionId: 'seed', seq: 0, projectId: '/novel', updatedAt: 1 })
    const evidence = [{ sessionId: 's', seq: 2, kind: 'user' as const, excerpt: '相对路径' }]
    const candidate = await memory.create({
      scope: { kind: 'project', projectId: '/novel' }, kind: 'lesson', status: 'candidate',
      title: 'lesson', content: 'x', tags: ['path'], evidence, exceptions: ['vendor'],
      source: 'self-improvement', expiresAt: 9_000,
    })
    const global = await impl.acceptLesson(candidate.id, candidate.revision, 'global', '/novel')
    expect(global.ok).toBe(true)
    if (!global.ok) return
    expect(global.value.id).toBe(candidate.id)
    expect(global.value.revision).toBe(candidate.revision + 1)
    expect(global.value.scope).toEqual({ kind: 'global' })
    expect(global.value.status).toBe('active')
    expect(global.value.expiresAt).toBe(9_000)
    expect(global.value.evidence).toEqual(evidence)
    expect(global.value.exceptions).toEqual(['vendor'])
    expect(memory.records.size).toBe(1)
    expect(memory.records.get(candidate.id)).toEqual(global.value)
    expect([...memory.records.values()].filter(item => item.status === 'active' && item.scope.kind === 'global')).toHaveLength(1)
  })

  it('MemoryFake.promoteToGlobal keeps one id and does not insert a row on stale revision', async () => {
    const memory = new MemoryFake()
    const created = await memory.create({
      scope: { kind: 'project', projectId: '/novel' }, kind: 'lesson', status: 'candidate',
      title: 'lesson', content: 'x', tags: [], evidence: [{ sessionId: 's', seq: 1, kind: 'user' }],
      exceptions: ['vendor'], source: 'self-improvement', expiresAt: 8_000,
    })
    const promoted = await memory.promoteToGlobal(created.id, created.revision)
    expect(promoted.id).toBe(created.id)
    expect(promoted.revision).toBe(created.revision + 1)
    expect(promoted.scope).toEqual({ kind: 'global' })
    expect(promoted.status).toBe('active')
    expect(promoted.expiresAt).toBe(8_000)
    expect(promoted.exceptions).toEqual(['vendor'])
    expect(memory.records.size).toBe(1)
    await expect(memory.promoteToGlobal(created.id, created.revision)).rejects.toThrow('stale')
    expect(memory.records.size).toBe(1)
    expect(memory.records.get(created.id)?.id).toBe(created.id)
  })

  it('stops injection after dispose even if Memory stays enabled', async () => {
    const memory = new MemoryFake()
    await memory.create({
      scope: { kind: 'project', projectId: '/a' }, kind: 'lesson', status: 'active',
      title: 'keep', content: 'visible', tags: [], evidence: [], exceptions: [], source: 'self-improvement',
    })
    const { impl } = engine(memory)
    impl.dispose()
    const decision = await impl.applyPreStep(liveSession('s', '/a', [userMessage(1, 'relative')]), { kind: 'enter', messages: [{ id: 'u' }] }, new AbortController().signal)
    expect(decision).toEqual({ kind: 'enter', messages: [{ id: 'u' }] })
  })

  it('rejects a skill when source lessons change, and records export only after download', async () => {
    const memory = new MemoryFake()
    const { impl, store } = engine(memory)
    await store.watermarks.put('seed', { sessionId: 'seed', seq: 0, projectId: '/a', updatedAt: 1 })
    const active = await memory.create({
      scope: { kind: 'project', projectId: '/a' }, kind: 'lesson', status: 'active',
      title: '相对路径', content: 'Use relative paths', tags: [],
      evidence: [{ sessionId: 's', seq: 2, kind: 'user' }], exceptions: [], source: 'self-improvement',
    })
    const preview = await impl.call('skill.preview', { lessonIds: [active.id] }, new AbortController().signal)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const skill = preview.value as { id: string; revision: number; markdown: string; exportState: string }
    expect(skill.exportState).toBe('none')
    expect(skill.markdown).toContain('## Instructions')
    const prepared = await impl.call('skill.export', { id: skill.id, expectedRevision: skill.revision }, new AbortController().signal)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const payload = prepared.value as { filename: string; markdown: string; skill: { exportState: string; revision: number } }
    expect(payload.skill.exportState).toBe('none')
    const started = downloadMarkdown(payload.filename, payload.markdown, {
      createElement() {
        const node = {
          href: '', rel: '', attrs: {} as Record<string, string>,
          setAttribute(name: string, value: string) { this.attrs[name] = value },
          click() {}, remove() {},
        }
        return node as unknown as HTMLElement
      },
      body: { appendChild(node: Node) { return node } } as unknown as HTMLElement,
    } as Pick<Document, 'createElement' | 'body'>)
    expect(started).toBe(true)
    const recorded = await impl.call('skill.exported', {
      id: skill.id, expectedRevision: payload.skill.revision, filename: payload.filename,
    }, new AbortController().signal)
    expect(recorded.ok).toBe(true)
    if (!recorded.ok) return
    expect((recorded.value as { exportState: string }).exportState).toBe('recorded')

    const preview2 = await impl.call('skill.preview', { lessonIds: [active.id] }, new AbortController().signal)
    expect(preview2.ok).toBe(true)
    if (!preview2.ok) return
    const draft = preview2.value as { id: string; revision: number }
    await impl.setLessonStatus(active.id, (memory.records.get(active.id)?.revision ?? 1), 'revoked', '/a')
    const accepted = await impl.call('skill.accept', { id: draft.id, expectedRevision: draft.revision }, new AbortController().signal)
    expect(accepted).toMatchObject({ ok: false, error: { code: 'STALE' } })
    const exported = await impl.call('skill.export', { id: draft.id, expectedRevision: draft.revision }, new AbortController().signal)
    expect(exported).toMatchObject({ ok: false, error: { code: 'STALE' } })
  })

  it('extracts a verified tool fix without treating an unfixed failure as success', async () => {
    const memory = new MemoryFake()
    const { impl, sessions } = engine(memory)
    sessions.set('s1', liveSession('s1', '/novel', [
      toolCall(1, 'write', 'c1'),
      toolResult(2, 'c1', true, 'EACCES'),
    ]))
    const none = await impl.call('extract', { sessionId: 's1' }, new AbortController().signal)
    expect(none.ok).toBe(true)
    if (!none.ok) return
    expect((none.value as { created: unknown[] }).created).toHaveLength(0)
    sessions.set('s1', liveSession('s1', '/novel', [
      toolCall(1, 'write', 'c1'),
      toolResult(2, 'c1', true, 'EACCES'),
      toolCall(3, 'write', 'c2'),
      toolResult(4, 'c2', false, 'wrote'),
    ]))
    const fixed = await impl.call('extract', { sessionId: 's1' }, new AbortController().signal)
    expect(fixed.ok).toBe(true)
    if (!fixed.ok) return
    expect((fixed.value as { created: unknown[] }).created).toHaveLength(1)
  })

  it('extracts a native-host correction through MemoryRuntime', async () => {
    const memory = ephemeralMemory()
    const store = tables()
    const sessionId = 'session-d7c12130-a2d7-49f2-861f-9c106718baad'
    const cwd = 'D:\\0 code\\dsh-editor\\.dev\\ai-plugins-1790011789872\\projects\\插件验收'
    const correction = '不对，以后调整语言时保留已有剧情。'
    const live = {
      id: sessionId,
      header: { cwd },
      meta: { cwd },
      snapshotEvents: () => [
        {
          type: 'assistant/message',
          seq: 15,
          time: 1_790_011_815_726,
          data: {
            turn: 1,
            step: 1,
            message: { role: 'assistant', content: [{ type: 'text', text: '已收到。测试回复已完成。' }] },
          },
        },
        {
          type: 'user/message',
          seq: 24,
          time: 1_790_011_824_110,
          data: {
            id: '5f1c2a10-9b3e-4c6d-8e21-0a7b4c9d2e11',
            role: 'user',
            source: { kind: 'user' },
            content: [{ type: 'text', text: correction }],
          },
        },
      ],
    }
    const impl = new SelfImprovementEngine({
      memory: () => memory,
      ai: () => undefined,
      sessionOf: id => id === sessionId ? live : undefined,
      skills: store.skills,
      watermarks: store.watermarks,
      now: () => 50,
    })
    const result = await impl.extractFromSession(live, new AbortController().signal, 'manual')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.created).toHaveLength(1)
    expect(result.value.created[0]).toMatchObject({
      kind: 'lesson',
      status: 'active',
      source: 'self-improvement',
      evidence: [{ sessionId, seq: 24, kind: 'user', excerpt: correction }],
    })
    expect(result.value.created[0]?.tags.every(tag => tag.length <= 40)).toBe(true)
    const listed = await memory.list({
      scope: { kind: 'project', projectId: 'D:/0 code/dsh-editor/.dev/ai-plugins-1790011789872/projects/插件验收' },
      kinds: ['lesson'],
    })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.status).toBe('active')
  })

  it('serializes delayed auto and manual extract of the same native correction', async () => {
    const memory = ephemeralMemory()
    const store = tables()
    const sessionId = 'session-d7c12130-a2d7-49f2-861f-9c106718baad'
    const cwd = 'D:\\0 code\\dsh-editor\\.dev\\ai-plugins-1790011789872\\projects\\插件验收'
    const projectId = 'D:/0 code/dsh-editor/.dev/ai-plugins-1790011789872/projects/插件验收'
    const correction = '不对，以后调整语言时保留已有剧情。'
    const live = {
      id: sessionId,
      header: { cwd },
      meta: { cwd },
      snapshotEvents: () => [
        {
          type: 'assistant/message',
          seq: 15,
          time: 1_790_011_815_726,
          data: {
            turn: 1,
            step: 1,
            message: { role: 'assistant', content: [{ type: 'text', text: '已收到。测试回复已完成。' }] },
          },
        },
        {
          type: 'user/message',
          seq: 24,
          time: 1_790_011_824_110,
          data: {
            id: '5f1c2a10-9b3e-4c6d-8e21-0a7b4c9d2e11',
            role: 'user',
            source: { kind: 'user' },
            content: [{ type: 'text', text: correction }],
          },
        },
      ],
    }
    let runs = 0
    let finish: ((result: AuxiliaryResult) => void) | undefined
    const ai: Pick<AiServices, 'activate'> = {
      activate: () => ({
        plugin: '@klarkxy/dsh-self-improvement',
        signal: new AbortController().signal,
        active: true,
        registerPurpose: () => () => {},
        dispose: () => {},
        run: () => {
          runs += 1
          return new Promise(resolve => { finish = resolve })
        },
      }),
    }
    const impl = new SelfImprovementEngine({
      memory: () => memory,
      ai: () => ai,
      sessionOf: id => id === sessionId ? live : undefined,
      skills: store.skills,
      watermarks: store.watermarks,
      now: () => 50,
    })
    const auto = impl.considerSession(live, new AbortController().signal)
    const manual = impl.extractFromSession(live, new AbortController().signal, 'manual')
    const queued = await impl.snapshot(sessionId)
    expect(queued.ok).toBe(true)
    if (queued.ok) expect(queued.value.extracting).toBe(true)
    const other = await impl.snapshot('other-session')
    expect(other.ok).toBe(true)
    if (other.ok) expect(other.value.extracting).toBe(false)
    const any = await impl.snapshot()
    expect(any.ok).toBe(true)
    if (any.ok) expect(any.value.extracting).toBe(true)
    for (let i = 0; i < 80 && !finish; i += 1) await Promise.resolve()
    expect(runs).toBe(1)
    const inflight = await impl.call('status', { sessionId }, new AbortController().signal)
    expect(inflight).toMatchObject({ ok: true, value: { extracting: true } })
    expect(runs).toBe(1)
    const dead = new AbortController()
    dead.abort()
    const cancelled = impl.extractFromSession(live, dead.signal, 'manual')
    const still = await impl.snapshot(sessionId)
    expect(still.ok).toBe(true)
    if (still.ok) expect(still.value.extracting).toBe(true)
    finish?.({
      text: '{"title":"保留剧情","content":"调整语言时保留已有剧情。"}',
      receipt: {
        id: 'r', plugin: 'p', purpose: 'self-improvement.extract', sourceVersion: 'v',
        status: 'success', attempts: 1, cost: null, startedAt: 1, finishedAt: 2,
      },
    })
    const [autoDone, manualDone, cancelledDone] = await Promise.all([auto, manual, cancelled])
    expect(autoDone).toBeUndefined()
    expect(manualDone.ok).toBe(true)
    expect(cancelledDone.ok).toBe(false)
    if (!cancelledDone.ok) expect(cancelledDone.error.code).toBe('CANCELLED')
    expect(runs).toBe(1)
    const listed = await memory.list({ scope: { kind: 'project', projectId }, kinds: ['lesson'] })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ status: 'active', source: 'self-improvement', kind: 'lesson' })
    const idle = await impl.snapshot(sessionId)
    expect(idle.ok).toBe(true)
    if (idle.ok) expect(idle.value.extracting).toBe(false)
    const again = await impl.extractFromSession(live, new AbortController().signal, 'manual')
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.created).toHaveLength(0)
    expect(runs).toBe(1)
    expect((await memory.list({ scope: { kind: 'project', projectId }, kinds: ['lesson'] }))).toHaveLength(1)
  })
})

it('does not inject preference records as lessons', async () => {
  const memory = new MemoryFake()
  memory.records.set('pref', {
    ...lesson({ id: 'pref', title: 'pref relative', content: 'secret-pref', status: 'active', scope: { kind: 'global' } }),
    kind: 'preference',
  })
  const { impl } = engine(memory)
  expect((await impl.recordsForInjection('/a', 'pref relative')).map(item => item.id)).not.toContain('pref')
})
