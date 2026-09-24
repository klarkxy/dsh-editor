import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  DEFAULT_IDLE_MS, defaultSettings, MAX_PROJECT_ID_CHARS, type DreamPlan, type MemoryPersistedState, type MemoryRecord,
  type MemorySettings, type MemoryTombstone,
} from './contracts.ts'

export const evidenceSchema = z.object({
  sessionId: z.string().min(1).max(200),
  seq: z.number().int().nonnegative(),
  kind: z.enum(['user', 'tool', 'turn', 'manual']),
  excerpt: z.string().max(400).optional(),
}).strict()

export const knowledgeScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1).max(MAX_PROJECT_ID_CHARS) }).strict(),
])

export const basisRefSchema = z.object({
  id: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
}).strict()

export const memoryRecordSchema = z.object({
  id: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  scope: knowledgeScopeSchema,
  kind: z.enum(['preference', 'project-fact', 'decision', 'lesson']),
  status: z.enum(['candidate', 'active', 'rejected', 'superseded', 'revoked', 'deleted']),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1).max(40)).max(16),
  evidence: z.array(evidenceSchema).max(16),
  exceptions: z.array(z.string().max(200)).max(16),
  source: z.enum(['user', 'memory', 'dream', 'self-improvement']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive().optional(),
  supersedes: z.array(z.string().min(1).max(80)).max(32).optional(),
  basis: z.array(basisRefSchema).max(16).optional(),
}).strict()

export const newMemoryRecordSchema = memoryRecordSchema.omit({
  id: true, revision: true, createdAt: true, updatedAt: true,
})

export const settingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  injectEnabled: z.boolean(),
  dreamIdleEnabled: z.boolean(),
  idleMs: z.number().int().min(60_000).max(180 * 60_000),
}).strict()

export const updateSettingsSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  settings: settingsSchema.omit({ revision: true }),
}).strict()

export const tombstoneSchema = z.object({
  id: z.string().min(1).max(80),
  deletedAt: z.number().int().nonnegative(),
  lastRevision: z.number().int().nonnegative(),
}).strict()

export const dreamSnapshotSchema = z.object({
  id: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  status: memoryRecordSchema.shape.status,
  scope: knowledgeScopeSchema,
  expiresAt: z.number().int().positive().optional(),
}).strict()

export const dreamProposalSchema = z.object({
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(4000),
  kind: z.enum(['preference', 'project-fact', 'decision']),
  tags: z.array(z.string().min(1).max(40)).max(16),
  exceptions: z.array(z.string().max(200)).max(16),
  evidence: z.array(evidenceSchema).max(16),
  sourceIds: z.array(z.string().min(1).max(80)).min(1).max(16),
  scope: knowledgeScopeSchema,
}).strict()

export const dreamPlanSchema = z.object({
  id: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  sessionId: z.string().min(1).max(200),
  projectId: z.string().min(1).max(MAX_PROJECT_ID_CHARS).optional(),
  status: z.enum(['preview', 'applied', 'cancelled', 'stale', 'failed', 'noop']),
  sourceVersion: z.string().min(1).max(64),
  snapshot: z.array(dreamSnapshotSchema).max(64),
  proposals: z.array(dreamProposalSchema).max(16),
  generation: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  error: z.string().max(240).optional(),
}).strict()

export const createRpcSchema = z.object({
  sessionId: z.string().min(1).max(200),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(4000),
  kind: z.enum(['preference', 'project-fact', 'decision', 'lesson']),
  global: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(40)).max(16).optional(),
  exceptions: z.array(z.string().max(200)).max(16).optional(),
  evidence: z.array(evidenceSchema).max(16).optional(),
  expiresAt: z.number().int().positive().optional(),
}).strict()

export const patchRpcSchema = z.object({
  sessionId: z.string().min(1).max(200),
  id: z.string().min(1).max(80),
  expectedRevision: z.number().int().nonnegative(),
  title: z.string().min(1).max(160).optional(),
  content: z.string().min(1).max(4000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(16).optional(),
  exceptions: z.array(z.string().max(200)).max(16).optional(),
  status: memoryRecordSchema.shape.status.optional(),
  expiresAt: z.number().int().positive().optional(),
}).strict()

export const revisionRpcSchema = z.object({
  sessionId: z.string().min(1).max(200),
  id: z.string().min(1).max(80),
  expectedRevision: z.number().int().nonnegative(),
}).strict()

export const listRpcSchema = z.object({
  sessionId: z.string().min(1).max(200),
  query: z.string().max(200).optional(),
  kinds: z.array(memoryRecordSchema.shape.kind).max(4).optional(),
  statuses: z.array(memoryRecordSchema.shape.status).max(8).optional(),
  global: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict()

export const MAX_MEMORY_RECORDS = 4096
export const MAX_MEMORY_TOMBSTONES = 4096
export const MAX_MEMORY_DREAMS = 256

export const memoryStateSchema = z.object({
  settings: settingsSchema,
  records: z.array(memoryRecordSchema).max(MAX_MEMORY_RECORDS),
  tombstones: z.array(tombstoneSchema).max(MAX_MEMORY_TOMBSTONES),
  dreams: z.array(dreamPlanSchema).max(MAX_MEMORY_DREAMS),
  lastAttemptAt: z.number().int().nonnegative().optional(),
}).strict()

export const memoryDomain = defineDomain({
  name: 'dsh_editor_memory',
  version: 2,
  tables: {
    state: domainTable<string, MemoryPersistedState>(memoryStateSchema),
  },
})

export function storedSettings(value: MemorySettings | undefined): MemorySettings {
  const merged = value ? { ...defaultSettings(), ...value } : defaultSettings()
  return { ...merged, idleMs: DEFAULT_IDLE_MS }
}

export type { DreamPlan, MemoryRecord, MemoryTombstone }
