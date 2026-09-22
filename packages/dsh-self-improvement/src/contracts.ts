/** Own records plus reexported frozen AI/Memory interfaces. */
import {
  CHAT_EVENTS_SLOT as FROZEN_CHAT_EVENTS_SLOT,
  projectIdFromCwd as sharedProjectIdFromCwd,
} from '@klarkxy/dsh-ai-services/contracts'
import type {
  AiFeatureScope,
  AiServices,
  AuxiliaryRequest,
  AuxiliaryResult,
  EvidenceRef,
  KnowledgeKind,
  KnowledgeScope,
  MemoryMutationOptions,
  MemoryQuery,
  MemoryRecord,
  MemoryService,
  NewMemoryRecord,
  PurposeSpec,
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
  MemoryMutationOptions,
  MemoryQuery,
  MemoryRecord,
  MemoryService,
  NewMemoryRecord,
  PurposeSpec,
  RpcResult,
  UsageReceipt,
}

export const CHAT_EVENTS_SLOT = FROZEN_CHAT_EVENTS_SLOT
export const projectIdFromCwd = sharedProjectIdFromCwd
export const SELF_IMPROVEMENT_RPC_CHANNEL = '/dsh-self-improvement'
export const SELF_IMPROVEMENT_PLUGIN = '@klarkxy/dsh-self-improvement'
/** Production activate identity. Core owns the scoped pluginName regex. */
export const SELF_IMPROVEMENT_ACTIVATE_ID = SELF_IMPROVEMENT_PLUGIN
export const EXTRACT_PURPOSE = 'self-improvement.extract'
export const LESSON_INJECTION_SECTION = 'dsh-self-improvement:lessons'
export const LESSON_SCHEMA_TAG = 'lesson-schema:1'
export const LESSON_SCHEMA_VERSION = 1
export const MAX_INJECTED_LESSONS = 5
export const MAX_INJECTION_TOKENS = 800
export const MAX_PROJECT_ID_CHARS = 32_768
export const MAX_RECALL_QUERY_CHARS = 200

export type SkillStatus = 'preview' | 'accepted' | 'rejected' | 'revoked'
export type SkillExportState = 'none' | 'recorded' | 'revoked'
export interface SkillAuditEntry { at: number; action: string; detail?: string }
export interface SkillSourceRef {
  id: string
  revision: number
  status: MemoryRecord['status']
  scope: KnowledgeScope
  expiresAt?: number
}
export interface SkillRecord {
  id: string
  revision: number
  status: SkillStatus
  lessonIds: string[]
  sources: SkillSourceRef[]
  title: string
  markdown: string
  createdAt: number
  updatedAt: number
  exportState: SkillExportState
  exportedAt?: number
  exportRevokedAt?: number
  exportFilename?: string
  audit: SkillAuditEntry[]
}
export interface SessionWatermark {
  sessionId: string
  seq: number
  projectId?: string
  updatedAt: number
}

export type LessonTriggerKind = 'human-correction' | 'verified-tool-fix' | 'manual'
export interface LessonTrigger {
  kind: LessonTriggerKind
  evidence: EvidenceRef[]
  titleHint: string
  contentHint: string
  toolName?: string
}

export interface LessonInjectPayload {
  source: {
    kind: 'plugin'
    plugin: string
    form: 'snapshot'
    sections: Array<{ name: string; text: string }>
  }
  content: Array<{ type: 'text'; text: string }>
}

export interface PreStepEnter { kind: 'enter'; messages: unknown[]; startsRequestSeries?: true }
export type PreStepDecision = { kind: 'reject' } | PreStepEnter

export interface ReviewSnapshot {
  memoryAvailable: boolean
  memoryMessage?: string
  projectId?: string
  generation: number
  storageFailed: boolean
  lessons: MemoryRecord[]
  skills: SkillRecord[]
  /** True while an extract for this session (or any session, if none requested) is queued or in flight. */
  extracting?: boolean
}

export function evidenceWatermark(refs: readonly EvidenceRef[]): string {
  return [...refs].map(ref => `${ref.sessionId}:${ref.seq}:${ref.kind}`).sort().join('|')
}

export function sessionCwd(session: unknown): string | undefined {
  if (!session || typeof session !== 'object') return undefined
  const row = session as { meta?: { cwd?: unknown }; header?: { cwd?: unknown } }
  const cwd = row.meta?.cwd ?? row.header?.cwd
  return typeof cwd === 'string' ? cwd : undefined
}

export function fail(code: string, message: string): RpcResult<never> {
  return { ok: false, error: { code, message } }
}

export const MEMORY_UNAVAILABLE_MESSAGE = '记忆服务不可用。请先单独启用「记忆」插件；启用自我改进不会自动打开记忆。'
export const MEMORY_UNAVAILABLE_MESSAGE_EN = 'Memory is unavailable. Enable the Memory plugin separately; turning on self-improvement does not enable Memory.'
