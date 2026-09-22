import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { MAX_PROJECT_ID_CHARS } from './contracts.ts'

const knowledgeScopeSchema = z.union([
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1).max(MAX_PROJECT_ID_CHARS) }).strict(),
])

export const skillSourceSchema = z.object({
  id: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  status: z.enum(['candidate', 'active', 'rejected', 'superseded', 'revoked', 'deleted']),
  scope: knowledgeScopeSchema,
  expiresAt: z.number().int().nonnegative().optional(),
}).strict()

export const skillRecordSchema = z.object({
  id: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  status: z.enum(['preview', 'accepted', 'rejected', 'revoked']),
  lessonIds: z.array(z.string().min(1).max(80)).min(1).max(16),
  sources: z.array(skillSourceSchema).min(1).max(16),
  title: z.string().min(1).max(160),
  markdown: z.string().min(1).max(80_000),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  exportState: z.enum(['none', 'recorded', 'revoked']),
  exportedAt: z.number().int().nonnegative().optional(),
  exportRevokedAt: z.number().int().nonnegative().optional(),
  exportFilename: z.string().max(180).optional(),
  audit: z.array(z.object({
    at: z.number().int().nonnegative(),
    action: z.string().min(1).max(64),
    detail: z.string().max(500).optional(),
  }).strict()).max(64),
}).strict()

export const watermarkSchema = z.object({
  sessionId: z.string().min(1).max(200),
  seq: z.number().int().nonnegative(),
  projectId: z.string().min(1).max(MAX_PROJECT_ID_CHARS).optional(),
  updatedAt: z.number().int().nonnegative(),
}).strict()

export const selfImprovementDomain = defineDomain({
  name: 'dsh_editor_self_improvement',
  version: 1,
  tables: {
    skills: domainTable<string, z.output<typeof skillRecordSchema>>(skillRecordSchema),
    watermarks: domainTable<string, z.output<typeof watermarkSchema>>(watermarkSchema),
  },
})
