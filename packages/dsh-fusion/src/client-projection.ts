import type { FusionCandidate, FusionPair, FusionPreview, FusionTask } from './contracts.ts'

/** The last task is the only one the Lead may still act on. Older tasks remain in native history. */
export function currentTask(pair: FusionPair | undefined): FusionTask | undefined {
  return pair?.tasks.at(-1)
}

/** An accepted review identifies an exact Writer revision; the newest draft alone grants no adoption. */
export function acceptedCandidate(task: FusionTask): FusionCandidate | undefined {
  if (task.state !== 'accepted') return undefined
  const review = task.reviews.at(-1)
  if (review?.verdict !== 'accept') return undefined
  return task.candidates.find(candidate => candidate.id === review.candidateId
    && candidate.hash === review.candidateHash && candidate.taskRevision === task.revision)
}

export function canAdopt(pair: FusionPair, task: FusionTask): boolean {
  const candidate = acceptedCandidate(task)
  return pair.profile === 'writing' && Boolean(task.target && candidate
    && task.candidates.at(-1)?.id === candidate.id
    && task.adoption !== 'applied' && task.adoption !== 'dismissed'
    && task.application?.state !== 'pending')
}

export interface TurnEvent { time: number; data?: { turn?: number } }
export interface TurnEntry { event: TurnEvent }

/** Anchor a durable task near its latest Lead turn instead of repeating it after every turn. */
export function taskAnchorTurn(task: FusionTask, entries: readonly TurnEntry[]): number | undefined {
  let eligible: number | undefined
  let latest: number | undefined
  for (const { event } of entries) {
    const turn = event.data?.turn
    if (!Number.isSafeInteger(turn) || (turn ?? 0) < 0) continue
    latest = turn
    if (event.time <= task.updatedAt) eligible = turn
  }
  return eligible ?? latest
}

export function needsRefresh(task: FusionTask | undefined): boolean {
  return Boolean(task && (['dispatching', 'working', 'decision', 'review'].includes(task.state)
    || task.cleanup === 'pending'))
}

/** Capture every authority field that can invalidate an in-flight author action. */
export function actionIdentity(sessionId: string, task: FusionTask, candidate?: FusionCandidate): string {
  return [sessionId, task.id, task.revision, candidate?.id ?? '', candidate?.hash ?? ''].join('\u0000')
}

export function isCurrentAction(mounted: boolean, captured: string, current: string): boolean {
  return mounted && captured === current
}
export interface AppliedReceipt { id: string; path: string }

/** Only a Host receipt for the exact preview may request an Editor view refresh. */
export function appliedReceipt(value: unknown, task: FusionTask, candidate: FusionCandidate, preview: FusionPreview): AppliedReceipt | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Partial<FusionTask>
  const application = row.application
  if (row.id !== task.id || row.revision !== task.revision || row.adoption !== 'applied'
    || application?.state !== 'applied' || typeof application.id !== 'string' || !application.id
    || application.candidateId !== candidate.id || application.candidateHash !== candidate.hash
    || application.path !== preview.path || application.beforeVersion !== preview.version
    || preview.candidateId !== candidate.id || preview.hash !== candidate.hash) return undefined
  return { id: application.id, path: application.path }
}

/** A late response has no authority over the newly selected Session's view. */
export function notifyAppliedReceipt(input: {
  value: unknown; task: FusionTask; candidate: FusionCandidate; preview: FusionPreview
  isCurrent(): boolean; notify(receipt: AppliedReceipt): void
}): boolean {
  if (!input.isCurrent()) return false
  const receipt = appliedReceipt(input.value, input.task, input.candidate, input.preview)
  if (!receipt) return false
  input.notify(receipt)
  return true
}
export interface ObservedPendingApplication {
  sessionId: string; taskId: string; id: string; path: string; candidateId: string; candidateHash: string
}

/** Cold-start applied history cannot navigate the author; only a seen pending intent may refresh. */
export function reconciledReceipt(observed: ObservedPendingApplication | undefined, sessionId: string, task: FusionTask | undefined): AppliedReceipt | undefined {
  const application = task?.application
  if (!observed || !task || task.adoption !== 'applied' || application?.state !== 'applied') return undefined
  if (observed.sessionId !== sessionId || observed.taskId !== task.id || observed.id !== application.id
    || observed.path !== application.path || observed.candidateId !== application.candidateId
    || observed.candidateHash !== application.candidateHash) return undefined
  return { id: application.id, path: application.path }
}
/** Native Agent.status has only idle/running on the pinned runtime; retain future values verbatim. */
export function activityLabel(value: string, locale: 'zh' | 'en'): string {
  if (locale === 'en') return value
  if (value === 'idle') return '待命'
  if (value === 'running') return '运行中'
  return value
}