import { randomUUID } from 'node:crypto'
import type { AiFeatureScope, PurposeSpec, RpcResult, TaskCheckpoint, TaskContract } from '@klarkxy/dsh-ai-services/contracts'
import {
  fail, ok, parseSessionId, RECAP_CHECKPOINT_PURPOSE, RECAP_DISPLAY_PURPOSE,
  type RecapCard, type RecapLogEvent, type RecapPersistedState, type RecapSettings, type RecapStatus,
  type RecapStore, type RecapTrigger,
} from './contracts.ts'
import {
  applyGeneratedText, cardForFacts, existingCardForWatermark, recapDisplayRequest,
  shouldGenerateRecap, shouldOfferIdleRecap, shouldOfferTurnRecap,
} from './recap.ts'
import {
  buildCheckpoint, checkpointInjectPayload, checkpointLineageKey, checkpointSemanticRequest, isCheckpointLineageStale,
  isMeaningfulCheckpointBoundary, sameCheckpointLineage, shouldRunSemanticCheckpoint,
} from './checkpoints.ts'
import { collectFacts, deterministicBody } from './log.ts'
import { parseUpdate } from './schema.ts'

export type { RecapPersistedState, RecapStore }

export interface RecapServiceOptions {
  store: RecapStore
  now?: () => number
  id?: () => string
  readEvents: (sessionId: string) => RecapLogEvent[] | undefined
  readContract?: (sessionId: string) => TaskContract | undefined
  activateAi?: () => AiFeatureScope | undefined
  createInjectMessage?: (payload: ReturnType<typeof checkpointInjectPayload>) => unknown
}

type Job = {
  abort: AbortController
  epoch: number
  sessionId: string
  sourceVersion: string
  kind: 'card' | 'checkpoint'
}

const displayPurpose: PurposeSpec = {
  id: RECAP_DISPLAY_PURPOSE,
  label: '对话回顾',
  defaultTarget: { kind: 'role', role: 'weak' },
  maxOutputTokens: 512,
  timeoutMs: 30_000,
}
const checkpointPurpose: PurposeSpec = {
  id: RECAP_CHECKPOINT_PURPOSE,
  label: '任务检查点',
  defaultTarget: { kind: 'role', role: 'weak' },
  maxOutputTokens: 512,
  timeoutMs: 30_000,
}

export class RecapService {
  private settings: RecapSettings
  private cards: RecapCard[] = []
  private checkpoints: TaskCheckpoint[] = []
  private storageFailed = false
  private disposed = false
  private pending = Promise.resolve()
  private cardEpoch = 0
  private checkpointEpoch = 0
  private jobs = new Map<string, Job>()
  private ai?: AiFeatureScope
  private unregisterPurposes: Array<() => void> = []
  private checkpointRevisions = new Map<string, number>()
  private checkpointInFlight = new Map<string, string>()
  private readonly now: () => number
  private readonly customId?: () => string

  constructor(private readonly options: RecapServiceOptions) {
    const loaded = cloneState(options.store.load())
    this.settings = loaded.settings
    this.cards = loaded.cards
    this.checkpoints = loaded.checkpoints
    this.checkpointRevisions = recoverCheckpointRevisions(loaded.checkpoints)
    this.now = options.now ?? Date.now
    this.customId = options.id
    this.syncAi()
  }

  status(sessionId?: string): RecapStatus {
    return {
      settings: { ...this.settings },
      storageFailed: this.storageFailed,
      cards: this.cards.filter(card => !sessionId || card.sessionId === sessionId).map(card => ({ ...card })),
      checkpoints: this.checkpoints.filter(row => !sessionId || row.sessionId === sessionId).map(row => ({
        ...row,
        items: row.items.map(item => ({ ...item, evidence: [...item.evidence] })),
        constraints: [...row.constraints],
      })),
    }
  }

  autoWorkActive(): boolean {
    return !this.disposed && (this.settings.cardsEnabled || this.settings.checkpointsEnabled)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.cardEpoch += 1
    this.checkpointEpoch += 1
    this.abortKind('card')
    this.abortKind('checkpoint')
    this.detachAi()
    await this.pending
  }

  async updateSettings(settings: Omit<RecapSettings, 'revision'>, expectedRevision: number): Promise<RecapStatus> {
    return this.serialize(async () => {
      this.assertLive()
      if (expectedRevision !== this.settings.revision) coded('RECAP_STALE', '回顾设置已更新，请刷新后重试。')
      const proposed = this.snapshot()
      proposed.settings = { ...settings, revision: this.settings.revision + 1 }
      const cardsOff = this.settings.cardsEnabled && !proposed.settings.cardsEnabled
      const checkpointsOff = this.settings.checkpointsEnabled && !proposed.settings.checkpointsEnabled
      const semanticOff = this.settings.semanticCheckpointsEnabled && !proposed.settings.semanticCheckpointsEnabled
      if (cardsOff) {
        proposed.cards = proposed.cards.map(card => card.generation === 'running'
          ? { ...card, generation: 'superseded', kind: 'deterministic', updatedAt: this.now() }
          : card)
      }
      await this.persistProposed(proposed)
      this.commit(proposed)
      if (cardsOff) {
        this.cardEpoch += 1
        this.abortKind('card')
      }
      if (checkpointsOff) {
        this.checkpointEpoch += 1
        this.abortKind('checkpoint')
      } else if (semanticOff) {
        this.abortKind('checkpoint')
      }
      this.syncAi()
      return this.status()
    })
  }

  async call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> {
    if (this.disposed) return fail('RECAP_DISABLED', '回顾插件已停止。')
    if (signal.aborted) return fail('RECAP_CANCELLED', '请求已取消')
    try {
      if (endpoint === 'status') return ok(await this.settledStatus(parseSessionId(payload)))
      if (endpoint === 'update') {
        const parsed = parseUpdate(payload)
        if (!parsed) return fail('RECAP_INVALID', '回顾设置格式无效。')
        return ok(await this.updateSettings(parsed.settings, parsed.expectedRevision))
      }
      if (endpoint === 'cards') return ok(this.status(parseSessionId(payload)).cards)
      if (endpoint === 'checkpoints') return ok(this.status(parseSessionId(payload)).checkpoints)
      if (endpoint === 'cancel') {
        const action = cardActionOf(payload)
        return ok(await this.cancelCard(action.cardId, action.sessionId))
      }
      if (endpoint === 'retry') {
        const action = cardActionOf(payload)
        return ok(await this.retryCard(action.cardId, action.sessionId))
      }
      if (endpoint === 'idle.return' || endpoint === 'refresh') {
        const sessionId = parseSessionId(payload)
        if (!sessionId) return fail('RECAP_INVALID', '缺少会话。')
        if (signal.aborted) return fail('RECAP_CANCELLED', '请求已取消')
        const card = endpoint === 'refresh' ? await this.refresh(sessionId) : await this.idleReturn(sessionId)
        return ok(card ?? null)
      }
      return fail('RECAP_INVALID', '未知操作。')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : 'RECAP_FAILED'
      return fail(code, error instanceof Error ? error.message : '回顾操作失败。')
    }
  }

  async onSessionEvent(sessionId: string, event: RecapLogEvent): Promise<RecapCard | undefined> {
    if (this.disposed || !this.settings.cardsEnabled || event.type !== 'turn/end') return undefined
    try {
      const card = await this.capture(sessionId, 'turn-end')
      return this.disposed ? undefined : card
    } catch (error) {
      if (this.disposed) return undefined
      throw error
    }
  }

  async idleReturn(sessionId: string): Promise<RecapCard | undefined> {
    if (this.disposed || !this.settings.cardsEnabled) return undefined
    try {
      const card = await this.capture(sessionId, 'idle-return')
      return this.disposed ? undefined : card
    } catch (error) {
      if (this.disposed) return undefined
      throw error
    }
  }

  async refresh(sessionId: string): Promise<RecapCard | undefined> {
    if (this.disposed || !this.settings.cardsEnabled) return undefined
    try {
      const card = await this.capture(sessionId, 'manual')
      return this.disposed ? undefined : card
    } catch (error) {
      if (this.disposed) return undefined
      throw error
    }
  }

  async cancelCard(cardId: string, sessionId?: string): Promise<RecapCard> {
    return this.serialize(async () => {
      this.assertLive()
      const card = this.requireCard(cardId, sessionId)
      this.jobs.get(cardId)?.abort.abort()
      this.jobs.delete(cardId)
      const next: RecapCard = {
        ...card,
        generation: 'cancelled',
        kind: card.kind === 'generated' ? 'generated' : 'deterministic',
        updatedAt: this.now(),
      }
      const proposed = this.snapshot()
      proposed.cards = proposed.cards.map(row => row.id === next.id ? next : row)
      await this.persistProposed(proposed)
      this.commit(proposed)
      return { ...next }
    })
  }

  async retryCard(cardId: string, sessionId?: string): Promise<RecapCard> {
    const prepared = await this.serialize(async () => {
      this.assertLive()
      if (!this.settings.cardsEnabled) coded('RECAP_DISABLED', '回顾已关闭。')
      const card = this.requireCard(cardId, sessionId)
      this.jobs.get(cardId)?.abort.abort()
      const events = this.options.readEvents(card.sessionId)
      if (!events) coded('RECAP_NOT_FOUND', '找不到会话日志。')
      const facts = collectFacts(card.sessionId, events, card.fromSeq, card.toSeq)
      const running = cardForFacts(facts, { id: card.id, trigger: 'retry', now: this.now(), generation: 'running', kind: 'deterministic' })
      running.createdAt = card.createdAt
      const proposed = this.snapshot()
      proposed.cards = proposed.cards.map(row => row.id === running.id ? running : row)
      await this.persistProposed(proposed)
      this.commit(proposed)
      return { running, facts, epoch: this.cardEpoch }
    })
    await this.generateCard(prepared.running, prepared.facts, prepared.epoch)
    this.assertLive()
    return this.requireCard(cardId, sessionId)
  }

  async handlePreStep<T extends { source?: { kind?: string; plugin?: string } }>(input: {
    sessionId: string
    messages: T[]
    step: number
    signal: AbortSignal
    next: () => Promise<{ kind: string; messages?: T[]; [flag: string]: unknown }>
  }): Promise<{ kind: string; messages?: Array<T | unknown>; [flag: string]: unknown }> {
    const decision = await input.next()
    if (this.disposed || !this.settings.checkpointsEnabled || decision.kind !== 'enter') return decision
    input.signal.throwIfAborted()
    const events = this.options.readEvents(input.sessionId)
    if (!events) return decision
    const contract = this.options.readContract?.(input.sessionId)
    const prepared = await this.serialize(async () => {
      this.assertLive()
      if (!this.settings.checkpointsEnabled) return undefined
      const previous = this.latestCheckpoint(input.sessionId)
      const fromSeq = previous ? previous.toSeq + 1 : 0
      const facts = collectFacts(input.sessionId, events, Math.min(fromSeq, events.at(-1)?.seq ?? 0))
      const lineage = {
        sessionId: facts.sessionId,
        sourceVersion: facts.sourceVersion,
        contractVersion: contract?.revision,
        toSeq: facts.toSeq,
      }
      const flightKey = checkpointLineageKey(lineage.sourceVersion, lineage.contractVersion)
      if (this.checkpoints.some(row => sameCheckpointLineage(row, lineage))) return undefined
      if (this.checkpointInFlight.get(input.sessionId) === flightKey) return undefined
      if (previous && !isCheckpointLineageStale(previous, lineage) && previous.sourceVersion === facts.sourceVersion) {
        return undefined
      }
      if (!isMeaningfulCheckpointBoundary({
        facts, previous, incoming: input.messages, step: input.step, contractVersion: contract?.revision,
      })) return undefined
      const revision = this.nextCheckpointRevision(input.sessionId)
      this.checkpointRevisions.set(input.sessionId, revision)
      this.checkpointInFlight.set(input.sessionId, flightKey)
      return { facts, revision, flightKey }
    })
    if (!prepared) return decision
    try {
      let checkpoint = buildCheckpoint(prepared.facts, {
        id: this.mintId(),
        now: this.now(),
        revision: prepared.revision,
        contract,
      })
      if (shouldRunSemanticCheckpoint(this.settings.semanticCheckpointsEnabled, prepared.facts, contract)) {
        checkpoint = await this.enrichCheckpoint(checkpoint, prepared.facts) ?? checkpoint
      }
      if (this.disposed || !this.settings.checkpointsEnabled) return decision
      input.signal.throwIfAborted()
      let published = false
      try {
        await this.serialize(async () => {
          this.assertLive()
          if (!this.settings.checkpointsEnabled) return
          if (this.checkpoints.some(row => sameCheckpointLineage(row, checkpoint))) return
          const proposed = this.snapshot()
          proposed.checkpoints = [
            ...proposed.checkpoints.filter(row => row.sessionId !== input.sessionId || row.id !== checkpoint.id),
            checkpoint,
          ]
          await this.persistProposed(proposed)
          this.commit(proposed)
          published = true
        })
      } catch {
        return decision
      }
      if (!published || this.disposed || !this.settings.checkpointsEnabled) return decision
      const payload = checkpointInjectPayload(checkpoint)
      const extra = this.options.createInjectMessage ? this.options.createInjectMessage(payload) : payload
      const messages = [...(decision.messages ?? input.messages), extra]
      return { ...decision, messages }
    } finally {
      this.clearCheckpointInFlight(input.sessionId, prepared.flightKey)
    }
  }

  private async capture(sessionId: string, trigger: RecapTrigger): Promise<RecapCard | undefined> {
    const prepared = await this.serialize(async () => {
      this.assertLive()
      if (!this.settings.cardsEnabled) return undefined
      const events = this.options.readEvents(sessionId)
      if (!events?.length) return undefined
      const previous = this.cards.filter(card => card.sessionId === sessionId).sort((a, b) => b.toSeq - a.toSeq)[0]
      const fromSeq = previous ? previous.toSeq + 1 : 0
      const facts = collectFacts(sessionId, events, fromSeq)
      const emptyNewWork = facts.userTurns === 0 && facts.toolCalls === 0 && facts.stepCount === 0 && facts.sourceStatus === 'running'
      if (emptyNewWork) {
        if (trigger !== 'manual' || !previous) return undefined
        if (previous.kind === 'generated' || previous.generation === 'running') return { action: 'reuse' as const, card: previous }
        return { action: 'retry' as const, card: previous }
      }
      const existing = existingCardForWatermark(this.cards, sessionId, facts.sourceVersion)
      if (existing) {
        if (trigger !== 'manual') return undefined
        if (existing.kind === 'generated' || existing.generation === 'running') return { action: 'reuse' as const, card: existing }
        return { action: 'retry' as const, card: existing }
      }
      if (trigger === 'turn-end' && !shouldOfferTurnRecap(facts, this.settings.cardsEnabled)) return undefined
      if (trigger === 'idle-return' && !shouldOfferIdleRecap(facts, this.settings.cardsEnabled, false)) return undefined
      if (facts.sourceStatus === 'running' && trigger === 'turn-end') return undefined
      const card = cardForFacts(facts, {
        id: this.mintId(),
        trigger,
        now: this.now(),
        generation: shouldGenerateRecap(facts, trigger) ? 'running' : 'idle',
        kind: 'deterministic',
      })
      const proposed = this.snapshot()
      proposed.cards = [...proposed.cards, card]
      await this.persistProposed(proposed)
      this.commit(proposed)
      return { action: 'create' as const, card, facts, epoch: this.cardEpoch }
    })
    if (!prepared) return undefined
    if (prepared.action === 'reuse') return prepared.card
    if (prepared.action === 'retry') return this.retryCard(prepared.card.id, sessionId)
    if (prepared.card.generation === 'running') await this.generateCard(prepared.card, prepared.facts, prepared.epoch)
    if (this.disposed) return undefined
    return this.cards.find(row => row.id === prepared.card.id)
  }

  private async generateCard(card: RecapCard, facts: ReturnType<typeof collectFacts>, epoch: number): Promise<void> {
    const started = await this.serialize(async () => {
      if (!this.isCardCurrent(card, epoch, false)) return undefined
      const scope = this.ai
      if (!scope || !this.settings.cardsEnabled) {
        const proposed = this.snapshot()
        proposed.cards = proposed.cards.map(row => row.id === card.id
          ? { ...row, generation: 'idle' as const, kind: 'deterministic' as const, updatedAt: this.now() }
          : row)
        await this.persistProposed(proposed)
        this.commit(proposed)
        return undefined
      }
      const abort = new AbortController()
      this.jobs.set(card.id, { abort, epoch, sessionId: card.sessionId, sourceVersion: card.sourceVersion, kind: 'card' })
      return { scope, abort }
    })
    if (!started) return
    try {
      const result = await started.scope.run({
        ...recapDisplayRequest(facts, card.id),
        signal: started.abort.signal,
        priority: 'background',
        isCurrent: () => this.isCardCurrent(card, epoch),
      })
      await this.serialize(async () => {
        if (!this.isCardCurrent(card, epoch)) return
        const current = this.cards.find(row => row.id === card.id)
        if (!current || current.generation !== 'running') return
        const next = result.receipt.status !== 'success'
          ? {
              ...current,
              generation: result.receipt.status === 'cancelled' ? 'cancelled' as const : 'failed' as const,
              kind: 'deterministic' as const,
              body: deterministicBody(facts),
              updatedAt: this.now(),
            }
          : applyGeneratedText(current, result.text, result.receipt.id, this.now())
        const proposed = this.snapshot()
        proposed.cards = proposed.cards.map(row => row.id === next.id ? next : row)
        await this.persistProposed(proposed)
        this.commit(proposed)
      })
    } catch {
      try {
        await this.serialize(async () => {
          if (!this.isCardCurrent(card, epoch)) return
          const current = this.cards.find(row => row.id === card.id)
          if (current?.generation !== 'running') return
          const proposed = this.snapshot()
          proposed.cards = proposed.cards.map(row => row.id === current.id
            ? {
                ...current,
                generation: started.abort.signal.aborted ? 'cancelled' as const : 'failed' as const,
                kind: 'cached' as const,
                body: current.body,
                updatedAt: this.now(),
              }
            : row)
          await this.persistProposed(proposed)
          this.commit(proposed)
        })
      } catch { /* storageFailed already set; do not mutate past a failed persist */ }
    } finally {
      this.jobs.delete(card.id)
    }
  }

  private async enrichCheckpoint(checkpoint: TaskCheckpoint, facts: ReturnType<typeof collectFacts>): Promise<TaskCheckpoint | undefined> {
    const scope = this.ai
    const epoch = this.checkpointEpoch
    if (this.disposed || !scope || !this.settings.semanticCheckpointsEnabled || !this.settings.checkpointsEnabled) return checkpoint
    const abort = new AbortController()
    const jobId = checkpoint.id
    this.jobs.set(jobId, { abort, epoch, sessionId: checkpoint.sessionId, sourceVersion: checkpoint.sourceVersion, kind: 'checkpoint' })
    const request = checkpointSemanticRequest(checkpoint, facts)
    try {
      const result = await scope.run({
        ...request,
        signal: abort.signal,
        priority: 'background',
        isCurrent: () => !this.disposed
          && this.checkpointEpoch === epoch
          && this.settings.checkpointsEnabled
          && this.settings.semanticCheckpointsEnabled
          && this.jobs.get(jobId)?.epoch === epoch
          && this.jobs.get(jobId)?.sessionId === checkpoint.sessionId,
      })
      if (this.disposed || this.checkpointEpoch !== epoch || !this.settings.checkpointsEnabled || !this.settings.semanticCheckpointsEnabled) {
        return undefined
      }
      if (result.receipt.status !== 'success' || !result.text.trim()) return checkpoint
      const nextAction = result.text.trim().split('\n')[0]?.slice(0, 400) || checkpoint.nextAction
      return { ...checkpoint, nextAction, constraints: checkpoint.constraints }
    } catch {
      return this.disposed || this.checkpointEpoch !== epoch ? undefined : checkpoint
    } finally {
      this.jobs.delete(jobId)
    }
  }

  private latestCheckpoint(sessionId: string): TaskCheckpoint | undefined {
    return this.checkpoints.filter(row => row.sessionId === sessionId).sort((a, b) => b.toSeq - a.toSeq || b.revision - a.revision)[0]
  }

  private nextCheckpointRevision(sessionId: string): number {
    const fromMap = this.checkpointRevisions.get(sessionId) ?? 0
    const fromRows = this.checkpoints.reduce((max, row) => row.sessionId === sessionId ? Math.max(max, row.revision) : max, 0)
    return Math.max(fromMap, fromRows) + 1
  }

  private clearCheckpointInFlight(sessionId: string, flightKey: string): void {
    if (this.checkpointInFlight.get(sessionId) === flightKey) this.checkpointInFlight.delete(sessionId)
  }

  private requireCard(cardId: string, sessionId?: string): RecapCard {
    const card = this.cards.find(row => row.id === cardId)
    if (!card) coded('RECAP_NOT_FOUND', '找不到该回顾。')
    if (sessionId && card.sessionId !== sessionId) coded('RECAP_STALE', '回顾不属于当前会话。')
    return card
  }

  private isCardCurrent(card: RecapCard, epoch: number, requireJob = true): boolean {
    if (this.disposed || this.cardEpoch !== epoch || !this.settings.cardsEnabled) return false
    const current = this.cards.find(row => row.id === card.id)
    if (!current || current.generation !== 'running' || current.sessionId !== card.sessionId) return false
    if (!requireJob) return true
    const job = this.jobs.get(card.id)
    return Boolean(job && job.epoch === epoch && job.sessionId === card.sessionId)
  }

  private abortKind(kind: Job['kind']): void {
    for (const [id, job] of this.jobs) {
      if (job.kind !== kind) continue
      job.abort.abort()
      this.jobs.delete(id)
    }
  }

  private syncAi(): void {
    if (this.disposed) {
      this.detachAi()
      return
    }
    const want = this.settings.cardsEnabled || (this.settings.checkpointsEnabled && this.settings.semanticCheckpointsEnabled)
    if (!want) {
      this.detachAi()
      return
    }
    if (this.ai) return
    const scope = this.options.activateAi?.()
    if (!scope) return
    this.ai = scope
    this.unregisterPurposes = [scope.registerPurpose(displayPurpose), scope.registerPurpose(checkpointPurpose)]
  }

  private detachAi(): void {
    for (const off of this.unregisterPurposes.splice(0)) off()
    this.ai?.dispose()
    this.ai = undefined
  }

  private mintId(): string {
    if (this.customId) {
      const id = this.customId()
      if (this.hasId(id)) coded('RECAP_CONFLICT', '回顾编号冲突。')
      return id
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = randomUUID()
      if (!this.hasId(id)) return id
    }
    coded('RECAP_CONFLICT', '回顾编号冲突。')
  }

  private hasId(id: string): boolean {
    return this.cards.some(card => card.id === id) || this.checkpoints.some(row => row.id === id)
  }

  private snapshot(): RecapPersistedState {
    return cloneState({ settings: this.settings, cards: this.cards, checkpoints: this.checkpoints })
  }

  private commit(proposed: RecapPersistedState): void {
    this.settings = proposed.settings
    this.cards = proposed.cards
    this.checkpoints = proposed.checkpoints
  }

  private async persistProposed(proposed: RecapPersistedState): Promise<void> {
    try {
      await this.options.store.save(cloneState(proposed))
      this.storageFailed = false
    } catch (error) {
      this.storageFailed = true
      if (error && typeof error === 'object' && 'code' in error) throw error
      coded('RECAP_STORAGE', '回顾保存失败，已保留原内容。')
    }
  }

  private assertLive(): void {
    if (this.disposed) coded('RECAP_DISABLED', '回顾插件已停止。')
  }

  private async settledStatus(sessionId?: string): Promise<RecapStatus> {
    await this.pending
    return this.status(sessionId)
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const task = this.pending.then(run, run)
    this.pending = task.then(() => {}, () => {})
    return task
  }
}

function recoverCheckpointRevisions(rows: readonly TaskCheckpoint[]): Map<string, number> {
  const revisions = new Map<string, number>()
  for (const row of rows) {
    const current = revisions.get(row.sessionId) ?? 0
    if (row.revision > current) revisions.set(row.sessionId, row.revision)
  }
  return revisions
}

function cloneState(state: RecapPersistedState): RecapPersistedState {
  return {
    settings: { ...state.settings },
    cards: state.cards.map(card => ({ ...card })),
    checkpoints: state.checkpoints.map(row => ({
      ...row,
      items: row.items.map(item => ({ ...item, evidence: item.evidence.map(ref => ({ ...ref })) })),
      constraints: [...row.constraints],
    })),
  }
}

function coded(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function cardActionOf(payload: unknown): { cardId: string; sessionId?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    coded('RECAP_INVALID', '缺少编号。')
  }
  const value = (payload as Record<string, unknown>).cardId
  if (typeof value !== 'string' || !value) coded('RECAP_INVALID', '缺少编号。')
  return { cardId: value, sessionId: parseSessionId(payload) }
}
