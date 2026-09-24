/** Public, browser-safe Fusion records. Native Sessions remain the transcript authority. */
export const FUSION_PLUGIN = '@klarkxy/dsh-fusion'
export const FUSION_RPC_CHANNEL = '/dsh-fusion'
export const FUSION_PURPOSE = 'fusion.sidekick'
export const FUSION_TOOLS = ['fusion_delegate', 'fusion_report', 'fusion_review', 'fusion_read', 'fusion_decide', 'fusion_cancel'] as const
export type FusionProfile = 'generic' | 'writing'
export type TaskState = 'dispatching' | 'working' | 'decision' | 'review' | 'accepted' | 'cancelled' | 'failed' | 'interrupted'
export type ModelRoute = { provider: string; model: string; reasoningEffort?: string }
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface FusionActor { sessionId: string; parentSessionId?: string; project: string }
export interface FusionBrief {
  title: string
  goal: string
  context: string
  constraints: string[]
  acceptance: string[]
}
/** A domain-owned, versioned destination. The Writer cannot replace this target. */
export interface FusionTarget { domain: string; data: { [key: string]: Json } }
export interface FusionCandidate {
  id: string
  taskRevision: number
  revision: number
  text: string
  hash: string
  report: string
  createdAt: number
}
export interface FusionReview {
  candidateId: string
  candidateHash: string
  verdict: 'accept' | 'revise' | 'reject'
  feedback: string
  createdAt: number
}
export interface FusionTask {
  id: string
  revision: number
  state: TaskState
  brief: FusionBrief
  target?: FusionTarget
  candidates: FusionCandidate[]
  reviews: FusionReview[]
  messageIds: string[]
  dispatchId: string
  reportIds: string[]
  /** Last report whose native Lead notification was confirmed and durably recorded. */
  notifiedReportId?: string
  /** Whether the latest native inbox submission is known to have been accepted. */
  delivery: 'pending' | 'accepted' | 'uncertain'
  decision?: string
  error?: string
  cleanup?: 'pending' | 'done' | 'failed'
  adoption?: 'pending' | 'applied' | 'dismissed' | 'conflict'
  /** Persist before filesystem mutation; never replay an uncertain write. */
  application?: {
    id: string; candidateId: string; candidateHash: string; path: string
    beforeVersion: string; afterHash: string; state: 'pending' | 'applied' | 'conflict'; version?: string
  }
  createdAt: number
  updatedAt: number
}
export interface FusionPair {
  id: string
  leadSessionId: string
  childSessionId: string
  project: string
  profile: FusionProfile
  route: ModelRoute
  /** A successful initial inbox admission, not a claim about provider prompt caching. */
  established: boolean
  tasks: FusionTask[]
  createdAt: number
}
export interface FusionState { version: 1; revision: number; pairs: FusionPair[] }
export interface FusionStore { load(): FusionState; save(next: FusionState): Promise<void> }
/** This port adapts native subagents. It must not own another Agent loop or inbox. */
export interface FusionNative {
  dispatch(input: { pair: FusionPair; task: FusionTask; prompt: string; signal: AbortSignal }): Promise<{ messageId: string }>
  notify(input: { pair: FusionPair; task: FusionTask; actor: FusionActor; text: string; signal: AbortSignal }): Promise<void>
  stop(pair: FusionPair, stopLead: boolean): Promise<void>
}
export interface FusionStatus {
  available: boolean
  profile: FusionProfile
  configured: boolean
  revision?: number
  error?: string
  pair?: FusionPair
  /** Cumulative native-session figures, not an estimate of this task's cost. */
  usage?: { leadTokens: number | null; sidekickTokens: number | null; cost: null }
  activity?: { lead: string; sidekick: string }
}
export type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export const isWorking = (state: TaskState): boolean => ['dispatching', 'working', 'decision', 'review'].includes(state)
export const emptyFusionState = (): FusionState => ({ version: 1, revision: 0, pairs: [] })

/** Browser commands identify stored authority; no command accepts replacement candidate text. */
export interface FusionCandidateAction {
  sessionId: string; taskId: string; taskRevision: number; candidateId: string; hash: string
}
export interface FusionPreview {
  path: string; before: string; after: string; version: string
  candidateId: string; hash: string
}
