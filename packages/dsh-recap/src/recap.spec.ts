import { describe, expect, it } from 'vitest'
import type { AiFeatureScope, AuxiliaryResult, TaskContract, UsageReceipt } from '@klarkxy/dsh-ai-services/contracts'
import { createPluginUserMessage, inject } from './index.ts'
import { defaultSettings, RECAP_CHECKPOINT_PURPOSE, RECAP_DISPLAY_PURPOSE, RECAP_PLUGIN, type RecapCard, type RecapLogEvent } from './contracts.ts'
import { RecapService, type RecapPersistedState, type RecapStore } from './service.ts'
import { checkpointInjectPayload } from './checkpoints.ts'

function receipt(status: UsageReceipt['status'], id = 'r1'): UsageReceipt {
  return {
    id, plugin: RECAP_PLUGIN, purpose: RECAP_DISPLAY_PURPOSE, sourceVersion: 's1#3',
    status, attempts: 1, cost: null, startedAt: 1, finishedAt: 2,
  }
}

function memoryStore(initial?: RecapPersistedState): RecapStore & { snapshot(): RecapPersistedState } {
  let state: RecapPersistedState = structuredClone(initial ?? { settings: defaultSettings(), cards: [], checkpoints: [] })
  return {
    load: () => structuredClone(state),
    save: async next => { state = structuredClone(next) },
    snapshot: () => structuredClone(state),
  }
}

function nativeCall(seq: number, name: string, callId: string, time = seq): RecapLogEvent {
  return { seq, type: 'tool/call', time, data: { turn: 1, step: 1, callId, name, arguments: '{}' } }
}

function nativeResult(seq: number, callId: string, text: string, time = seq): RecapLogEvent {
  return {
    seq, type: 'tool/result', time,
    data: {
      turn: 1, step: 1,
      message: {
        role: 'user', source: { kind: 'tool', callId },
        content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text }] }],
      },
    },
  }
}

function longCompleted(status: 'completed' | 'cancelled' | 'failed' = 'completed'): RecapLogEvent[] {
  const reason = status === 'completed' ? { kind: 'completed' }
    : status === 'cancelled' ? { kind: 'aborted', reason: { kind: 'user' } }
      : { kind: 'error', error: { message: 'failed', code: 'UNKNOWN' } }
  return [
    { seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } },
    { seq: 1, type: 'step/start', time: 0, data: { turn: 1, step: 1 } },
    { seq: 2, type: 'user/message', time: 1, data: { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '长任务' }] } },
    { seq: 3, type: 'step/start', time: 2, data: { turn: 1, step: 2 } },
    nativeCall(4, 'read', 'r1', 3),
    nativeResult(5, 'r1', 'ok', 4),
    { seq: 6, type: 'turn/end', time: 70_000, data: { turn: 1, reason } },
  ]
}

function secondTurn(base: RecapLogEvent[]): RecapLogEvent[] {
  return [
    ...base,
    { seq: 7, type: 'turn/start', time: 80_000, data: { turn: 2 } },
    { seq: 8, type: 'step/start', time: 80_000, data: { turn: 2, step: 1 } },
    { seq: 9, type: 'user/message', time: 80_001, data: { id: 'u9', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '下一轮' }] } },
    { seq: 10, type: 'step/start', time: 80_002, data: { turn: 2, step: 2 } },
    nativeCall(11, 'read', 'r2', 80_003),
    nativeResult(12, 'r2', 'ok', 80_004),
    { seq: 13, type: 'turn/end', time: 150_000, data: { turn: 2, reason: { kind: 'completed' } } },
  ]
}

function shortCompleted(): RecapLogEvent[] {
  return [
    { seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } },
    { seq: 1, type: 'user/message', time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '短句' }] } },
    { seq: 2, type: 'turn/end', time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

function existingCard(partial: Partial<RecapCard> = {}): RecapCard {
  return {
    id: 'recap-1',
    sessionId: 's1',
    sourceVersion: 's1#6',
    fromSeq: 0,
    toSeq: 6,
    trigger: 'turn-end',
    sourceStatus: 'completed',
    title: '回顾 · 已完成',
    body: '旧卡片',
    kind: 'deterministic',
    generation: 'idle',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

const enabledPatch = {
  cardsEnabled: true,
  checkpointsEnabled: false,
  semanticCheckpointsEnabled: false,
  idleReturnMs: defaultSettings().idleReturnMs,
}

function settingsOn(service: RecapService, patch: Partial<ReturnType<typeof defaultSettings>> = {}) {
  const { revision, ...rest } = service.status().settings
  return service.updateSettings({ ...rest, cardsEnabled: true, ...patch }, revision)
}

describe('recap service', () => {
  it('requires host sessions and aiServices instead of optional lookups', () => {
    expect([...inject]).toEqual(['connection', 'webServer', 'storageDomain', 'sessions', 'aiServices'])
  })

  it('deduplicates cards by session identity and log watermark', async () => {
    const log = longCompleted()
    const service = new RecapService({ store: memoryStore(), readEvents: id => id === 's1' ? log : undefined, id: () => 'card-1' })
    await settingsOn(service)
    const first = await service.onSessionEvent('s1', log[6]!)
    const second = await service.onSessionEvent('s1', log[6]!)
    expect(first?.sourceVersion).toBe('s1#6')
    expect(second).toBeUndefined()
    expect(service.status('s1').cards).toHaveLength(1)
    expect(await service.idleReturn('s1')).toBeUndefined()
  })

  it('keeps cancelled turns cancelled and does not record them as completed', async () => {
    const log = longCompleted('cancelled')
    const service = new RecapService({ store: memoryStore(), readEvents: () => log, id: () => 'card-c' })
    await settingsOn(service)
    const card = await service.onSessionEvent('s1', log[6]!)
    expect(card?.sourceStatus).toBe('cancelled')
    expect(card?.sourceStatus).not.toBe('completed')
    expect(card?.title).toContain('已取消')
  })

  it('rejects late generation after cards are turned off', async () => {
    let finish!: (result: AuxiliaryResult) => void
    const pending = new Promise<AuxiliaryResult>(resolve => { finish = resolve })
    let entered = false
    const scope: AiFeatureScope = {
      plugin: RECAP_PLUGIN,
      signal: new AbortController().signal,
      active: true,
      registerPurpose: () => () => {},
      run: async () => {
        entered = true
        return pending
      },
      dispose() {},
    }
    const log = longCompleted()
    const service = new RecapService({
      store: memoryStore(),
      readEvents: () => log,
      id: () => 'card-late',
      activateAi: () => scope,
    })
    await settingsOn(service)
    const started = service.onSessionEvent('s1', log[6]!)
    while (!entered) await Promise.resolve()
    expect(service.status().cards[0]?.generation).toBe('running')
    const current = service.status().settings
    await service.updateSettings({
      cardsEnabled: false,
      checkpointsEnabled: false,
      semanticCheckpointsEnabled: false,
      idleReturnMs: current.idleReturnMs,
    }, current.revision)
    finish({ text: '不该出现', receipt: receipt('success') })
    await started
    const card = service.status().cards[0]
    expect(card?.generation).toBe('superseded')
    expect(card?.kind).not.toBe('generated')
    expect(card?.body).not.toContain('不该出现')
  })

  it('does not inject recap display into agent prompt messages', async () => {
    const log = longCompleted()
    let ids = 0
    const service = new RecapService({
      store: memoryStore(),
      readEvents: () => log,
      id: () => `x${++ids}`,
      createInjectMessage: payload => payload,
    })
    await settingsOn(service, { cardsEnabled: true, checkpointsEnabled: false })
    await service.onSessionEvent('s1', log[6]!)
    const recapBody = service.status().cards[0]?.body
    const decision = await service.handlePreStep({
      sessionId: 's1',
      messages: [{ source: { kind: 'user' } }],
      step: 1,
      signal: new AbortController().signal,
      next: async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' as const } }] }),
    })
    expect(decision.messages).toEqual([{ source: { kind: 'user' } }])
    expect(JSON.stringify(decision)).not.toContain(recapBody)
    expect(JSON.stringify(decision)).not.toContain(RECAP_DISPLAY_PURPOSE)

    await service.updateSettings({
      cardsEnabled: false,
      checkpointsEnabled: true,
      semanticCheckpointsEnabled: false,
      idleReturnMs: defaultSettings().idleReturnMs,
    }, service.status().settings.revision)
    const withCheckpoint = await service.handlePreStep({
      sessionId: 's1',
      messages: [{ source: { kind: 'user' } }],
      step: 1,
      signal: new AbortController().signal,
      next: async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' as const } }], skipTools: true, otherFeature: 'keep' }),
    })
    const extra = withCheckpoint.messages?.at(-1) as ReturnType<typeof checkpointInjectPayload>
    expect(extra.source.plugin).toBe(RECAP_PLUGIN)
    expect(extra.content[0]?.text).not.toContain('回顾 ·')
    expect(JSON.stringify(extra)).not.toContain(recapBody)
    expect(withCheckpoint.skipTools).toBe(true)
    expect(withCheckpoint.otherFeature).toBe('keep')
    expect(withCheckpoint.messages?.[0]).toEqual({ source: { kind: 'user' } })
  })

  it('creates an idle-return card once for new work and skips a second idle on the same watermark', async () => {
    const log = longCompleted()
    const service = new RecapService({ store: memoryStore(), readEvents: () => log, id: () => 'idle-1' })
    await settingsOn(service)
    const card = await service.idleReturn('s1')
    expect(card?.trigger).toBe('idle-return')
    expect(card?.sourceVersion).toBe('s1#6')
    expect(await service.idleReturn('s1')).toBeUndefined()
  })

  it('enables cards and checkpoints by default without a second settings toggle', async () => {
    const log = longCompleted()
    const service = new RecapService({ store: memoryStore(), readEvents: () => log, id: () => 'default-on' })
    expect(service.status().settings.cardsEnabled).toBe(true)
    expect(service.status().settings.checkpointsEnabled).toBe(true)
    expect(service.status().settings.semanticCheckpointsEnabled).toBe(true)
    const card = await service.onSessionEvent('s1', log[6]!)
    expect(card?.id).toBe('default-on')
  })

  it('rejects storage failure without committing settings or activation', async () => {
    const store: RecapStore = {
      load: () => ({ settings: defaultSettings(), cards: [], checkpoints: [] }),
      save: async () => { throw new Error('disk') },
    }
    const service = new RecapService({ store, readEvents: () => longCompleted() })
    const result = await service.call('update', {
      expectedRevision: 0,
      settings: { ...enabledPatch, checkpointsEnabled: true },
    }, new AbortController().signal)
    expect(result).toEqual({ ok: false, error: { code: 'RECAP_STORAGE', message: '回顾保存失败，已保留原内容。' } })
    expect(service.status().settings.revision).toBe(0)
    expect(service.status().settings.checkpointsEnabled).toBe(true)
    expect(service.status().storageFailed).toBe(true)
  })

  it('serializes concurrent CAS updates so the loser keeps the previous revision', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let writes = 0
    let persisted: RecapPersistedState | undefined
    const store: RecapStore = {
      load: () => ({ settings: defaultSettings(), cards: [], checkpoints: [] }),
      save: async next => {
        writes += 1
        if (writes === 1) await gate
        persisted = structuredClone(next)
      },
    }
    const service = new RecapService({ store, readEvents: () => [] })
    const first = service.updateSettings({ ...enabledPatch, idleReturnMs: 120_000 }, 0)
    const second = service.updateSettings({ ...enabledPatch, idleReturnMs: 180_000 }, 0)
    await Promise.resolve()
    expect(service.status().settings.idleReturnMs).toBe(defaultSettings().idleReturnMs)
    expect(service.status().settings.revision).toBe(0)
    release()
    const [won, lost] = await Promise.allSettled([first, second])
    expect(won.status).toBe('fulfilled')
    expect(lost.status).toBe('rejected')
    expect((lost as PromiseRejectedResult).reason).toMatchObject({ code: 'RECAP_STALE' })
    expect(service.status().settings.revision).toBe(1)
    expect(service.status().settings.idleReturnMs).toBe(120_000)
    expect(persisted?.settings.idleReturnMs).toBe(120_000)
    expect(persisted?.settings.revision).toBe(1)
  })

  it('loads existing rows after restart and captures the next turn without overwriting old ids', async () => {
    const log = secondTurn(longCompleted())
    const store = memoryStore({
      settings: { ...defaultSettings(), revision: 1 },
      cards: [existingCard()],
      checkpoints: [],
    })
    const service = new RecapService({ store, readEvents: () => log })
    const next = await service.onSessionEvent('s1', log[13]!)
    expect(service.status().cards.map(card => card.id)).toContain('recap-1')
    expect(next?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(next?.id).not.toBe('recap-1')
    expect(next?.sourceVersion).toBe('s1#13')
    expect(store.snapshot().cards.some(card => card.id === 'recap-1')).toBe(true)
    expect(store.snapshot().cards.some(card => card.id === next?.id)).toBe(true)
  })

  it('rejects an accidental id collision instead of overwriting the existing row', async () => {
    const log = secondTurn(longCompleted())
    const service = new RecapService({
      store: memoryStore({
        settings: { ...defaultSettings(), revision: 1 },
        cards: [existingCard({ id: 'dup' })],
        checkpoints: [],
      }),
      readEvents: () => log,
      id: () => 'dup',
    })
    await expect(service.onSessionEvent('s1', log[13]!)).rejects.toMatchObject({ code: 'RECAP_CONFLICT' })
    expect(service.status().cards).toEqual([expect.objectContaining({ id: 'dup', sourceVersion: 's1#6' })])
  })

  it('does not mutate after dispose, including late session and idle events', async () => {
    let log = longCompleted()
    let ids = 0
    const service = new RecapService({ store: memoryStore(), readEvents: () => log, id: () => `live-${++ids}` })
    await service.onSessionEvent('s1', log[6]!)
    await settingsOn(service, { checkpointsEnabled: true })
    expect(service.status().cards).toEqual([expect.objectContaining({ id: 'live-1', sourceVersion: 's1#6' })])
    await service.dispose()
    log = secondTurn(longCompleted())
    expect(await service.onSessionEvent('s1', log[13]!)).toBeUndefined()
    expect(await service.idleReturn('s1')).toBeUndefined()
    expect(await service.refresh('s1')).toBeUndefined()
    expect(service.status().cards).toEqual([expect.objectContaining({ id: 'live-1', sourceVersion: 's1#6' })])
    const decision = await service.handlePreStep({
      sessionId: 's1',
      messages: [{ source: { kind: 'user' } }],
      step: 1,
      signal: new AbortController().signal,
      next: async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' as const } }] }),
    })
    expect(decision.messages).toEqual([{ source: { kind: 'user' } }])
    expect(service.status().checkpoints).toHaveLength(0)
    expect((await service.call('status', { sessionId: 's1' }, new AbortController().signal)).ok).toBe(false)
  })

  it('waits for an in-flight persist while unregistering', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let saved = false
    let entered = false
    const store: RecapStore = {
      load: () => ({ settings: defaultSettings(), cards: [], checkpoints: [] }),
      save: async next => {
        entered = true
        await gate
        saved = true
        expect(next.settings.idleReturnMs).toBe(120_000)
      },
    }
    const service = new RecapService({ store, readEvents: () => [] })
    const updating = service.updateSettings({ ...enabledPatch, idleReturnMs: 120_000 }, 0)
    while (!entered) await Promise.resolve()
    const disposing = service.dispose()
    expect(saved).toBe(false)
    release()
    await expect(updating).resolves.toMatchObject({ settings: { idleReturnMs: 120_000, revision: 1 } })
    await disposing
    expect(saved).toBe(true)
  })

  it('builds a native plugin user message rather than returning the raw payload', () => {
    const payload = checkpointInjectPayload({
      id: 'c1', sessionId: 's1', sourceVersion: 's1#1', fromSeq: 0, toSeq: 1, revision: 1,
      status: 'running', items: [], constraints: ['不要改名'], nextAction: '继续', createdAt: 1,
    })
    const message = createPluginUserMessage(payload) as { id: string; role: string; source: unknown; content: unknown }
    expect(message).not.toBe(payload)
    expect(message.role).toBe('user')
    expect(typeof message.id).toBe('string')
    expect(message.id.length).toBeGreaterThan(0)
    expect(message.source).toEqual(payload.source)
    expect(message.content).toEqual(payload.content)
  })

  it('refreshes a short session with at most one model call per watermark', async () => {
    let runs = 0
    const scope: AiFeatureScope = {
      plugin: RECAP_PLUGIN,
      signal: new AbortController().signal,
      active: true,
      registerPurpose: () => () => {},
      run: async request => {
        runs += 1
        expect(request.isCurrent?.()).toBe(true)
        return { text: '短回顾', receipt: receipt('success') }
      },
      dispose() {},
    }
    const log = shortCompleted()
    const service = new RecapService({
      store: memoryStore(),
      readEvents: () => log,
      id: () => 'short-1',
      activateAi: () => scope,
    })
    expect(await service.onSessionEvent('s1', log[2]!)).toBeUndefined()
    expect(await service.call('status', { sessionId: 's1' }, new AbortController().signal)).toEqual(expect.objectContaining({ ok: true }))
    expect(runs).toBe(0)
    const card = await service.refresh('s1')
    expect(card?.trigger).toBe('manual')
    expect(card?.kind).toBe('generated')
    expect(card?.body).toBe('短回顾')
    expect(runs).toBe(1)
    expect(await service.refresh('s1')).toMatchObject({ id: 'short-1', kind: 'generated' })
    expect(runs).toBe(1)
  })

  it('rejects retry and cancel that target a different session', async () => {
    const log = longCompleted()
    const service = new RecapService({ store: memoryStore(), readEvents: () => log, id: () => 'owned' })
    await service.onSessionEvent('s1', log[6]!)
    const stale = await service.call('retry', { cardId: 'owned', sessionId: 'other' }, new AbortController().signal)
    expect(stale).toEqual({ ok: false, error: { code: 'RECAP_STALE', message: '回顾不属于当前会话。' } })
    const cancelled = await service.call('cancel', { cardId: 'owned', sessionId: 'other' }, new AbortController().signal)
    expect(cancelled).toEqual({ ok: false, error: { code: 'RECAP_STALE', message: '回顾不属于当前会话。' } })
    expect(service.status('s1').cards[0]?.id).toBe('owned')
  })

  it('recovers checkpoint revisions after restart and does not repeat semantic calls for the same source', async () => {
    const contract: TaskContract = {
      id: 't1', sessionId: 's1', sourceVersion: 's1#0', revision: 2, goal: '改章',
      deliverables: [], inScope: [], outOfScope: [], constraints: ['不要改名'],
      acceptance: [], assumptions: [], questions: [], evidence: [],
      readiness: 'user-confirmed', updatedAt: 1,
    }
    const log: RecapLogEvent[] = [
      { seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } },
      nativeCall(1, 'read', 'r1'),
      nativeResult(2, 'r1', 'ok'),
      nativeCall(3, 'writing_propose', 'p'),
      nativeResult(4, 'p', '{"marker":"dsh-editor.proposal"}'),
      nativeCall(5, 'read', 'r2'),
      nativeResult(6, 'r2', 'ok'),
    ]
    const store = memoryStore({
      settings: {
        ...defaultSettings(),
        revision: 1,
        cardsEnabled: false,
        checkpointsEnabled: true,
        semanticCheckpointsEnabled: true,
      },
      cards: [],
      checkpoints: [{
        id: 'old-rev10', sessionId: 's1', sourceVersion: 's1#0', fromSeq: 0, toSeq: 0, revision: 10,
        status: 'running', items: [], constraints: [], nextAction: '继续', createdAt: 1,
      }],
    })
    let semantic = 0
    const scope: AiFeatureScope = {
      plugin: RECAP_PLUGIN,
      signal: new AbortController().signal,
      active: true,
      registerPurpose: () => () => {},
      run: async request => {
        semantic += 1
        expect(request.purpose).toBe(RECAP_CHECKPOINT_PURPOSE)
        expect(request.input).not.toContain('已经写入')
        if (semantic === 1) expect(request.input).toContain('writing_propose')
        return {
          text: '等待作者确认修改',
          receipt: {
            ...receipt('success', `sem-${semantic}`),
            purpose: RECAP_CHECKPOINT_PURPOSE,
            sourceVersion: request.sourceVersion,
          },
        }
      },
      dispose() {},
    }
    let ids = 0
    const options = {
      store,
      readEvents: () => log,
      readContract: () => contract,
      id: () => `cp-${++ids}`,
      activateAi: () => scope,
    }
    const service = new RecapService(options)
    const step = {
      sessionId: 's1',
      messages: [{ source: { kind: 'user' as const } }],
      step: 2,
      signal: new AbortController().signal,
      next: async () => ({ kind: 'enter' as const, messages: [{ source: { kind: 'user' as const } }] }),
    }
    const [first, concurrent] = await Promise.all([service.handlePreStep(step), service.handlePreStep(step)])
    expect(first.messages?.length).toBe(2)
    expect([first.messages?.length, concurrent.messages?.length].sort()).toEqual([1, 2])
    expect(semantic).toBe(1)
    const afterFirst = service.status().checkpoints.filter(row => row.sessionId === 's1')
    expect(afterFirst.map(row => row.id).sort()).toEqual(['cp-1', 'old-rev10'])
    const newer = afterFirst.find(row => row.id === 'cp-1')
    expect(newer).toMatchObject({ revision: 11, toSeq: 6, sourceVersion: 's1#6' })
    expect(newer?.items.some(item => item.state === 'verified' && item.label.includes('writing_propose'))).toBe(false)
    expect(JSON.stringify(newer)).toContain('未确认已写入')

    const repeated = await service.handlePreStep(step)
    expect(repeated.messages).toEqual([{ source: { kind: 'user' } }])
    expect(semantic).toBe(1)
    expect(service.status().checkpoints).toHaveLength(2)

    const restarted = new RecapService({ ...options, id: () => `cp-${++ids}` })
    const afterRestart = await restarted.handlePreStep(step)
    expect(afterRestart.messages).toEqual([{ source: { kind: 'user' } }])
    expect(semantic).toBe(1)
    expect(restarted.status().checkpoints).toHaveLength(2)

    log.push(
      nativeCall(7, 'read', 'r3'),
      nativeResult(8, 'r3', 'ok'),
      nativeCall(9, 'search', 's'),
      nativeResult(10, 's', 'hits'),
      nativeCall(11, 'read', 'r4'),
      nativeResult(12, 'r4', 'ok'),
    )
    const advanced = await restarted.handlePreStep(step)
    expect(advanced.messages?.length).toBe(2)
    expect(semantic).toBe(2)
    const rows = restarted.status().checkpoints.filter(row => row.sessionId === 's1').sort((a, b) => b.toSeq - a.toSeq)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ revision: 12, toSeq: 12, sourceVersion: 's1#12' })
    expect(rows[0]?.fromSeq).toBeGreaterThan(6)
    expect(rows.map(row => row.revision).sort((a, b) => a - b)).toEqual([10, 11, 12])
    expect(store.snapshot().checkpoints).toHaveLength(3)
  })

  it('injects one newer-contract checkpoint on the same log and does not repeat semantic for that contract', async () => {
    const log: RecapLogEvent[] = [
      { seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } },
      nativeCall(1, 'read', 'r1'),
      nativeResult(2, 'r1', 'ok'),
      nativeCall(3, 'writing_propose', 'p'),
      nativeResult(4, 'p', '{"marker":"dsh-editor.proposal"}'),
      nativeCall(5, 'read', 'r2'),
      nativeResult(6, 'r2', 'ok'),
    ]
    const v2: TaskContract = {
      id: 't1', sessionId: 's1', sourceVersion: 's1#0', revision: 2, goal: '改章',
      deliverables: [], inScope: [], outOfScope: [], constraints: ['改后约束'],
      acceptance: [], assumptions: [], questions: [], evidence: [],
      readiness: 'user-confirmed', updatedAt: 2,
    }
    const store = memoryStore({
      settings: {
        ...defaultSettings(),
        revision: 1,
        cardsEnabled: false,
        checkpointsEnabled: true,
        semanticCheckpointsEnabled: true,
      },
      cards: [],
      checkpoints: [{
        id: 'old-c1', sessionId: 's1', sourceVersion: 's1#6', fromSeq: 0, toSeq: 6, revision: 3,
        contractVersion: 1, status: 'running', items: [], constraints: ['旧约束'], nextAction: '继续', createdAt: 1,
      }],
    })
    let semantic = 0
    const scope: AiFeatureScope = {
      plugin: RECAP_PLUGIN,
      signal: new AbortController().signal,
      active: true,
      registerPurpose: () => () => {},
      run: async request => {
        semantic += 1
        expect(request.purpose).toBe(RECAP_CHECKPOINT_PURPOSE)
        expect(request.contractVersion).toBe(2)
        return {
          text: '按新约束继续',
          receipt: {
            ...receipt('success', `sem-c${semantic}`),
            purpose: RECAP_CHECKPOINT_PURPOSE,
            sourceVersion: request.sourceVersion,
          },
        }
      },
      dispose() {},
    }
    let ids = 0
    const service = new RecapService({
      store,
      readEvents: () => log,
      readContract: () => v2,
      id: () => `c-${++ids}`,
      activateAi: () => scope,
    })
    const step = {
      sessionId: 's1',
      messages: [{ source: { kind: 'user' as const } }],
      step: 2,
      signal: new AbortController().signal,
      next: async () => ({ kind: 'enter' as const, messages: [{ source: { kind: 'user' as const } }] }),
    }
    const first = await service.handlePreStep(step)
    expect(first.messages?.length).toBe(2)
    expect(semantic).toBe(1)
    const rows = service.status().checkpoints.filter(row => row.sessionId === 's1').sort((a, b) => a.revision - b.revision)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'old-c1', revision: 3, contractVersion: 1, sourceVersion: 's1#6' })
    expect(rows[1]).toMatchObject({ id: 'c-1', revision: 4, contractVersion: 2, sourceVersion: 's1#6' })
    expect(rows[1]?.constraints).toContain('改后约束')
    expect(JSON.stringify(first.messages?.at(-1))).toContain('改后约束')

    const repeated = await service.handlePreStep(step)
    expect(repeated.messages).toEqual([{ source: { kind: 'user' } }])
    expect(semantic).toBe(1)
    expect(service.status().checkpoints).toHaveLength(2)
    expect(service.status().checkpoints.map(row => row.revision).sort((a, b) => a - b)).toEqual([3, 4])
    expect(store.snapshot().checkpoints.map(row => row.revision).sort((a, b) => a - b)).toEqual([3, 4])
  })

  it('status RPC waits for the running-card persist and does not wait for the model', async () => {
    let releasePersist!: () => void
    const persistGate = new Promise<void>(resolve => { releasePersist = resolve })
    let persistEntered = false
    let modelEntered = false
    let finishModel!: (result: AuxiliaryResult) => void
    const model = new Promise<AuxiliaryResult>(resolve => { finishModel = resolve })
    const store: RecapStore = {
      load: () => ({ settings: { ...defaultSettings(), revision: 1 }, cards: [], checkpoints: [] }),
      save: async () => {
        persistEntered = true
        await persistGate
      },
    }
    const scope: AiFeatureScope = {
      plugin: RECAP_PLUGIN,
      signal: new AbortController().signal,
      active: true,
      registerPurpose: () => () => {},
      run: async () => {
        modelEntered = true
        return model
      },
      dispose() {},
    }
    const log = longCompleted()
    const service = new RecapService({
      store,
      readEvents: () => log,
      id: () => 'race-1',
      activateAi: () => scope,
    })
    const started = service.onSessionEvent('s1', log[6]!)
    while (!persistEntered) await Promise.resolve()
    expect(service.status().cards).toEqual([])
    const raced = service.call('status', { sessionId: 's1' }, new AbortController().signal)
    let settled = false
    void raced.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(modelEntered).toBe(false)
    releasePersist()
    const result = await raced
    expect(settled).toBe(true)
    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(result.ok && result.value.cards[0]).toMatchObject({ id: 'race-1', generation: 'running' })
    while (!modelEntered) await Promise.resolve()
    expect(modelEntered).toBe(true)
    finishModel({ text: '完成后才应出现', receipt: receipt('success') })
    await started
    expect(service.status().cards[0]?.generation).toBe('idle')
    expect(service.status().cards[0]?.body).toBe('完成后才应出现')
  })

  it('status RPC does not deadlock with an in-flight serialized settings write', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let writes = 0
    const store: RecapStore = {
      load: () => ({ settings: defaultSettings(), cards: [], checkpoints: [] }),
      save: async () => {
        writes += 1
        if (writes === 1) await gate
      },
    }
    const service = new RecapService({ store, readEvents: () => [] })
    const updating = service.updateSettings({ ...enabledPatch, idleReturnMs: 120_000 }, 0)
    while (writes === 0) await Promise.resolve()
    const raced = service.call('status', {}, new AbortController().signal)
    release()
    const [updated, status] = await Promise.all([updating, raced])
    expect(updated.settings.idleReturnMs).toBe(120_000)
    expect(status).toEqual(expect.objectContaining({ ok: true }))
    expect(status.ok && status.value.settings.idleReturnMs).toBe(120_000)
  })
})
