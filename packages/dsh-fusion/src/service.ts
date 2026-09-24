import { createHash, randomUUID } from 'node:crypto'
import { emptyFusionState, isWorking, type FusionActor, type FusionBrief, type FusionCandidate, type FusionNative, type FusionPair,
  type FusionProfile, type FusionState, type FusionStore, type FusionTarget, type FusionTask, type ModelRoute } from './contracts.ts'
import type { FusionWritingHost } from './host-contracts.ts'
import type { FusionCandidateAction, FusionPreview } from './contracts.ts'
import { brief as parseBrief, integer, requireFusion, route as parseRoute, target as parseTarget, text, validateState } from './validation.ts'

export const contentHash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')
const clone = <T>(value: T): T => structuredClone(value)
const currentTask = (pair: FusionPair): FusionTask | undefined => pair.tasks.at(-1)

/** Business records only. The native continuation manager owns Agents and all message scheduling. */
export class FusionService {
  private state: FusionState
  private pending: Promise<void> = Promise.resolve()
  private enabled = true
  private generation = 0
  private storageFailed = false
  private readonly controller = new AbortController()
  private readonly dispatches = new Map<string, Set<AbortController>>()
  private readonly applications = new Map<string, Set<AbortController>>()
  private readonly notifications = new Map<string, Set<AbortController>>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly ready: Promise<void>
  private readonly store: FusionStore
  private readonly inspectAdmission?: (pair: FusionPair, signal: AbortSignal) => Promise<'present' | 'absent'>
  private readonly native: FusionNative
  private readonly now: () => number
  private readonly id: () => string
  constructor(input: { store: FusionStore; native: FusionNative; inspectAdmission?: (pair: FusionPair, signal: AbortSignal) => Promise<'present' | 'absent'>; now?: () => number; id?: () => string }) {
    this.inspectAdmission = input.inspectAdmission
    this.store = input.store; this.native = input.native; this.now = input.now ?? Date.now; this.id = input.id ?? randomUUID
    this.state = validateState(this.store.load() ?? emptyFusionState())
    // A restored task is not a license to replay a side effect or start inference from a status read.
    this.ready = this.change(next => {
      for (const pair of next.pairs) for (const task of pair.tasks) {
        if (isWorking(task.state)) {
          task.state = 'interrupted'; task.delivery = 'uncertain'; task.updatedAt = this.now()
          task.error = '进程已重启。请核对执行记录后明确恢复；未自动重发任务。'
        }
      }
    }, true)
  }
  get active(): boolean { return this.enabled && !this.storageFailed }
  async initialized(): Promise<void> { await this.ready }
  snapshot(): FusionState { return clone(this.state) }
  pairFor(sessionId: string): FusionPair | undefined {
    const pair = this.state.pairs.find(pair => pair.leadSessionId === sessionId || pair.childSessionId === sessionId)
    return pair && clone(pair)
  }
  role(sessionId: string): 'lead' | 'sidekick' | undefined {
    const pair = this.state.pairs.find(pair => pair.leadSessionId === sessionId || pair.childSessionId === sessionId)
    return pair && (pair.leadSessionId === sessionId ? 'lead' : 'sidekick')
  }
  private async persist(next: FusionState): Promise<void> {
    next.revision++
    validateState(next)
    try { await this.store.save(clone(next)) }
    catch (error) { this.storageFailed = true; this.generation++; this.controller.abort(); throw error }
    this.state = clone(next)
  }
  private change<T>(fn: (next: FusionState) => T | Promise<T>, allowInactive = false): Promise<T> {
    const result = this.pending.then(async () => {
      requireFusion(allowInactive || this.enabled, 'DISABLED', 'Fusion is disabled.')
      requireFusion(allowInactive || !this.storageFailed, 'STORAGE_FAILED', 'Fusion storage failed. Reload after repairing storage; no new work was admitted.')
      const next = clone(this.state), value = await fn(next)
      await this.persist(next)
      return clone(value)
    })
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }
  private owned(next: FusionState, actor: FusionActor, side: 'lead' | 'sidekick'): FusionPair {
    const pair = next.pairs.find(pair => (side === 'lead' ? pair.leadSessionId : pair.childSessionId) === actor.sessionId)
    requireFusion(pair && pair.project === actor.project && (side !== 'sidekick' || actor.parentSessionId === pair.leadSessionId), 'UNAUTHORIZED', 'This session does not own the Fusion task.')
    if (side === 'lead') requireFusion(!actor.parentSessionId, 'UNAUTHORIZED', 'A child cannot become a Fusion Lead.')
    return pair
  }
  private task(pair: FusionPair, taskId: string, revision: number): FusionTask {
    const task = currentTask(pair)
    requireFusion(task?.id === taskId && task.revision === revision, 'STALE', 'This task revision is no longer current.')
    return task
  }
  private isCurrent(pairId: string, taskId: string, revision: number, generation: number): boolean {
    if (!this.enabled || this.storageFailed || generation !== this.generation) return false
    const pair = this.state.pairs.find(pair => pair.id === pairId), task = pair && currentTask(pair)
    return task?.id === taskId && task.revision === revision && isWorking(task.state)
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.inFlight.add(operation)
    void operation.finally(() => this.inFlight.delete(operation)).catch(() => {})
    return operation
  }
  private abortNotifications(taskId: string): void {
    for (const controller of this.notifications.get(taskId) ?? []) controller.abort()
  }
  async delegate(actor: FusionActor, input: { profile: FusionProfile; route: ModelRoute; brief: FusionBrief; target?: FusionTarget; signal: AbortSignal }): Promise<FusionTask> {
    await this.ready
    input.signal.throwIfAborted()
    requireFusion(!actor.parentSessionId && !this.roleIsChild(actor.sessionId), 'UNAUTHORIZED', 'Fusion only delegates from a user root session.')
    text(actor.sessionId, 'session id', 200); text(actor.project, 'project identity', 8192)
    const brief = parseBrief(input.brief), route = parseRoute(input.route), target = parseTarget(input.target)
    requireFusion(input.profile === 'generic' || input.profile === 'writing', 'INVALID_INPUT', 'Unknown Fusion profile.')
    const reserved = await this.change(async next => {
      input.signal.throwIfAborted()
      let pair = next.pairs.find(pair => pair.leadSessionId === actor.sessionId)
      if (pair) {
        requireFusion(pair.project === actor.project && pair.profile === input.profile, 'CONTEXT_CHANGED', 'Project or profile changed. Start a new root conversation.')
        requireFusion(!currentTask(pair) || !isWorking(currentTask(pair)!.state), 'BUSY', 'The previous Fusion task needs review, cancellation or a decision first.')
        requireFusion(!currentTask(pair) || !this.dispatches.has(currentTask(pair)!.id), 'ADMISSION_PENDING', 'The previous native admission is still settling.')
        requireFusion(!['pending', 'conflict'].includes(currentTask(pair)?.adoption ?? '') && currentTask(pair)?.application?.state !== 'pending', 'ADOPTION_PENDING', 'Adopt or dismiss the previous candidate before delegating again.')
        requireFusion(currentTask(pair)?.cleanup !== 'pending' && currentTask(pair)?.cleanup !== 'failed', 'STOP_INCOMPLETE', 'Previous child cleanup must finish before delegation.')
        requireFusion(JSON.stringify(pair.route) === JSON.stringify(route), 'ROUTE_CHANGED', 'The persistent partner uses another route. Start a new conversation to change it.')
        if (!pair.established && pair.tasks.length && this.inspectAdmission) {
          await this.native.stop(clone(pair), false)
          pair.established = await this.inspectAdmission(clone(pair), input.signal) === 'present'
          input.signal.throwIfAborted()
        }
        requireFusion(pair.established || pair.tasks.length === 0 || this.inspectAdmission, 'UNCERTAIN_ADMISSION', 'Initial child admission is uncertain. Start a new conversation after inspecting the old child.')
      } else {
        pair = { id: this.id(), leadSessionId: actor.sessionId, childSessionId: this.id(), project: actor.project,
          profile: input.profile, route, established: false, tasks: [], createdAt: this.now() }
        next.pairs.push(pair)
      }
      const task: FusionTask = { id: this.id(), revision: 1, state: 'dispatching', brief, ...(target ? { target } : {}), candidates: [], reviews: [],
        messageIds: [], dispatchId: this.id(), reportIds: [], delivery: 'pending', createdAt: this.now(), updatedAt: this.now() }
      pair.tasks.push(task)
      return { pair, task }
    })
    return this.dispatch(reserved.pair, reserved.task, input.signal)
  }
  private roleIsChild(id: string): boolean { return this.state.pairs.some(pair => pair.childSessionId === id) }
  private dispatch(pair: FusionPair, task: FusionTask, outerSignal: AbortSignal): Promise<FusionTask> {
    const controller = new AbortController(), generation = this.generation
    const controllers = this.dispatches.get(task.id) ?? new Set<AbortController>()
    controllers.add(controller); this.dispatches.set(task.id, controllers)
    const signal = AbortSignal.any([outerSignal, controller.signal, this.controller.signal])
    return this.track((async () => {
      try {
        signal.throwIfAborted()
        const message = await this.native.dispatch({ pair: clone(pair), task: clone(task), prompt: this.prompt(pair, task), signal })
        // Report/review can finish before the native admission promise returns. Completion is not cancellation.
        const admitted = await this.change(next => {
          const current = next.pairs.find(row => row.id === pair.id)!
          current.established = true
          const row = current.tasks.find(row => row.id === task.id)!
          const messageId = text(message.messageId, 'message id', 200)
          if (!row.messageIds.includes(messageId)) row.messageIds.push(messageId)
          if (row.revision === task.revision) {
            row.delivery = 'accepted'
            if (this.enabled && !this.storageFailed && generation === this.generation && row.state === 'dispatching') row.state = 'working'
            row.updatedAt = this.now()
          }
          return { task: row, valid: this.enabled && !this.storageFailed && generation === this.generation && !['cancelled', 'failed', 'interrupted'].includes(row.state) }
        }, true)
        requireFusion(admitted.valid, 'STALE', 'Task was invalidated while its message was being admitted.')
        return admitted.task
      } catch (error) {
        await this.change(next => {
          const row = next.pairs.find(row => row.id === pair.id)?.tasks.find(row => row.id === task.id)
          if (row && row.revision === task.revision && isWorking(row.state)) {
            row.state = signal.aborted ? 'cancelled' : 'failed'
            row.delivery = 'uncertain'; row.updatedAt = this.now()
            row.error = signal.aborted ? '任务已取消，未自动重试。' : '委派未确认完成，请查看执行记录后再处理。'
          }
        }, true)
        // dispatch implementations clean partial starts; stop also covers accepted-but-unsaved children.
        const latest = this.pairFor(pair.leadSessionId)?.tasks.at(-1)
        // An old admission or revision must never drain newer work using the persistent child.
        if (!this.enabled || (latest?.id === task.id && latest.revision === task.revision && ['cancelled', 'failed', 'interrupted'].includes(latest.state))) {
          try { await this.native.stop(pair, false) } catch { /* later cancel can retry cleanup */ }
        }
        throw error
      } finally {
        controllers.delete(controller)
        if (!controllers.size) this.dispatches.delete(task.id)
      }
    })())
  }
  private prompt(pair: FusionPair, task: FusionTask): string {
    return `Fusion task ${task.id}; revision ${task.revision}; dispatch ${task.dispatchId}.\n`
      + `Goal: ${task.brief.goal}\nContext:\n${task.brief.context}\nConstraints:\n${task.brief.constraints.join('\n')}\nAcceptance:\n${task.brief.acceptance.join('\n')}\n`
      + (task.target ? `Versioned destination (do not change): ${JSON.stringify(task.target)}\n` : '')
      + (task.decision ? `Lead feedback: ${task.decision}\n` : '')
      + `Use fusion_report with this taskId and taskRevision, and a unique reportId. Submit ${pair.profile === 'writing' ? 'the exact prose candidate' : 'a concise result with verifiable evidence'}, or request a decision. Do not claim the task is complete without reporting. Stop after reporting and wait for the Lead.`
  }
  async report(actor: FusionActor, input: { taskId: string; taskRevision: number; reportId: string; kind: 'candidate' | 'decision'; text: string; report?: string; signal: AbortSignal }): Promise<FusionTask> {
    await this.ready; input.signal.throwIfAborted()
    integer(input.taskRevision, 'task revision'); text(input.reportId, 'report id', 200)
    text(input.text, 'report text', input.kind === 'candidate' ? 200_000 : 16_000, input.kind === 'candidate')
    text(input.report ?? '', 'report summary', 16_000, true)
    requireFusion(input.kind === 'candidate' || input.kind === 'decision', 'INVALID_INPUT', 'Unknown report kind.')
    const generation = this.generation
    const result = await this.change(next => {
      input.signal.throwIfAborted()
      const pair = this.owned(next, actor, 'sidekick'), task = this.task(pair, input.taskId, input.taskRevision)
      // A report from the exact native-owned child proves that initial admission materialized.
      pair.established = true
      const reportKey = `${task.revision}:${input.reportId}`
      if (task.reportIds.includes(reportKey)) {
        const candidate = task.candidates.at(-1)
        requireFusion(input.kind === 'decision' ? task.decision === input.text : candidate?.text === input.text && candidate.report === (input.report ?? ''), 'DUPLICATE_CONFLICT', 'A report id cannot be reused for different content.')
        return { pair, task, reportKey, duplicate: true }
      }
      requireFusion(task.state === 'dispatching' || task.state === 'working', 'STALE', 'The task is no longer accepting reports.')
      task.reportIds.push(reportKey)
      if (input.kind === 'decision') { task.state = 'decision'; task.decision = input.text }
      else {
        task.candidates.push({ id: this.id(), taskRevision: task.revision, revision: task.candidates.length + 1,
          text: input.text, hash: contentHash(input.text), report: input.report ?? '', createdAt: this.now() })
        task.state = 'review'
      }
      task.updatedAt = this.now()
      return { pair, task, reportKey, duplicate: false }
    })
    if (result.duplicate) {
      requireFusion(result.task.notifiedReportId === result.reportKey, 'NOTIFICATION_UNCERTAIN', 'The report was saved, but Lead notification is not confirmed. Inspect the exact task record before any explicit recovery.')
      return result.task
    }
    const controller = new AbortController()
    const controllers = this.notifications.get(result.task.id) ?? new Set<AbortController>()
    controllers.add(controller)
    this.notifications.set(result.task.id, controllers)
    try {
      if (this.isCurrent(result.pair.id, result.task.id, result.task.revision, generation)) {
        const candidate = result.task.candidates.at(-1)
        const body = result.task.state === 'decision'
          ? `Decision requested for ${result.task.id} revision ${result.task.revision}: ${result.task.decision}`
          : `Candidate ready for ${result.task.id} revision ${result.task.revision}: ${candidate!.id}, sha256 ${candidate!.hash}. Read the exact candidate using fusion_read before fusion_review. Report: ${candidate!.report}`
        const signal = AbortSignal.any([controller.signal, this.controller.signal])
        signal.throwIfAborted()
        await this.track(this.native.notify({ pair: result.pair, task: result.task, actor, text: body, signal }))
        await this.change(next => {
          const row = next.pairs.find(pair => pair.id === result.pair.id)?.tasks.find(task => task.id === result.task.id)
          if (row?.revision === result.task.revision && isWorking(row.state)) row.notifiedReportId = result.reportKey
        }, true)
      }
    } finally {
      controllers.delete(controller)
      if (controllers.size === 0) this.notifications.delete(result.task.id)
    }
    return clone(this.state.pairs.find(pair => pair.id === result.pair.id)?.tasks.find(task => task.id === result.task.id) ?? result.task)
  }
  read(actor: FusionActor, taskId: string, candidateId?: string): { task: FusionTask; candidate?: FusionCandidate } {
    const pair = this.owned(this.state, actor, 'lead')
    const task = pair.tasks.find(row => row.id === taskId)
    requireFusion(task, 'NOT_FOUND', 'Unknown Fusion task.')
    const candidate = candidateId ? task.candidates.find(row => row.id === candidateId) : task.candidates.at(-1)
    requireFusion(!candidateId || candidate, 'NOT_FOUND', 'Unknown candidate.')
    return clone({ task, ...(candidate ? { candidate } : {}) })
  }
  async review(actor: FusionActor, input: { taskId: string; taskRevision: number; candidateId: string; hash: string; verdict: 'accept' | 'revise' | 'reject'; feedback: string; signal: AbortSignal }): Promise<FusionTask> {
    await this.ready; input.signal.throwIfAborted(); text(input.feedback, 'feedback', 16_000, true)
    requireFusion(['accept','revise','reject'].includes(input.verdict), 'INVALID_INPUT', 'Unknown review verdict.')
    const result = await this.change(next => {
      input.signal.throwIfAborted()
      const pair = this.owned(next, actor, 'lead'), task = this.task(pair, input.taskId, integer(input.taskRevision, 'task revision'))
      const candidate = task.candidates.at(-1)
      requireFusion(candidate?.id === input.candidateId && candidate.hash === input.hash && candidate.taskRevision === task.revision, 'STALE', 'Review must reference the current exact candidate.')
      requireFusion(task.state === 'review', 'STALE', 'The task is not awaiting review.')
      requireFusion(contentHash(candidate.text) === candidate.hash, 'INVALID_STATE', 'Candidate content does not match its stored hash.')
      task.reviews.push({ candidateId: candidate.id, candidateHash: candidate.hash, verdict: input.verdict, feedback: input.feedback, createdAt: this.now() })
      task.updatedAt = this.now()
      if (input.verdict === 'accept') { task.state = 'accepted'; if (pair.profile === 'writing' && task.target) task.adoption = 'pending' }
      else if (input.verdict === 'reject') task.state = 'cancelled'
      else {
        requireFusion(task.candidates.length < 16, 'RETRY_LIMIT', 'Revision limit reached. Keep the candidate and ask the author for direction.')
        requireFusion(input.feedback.trim(), 'INVALID_INPUT', 'Revision requires actionable feedback.')
        task.revision++; task.state = 'dispatching'; task.dispatchId = this.id(); task.delivery = 'pending'; task.decision = input.feedback; delete task.notifiedReportId
      }
      return { pair, task }
    })
    this.abortNotifications(result.task.id)
    if (input.verdict === 'revise') return this.dispatch(result.pair, result.task, input.signal)
    return result.task
  }
  async decide(actor: FusionActor, input: { taskId: string; taskRevision: number; feedback: string; signal: AbortSignal }): Promise<FusionTask> {
    await this.ready; input.signal.throwIfAborted(); text(input.feedback, 'decision', 16_000)
    const result = await this.change(async next => {
      input.signal.throwIfAborted()
      const pair = this.owned(next, actor, 'lead'), task = this.task(pair, input.taskId, integer(input.taskRevision, 'task revision'))
      requireFusion(['decision', 'interrupted', 'failed'].includes(task.state), 'STALE', 'Only a blocked or explicitly interrupted task can resume.')
      requireFusion(task.delivery !== 'pending', 'UNCERTAIN_ADMISSION', 'Initial admission is still pending.')
      if (this.inspectAdmission) {
        // Explicit continuation must first quiesce any surviving admission and verify native authority.
        await this.native.stop(clone(pair), false)
        pair.established = await this.inspectAdmission(clone(pair), input.signal) === 'present'
        input.signal.throwIfAborted()
        task.cleanup = 'done'
      } else requireFusion(pair.established, 'UNCERTAIN_ADMISSION', 'Inspect uncertain initial admission before resuming.')
      requireFusion(task.revision < 32, 'RETRY_LIMIT', 'Task revision limit reached.')
      task.revision++; task.state = 'dispatching'; task.delivery = 'pending'; task.dispatchId = this.id(); task.decision = input.feedback; delete task.error; delete task.notifiedReportId
      task.updatedAt = this.now()
      return { pair, task }
    })
    this.abortNotifications(result.task.id)
    return this.dispatch(result.pair, result.task, input.signal)
  }
  async cancel(actor: FusionActor, taskId: string, taskRevision: number, stopLead = false): Promise<void> {
    await this.ready
    const present = this.task(this.owned(this.state, actor, 'lead'), taskId, integer(taskRevision, 'task revision'))
    for (const controller of this.applications.get(present.id) ?? []) controller.abort()
    // Invalidate business results before any asynchronous resource teardown.
    const pair = await this.change(next => {
      const pair = this.owned(next, actor, 'lead'), task = this.task(pair, taskId, integer(taskRevision, 'task revision'))
      requireFusion(task.application?.state !== 'pending', 'APPLICATION_UNCERTAIN', 'Inspect the pending application before stopping this task.')
      requireFusion(task.adoption !== 'applied', 'ALREADY_APPLIED', 'Stopping does not undo an applied change.')
      if (task.state === 'accepted' && pair.profile === 'writing' && task.target) task.adoption = 'dismissed'
      else task.state = 'cancelled'
      task.cleanup = 'pending'; task.updatedAt = this.now()
      return pair
    })
    for (const controller of this.dispatches.get(taskId) ?? []) controller.abort()
    this.abortNotifications(taskId)
    try {
      await this.track(this.native.stop(pair, stopLead))
      await this.change(next => { this.task(this.owned(next, actor, 'lead'), taskId, taskRevision).cleanup = 'done' }, true)
    } catch (error) {
      await this.change(next => { this.task(this.owned(next, actor, 'lead'), taskId, taskRevision).cleanup = 'failed' }, true)
      throw error
    }
  }
  async executionInterrupted(actor: FusionActor, reason: string, expected?: { taskId: string; revision: number }): Promise<void> {
    await this.ready
    await this.change(next => {
      const pair = this.owned(next, actor, 'sidekick'), task = currentTask(pair)
      if (task && (!expected || (task.id === expected.taskId && task.revision === expected.revision)) && ['dispatching', 'working'].includes(task.state)) {
        task.state = 'interrupted'; task.error = text(reason, 'interruption reason', 16_000); task.delivery = 'uncertain'; task.updatedAt = this.now()
      }
    })
  }
  /** Explicit recovery only: saved content is re-notified, never dispatched to the Writer. */
  async recover(actor: FusionActor, taskId: string, taskRevision: number, outerSignal: AbortSignal): Promise<FusionTask> {
    await this.ready
    outerSignal.throwIfAborted()
    const result = await this.change(next => {
      const pair = this.owned(next, actor, 'lead'), task = this.task(pair, taskId, integer(taskRevision, 'task revision'))
      requireFusion(['interrupted', 'review', 'decision'].includes(task.state), 'STALE', 'This task has no recoverable report.')
      const reportKey = task.reportIds.at(-1)
      requireFusion(reportKey?.startsWith(`${task.revision}:`), 'NO_REPORT', 'There is no saved report for this revision. Resume with feedback instead.')
      const candidate = task.candidates.at(-1)
      task.state = candidate?.taskRevision === task.revision ? 'review' : 'decision'
      requireFusion(task.state === 'review' || task.decision, 'NO_REPORT', 'No saved report is available.')
      task.updatedAt = this.now()
      return { pair, task, reportKey }
    })
    const controller = new AbortController(), controllers = this.notifications.get(taskId) ?? new Set<AbortController>()
    controllers.add(controller); this.notifications.set(taskId, controllers)
    const signal = AbortSignal.any([outerSignal, controller.signal, this.controller.signal])
    try {
      signal.throwIfAborted()
      const candidate = result.task.candidates.at(-1)
      const body = result.task.state === 'review'
        ? `Recovered saved candidate for ${taskId} revision ${taskRevision}: ${candidate!.id}, sha256 ${candidate!.hash}. Read with fusion_read, then fusion_review. This is a repeated notification, not a new Writer result.`
        : `Recovered saved decision for ${taskId} revision ${taskRevision}: ${result.task.decision}`
      await this.track(this.native.notify({ pair: result.pair, task: result.task, actor, text: body, signal }))
      await this.change(next => {
        const task = this.task(this.owned(next, actor, 'lead'), taskId, taskRevision)
        requireFusion(['review', 'decision'].includes(task.state), 'STALE', 'Recovery was cancelled.')
        task.notifiedReportId = result.reportKey
      })
      return this.read(actor, taskId).task
    } finally {
      controllers.delete(controller)
      if (!controllers.size) this.notifications.delete(taskId)
    }
  }
  private candidateAction(next: FusionState, actor: FusionActor, input: FusionCandidateAction) {
    requireFusion(input.sessionId === actor.sessionId, 'UNAUTHORIZED', 'Session identity mismatch.')
    const pair = this.owned(next, actor, 'lead'), task = this.task(pair, input.taskId, integer(input.taskRevision, 'task revision'))
    const candidate = task.candidates.at(-1)
    requireFusion(candidate?.id === input.candidateId && candidate.hash === input.hash && candidate.taskRevision === task.revision,
      'STALE', 'The exact current candidate is required.')
    const review = task.reviews.at(-1)
    requireFusion(review?.verdict === 'accept' && review.candidateId === candidate.id && review.candidateHash === candidate.hash, 'NOT_ACCEPTED', 'The exact candidate has not been accepted by the Lead.')
    requireFusion(pair.profile === 'writing' && task.target && task.state === 'accepted', 'NOT_ACCEPTED', 'The Lead must accept this writing candidate first.')
    return { pair, task, candidate, target: task.target }
  }
  /** Also used by status. An uncertain filesystem mutation is inspected, never replayed. */
  async reconcile(actor: FusionActor, host: FusionWritingHost, signal: AbortSignal): Promise<void> {
    await this.ready
    const pair = this.pairFor(actor.sessionId)
    if (!pair?.tasks.some(task => task.application?.state === 'pending')) return
    await this.change(async next => {
      const pair = this.owned(next, actor, 'lead')
      for (const task of pair.tasks) {
        const application = task.application
        if (application?.state !== 'pending') continue
        const candidate = task.candidates.find(row => row.id === application.candidateId)
        requireFusion(task.target && candidate, 'INVALID_STATE', 'Incomplete application intent.')
        await host.transact(actor, task.target, candidate, signal, async access => {
          const current = await access.inspect()
          if (current && contentHash(current.text) === application.afterHash) {
            application.state = 'applied'; application.version = text(current.version, 'application receipt version', 8192); task.adoption = 'applied'
          } else { application.state = 'conflict'; task.adoption = 'conflict' }
          task.updatedAt = this.now()
        })
      }
    })
  }
  async preview(actor: FusionActor, input: FusionCandidateAction, host: FusionWritingHost, signal: AbortSignal): Promise<FusionPreview> {
    await this.ready
    return this.change(async next => {
      const { task, candidate, target } = this.candidateAction(next, actor, input)
      requireFusion(!task.application || task.application.state === 'conflict', 'ALREADY_APPLIED', 'This application has already started or completed.')
      requireFusion(task.adoption !== 'dismissed' && task.adoption !== 'applied', 'STALE', 'This candidate is no longer awaiting adoption.')
      return host.transact(actor, target, candidate, signal, async access => ({ ...await access.prepare(), candidateId: candidate.id, hash: candidate.hash }))
    })
  }
  async applyCandidate(actor: FusionActor, input: FusionCandidateAction & { expectedVersion: string }, host: FusionWritingHost, outerSignal: AbortSignal): Promise<FusionTask> {
    await this.ready
    text(input.expectedVersion, 'expected version', 8192, true)
    const controller = new AbortController(), controllers = this.applications.get(input.taskId) ?? new Set<AbortController>()
    controllers.add(controller); this.applications.set(input.taskId, controllers)
    try { return await this.change(async next => {
      const { task, candidate, target } = this.candidateAction(next, actor, input)
      requireFusion(task.adoption !== 'dismissed', 'STALE', 'This candidate was dismissed.')
      requireFusion(!task.application || task.application.state === 'conflict', 'ALREADY_APPLIED', 'This application has already started or completed.')
      const signal = AbortSignal.any([outerSignal, controller.signal, this.controller.signal])
      return host.transact(actor, target, candidate, signal, async access => {
        const preview = await access.prepare()
        requireFusion(preview.version === input.expectedVersion, 'CONFLICT', 'The preview version changed. Preview the current file again.')
        signal.throwIfAborted()
        task.application = { id: this.id(), candidateId: candidate.id, candidateHash: candidate.hash, path: preview.path,
          beforeVersion: preview.version, afterHash: contentHash(preview.after), state: 'pending' }
        task.adoption = 'pending'; task.updatedAt = this.now()
        // Reserve the largest receipt (including JSON escaping) before any irreversible file write.
        requireFusion(JSON.stringify(next).length <= 16_000_000 - 65_536, 'CAPACITY', 'Fusion history has no room for the application receipt. The file was not changed.')
        // Persist the exact resulting file hash while holding both the mutation queue and Host lock.
        await this.persist(next)
        signal.throwIfAborted()
        try {
          const receipt = await access.commit(preview.version)
          requireFusion(receipt.path === preview.path, 'INVALID_RECEIPT', 'Host committed a different destination.')
          task.application.state = 'applied'; task.application.version = text(receipt.version, 'application receipt version', 8192); task.adoption = 'applied'
          task.updatedAt = this.now()
          // A winning disable/cancel cannot erase a completed filesystem receipt.
          return task
        } catch (error) {
          // Keep the durable pending intent for a later, lock-protected inspection.
          throw error
        }
      })
    }) } catch (error) {
      if (this.active) await this.change(next => {
        const pair = next.pairs.find(row => row.leadSessionId === actor.sessionId && row.project === actor.project)
        const task = pair?.tasks.at(-1), candidate = task?.candidates.at(-1)
        if (task?.id === input.taskId && task.revision === input.taskRevision && candidate?.id === input.candidateId && candidate.hash === input.hash && task.state === 'accepted' && task.adoption !== 'applied' && task.adoption !== 'dismissed') {
          if (!task.application || task.application.state === 'conflict') task.adoption = 'conflict'
          task.error = (error instanceof Error ? error.message : String(error)).slice(0, 16_000)
        }
      }).catch(() => {})
      throw error
    } finally {
      controllers.delete(controller)
      if (!controllers.size) this.applications.delete(input.taskId)
    }
  }
  async dismiss(actor: FusionActor, input: FusionCandidateAction): Promise<FusionTask> {
    await this.ready
    return this.change(next => {
      const { task } = this.candidateAction(next, actor, input)
      requireFusion(task.application?.state !== 'pending' && task.adoption !== 'applied', 'ALREADY_APPLIED', 'Inspect the application before dismissing it.')
      task.adoption = 'dismissed'; task.updatedAt = this.now()
      return task
    })
  }
  /** Domain Host only: never expose an RPC that lets a browser claim a file was applied. */
  async adoption(leadSessionId: string, taskId: string, candidateId: string, state: 'applied' | 'dismissed' | 'conflict'): Promise<void> {
    await this.ready
    await this.change(next => {
      const pair = next.pairs.find(row => row.leadSessionId === leadSessionId), task = pair?.tasks.find(row => row.id === taskId)
      requireFusion(task && task.state === 'accepted' && task.candidates.at(-1)?.id === candidateId, 'STALE', 'No accepted candidate matches the Host receipt.')
      requireFusion(task.adoption !== 'applied' || state === 'applied', 'ALREADY_APPLIED', 'An applied receipt cannot be overwritten.')
      task.adoption = state; task.updatedAt = this.now()
    }, true)
  }
  /** Stops owned work only. Invalidate synchronously, then await admissions and cleanup. */
  async dispose(): Promise<void> {
    if (!this.enabled) return
    this.enabled = false; this.generation++; this.controller.abort()
    for (const controllers of this.dispatches.values()) for (const controller of controllers) controller.abort()
    for (const taskId of this.notifications.keys()) this.abortNotifications(taskId)
    const errors: unknown[] = []
    try {
      await this.ready
      await this.change(next => {
        for (const pair of next.pairs) for (const task of pair.tasks) if (isWorking(task.state)) {
          task.state = 'cancelled'; task.cleanup = 'pending'; task.updatedAt = this.now()
        }
      }, true)
    } catch (error) { errors.push(error) }
    await Promise.allSettled([...this.inFlight])
    const results = await Promise.allSettled(this.state.pairs.map(pair => this.native.stop(clone(pair), false)))
    try {
      await this.change(next => {
        next.pairs.forEach((pair, index) => { for (const task of pair.tasks) if (task.cleanup === 'pending') task.cleanup = results[index].status === 'fulfilled' ? 'done' : 'failed' })
      }, true)
    } catch (error) { errors.push(error) }
    for (const result of results) if (result.status === 'rejected') errors.push(result.reason)
    if (errors.length) throw new AggregateError(errors, 'Fusion teardown did not complete cleanly.')
  }
}
