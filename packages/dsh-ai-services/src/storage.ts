import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { AiPolicy, ModelRole, ModelRoute, ModelTarget, PurposeSpec, UsageReceipt } from './contracts.ts'
import { AI_POLICY_INVALID, fail } from './errors.ts'

export const POLICY_KEY = 'current'
export const RECEIPTS_KEY = 'log'
export const RECEIPT_LIMIT = 100

export const DEFAULT_LIMITS = {
  concurrency: 1,
  timeoutMs: 60_000,
  maxInputChars: 32_000,
  maxOutputTokens: 2048,
  maxAttempts: 2,
} as const

const roleSchema = z.enum(['normal', 'weak', 'strong'])

export const modelRouteSchema = z.object({
  provider: z.string().trim().min(1).max(128),
  model: z.string().trim().min(1).max(256),
  reasoningEffort: z.string().trim().min(1).max(64).optional(),
}).strict()

export const modelTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('role'), role: roleSchema }).strict(),
  z.object({ kind: z.literal('session') }).strict(),
  z.object({ kind: z.literal('model') }).merge(modelRouteSchema).strict(),
])

export const limitsSchema = z.object({
  concurrency: z.number().int().min(1).max(8),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  maxInputChars: z.number().int().min(1).max(200_000),
  maxOutputTokens: z.number().int().min(1).max(8_192),
  maxAttempts: z.number().int().min(1).max(5),
}).strict()

export const policyDataSchema = z.object({
  roles: z.object({
    normal: modelRouteSchema.optional(),
    weak: modelRouteSchema.optional(),
    strong: modelRouteSchema.optional(),
  }).strict(),
  purposes: z.record(z.string().min(1).max(80), modelTargetSchema).refine(value => Object.keys(value).length <= 200),
  limits: limitsSchema,
}).strict()

export const policySchema = policyDataSchema.extend({
  revision: z.number().int().nonnegative(),
}).strict()

export const storedPolicySchema = policySchema.extend({ imports: z.array(z.string().min(1).max(80)).max(100).optional() }).strict()

export const updatePolicySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  policy: policyDataSchema,
}).strict()

export const resolveRpcSchema = z.object({
  purpose: z.string().min(1).max(80),
  sessionId: z.string().min(1).max(128).optional(),
  override: modelTargetSchema.optional(),
}).strict()

const usageReceiptSchema = z.object({
  id: z.string().min(1).max(80),
  plugin: z.string().min(1).max(80),
  purpose: z.string().min(1).max(80),
  sessionId: z.string().max(128).optional(),
  sourceVersion: z.string().max(128),
  contractVersion: z.number().int().optional(),
  promptVersion: z.string().max(80).optional(),
  schemaVersion: z.string().max(80).optional(),
  route: z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string().optional(),
    source: z.enum(['override', 'purpose', 'default']),
    target: modelTargetSchema,
    policyRevision: z.number().int().nonnegative(),
    inheritedRole: roleSchema.optional(),
  }).strict().optional(),
  status: z.enum(['success', 'failed', 'cancelled', 'superseded', 'skipped']),
  attempts: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cost: z.null(),
  startedAt: z.number(),
  finishedAt: z.number(),
  error: z.string().max(240).optional(),
}).strict()

export const storedReceiptsSchema = z.object({
  items: z.array(usageReceiptSchema).max(RECEIPT_LIMIT),
}).strict()

export const purposeSpecSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,79}$/),
  label: z.string().trim().min(1).max(80),
  defaultTarget: modelTargetSchema,
  maxOutputTokens: z.number().int().min(1).max(8_192).optional(),
  maxInputChars: z.number().int().min(1).max(200_000).optional(),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
}).strict()

export function defaultPolicy(): AiPolicy {
  return {
    revision: 0,
    roles: {},
    purposes: {},
    limits: { ...DEFAULT_LIMITS },
  }
}

export function clonePolicy(policy: AiPolicy): AiPolicy {
  return structuredClone(policy)
}

export function parsePolicy(value: unknown): AiPolicy {
  const parsed = policySchema.safeParse(value)
  if (!parsed.success) fail(AI_POLICY_INVALID, '模型策略格式无效。')
  return parsed.data
}

export function parsePolicyData(value: unknown): Omit<AiPolicy, 'revision'> {
  const parsed = policyDataSchema.safeParse(value)
  if (!parsed.success) fail(AI_POLICY_INVALID, '模型策略格式无效。')
  return parsed.data
}

export function sanitizeReceipt(receipt: UsageReceipt): z.output<typeof usageReceiptSchema> {
  return usageReceiptSchema.parse({
    ...receipt,
    cost: null,
    error: receipt.error?.slice(0, 240),
  })
}

export function boundedReceipts(items: UsageReceipt[]): z.output<typeof storedReceiptsSchema>['items'] {
  return storedReceiptsSchema.parse({ items: items.map(sanitizeReceipt).slice(-RECEIPT_LIMIT) }).items
}

export const aiServicesDomain = defineDomain({
  name: 'dsh_editor_ai_services',
  version: 1,
  tables: {
    policy: domainTable<string, z.output<typeof storedPolicySchema>>(storedPolicySchema),
    receipts: domainTable<string, z.output<typeof storedReceiptsSchema>>(storedReceiptsSchema),
  },
})

export function isModelRole(value: unknown): value is ModelRole {
  return value === 'normal' || value === 'weak' || value === 'strong'
}

export function cloneRoute(route: ModelRoute): ModelRoute {
  return route.reasoningEffort
    ? { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort }
    : { provider: route.provider, model: route.model }
}

export function cloneTarget(target: ModelTarget): ModelTarget {
  return structuredClone(target)
}

export function clonePurpose(spec: PurposeSpec): PurposeSpec {
  return structuredClone(spec)
}
