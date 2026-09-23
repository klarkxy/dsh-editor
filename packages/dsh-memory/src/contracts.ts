/** Browser-safe contracts. MemoryRecord / MemoryService match frozen @klarkxy/dsh-ai-services. */
import {
  CHAT_EVENTS_SLOT as FROZEN_CHAT_EVENTS_SLOT,
  projectIdFromCwd as frozenProjectIdFromCwd,
} from '@klarkxy/dsh-ai-services/contracts'
import type {
  AiFeatureScope,
  AiServices,
  AuxiliaryRequest,
  AuxiliaryResult,
  EvidenceRef,
  KnowledgeKind,
  KnowledgeScope,
  MemoryQuery,
  MemoryRecord,
  MemoryService,
  NewMemoryRecord,
  PurposeSpec,
  ProducerMessageSource,
  RpcResult,
  UsageReceipt,
} from '@klarkxy/dsh-ai-services/contracts'

export type {
  AiFeatureScope,
  AiServices,
  AuxiliaryRequest,
  AuxiliaryResult,
  EvidenceRef,
  KnowledgeKind,
  KnowledgeScope,
  MemoryQuery,
  MemoryRecord,
  MemoryService,
  NewMemoryRecord,
  PurposeSpec,
  ProducerMessageSource,
  RpcResult,
  UsageReceipt,
}

/** Frozen shared chat-events seat. Must stay equal to @klarkxy/dsh-ai-services CHAT_EVENTS_SLOT. */
export const CHAT_EVENTS_SLOT = FROZEN_CHAT_EVENTS_SLOT
/** Shared untruncated cwd identity. Drive roots (`/` / `C:/`) stay intact. */
export const projectIdFromCwd = frozenProjectIdFromCwd
export const MEMORY_PLUGIN = '@klarkxy/dsh-memory'
export const MEMORY_SOURCE_KIND = 'plugin:@klarkxy/dsh-memory' as const
export const MEMORY_RPC_CHANNEL = '/dsh-memory'
export const MEMORY_DREAM_PURPOSE = 'memory.dream'
export const MEMORY_INJECTION_SECTION = 'dsh-memory:recall'
/** Frozen pluginName now accepts scoped ids. */
export const MEMORY_ACTIVATE_ID = MEMORY_PLUGIN

export const DEFAULT_IDLE_MS = 15 * 60 * 1000
export const MIN_IDLE_MS = 60_000
export const MAX_IDLE_MS = 180 * 60_000
export const MIN_RECALL_RECORDS = 1
export const MAX_RECALL_RECORDS = 5
export const MAX_RECALL_TOKENS = 800
export const MAX_PROJECT_ID_CHARS = 32_768
export const INJECT_KINDS: readonly KnowledgeKind[] = ['preference', 'project-fact', 'decision']
export const RECALL_EXCLUDED_STATUSES: readonly MemoryRecord['status'][] = [
  'candidate', 'rejected', 'revoked', 'deleted', 'superseded',
]

export interface MemorySettings {
  revision: number
  injectEnabled: boolean
  dreamIdleEnabled: boolean
  idleMs: number
}

export const defaultSettings = (): MemorySettings => ({
  revision: 0,
  injectEnabled: true,
  dreamIdleEnabled: false,
  idleMs: DEFAULT_IDLE_MS,
})

export type DreamPlanStatus = 'preview' | 'applied' | 'cancelled' | 'stale' | 'failed'

export interface DreamSnapshotEntry {
  id: string
  revision: number
  status: MemoryRecord['status']
  scope: KnowledgeScope
  expiresAt?: number
}

export interface DreamProposal {
  title: string
  content: string
  kind: Exclude<KnowledgeKind, 'lesson'>
  tags: string[]
  exceptions: string[]
  evidence: EvidenceRef[]
  sourceIds: string[]
  scope: KnowledgeScope
}

export interface DreamPlan {
  id: string
  revision: number
  sessionId: string
  projectId?: string
  status: DreamPlanStatus
  sourceVersion: string
  snapshot: DreamSnapshotEntry[]
  proposals: DreamProposal[]
  generation: number
  createdAt: number
  updatedAt: number
  error?: string
}

export interface MemoryTombstone {
  id: string
  deletedAt: number
  lastRevision: number
}

export interface MemoryPersistedState {
  settings: MemorySettings
  records: MemoryRecord[]
  tombstones: MemoryTombstone[]
  dreams: DreamPlan[]
}

export interface MemoryStatus {
  runningDreams?: string[]
  settings: MemorySettings
  records: MemoryRecord[]
  dreams: DreamPlan[]
  projectId?: string
  storageFailed: boolean
  aiAvailable: boolean
}

/** Matches frozen MemoryService optional mutation identity/lifetime guards. */
export interface MemoryMutationOptions { signal?: AbortSignal; isCurrent?: () => boolean }

export interface PreStepEnter {
  kind: 'enter'
  messages: unknown[]
  startsRequestSeries?: true
}
export type PreStepDecision = { kind: 'reject' } | PreStepEnter

export interface InjectedMemoryMessage {
  content: Array<{ type: 'text'; text: string }>
  source: ProducerMessageSource & {
    kind: typeof MEMORY_SOURCE_KIND
    plugin: typeof MEMORY_PLUGIN
    form: 'snapshot'
    sections: Array<{ name: string; text: string }>
  }
}

export function fail<T = never>(code: string, message: string): RpcResult<T> {
  return { ok: false, error: { code, message } }
}

export function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

export function parseSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const sessionId = (payload as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 200 ? sessionId : undefined
}

export function sessionCwd(session: unknown): string | undefined {
  if (!session || typeof session !== 'object') return undefined
  const row = session as { meta?: { cwd?: unknown }; header?: { cwd?: unknown } }
  const cwd = row.meta?.cwd ?? row.header?.cwd
  return typeof cwd === 'string' ? cwd : undefined
}

export function scopesEqual(left: KnowledgeScope, right: KnowledgeScope): boolean {
  if (left.kind === 'global') return right.kind === 'global'
  return right.kind === 'project' && left.projectId === right.projectId
}

export function scopeKey(scope: KnowledgeScope): string {
  return scope.kind === 'global' ? 'global' : `project:${scope.projectId}`
}

export function cloneRecord(record: MemoryRecord): MemoryRecord {
  return structuredClone(record)
}
