import type { ContextFormed } from '@deepseek-ai/dsh-llm'

/** Public, browser-safe contracts. Host implementations stay in their owning packages. */
export type ProducerSourceKind = `plugin:${string}`
export type ProducerMessageSource = { kind: ProducerSourceKind; plugin: string } & ContextFormed

/**
 * V4 sessions persist the producing extension in `kind`; the retired generic
 * `plugin` wrapper is not admitted. The AI service is the shared producer for
 * feature scopes, so its map must cover every registered feature id.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    [kind: ProducerSourceKind]: ProducerMessageSource
  }
}

export function producerMessageSource(plugin: string): ProducerMessageSource {
  return { kind: `plugin:${plugin}`, plugin }
}
export type ModelRole = 'normal' | 'weak' | 'strong' | 'fantasy'
export interface ModelRoute { provider: string; model: string; reasoningEffort?: string }
export type ModelTarget = { kind: 'role'; role: ModelRole } | { kind: 'session' } | ({ kind: 'model' } & ModelRoute)
export interface AiPolicy {
  revision: number
  roles: Partial<Record<ModelRole, ModelRoute>>
  purposes: Record<string, ModelTarget>
  limits: { concurrency: number; timeoutMs: number; maxInputChars: number; maxOutputTokens: number; maxAttempts: number }
}
export interface PurposeSpec {
  id: string
  label: string
  defaultTarget: ModelTarget
  maxOutputTokens?: number
  maxInputChars?: number
  timeoutMs?: number
}
export interface ResolvedRoute extends ModelRoute {
  source: 'override' | 'purpose' | 'default'
  target: ModelTarget
  policyRevision: number
  inheritedRole?: ModelRole
}
export interface AuxiliaryRequest {
  purpose: string
  sessionId?: string
  input: string
  system: string
  sourceVersion: string
  contractVersion?: number
  promptVersion?: string
  schemaVersion?: string
  override?: ModelTarget
  signal?: AbortSignal
  /** Rechecked after every await and before returning a publishable result. */
  isCurrent?: () => boolean
  priority?: 'interactive' | 'background'
  /** Plain writing candidates can stop once this many visible characters are available. */
  insert?: { maxChars: number }
}
export interface UsageReceipt {
  id: string
  plugin: string
  purpose: string
  sessionId?: string
  sourceVersion: string
  contractVersion?: number
  promptVersion?: string
  schemaVersion?: string
  route?: ResolvedRoute
  status: 'success' | 'failed' | 'cancelled' | 'superseded' | 'skipped'
  attempts: number
  inputTokens?: number
  outputTokens?: number
  cost: number | null
  startedAt: number
  finishedAt: number
  error?: string
}
export interface AuxiliaryResult { text: string; receipt: UsageReceipt }
export interface AiFeatureScope {
  readonly plugin: string
  readonly signal: AbortSignal
  readonly active: boolean
  registerPurpose(spec: PurposeSpec): () => void
  run(request: AuxiliaryRequest): Promise<AuxiliaryResult>
  dispose(): void
}
export interface AiServices {
  activate(plugin: string): AiFeatureScope
  /** Atomically import missing purpose defaults once; host-only compatibility entrypoint. */
  importPurposes(migrationId: string, defaults: Record<string, ModelTarget>, roles?: AiPolicy['roles']): Promise<AiPolicy>
  getPolicy(): AiPolicy
  updatePolicy(policy: Omit<AiPolicy, 'revision'>, expectedRevision: number): Promise<AiPolicy>
  resolve(purpose: string, sessionId?: string, override?: ModelTarget): Promise<ResolvedRoute>
  purposes(): Array<PurposeSpec & { plugin: string }>
  usage(): UsageReceipt[]
}
export type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export const AI_RPC_CHANNEL = '/dsh-ai-services'
export const CHAT_EVENTS_SLOT = 'dsh-editor.chat.events'
export const MODEL_SETTINGS_SLOT = 'dsh-editor.settings.models'
export interface EvidenceRef { sessionId: string; seq: number; kind: 'user' | 'tool' | 'turn' | 'manual'; excerpt?: string }
export interface TaskContract {
  id: string
  sessionId: string
  sourceVersion: string
  revision: number
  goal: string
  deliverables: string[]
  inScope: string[]
  outOfScope: string[]
  constraints: string[]
  acceptance: string[]
  assumptions: string[]
  questions: string[]
  evidence: EvidenceRef[]
  readiness: 'pending' | 'clear-request' | 'user-confirmed' | 'disclosed-assumptions' | 'cancelled' | 'stale'
  updatedAt: number
}
export interface TaskCheckpoint {
  id: string
  sessionId: string
  sourceVersion: string
  contractVersion?: number
  fromSeq: number
  toSeq: number
  revision: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  items: Array<{ label: string; state: 'pending' | 'verified' | 'failed'; evidence: EvidenceRef[] }>
  constraints: string[]
  nextAction: string
  createdAt: number
}
export type KnowledgeScope = { kind: 'global' } | { kind: 'project'; projectId: string }
export type KnowledgeKind = 'preference' | 'project-fact' | 'decision' | 'vocabulary' | 'activity' | 'lesson'
/** Descriptive context, never an executable instruction or authorization. */
export interface ContextKnowledge {
  subject: string
  domain: string
  key: string
  aliases: string[]
  observedAt: number
  /** The user's own time expression, not an inferred completion date. */
  eventTime?: string
  activityStatus?: 'planned' | 'in-progress' | 'blocked' | 'paused' | 'completed' | 'cancelled' | 'unknown'
}
/** A scoped method. Observations remain candidates until explicitly accepted. */
export interface ProcedureKnowledge {
  origin: 'instruction' | 'observation'
  goal: string
  when: string[]
  steps: string[]
  avoid: string[]
  verify: string[]
}
export interface MemoryRecord {
  id: string
  revision: number
  scope: KnowledgeScope
  kind: KnowledgeKind
  status: 'candidate' | 'active' | 'rejected' | 'superseded' | 'revoked' | 'deleted'
  title: string
  content: string
  tags: string[]
  evidence: EvidenceRef[]
  exceptions: string[]
  source: 'user' | 'memory' | 'dream' | 'self-improvement'
  context?: ContextKnowledge
  procedure?: ProcedureKnowledge
  createdAt: number
  updatedAt: number
  expiresAt?: number
  supersedes?: string[]
  /** Exact record revisions behind a derived candidate; revalidated on adoption. */
  basis?: Array<{ id: string; revision: number }>
}
export type NewMemoryRecord = Omit<MemoryRecord, 'id' | 'revision' | 'createdAt' | 'updatedAt'>
export interface MemoryQuery { scope: KnowledgeScope; query?: string; kinds?: KnowledgeKind[]; statuses?: MemoryRecord['status'][]; limit?: number }
export interface MemoryMutationOptions { signal?: AbortSignal; isCurrent?: () => boolean }
export interface MemoryService {
  list(query: MemoryQuery): Promise<MemoryRecord[]>
  create(record: NewMemoryRecord, options?: MemoryMutationOptions): Promise<MemoryRecord>
  update(id: string, patch: Partial<Pick<MemoryRecord, 'title' | 'content' | 'tags' | 'exceptions' | 'status' | 'expiresAt'>>, expectedRevision: number, options?: MemoryMutationOptions): Promise<MemoryRecord>
  /** Explicit user promotion, persisted atomically on the same record; preserves expiry and evidence. */
  promoteToGlobal(id: string, expectedRevision: number, options?: MemoryMutationOptions): Promise<MemoryRecord>
  remove(id: string, expectedRevision: number, options?: MemoryMutationOptions): Promise<void>
  recall(query: MemoryQuery): Promise<MemoryRecord[]>
}

/** Project keys come only from the host-validated session directory, never client input. */
export function projectIdFromCwd(cwd: string | undefined): string | undefined {
  if (typeof cwd !== 'string') return undefined
  const normalized = cwd.trim().replaceAll('\\', '/')
  if (!normalized) return undefined
  return normalized === '/' || /^[A-Za-z]:\/$/.test(normalized) ? normalized : normalized.replace(/\/+$/, '')
}
