import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AiFeatureScope, AuxiliaryResult } from '@klarkxy/dsh-ai-services'
import { isMoodMessage, type SessionEventLike, type UserMessageLike } from './evidence.ts'
import { ASK_DETAIL_OPTION } from './questions.ts'
import { MoodService, type MoodPersistedState, type MoodStore, type PreStepDecision } from './service.ts'

function userMessage(id: string, text: string): UserMessageLike {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

function receipt(status: AuxiliaryResult['receipt']['status'] = 'success'): AuxiliaryResult {
  return {
    text: JSON.stringify({
      goal: '改短林晚对白',
      deliverables: ['修订对白'],
      inScope: ['第一章'],
      outOfScope: [],
      constraints: ['不超过200字'],
      acceptance: ['保持语气'],
      assumptions: [],
      questions: ['对白要保留哪些句子？'],
    }),
    receipt: {
      id: 'r1', plugin: '@klarkxy/dsh-mood', purpose: 'mood.analyze', sourceVersion: 'v', status, attempts: 1, cost: null, startedAt: 1, finishedAt: 2,
    },
  }
}

function setup(input: {
  events?: SessionEventLike[]
  run?: ReturnType<typeof vi.fn>
  ask?: ReturnType<typeof vi.fn>
  live?: boolean
  store?: MoodStore
  resumeHeld?: ReturnType<typeof vi.fn>
  id?: () => string
} = {}) {
  const run = input.run ?? vi.fn(async () => receipt())
  const ask = input.ask ?? vi.fn(async (request: { questions: Array<{ id: string }>; agent: unknown }) => ({
    answers: request.questions.map(item => ({ id: item.id, selected: [], custom: '保留争吵那句' })),
  }))
  const events = input.events ?? []
  const scope: AiFeatureScope = {
    plugin: '@klarkxy/dsh-mood',
    signal: new AbortController().signal,
    active: true,
    registerPurpose: () => () => {},
    run: request => run(request),
    dispose: () => {},
  }
  const service = new MoodService({
    now: () => 10,
    id: input.id ?? (() => 'mood-1'),
    store: input.store,
    readEvents: () => events,
    liveSession: input.live === false
      ? () => undefined
      : sessionId => sessionId === 'sess-1' ? { id: sessionId, header: { cwd: '/work/novel' } } : undefined,
    activateAi: () => scope,
    askUser: ask,
    resumeHeld: input.resumeHeld,
  })
  return { service, run, ask, events, agent: { id: 'sess-1', session: { id: 'sess-1', header: { cwd: '/work/novel' } } } }
}

async function step(
  service: MoodService,
  agent: { id: string; session: { id: string; header: { cwd: string } } },
  messages: UserMessageLike[],
  extra?: { turn?: number; step?: number; signal?: AbortSignal },
) {
  let nextCalls = 0
  const decision = await service.handlePreStep({
    agent, messages, turn: extra?.turn ?? 1, step: extra?.step ?? 1, signal: extra?.signal ?? new AbortController().signal,
  }, async () => {
    nextCalls += 1
    return { kind: 'enter', messages }
  })
  return { decision, nextCalls }
}

describe('mood pre-step lifecycle', () => {
  it('is inert after dispose: no analysis, no inject, original messages returned once', async () => {
    const { service, run, agent } = setup()
    await service.dispose()
    const messages = [userMessage('u1', '帮我改一下')]
    const { decision, nextCalls } = await step(service, agent, messages)
    expect(nextCalls).toBe(1)
    expect(run).not.toHaveBeenCalled()
    expect(decision).toEqual({ kind: 'enter', messages })
    expect(service.getContract('sess-1')).toBeUndefined()
  })

  it('writes a clear-request contract without analysis and injects plugin context', async () => {
    const { service, run, ask, agent } = setup()
    const messages = [userMessage('u1', '把第一章.md里林晚的对白改短，不超过200字，保持原语气。')]
    const { decision, nextCalls } = await step(service, agent, messages)
    expect(nextCalls).toBe(1)
    expect(run).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
    expect(service.getContract('sess-1')?.readiness).toBe('clear-request')
    expect(service.getContract('sess-1')?.sourceVersion).toBe('u1')
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(isMoodMessage(decision.messages.at(-1) as UserMessageLike)).toBe(true)
    expect(JSON.stringify(decision.messages.at(-1))).toContain('不能代替文件修改或发布审批')
  })

  it('asks native questions in the same pre-step then resumes once as user-confirmed', async () => {
    const { service, run, ask, agent } = setup()
    const messages = [userMessage('u1', '帮我改一下')]
    const { decision, nextCalls } = await step(service, agent, messages)
    expect(nextCalls).toBe(1)
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[0].purpose).toBe('mood.analyze')
    expect(ask).toHaveBeenCalledOnce()
    expect(ask.mock.calls[0]?.[0].agent).toBe(agent)
    const questions = ask.mock.calls[0]?.[0].questions as Array<{ id: string; header?: string; options?: Array<{ label: string }> }>
    expect(questions).toHaveLength(1)
    expect(questions[0]?.header).toBe('澄清')
    expect(questions[0]?.options?.[0]?.label).toBe(ASK_DETAIL_OPTION)
    expect(service.getContract('sess-1')?.readiness).toBe('user-confirmed')
    expect(service.status('sess-1').session?.clarification[0]?.status).toBe('answered')
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages[0]).toBe(messages[0])
    expect(isMoodMessage(decision.messages.at(-1) as UserMessageLike)).toBe(true)
  })

  it('does not create a second prompt on repeat clarification of the same user version', async () => {
    const { service, run, ask, agent } = setup()
    const messages = [userMessage('u1', '帮我改一下')]
    await step(service, agent, messages)
    const second = await step(service, agent, messages, { step: 2 })
    expect(second.nextCalls).toBe(1)
    expect(run).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledOnce()
    expect(service.getContract('sess-1')?.readiness).toBe('user-confirmed')
  })

  it('rejects old analysis and answers when a new user version arrives', async () => {
    const { service, run, ask, agent } = setup()
    await step(service, agent, [userMessage('u1', '帮我改一下')])
    expect(service.getContract('sess-1')?.readiness).toBe('user-confirmed')
    ask.mockClear()
    run.mockClear()
    await step(service, agent, [userMessage('u2', '帮我改一下结尾')])
    expect(run).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledOnce()
    expect(service.getContract('sess-1')?.sourceVersion).toBe('u2')
    expect(service.getContract('sess-1')?.readiness).toBe('user-confirmed')
  })

  it('rejects unresolved risk without a model step, calling next once', async () => {
    const ask = vi.fn(async () => {
      throw Object.assign(new Error('no answerer'), { code: 'NO_PROVIDER' })
    })
    const { service, run, agent } = setup({ ask })
    const messages = [userMessage('u1', '把所有章节覆盖成新稿并发布')]
    const { decision, nextCalls } = await step(service, agent, messages)
    expect(nextCalls).toBe(1)
    expect(run).toHaveBeenCalledOnce()
    expect(decision).toEqual({ kind: 'reject' })
    expect(service.getContract('sess-1')?.readiness).toBe('pending')
    expect(service.status('sess-1').session?.held).toBe(true)
    expect(service.status('sess-1').session?.clarification.some(item => item.status === 'pending')).toBe(true)
  })

  it('on cancelled native questions stays unresolved, persists cancelled, and does not execute', async () => {
    const ask = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { code: 'ASK_ABORTED', name: 'UserQuestionError' })
    })
    const { service, agent } = setup({ ask })
    const { decision, nextCalls } = await step(service, agent, [userMessage('u1', '帮我改一下')])
    expect(nextCalls).toBe(1)
    expect(decision).toEqual({ kind: 'reject' })
    expect(service.getContract('sess-1')?.readiness).toBe('cancelled')
    expect(service.status('sess-1').session?.clarification.every(item => item.status === 'cancelled')).toBe(true)
    expect(service.status('sess-1').session?.held).toBe(true)
  })

  it('does not treat skipped material answers as disclosed assumptions or execute', async () => {
    const ask = vi.fn(async (request: { questions: Array<{ id: string }> }) => ({
      answers: request.questions.slice(0, 0),
    }))
    const { service, agent } = setup({ ask })
    const { decision } = await step(service, agent, [userMessage('u1', '帮我改一下')])
    expect(decision).toEqual({ kind: 'reject' })
    expect(service.getContract('sess-1')?.readiness).toBe('pending')
    expect(service.getContract('sess-1')?.assumptions.join('；')).not.toContain('未回答')
    expect(service.status('sess-1').session?.clarification.some(item => item.status === 'skipped')).toBe(true)
  })

  it('retries the exact original request without fabricating a new human prompt', async () => {
    const resumeHeld = vi.fn(async () => {})
    const ask = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { code: 'ASK_ABORTED', name: 'UserQuestionError' })
    })
    const { service, agent } = setup({ ask, resumeHeld })
    const original = userMessage('u1', '帮我改一下')
    await step(service, agent, [original])
    const retried = await service.call('retry', { sessionId: 'sess-1' }, new AbortController().signal)
    expect(retried.ok).toBe(true)
    expect(resumeHeld).toHaveBeenCalledOnce()
    const held = resumeHeld.mock.calls[0]?.[1] as UserMessageLike[]
    expect(held[0]?.id).toBe('u1')
    expect(held[0]?.source?.kind).toBe('user')
    expect(JSON.stringify(held[0])).toContain('帮我改一下')
  })

  it('does not process plugin-only batches', async () => {
    const { service, run, ask, agent } = setup()
    const plugin = { id: 'p1', source: { kind: 'plugin:other', plugin: 'other' }, content: [{ type: 'text', text: '辅助' }] }
    const { decision } = await step(service, agent, [plugin])
    expect(run).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
    expect(decision).toEqual({ kind: 'enter', messages: [plugin] })
  })

  it('does not attribute previous turn seq as this request sourceVersion or evidence', async () => {
    const events: SessionEventLike[] = [
      { seq: 5, type: 'user/message', data: { id: 'u-old', source: { kind: 'user' }, content: [{ type: 'text', text: '上一轮' }] } },
    ]
    const { service, agent } = setup({ events })
    await step(service, agent, [userMessage('u-new', '把第一章.md里林晚的对白改短，不超过200字，保持原语气。')])
    const contract = service.getContract('sess-1')
    expect(contract?.sourceVersion).toBe('u-new')
    expect(contract?.sourceVersion).not.toContain('5')
    expect(contract?.evidence.some(item => item.seq === 5)).toBe(false)
  })

  it('cancels in-flight questions on disable without a late contract commit or inject', async () => {
    let release!: (error: unknown) => void
    const ask = vi.fn(() => new Promise<never>((_, reject) => { release = reject }))
    const { service, agent } = setup({ ask })
    const messages = [userMessage('u1', '帮我改一下')]
    const pending = step(service, agent, messages)
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())
    await service.dispose()
    release(Object.assign(new Error('aborted'), { code: 'ASK_ABORTED', name: 'UserQuestionError' }))
    const { decision, nextCalls } = await pending
    expect(nextCalls).toBe(1)
    expect(decision).toEqual({ kind: 'enter', messages })
    expect(service.getContract('sess-1')).toBeUndefined()
    if (decision.kind === 'enter') expect(decision.messages.every(item => !isMoodMessage(item as UserMessageLike))).toBe(true)
  })

  it('does not let a late analysis overwrite a newer contract', async () => {
    let finishFirst!: (value: AuxiliaryResult) => void
    const run = vi.fn()
      .mockImplementationOnce(() => new Promise<AuxiliaryResult>(resolve => { finishFirst = resolve }))
      .mockImplementation(async () => receipt())
    const { service, agent } = setup({ run })
    const first = step(service, agent, [userMessage('u1', '帮我改一下')])
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    const second = await step(service, agent, [userMessage('u2', '帮我改一下结尾')])
    expect(second.decision.kind).toBe('enter')
    expect(service.getContract('sess-1')?.sourceVersion).toBe('u2')
    finishFirst(receipt())
    const late = await first
    expect(late.decision).toEqual({ kind: 'reject' })
    expect(service.getContract('sess-1')?.sourceVersion).toBe('u2')
  })

  it('uses unique default ids across service instances instead of mood-++ counters', async () => {
    const first = new MoodService({
      now: () => 10,
      readEvents: () => [],
      liveSession: id => id === 'sess-1' ? { id: 'sess-1', header: { cwd: '/work/novel' } } : undefined,
      activateAi: () => undefined,
    })
    const second = new MoodService({
      now: () => 10,
      readEvents: () => [],
      liveSession: id => id === 'sess-1' ? { id: 'sess-1', header: { cwd: '/work/novel' } } : undefined,
      activateAi: () => undefined,
    })
    const agent = { id: 'sess-1', session: { id: 'sess-1', header: { cwd: '/work/novel' } } }
    const messages = [userMessage('u1', '把第一章.md里林晚的对白改短，不超过200字，保持原语气。')]
    await first.handlePreStep({ agent, messages, turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages }))
    await second.handlePreStep({ agent, messages, turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages }))
    const left = first.getContract('sess-1')?.id ?? ''
    const right = second.getContract('sess-1')?.id ?? ''
    expect(left).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(right).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(left).not.toBe(right)
  })

  it('does not claim a saved success when persist fails', async () => {
    const store: MoodStore = {
      load: () => ({ settings: { revision: 0, mode: 'auto' }, sessions: {} }),
      save: async () => { throw new Error('disk') },
    }
    const { service } = setup({ store })
    const result = await service.call('mode', { expectedRevision: 0, mode: 'strict' }, new AbortController().signal)
    expect(result).toEqual({ ok: false, error: { code: 'MOOD_STORAGE', message: '需求澄清保存失败，已保留原内容。' } })
    expect(service.status().settings.revision).toBe(0)
    expect(service.status().settings.mode).toBe('auto')
    expect(service.status().storageFailed).toBe(true)
  })

  it('serializes concurrent CAS updates so the loser keeps the previous revision', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let writes = 0
    let persisted: MoodPersistedState | undefined
    const store: MoodStore = {
      load: () => ({ settings: { revision: 0, mode: 'auto' }, sessions: {} }),
      save: async next => {
        writes += 1
        if (writes === 1) await gate
        persisted = structuredClone(next)
      },
    }
    const { service } = setup({ store })
    const first = service.call('mode', { expectedRevision: 0, mode: 'manual' }, new AbortController().signal)
    const second = service.call('mode', { expectedRevision: 0, mode: 'strict' }, new AbortController().signal)
    await Promise.resolve()
    expect(service.status().settings.mode).toBe('auto')
    expect(service.status().settings.revision).toBe(0)
    release()
    const [won, lost] = await Promise.all([first, second])
    expect(won.ok).toBe(true)
    expect(lost.ok).toBe(false)
    if (!lost.ok) expect(lost.error.code).toBe('MOOD_STALE')
    expect(service.status().settings.mode).toBe('auto')
    expect(service.status().settings.revision).toBe(1)
    expect(persisted?.settings.mode).toBe('auto')
    expect(persisted?.settings.revision).toBe(1)
  })

  it('derives mutative RPC from the live host session and supports manual/edit', async () => {
    const { service } = setup()
    const missing = await service.call('manual', { sessionId: 'gone' }, new AbortController().signal)
    expect(missing.ok).toBe(false)
    const live = new MoodService({
      now: () => 10,
      readEvents: () => [],
      liveSession: id => id === 'sess-1' ? { id: 'sess-1', header: { cwd: '/work/novel' } } : undefined,
      activateAi: () => undefined,
    })
    const messages = [userMessage('u1', '把第一章.md里林晚的对白改短，不超过200字，保持原语气。')]
    await live.handlePreStep({
      agent: { id: 'sess-1', session: { id: 'sess-1', header: { cwd: '/work/novel' } } },
      messages, turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages }))
    const edited = await live.call('edit', {
      sessionId: 'sess-1', expectedRevision: 1, patch: { goal: '改为旁白' },
    }, new AbortController().signal)
    expect(edited.ok).toBe(true)
    expect(live.getContract('sess-1')?.goal).toBe('改为旁白')
    expect(live.getContract('sess-1')?.readiness).toBe('user-confirmed')
    const manual = await live.call('manual', { sessionId: 'sess-1' }, new AbortController().signal)
    expect(manual.ok).toBe(true)
    expect(live.status('sess-1').session?.pendingManual).toBe(true)
  })
})

function pluginSnapshot(plugin: string, section: string, text: string) {
  return createUserMessage({
    source: { kind: 'plugin:' + plugin, plugin, form: 'snapshot', sections: [{ name: section, text }] },
    content: [{ type: 'text', text }],
  })
}

function claimedHuman(text: string) {
  return createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  })
}

function nativeChain(claimed: unknown[]) {
  const runtime = pluginSnapshot('runtime-context', 'runtimeContext.project', 'cwd=/work/novel')
  const memory = pluginSnapshot('@klarkxy/dsh-memory', 'dsh-memory:records', '项目记忆')
  const recap = pluginSnapshot('@klarkxy/dsh-recap', 'checkpoint', '检查点')
  const inner: Extract<PreStepDecision, { kind: 'enter' }> = {
    kind: 'enter',
    startsRequestSeries: true,
    messages: [...claimed, runtime, memory, recap],
  }
  return { runtime, memory, recap, inner }
}

function expectPreservedInner(
  decision: PreStepDecision,
  inner: Extract<PreStepDecision, { kind: 'enter' }>,
  extras: { runtime: unknown; memory: unknown; recap: unknown },
  mood: boolean,
) {
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') return
  expect(decision.startsRequestSeries).toBe(true)
  expect(decision.messages).toContain(inner.messages[0])
  expect(decision.messages).toContain(extras.runtime)
  expect(decision.messages).toContain(extras.memory)
  expect(decision.messages).toContain(extras.recap)
  const moodRows = decision.messages.filter(item => isMoodMessage(item as UserMessageLike))
  if (mood) {
    expect(moodRows).toHaveLength(1)
    expect(isMoodMessage(decision.messages.at(-1) as UserMessageLike)).toBe(true)
  } else {
    expect(moodRows).toHaveLength(0)
    expect(decision.messages).toEqual(inner.messages)
  }
}

describe('pre-step preserves native and plugin inner snapshots', () => {
  it('keeps runtime context and other plugin snapshots on clear, analyzed, manual, and disable', async () => {
    const { service, run, ask, agent } = setup()

    const clearClaimed = [claimedHuman('把第一章.md里林晚的对白改短，不超过200字，保持原语气。')]
    const clear = nativeChain(clearClaimed)
    const clearDecision = await service.handlePreStep({
      agent, messages: clearClaimed as UserMessageLike[], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => clear.inner)
    expect(run).not.toHaveBeenCalled()
    expectPreservedInner(clearDecision, clear.inner, clear, true)
    expect(service.getContract('sess-1')?.sourceVersion).toBe((clearClaimed[0] as { id: string }).id)

    const mildClaimed = [claimedHuman('请润色第三章的对话。')]
    const mild = nativeChain(mildClaimed)
    const mildDecision = await service.handlePreStep({
      agent, messages: mildClaimed as UserMessageLike[], turn: 1, step: 2, signal: new AbortController().signal,
    }, async () => mild.inner)
    expectPreservedInner(mildDecision, mild.inner, mild, false)

    const analyzedClaimed = [claimedHuman('帮我改一下')]
    const analyzed = nativeChain(analyzedClaimed)
    const analyzedDecision = await service.handlePreStep({
      agent, messages: analyzedClaimed as UserMessageLike[], turn: 1, step: 3, signal: new AbortController().signal,
    }, async () => analyzed.inner)
    expect(ask).toHaveBeenCalled()
    expectPreservedInner(analyzedDecision, analyzed.inner, analyzed, true)
    expect(service.getContract('sess-1')?.readiness).toBe('user-confirmed')
    expect(service.getContract('sess-1')?.sourceVersion).toBe((analyzedClaimed[0] as { id: string }).id)

    await service.call('manual', { sessionId: 'sess-1' }, new AbortController().signal)
    const manualClaimed = [claimedHuman('把第一章.md里林晚的对白改短，不超过200字，保持原语气。')]
    const manual = nativeChain(manualClaimed)
    run.mockClear()
    ask.mockClear()
    const manualDecision = await service.handlePreStep({
      agent, messages: manualClaimed as UserMessageLike[], turn: 1, step: 4, signal: new AbortController().signal,
    }, async () => manual.inner)
    expect(run).toHaveBeenCalledOnce()
    expectPreservedInner(manualDecision, manual.inner, manual, true)

    await service.dispose()
    const disabledClaimed = [claimedHuman('帮我改一下')]
    const disabled = nativeChain(disabledClaimed)
    const disabledDecision = await service.handlePreStep({
      agent, messages: disabledClaimed as UserMessageLike[], turn: 1, step: 5, signal: new AbortController().signal,
    }, async () => disabled.inner)
    expect(disabledDecision).toEqual(disabled.inner)
    expectPreservedInner(disabledDecision, disabled.inner, disabled, false)
  })

  it('does not drop inner snapshots when disable aborts an in-flight question', async () => {
    let release!: (error: unknown) => void
    const ask = vi.fn(() => new Promise<never>((_, reject) => { release = reject }))
    const { service, agent } = setup({ ask })
    const claimed = [claimedHuman('帮我改一下')]
    const chain = nativeChain(claimed)
    const pending = service.handlePreStep({
      agent, messages: claimed as UserMessageLike[], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => chain.inner)
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())
    await service.dispose()
    release(Object.assign(new Error('aborted'), { code: 'ASK_ABORTED', name: 'UserQuestionError' }))
    const decision = await pending
    expect(decision).toEqual(chain.inner)
    expectPreservedInner(decision, chain.inner, chain, false)
  })
})
