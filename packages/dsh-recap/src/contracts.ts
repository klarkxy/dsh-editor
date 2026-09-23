/** Recap-owned records. Shared TaskCheckpoint / RPC / slot names come from @klarkxy/dsh-ai-services/contracts. */
import type {
  AiFeatureScope,
  AiServices,
  AuxiliaryRequest,
  AuxiliaryResult,
  EvidenceRef,
  PurposeSpec,
  ProducerMessageSource,
  RpcResult,
  TaskCheckpoint,
  TaskContract,
  UsageReceipt,
} from '@klarkxy/dsh-ai-services/contracts'

export type {
  AiFeatureScope,
  AiServices,
  AuxiliaryRequest,
  AuxiliaryResult,
  EvidenceRef,
  PurposeSpec,
  ProducerMessageSource,
  RpcResult,
  TaskCheckpoint,
  TaskContract,
  UsageReceipt,
}

export { CHAT_EVENTS_SLOT } from '@klarkxy/dsh-ai-services/contracts'

/** DSH message source identity and aiServices.activate() plugin id. */
export const RECAP_PLUGIN = '@klarkxy/dsh-recap'
export const RECAP_SOURCE_KIND = 'plugin:@klarkxy/dsh-recap' as const
export const RECAP_RPC_CHANNEL = '/dsh-recap'
export const RECAP_DISPLAY_PURPOSE = 'recap.display'
export const RECAP_CHECKPOINT_PURPOSE = 'recap.checkpoint'
export const DEFAULT_IDLE_RETURN_MS = 15 * 60 * 1000
export const MAX_LOG_EVENTS = 256
export const MAX_EXCERPT_CHARS = 200
export const MAX_CARD_BODY_CHARS = 4000
export const MAX_CHECKPOINT_CHARS = 2000
export const LONG_TASK_MIN_MS = 60_000
export const LONG_TASK_MIN_STEPS = 2
export const LONG_TASK_MIN_TOOLS = 3
export const MEANINGFUL_TOOL_DELTA = 3

export type RecapSourceStatus = 'completed' | 'failed' | 'cancelled' | 'running'
export type RecapTrigger = 'turn-end' | 'idle-return' | 'retry' | 'manual'
export type RecapCardKind = 'deterministic' | 'generated' | 'cached'
export type RecapGeneration = 'idle' | 'running' | 'failed' | 'cancelled' | 'superseded'

export interface RecapSettings {
  revision: number
  cardsEnabled: boolean
  checkpointsEnabled: boolean
  semanticCheckpointsEnabled: boolean
  idleReturnMs: number
}

export const defaultSettings = (): RecapSettings => ({
  revision: 0,
  cardsEnabled: true,
  checkpointsEnabled: true,
  semanticCheckpointsEnabled: true,
  idleReturnMs: DEFAULT_IDLE_RETURN_MS,
})

export interface RecapCard {
  id: string
  sessionId: string
  sourceVersion: string
  fromSeq: number
  toSeq: number
  trigger: RecapTrigger
  sourceStatus: Exclude<RecapSourceStatus, 'running'>
  title: string
  body: string
  kind: RecapCardKind
  generation: RecapGeneration
  receiptId?: string
  createdAt: number
  updatedAt: number
}

export interface RecapPersistedState {
  settings: RecapSettings
  cards: RecapCard[]
  checkpoints: TaskCheckpoint[]
}

export interface RecapStore {
  load(): RecapPersistedState
  save(state: RecapPersistedState): Promise<void>
}

export interface RecapStatus {
  settings: RecapSettings
  cards: RecapCard[]
  checkpoints: TaskCheckpoint[]
  storageFailed: boolean
}

export interface RecapLogEvent {
  seq: number
  type: string
  time: number
  data: unknown
}

export interface RecapToolFact {
  name: string
  callId?: string
  proposedChange: boolean
  error?: boolean
  seq: number
  outcome: 'verified' | 'failed' | 'unverified' | 'missing' | 'cancelled' | 'unknown'
}

export interface RecapFacts {
  sessionId: string
  fromSeq: number
  toSeq: number
  sourceVersion: string
  sourceStatus: RecapSourceStatus
  turn?: number
  stepCount: number
  userTurns: number
  toolCalls: number
  toolResults: number
  proposals: number
  durationMs: number
  lastUserExcerpt?: string
  tools: RecapToolFact[]
  constraints: string[]
}

export type MoodContractApi = {
  getContract?(sessionId: string): TaskContract | undefined
}

export function fail<T = never>(code: string, message: string): RpcResult<T> {
  return { ok: false, error: { code, message } }
}

export function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

export function recapSourceVersion(sessionId: string, toSeq: number): string {
  return `${sessionId}#${toSeq}`
}

export function parseSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const sessionId = (payload as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 200 ? sessionId : undefined
}
