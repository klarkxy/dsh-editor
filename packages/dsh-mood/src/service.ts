import { randomUUID } from 'node:crypto'
import type { AiFeatureScope, AuxiliaryResult, RpcResult, TaskContract } from '@klarkxy/dsh-ai-services/contracts'
import {
  MOOD_ANALYZE_PURPOSE, PROMPT_VERSION, SCHEMA_VERSION, cloneContract, defaultSettings, excerptOf, fail, ok,
  parseSessionId, projectIdFromCwd, sessionIdOf, type AskUserRequest, type AskUserQuestionAnswer, type ClarificationItem,
  type HeldRequest, type MoodMode, type MoodSessionView, type MoodSettings, type MoodStatus,
} from './contracts.ts'
import { ANALYZE_SYSTEM, analyzePurpose, boundQuestions, contractFromDraft, parseAnalysis, thinContract } from './analyze.ts'
import {
  collectClaimedHumans, evidenceForRequest, incomingAreAuxiliaryOnly, latestUserSeq, sourceVersionOf,
  type SessionEventLike, type UserMessageLike,
} from './evidence.ts'
import { createMoodContextMessage, formatContract, mergeContractMessage } from './inject.ts'
import {
  answeredNotes, applyAnswers, isAbortLike, markClarification, pendingClarifications, readinessAfterAnswers, toAskItems,
} from './questions.ts'
import { parseEdit, parseManual, parseModeUpdate } from './schema.ts'
import { classifyRequest, isBlockingKind, shouldAnalyze, shouldWriteClearContract, type TriggerKind } from './trigger.ts'

export interface MoodPersistedState {
  settings: MoodSettings
  sessions: Record<string, MoodStoredSession>
}

export interface MoodStoredSession {
  contract?: TaskContract
  clarification: ClarificationItem[]
  lastHandledVersion?: string
  pendingManual: boolean
  projectId?: string
  heldRequest?: HeldRequest
}

export interface MoodStore {
  load(): MoodPersistedState
  save(state: MoodPersistedState): Promise<void>
}

export interface SessionLike {
  id?: unknown
  header?: { cwd?: string }
  meta?: { cwd?: string }
}

export interface PreStepPayload {
  agent: { id?: unknown; session?: SessionLike }
  messages: UserMessageLike[]
  turn: number
  step: number
  signal: AbortSignal
}

export type PreStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: unknown[]; startsRequestSeries?: true }

export interface MoodServiceOptions {
  store?: MoodStore
  now?: () => number
  id?: () => string
  readEvents: (sessionId: string) => readonly SessionEventLike[] | undefined
  liveSession?: (sessionId: string) => SessionLike | undefined
  activateAi?: () => AiFeatureScope | undefined
  askUser?: (request: AskUserRequest) => Promise<AskUserQuestionAnswer>
  createInjectMessage?: (text: string) => unknown
  resumeHeld?: (sessionId: string, messages: unknown[]) => Promise<void>
}

type InternalSession = MoodStoredSession & {
  generation: number
  work?: AbortController
  inflightVersion?: string
}

export class MoodService {
  private settings: MoodSettings
  private sessions = new Map<string, InternalSession>()
  private storageFailed = false
  private active = true
  private ai?: AiFeatureScope
  private unregisterPurpose?: () => void
  private pending = Promise.resolve()
  private readonly now: () => number
  private readonly nextId: () => string

  constructor(private readonly options: MoodServiceOptions) {
    const loaded = cloneState(options.store?.load() ?? { settings: defaultSettings(), sessions: {} })
    this.settings = loaded.settings
    for (const [sessionId, row] of Object.entries(loaded.sessions)) {
      this.sessions.set(sessionId, {
        ...row,
        clarification: row.clarification ?? [],
        pendingManual: Boolean(row.pendingManual),
        generation: 0,
      })
    }
    this.now = options.now ?? Date.now
    this.nextId = options.id ?? randomUUID
    this.syncAi()
  }

  getContract(sessionId: string): TaskContract | undefined {
    const contract = this.sessions.get(sessionId)?.contract
    return contract ? cloneContract(contract) : undefined
  }

  status(sessionId?: string): MoodStatus {
    const status: MoodStatus = {
      settings: { ...this.settings },
      storageFailed: this.storageFailed,
    }
    if (!sessionId) return status
    const row = this.ensure(sessionId)
    status.session = this.view(sessionId, row)
    return status
  }

  isActive(): boolean {
    return this.active
  }

  async dispose(): Promise<void> {
    this.active = false
    for (const row of this.sessions.values()) {
      row.generation += 1
      row.work?.abort()
      row.work = undefined
    }
    this.detachAi()
    await this.pending
  }

  async call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> {
    if (!this.active) return fail('MOOD_DISABLED', '需求澄清已关闭。')
    if (signal.aborted) return fail('MOOD_CANCELLED', '请求已取消。')
    try {
      if (endpoint === 'status') return ok(this.status(parseSessionId(payload)))
      if (endpoint === 'contract') {
        const sessionId = this.hostSessionId(parseSessionId(payload), false)
        if (!sessionId) return fail('MOOD_INVALID', '缺少会话。')
        return ok(this.getContract(sessionId) ?? null)
      }
      if (endpoint === 'mode') {
        const parsed = parseModeUpdate(payload)
        if (!parsed) return fail('MOOD_INVALID', '模式格式无效。')
        return ok(await this.updateMode(parsed.mode, parsed.expectedRevision))
      }
      if (endpoint === 'manual') {
        const parsed = parseManual(payload)
        if (!parsed) return fail('MOOD_INVALID', '缺少会话。')
        const sessionId = this.hostSessionId(parsed.sessionId, true)
        if (!sessionId) return fail('MOOD_SESSION_NOT_FOUND', '会话不在当前 Host。')
        return ok(await this.requestManual(sessionId))
      }
      if (endpoint === 'retry') {
        const parsed = parseManual(payload)
        if (!parsed) return fail('MOOD_INVALID', '缺少会话。')
        const sessionId = this.hostSessionId(parsed.sessionId, true)
        if (!sessionId) return fail('MOOD_SESSION_NOT_FOUND', '会话不在当前 Host。')
        return ok(await this.requestRetry(sessionId))
      }
      if (endpoint === 'edit') {
        const parsed = parseEdit(payload)
        if (!parsed) return fail('MOOD_INVALID', '修订格式无效。')
        const sessionId = this.hostSessionId(parsed.sessionId, true)
        if (!sessionId) return fail('MOOD_SESSION_NOT_FOUND', '会话不在当前 Host。')
        return ok(await this.editContract(sessionId, parsed.expectedRevision, parsed.patch))
      }
      return fail('MOOD_INVALID', '未知操作。')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : 'MOOD_FAILED'
      return fail(code, error instanceof Error ? error.message : '需求澄清操作失败。')
    }
  }

  async handlePreStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> {
    const inner = await next()
    if (!this.active) return inner
    if (inner.kind !== 'enter') return inner
    payload.signal.throwIfAborted()
    const sessionId = sessionIdOf(payload.agent)
    if (!sessionId) return inner
    const claimedMessages = payload.messages
    const state = this.ensure(sessionId)
    state.projectId = projectIdFromCwd(payload.agent.session?.header?.cwd ?? payload.agent.session?.meta?.cwd)
      ?? projectIdFromCwd(this.options.liveSession?.(sessionId)?.header?.cwd ?? this.options.liveSession?.(sessionId)?.meta?.cwd)
      ?? state.projectId

    if (incomingAreAuxiliaryOnly(claimedMessages) && !state.pendingManual) {
      if (this.isBlocked(state)) return { kind: 'reject' }
      return this.enter(inner, state.contract, state.clarification)
    }

    const claimed = collectClaimedHumans(claimedMessages)
    const sourceVersion = sourceVersionOf(claimed)
    const events = this.options.readEvents(sessionId) ?? []
    const evidence = evidenceForRequest(sessionId, events, claimed)
    const text = claimed.at(-1)?.text ?? ''

    if (claimed.length) this.supersedeIfNew(sessionId, sourceVersion)

    const live = this.ensure(sessionId)
    if (live.lastHandledVersion === sourceVersion && !live.pendingManual && isSettled(live.contract?.readiness)) {
      return this.enter(inner, live.contract, live.clarification)
    }

    const kind = classifyRequest(text, { hasConfirmedContract: isSettled(live.contract?.readiness) })
    if (kind === 'skip' && !live.pendingManual) {
      return this.enter(inner, live.contract, live.clarification)
    }

    if (shouldWriteClearContract(kind, live.pendingManual, this.settings.mode)) {
      const generation = live.generation
      const contract = thinContract({
        id: this.nextId(),
        sessionId,
        sourceVersion,
        revision: nextRevision(live.contract),
        goal: text.slice(0, 2000),
        evidence,
        readiness: 'clear-request',
        now: this.now(),
      })
      const wrote = await this.commitIfCurrent(sessionId, generation, {
        contract,
        clarification: [],
        lastHandledVersion: sourceVersion,
        pendingManual: false,
        heldRequest: undefined,
        projectId: live.projectId,
      })
      if (!wrote) return this.afterStale(inner)
      return this.enter(inner, contract, [])
    }

    if (!shouldAnalyze(kind, this.settings.mode, live.pendingManual)) {
      return inner
    }

    const generation = live.generation
    live.inflightVersion = sourceVersion
    const work = this.replaceWork(sessionId)
    const combined = combineSignals(payload.signal, work.signal, this.ai?.signal)
    let draft = undefined as ReturnType<typeof parseAnalysis>
    try {
      draft = await this.runAnalysis({ sessionId, sourceVersion, text, evidence, signal: combined, generation })
    } catch (error) {
      if (!this.generationCurrent(sessionId, generation)) return this.afterStale(inner)
      const status = isAbortLike(error, combined) ? 'cancelled' : 'pending'
      await this.blockUnresolved({
        sessionId, generation, sourceVersion, text, evidence, kind, claimed: claimedMessages, status, inner,
      })
      return { kind: 'reject' }
    }

    if (!this.generationCurrent(sessionId, generation)) return this.afterStale(inner)

    const questions = boundQuestions(draft?.questions ?? [], kind)
    const clarification = pendingClarifications(questions)
    let contract = contractFromDraft({
      id: this.nextId(),
      sessionId,
      sourceVersion,
      revision: nextRevision(this.ensure(sessionId).contract),
      goalFallback: text.slice(0, 2000),
      evidence,
      draft,
      questions,
      readiness: questions.length || isBlockingKind(kind) ? 'pending' : 'disclosed-assumptions',
      now: this.now(),
    })

    if (questions.length > 0) {
      const asked = await this.askOnce(payload.agent, clarification, combined)
      if (!this.generationCurrent(sessionId, generation)) return this.afterStale(inner)
      if (asked.kind === 'aborted' || asked.kind === 'failed') {
        const status = asked.kind === 'aborted' ? 'cancelled' : 'pending'
        await this.blockUnresolved({
          sessionId, generation, sourceVersion, text, evidence, kind, claimed: claimedMessages, status, inner,
          contract, clarification: asked.kind === 'aborted' ? markClarification(clarification, 'cancelled') : clarification,
        })
        return { kind: 'reject' }
      }
      const answered = applyAnswers(clarification, asked.answer)
      const readiness = readinessAfterAnswers(answered, kind)
      if (isBlockingKind(kind) && readiness !== 'user-confirmed') {
        contract = {
          ...contract,
          readiness: 'pending',
          assumptions: draft?.assumptions ?? contract.assumptions,
          constraints: [...contract.constraints, ...answeredNotes(answered)],
          questions: answered.filter(item => item.status !== 'answered').map(item => item.question),
          updatedAt: this.now(),
        }
        await this.commitIfCurrent(sessionId, generation, {
          contract,
          clarification: answered,
          pendingManual: false,
          lastHandledVersion: undefined,
          heldRequest: holdOf(sourceVersion, kind, claimedMessages),
          projectId: this.ensure(sessionId).projectId,
        })
        return { kind: 'reject' }
      }
      contract = {
        ...contract,
        readiness,
        assumptions: [
          ...contract.assumptions,
          ...(isBlockingKind(kind) ? [] : answered.filter(item => item.status === 'skipped').map(item => `未回答：${item.question}`)),
        ],
        constraints: [...contract.constraints, ...answeredNotes(answered)],
        questions: answered.filter(item => item.status !== 'answered').map(item => item.question),
        updatedAt: this.now(),
      }
      const wrote = await this.commitIfCurrent(sessionId, generation, {
        contract,
        clarification: answered,
        lastHandledVersion: sourceVersion,
        pendingManual: false,
        heldRequest: undefined,
        projectId: this.ensure(sessionId).projectId,
      })
      if (!wrote) return this.afterStale(inner)
      return this.enter(inner, contract, answered)
    }

    if (isBlockingKind(kind) && contract.readiness === 'pending') {
      await this.commitIfCurrent(sessionId, generation, {
        contract,
        clarification,
        pendingManual: false,
        lastHandledVersion: undefined,
        heldRequest: holdOf(sourceVersion, kind, claimedMessages),
        projectId: this.ensure(sessionId).projectId,
      })
      return { kind: 'reject' }
    }

    const wrote = await this.commitIfCurrent(sessionId, generation, {
      contract,
      clarification,
      lastHandledVersion: sourceVersion,
      pendingManual: false,
      heldRequest: undefined,
      projectId: this.ensure(sessionId).projectId,
    })
    if (!wrote) return this.afterStale(inner)
    return this.enter(inner, contract, clarification)
  }

  private async runAnalysis(input: {
    sessionId: string
    sourceVersion: string
    text: string
    evidence: TaskContract['evidence']
    signal: AbortSignal
    generation: number
  }): Promise<ReturnType<typeof parseAnalysis>> {
    const scope = this.ai
    if (!scope?.active) return undefined
    input.signal.throwIfAborted()
    const result: AuxiliaryResult = await scope.run({
      purpose: MOOD_ANALYZE_PURPOSE,
      sessionId: input.sessionId,
      sourceVersion: input.sourceVersion,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      system: ANALYZE_SYSTEM,
      input: JSON.stringify({
        text: input.text,
        evidence: input.evidence,
      }),
      signal: input.signal,
      priority: 'interactive',
      isCurrent: () => this.generationCurrent(input.sessionId, input.generation) && !input.signal.aborted,
    })
    if (result.receipt.status !== 'success') return undefined
    if (!this.generationCurrent(input.sessionId, input.generation)) return undefined
    return parseAnalysis(result.text)
  }

  private async askOnce(
    agent: unknown,
    clarification: ClarificationItem[],
    signal: AbortSignal,
  ): Promise<{ kind: 'answered'; answer: AskUserQuestionAnswer } | { kind: 'aborted' } | { kind: 'failed' }> {
    const ask = this.options.askUser
    const items = toAskItems(clarification)
    if (!items.length || !ask) return { kind: 'failed' }
    try {
      const answer = await ask({ agent, questions: items, signal })
      return { kind: 'answered', answer }
    } catch (error) {
      if (isAbortLike(error, signal)) return { kind: 'aborted' }
      return { kind: 'failed' }
    }
  }

  private afterStale(inner: Extract<PreStepDecision, { kind: 'enter' }>): PreStepDecision {
    if (!this.active) return inner
    return { kind: 'reject' }
  }

  private enter(
    decision: Extract<PreStepDecision, { kind: 'enter' }>,
    contract: TaskContract | undefined,
    clarification: readonly ClarificationItem[],
  ): PreStepDecision {
    if (!this.active || !contract) return decision
    if (contract.readiness === 'pending' || contract.readiness === 'cancelled' || contract.readiness === 'stale') {
      return decision
    }
    const text = formatContract(contract, clarification)
    const extra = this.options.createInjectMessage
      ? this.options.createInjectMessage(text)
      : createMoodContextMessage(text)
    return { ...decision, messages: mergeContractMessage(decision.messages ?? [], extra) }
  }

  private async blockUnresolved(input: {
    sessionId: string
    generation: number
    sourceVersion: string
    text: string
    evidence: TaskContract['evidence']
    kind: TriggerKind
    claimed: unknown[]
    status: 'pending' | 'cancelled' | 'stale'
    inner: Extract<PreStepDecision, { kind: 'enter' }>
    contract?: TaskContract
    clarification?: ClarificationItem[]
  }): Promise<void> {
    if (!this.generationCurrent(input.sessionId, input.generation)) return
    const state = this.ensure(input.sessionId)
    const questions = boundQuestions(input.contract?.questions ?? [], input.kind)
    const clarification = input.clarification ?? markClarification(
      pendingClarifications(questions),
      input.status === 'pending' ? 'pending' : input.status,
    )
    const contract = input.contract
      ? { ...input.contract, readiness: input.status, questions, updatedAt: this.now() }
      : thinContract({
        id: this.nextId(),
        sessionId: input.sessionId,
        sourceVersion: input.sourceVersion,
        revision: nextRevision(state.contract),
        goal: input.text.slice(0, 2000),
        evidence: input.evidence,
        readiness: input.status,
        now: this.now(),
        extra: { questions },
      })
    const hold = isBlockingKind(input.kind) || clarification.length > 0
      ? holdOf(input.sourceVersion, input.kind, input.claimed)
      : undefined
    await this.commitIfCurrent(input.sessionId, input.generation, {
      contract,
      clarification,
      pendingManual: false,
      lastHandledVersion: undefined,
      heldRequest: hold,
      projectId: state.projectId,
    })
    void input.inner
  }

  private async updateMode(mode: MoodMode, expectedRevision: number): Promise<MoodStatus> {
    return this.serialize(async () => {
      this.assertLive()
      if (expectedRevision !== this.settings.revision) coded('MOOD_STALE', '需求澄清设置已更新，请刷新后重试。')
      const proposed = this.snapshot()
      proposed.settings = { mode, revision: this.settings.revision + 1 }
      await this.persistProposed(proposed)
      this.commitState(proposed)
      return this.status()
    })
  }

  private async requestManual(sessionId: string): Promise<MoodStatus> {
    const state = this.ensure(sessionId)
    const generation = state.generation
    const held = state.heldRequest
    const wrote = await this.commitIfCurrent(sessionId, generation, {
      pendingManual: true,
      lastHandledVersion: undefined,
      heldRequest: held,
      clarification: state.clarification,
      contract: state.contract,
      projectId: state.projectId,
    })
    if (!wrote) coded('MOOD_CANCELLED', '会话已切换，未执行手动分析。')
    if (held?.messages.length) await this.resumeExact(sessionId, held.messages)
    return this.status(sessionId)
  }

  private async requestRetry(sessionId: string): Promise<MoodStatus> {
    const state = this.ensure(sessionId)
    const held = state.heldRequest
    if (!held?.messages.length) coded('MOOD_NOT_FOUND', '没有可按原请求重试的内容。')
    const generation = state.generation
    const wrote = await this.commitIfCurrent(sessionId, generation, {
      pendingManual: false,
      lastHandledVersion: undefined,
      heldRequest: held,
      clarification: state.clarification.map(item => (
        item.status === 'cancelled' || item.status === 'stale' ? { ...item, status: 'pending' as const, answer: undefined } : item
      )),
      contract: state.contract ? { ...state.contract, readiness: 'pending', updatedAt: this.now() } : state.contract,
      projectId: state.projectId,
    })
    if (!wrote) coded('MOOD_CANCELLED', '会话已切换，未重试。')
    await this.resumeExact(sessionId, held.messages)
    return this.status(sessionId)
  }

  private async resumeExact(sessionId: string, messages: unknown[]): Promise<void> {
    const resume = this.options.resumeHeld
    if (!resume) coded('MOOD_NO_RESUME', '当前 Host 不能按原请求恢复。')
    await resume(sessionId, messages)
  }

  private async editContract(
    sessionId: string,
    expectedRevision: number,
    patch: Partial<Pick<TaskContract, 'goal' | 'deliverables' | 'inScope' | 'outOfScope' | 'constraints' | 'acceptance' | 'assumptions' | 'questions'>>,
  ): Promise<MoodStatus> {
    const state = this.ensure(sessionId)
    const generation = state.generation
    const current = state.contract
    if (!current) coded('MOOD_NOT_FOUND', '还没有可修订的约定。')
    if (current.revision !== expectedRevision) coded('MOOD_STALE', '约定已更新，请刷新后重试。')
    const evidence = [
      ...current.evidence,
      { sessionId, seq: latestUserSeq(this.options.readEvents(sessionId) ?? []), kind: 'manual' as const, excerpt: excerptOf(patch.goal ?? '修订约定') },
    ]
    const contract: TaskContract = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      readiness: 'user-confirmed',
      evidence,
      updatedAt: this.now(),
    }
    const wrote = await this.commitIfCurrent(sessionId, generation, {
      contract,
      clarification: state.clarification.map(item => item.status === 'pending' ? { ...item, status: 'answered' as const, answer: '作者直接修订约定' } : item),
      pendingManual: false,
      lastHandledVersion: state.lastHandledVersion,
      heldRequest: undefined,
      projectId: state.projectId,
    })
    if (!wrote) coded('MOOD_CANCELLED', '会话已切换，未保存修订。')
    return this.status(sessionId)
  }

  private hostSessionId(sessionId: string | undefined, required: boolean): string | undefined {
    if (!sessionId) return undefined
    if (!this.options.liveSession) return sessionId
    const live = this.options.liveSession(sessionId)
    if (!live) return required ? undefined : sessionId
    return live.id != null ? String(live.id) : sessionId
  }

  private ensure(sessionId: string): InternalSession {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    const created: InternalSession = { clarification: [], pendingManual: false, generation: 0 }
    this.sessions.set(sessionId, created)
    return created
  }

  private view(sessionId: string, row: InternalSession): MoodSessionView {
    return {
      sessionId,
      ...(row.projectId ? { projectId: row.projectId } : {}),
      ...(row.contract ? { contract: cloneContract(row.contract) } : {}),
      clarification: row.clarification.map(item => ({ ...item })),
      pendingManual: row.pendingManual,
      held: Boolean(row.heldRequest?.messages.length),
    }
  }

  private isBlocked(state: InternalSession): boolean {
    if (!state.heldRequest) return false
    const readiness = state.contract?.readiness
    return readiness === 'pending' || readiness === 'cancelled' || state.clarification.some(item => item.status === 'pending' || item.status === 'cancelled')
  }

  private async commitIfCurrent(sessionId: string, generation: number, patch: MoodStoredSession): Promise<boolean> {
    return this.serialize(async () => {
      if (!this.generationCurrent(sessionId, generation)) return false
      const proposed = this.snapshot()
      proposed.sessions[sessionId] = storedOf({ ...this.ensure(sessionId), ...patch })
      await this.persistProposed(proposed)
      if (!this.generationCurrent(sessionId, generation)) return false
      this.commitState(proposed)
      return true
    })
  }

  private supersedeIfNew(sessionId: string, sourceVersion: string): void {
    const state = this.ensure(sessionId)
    const previous = state.inflightVersion ?? state.heldRequest?.sourceVersion ?? state.contract?.sourceVersion
    if (!previous || previous === sourceVersion) return
    this.supersede(sessionId)
  }

  private supersede(sessionId: string): void {
    const state = this.ensure(sessionId)
    state.generation += 1
    state.work?.abort()
    state.work = undefined
    state.inflightVersion = undefined
    state.heldRequest = undefined
    state.lastHandledVersion = undefined
    if (state.contract && state.contract.readiness !== 'stale' && state.contract.readiness !== 'cancelled') {
      state.contract = { ...state.contract, readiness: 'stale', updatedAt: this.now() }
    }
    state.clarification = markClarification(state.clarification, 'stale')
  }

  private replaceWork(sessionId: string): AbortController {
    const state = this.ensure(sessionId)
    state.work?.abort()
    const work = new AbortController()
    state.work = work
    return work
  }

  private generationCurrent(sessionId: string, generation: number): boolean {
    if (!this.active) return false
    const state = this.sessions.get(sessionId)
    return Boolean(state && state.generation === generation)
  }

  private snapshot(): MoodPersistedState {
    const sessions: Record<string, MoodStoredSession> = {}
    for (const [sessionId, row] of this.sessions) sessions[sessionId] = storedOf(row)
    return cloneState({ settings: this.settings, sessions })
  }

  private commitState(proposed: MoodPersistedState): void {
    this.settings = proposed.settings
    const next = new Map<string, InternalSession>()
    for (const [sessionId, row] of Object.entries(proposed.sessions)) {
      const previous = this.sessions.get(sessionId)
      next.set(sessionId, {
        ...row,
        generation: previous?.generation ?? 0,
        work: previous?.work,
        inflightVersion: previous?.inflightVersion,
      })
    }
    this.sessions = next
  }

  private async persistProposed(proposed: MoodPersistedState): Promise<void> {
    this.assertLive()
    if (!this.options.store) {
      this.storageFailed = false
      return
    }
    try {
      await this.options.store.save(cloneState(proposed))
      this.storageFailed = false
    } catch (error) {
      this.storageFailed = true
      if (error && typeof error === 'object' && 'code' in error) throw error
      coded('MOOD_STORAGE', '需求澄清保存失败，已保留原内容。')
    }
  }

  private assertLive(): void {
    if (!this.active) coded('MOOD_DISABLED', '需求澄清已关闭。')
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const task = this.pending.then(run, run)
    this.pending = task.then(() => {}, () => {})
    return task
  }

  private syncAi(): void {
    if (!this.active) {
      this.detachAi()
      return
    }
    if (this.ai) return
    const scope = this.options.activateAi?.()
    if (!scope) return
    this.ai = scope
    this.unregisterPurpose = scope.registerPurpose(analyzePurpose)
  }

  private detachAi(): void {
    this.unregisterPurpose?.()
    this.unregisterPurpose = undefined
    this.ai?.dispose()
    this.ai = undefined
  }
}

function isSettled(readiness: TaskContract['readiness'] | undefined): boolean {
  return readiness === 'user-confirmed' || readiness === 'clear-request' || readiness === 'disclosed-assumptions'
}

function nextRevision(contract: TaskContract | undefined): number {
  return (contract?.revision ?? 0) + 1
}

function holdOf(sourceVersion: string, kind: TriggerKind, messages: unknown[]): HeldRequest {
  const trigger = kind === 'risk' || kind === 'material' || kind === 'mild' || kind === 'clear' ? kind : 'material'
  return { sourceVersion, trigger, messages: structuredClone(messages) }
}

function storedOf(row: MoodStoredSession): MoodStoredSession {
  return {
    clarification: row.clarification,
    pendingManual: row.pendingManual,
    ...(row.contract ? { contract: row.contract } : {}),
    ...(row.lastHandledVersion !== undefined ? { lastHandledVersion: row.lastHandledVersion } : {}),
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.heldRequest ? { heldRequest: row.heldRequest } : {}),
  }
}

function cloneState(state: MoodPersistedState): MoodPersistedState {
  return structuredClone(state)
}

function coded(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const live = signals.filter((item): item is AbortSignal => Boolean(item))
  if (live.length === 0) return new AbortController().signal
  if (live.length === 1) return live[0]!
  return AbortSignal.any(live)
}
