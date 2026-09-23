/** Browser-safe Mood contracts. Shared TaskContract fields match frozen @klarkxy/dsh-ai-services. */
import type { AiFeatureScope, EvidenceRef, ProducerMessageSource, RpcResult, TaskContract } from '@klarkxy/dsh-ai-services/contracts'

export type { AiFeatureScope, EvidenceRef, ProducerMessageSource, RpcResult, TaskContract }
export { projectIdFromCwd } from '@klarkxy/dsh-ai-services/contracts'

/** Frozen shared chat-events seat. Must stay equal to @klarkxy/dsh-ai-services CHAT_EVENTS_SLOT. */
export const CHAT_EVENTS_SLOT = 'dsh-editor.chat.events'
export const MOOD_PLUGIN = '@klarkxy/dsh-mood'
export const MOOD_SOURCE_KIND = 'plugin:@klarkxy/dsh-mood' as const
/** Production activate identity after scoped pluginName support. */
export const MOOD_AI_PLUGIN = MOOD_PLUGIN
export const MOOD_RPC_CHANNEL = '/dsh-mood'
export const MOOD_ANALYZE_PURPOSE = 'mood.analyze'
export const CONTRACT_SECTION = 'dsh-mood:contract'
export const PROMPT_VERSION = 'mood.analyze.v1'
export const SCHEMA_VERSION = 'mood-contract.v1'
export const MAX_QUESTIONS = 3
export const MAX_EXCERPT_CHARS = 200
export const MAX_PROJECT_ID_CHARS = 32_768
export const DEFAULT_QUESTION = '这次要改哪些内容，做到什么程度算完成？'

export type MoodMode = 'auto' | 'manual' | 'strict'
export type ClarificationStatus = 'pending' | 'answered' | 'skipped' | 'cancelled' | 'stale'
export type MoodLocale = 'zh' | 'en'

export interface MoodSettings {
  revision: number
  mode: MoodMode
}

export const defaultSettings = (): MoodSettings => ({ revision: 0, mode: 'auto' })

export interface ClarificationItem {
  id: string
  question: string
  status: ClarificationStatus
  answer?: string
}

export interface HeldRequest {
  sourceVersion: string
  trigger: 'material' | 'risk' | 'mild' | 'clear'
  messages: unknown[]
}

export interface MoodSessionView {
  sessionId: string
  projectId?: string
  contract?: TaskContract
  clarification: ClarificationItem[]
  pendingManual: boolean
  held: boolean
}

export interface MoodStatus {
  settings: MoodSettings
  storageFailed: boolean
  session?: MoodSessionView
}

/** Native `@deepseek-ai/dsh-user-questions` AskUserQuestionItem. */
export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
}

export interface AskUserQuestionAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

export interface AskUserQuestionAnswer {
  answers: AskUserQuestionAnswerItem[]
}

export interface AskUserRequest {
  questions: AskUserQuestionItem[]
  agent?: unknown
  signal?: AbortSignal
}

export function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

export function fail(code: string, message: string): RpcResult<never> {
  return { ok: false, error: { code, message } }
}

export function isMoodMode(value: unknown): value is MoodMode {
  return value === 'auto' || value === 'manual' || value === 'strict'
}

export function parseSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const sessionId = (payload as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 200 ? sessionId : undefined
}

export function excerptOf(text: string, limit = MAX_EXCERPT_CHARS): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`
}

export function sessionIdOf(agent: { id?: unknown; session?: { id?: unknown } } | undefined): string {
  const fromSession = agent?.session?.id
  if (fromSession != null && String(fromSession).length > 0) return String(fromSession)
  if (agent?.id != null && String(agent.id).length > 0) return String(agent.id)
  return ''
}

export function cloneContract(contract: TaskContract): TaskContract {
  return structuredClone(contract)
}

export function readinessLabel(readiness: TaskContract['readiness']): string {
  if (readiness === 'clear-request') return '表述清楚'
  if (readiness === 'user-confirmed') return '作者已确认'
  if (readiness === 'disclosed-assumptions') return '按已披露假定继续'
  if (readiness === 'cancelled') return '已取消，未确认'
  if (readiness === 'stale') return '已过期'
  return '待确认'
}
