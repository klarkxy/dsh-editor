import type { AiPolicy, AiServicesStatus, AiServicesUpdateRequest, ModelRole, ModelRoute, ModelTarget, RegisteredPurpose, ResolvedRoute } from './contracts.ts'
import { isModelRole } from './contracts.ts'

export const LIMIT_BOUNDS = {
  concurrency: { min: 1, max: 8 },
  timeoutMs: { min: 1_000, max: 300_000 },
  maxInputChars: { min: 1, max: 200_000 },
  maxOutputTokens: { min: 1, max: 8_192 },
  maxAttempts: { min: 1, max: 5 },
} as const

export const ROUTE_BOUNDS = {
  provider: 128,
  model: 256,
  effort: 64,
  purpose: 80,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function boundedInt(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > max) return undefined
  return text
}

export function parseModelRoute(value: unknown): ModelRoute | undefined {
  if (!isRecord(value)) return undefined
  const provider = boundedText(value.provider, ROUTE_BOUNDS.provider)
  const model = boundedText(value.model, ROUTE_BOUNDS.model)
  if (!provider || !model) return undefined
  if (value.reasoningEffort === undefined) return { provider, model }
  if (typeof value.reasoningEffort !== 'string') return undefined
  const reasoningEffort = value.reasoningEffort.trim()
  if (!reasoningEffort) return { provider, model }
  if (reasoningEffort.length > ROUTE_BOUNDS.effort) return undefined
  return { provider, model, reasoningEffort }
}

export function parseModelTarget(value: unknown): ModelTarget | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined
  if (value.kind === 'session') return { kind: 'session' }
  if (value.kind === 'role' && isModelRole(value.role)) return { kind: 'role', role: value.role }
  if (value.kind === 'model') {
    const route = parseModelRoute(value)
    return route ? { kind: 'model', ...route } : undefined
  }
  return undefined
}

export function parseLimits(value: unknown): AiPolicy['limits'] | undefined {
  if (!isRecord(value)) return undefined
  const concurrency = boundedInt(value.concurrency, LIMIT_BOUNDS.concurrency.min, LIMIT_BOUNDS.concurrency.max)
  const timeoutMs = boundedInt(value.timeoutMs, LIMIT_BOUNDS.timeoutMs.min, LIMIT_BOUNDS.timeoutMs.max)
  const maxInputChars = boundedInt(value.maxInputChars, LIMIT_BOUNDS.maxInputChars.min, LIMIT_BOUNDS.maxInputChars.max)
  const maxOutputTokens = boundedInt(value.maxOutputTokens, LIMIT_BOUNDS.maxOutputTokens.min, LIMIT_BOUNDS.maxOutputTokens.max)
  const maxAttempts = boundedInt(value.maxAttempts, LIMIT_BOUNDS.maxAttempts.min, LIMIT_BOUNDS.maxAttempts.max)
  if (concurrency === undefined || timeoutMs === undefined || maxInputChars === undefined || maxOutputTokens === undefined || maxAttempts === undefined) {
    return undefined
  }
  return { concurrency, timeoutMs, maxInputChars, maxOutputTokens, maxAttempts }
}

export function parseRoles(value: unknown): AiPolicy['roles'] | undefined {
  if (!isRecord(value)) return undefined
  const roles: AiPolicy['roles'] = {}
  for (const role of ['normal', 'weak', 'strong', 'fantasy'] as const) {
    if (value[role] === undefined) continue
    const route = parseModelRoute(value[role])
    if (!route) return undefined
    roles[role] = route
  }
  return roles
}

export function parsePurposes(value: unknown): Record<string, ModelTarget> | undefined {
  if (!isRecord(value)) return undefined
  const keys = Object.keys(value)
  if (keys.length > 200) return undefined
  const purposes: Record<string, ModelTarget> = {}
  for (const key of keys) {
    if (!key || key.length > ROUTE_BOUNDS.purpose) return undefined
    const target = parseModelTarget(value[key])
    if (!target) return undefined
    purposes[key] = target
  }
  return purposes
}

export function parsePolicyBody(value: unknown): Omit<AiPolicy, 'revision'> | undefined {
  if (!isRecord(value)) return undefined
  const roles = parseRoles(value.roles)
  const purposes = parsePurposes(value.purposes)
  const limits = parseLimits(value.limits)
  if (!roles || !purposes || !limits) return undefined
  return { roles, purposes, limits }
}

export function parseAiPolicy(value: unknown): AiPolicy | undefined {
  if (!isRecord(value)) return undefined
  const revision = boundedInt(value.revision, 0, Number.MAX_SAFE_INTEGER)
  const body = parsePolicyBody(value)
  if (revision === undefined || !body) return undefined
  return { revision, ...body }
}

export function parsePurposeSpec(value: unknown): RegisteredPurpose | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.plugin !== 'string') return undefined
  if (!value.id || value.id.length > ROUTE_BOUNDS.purpose || !value.label || !value.plugin) return undefined
  const defaultTarget = parseModelTarget(value.defaultTarget)
  if (!defaultTarget) return undefined
  return {
    id: value.id,
    label: value.label,
    plugin: value.plugin,
    defaultTarget,
    maxOutputTokens: typeof value.maxOutputTokens === 'number' ? value.maxOutputTokens : undefined,
    maxInputChars: typeof value.maxInputChars === 'number' ? value.maxInputChars : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
  }
}

export function parsePolicyUpdate(payload: unknown): { ok: true; value: AiServicesUpdateRequest } | { ok: false; error: string } {
  if (!isRecord(payload)) return fail('AI 策略格式无效。')
  const expectedRevision = boundedInt(payload.expectedRevision, 0, Number.MAX_SAFE_INTEGER)
  const policy = parsePolicyBody(payload.policy)
  if (expectedRevision === undefined || !policy) return fail('AI 策略格式无效。')
  return { ok: true, value: { expectedRevision, policy } }
}

export function parseAiServicesStatus(value: unknown): { ok: true; value: AiServicesStatus } | { ok: false; error: string } {
  if (!isRecord(value) || value.policy === undefined || !Array.isArray(value.purposes)) {
    return fail('AI 策略接口与约定不一致。')
  }
  const policy = parseAiPolicy(value.policy)
  if (!policy) return fail('AI 策略接口与约定不一致。')
  const purposes = value.purposes.map(parsePurposeSpec)
  if (purposes.some(item => !item)) return fail('AI 策略接口与约定不一致。')
  if (value.storageFailed !== undefined && typeof value.storageFailed !== 'boolean') return fail('AI 策略接口与约定不一致。')
  return {
    ok: true,
    value: { policy, purposes: purposes as RegisteredPurpose[], storageFailed: value.storageFailed === true },
  }
}

export function parseResolvedRoute(value: unknown): { success: true; data: ResolvedRoute } | { success: false } {
  if (!isRecord(value)) return { success: false }
  const route = parseModelRoute(value)
  const target = parseModelTarget(value.target)
  const policyRevision = boundedInt(value.policyRevision, 0, Number.MAX_SAFE_INTEGER)
  const source = value.source
  if (!route || !target || policyRevision === undefined || (source !== 'override' && source !== 'purpose' && source !== 'default')) {
    return { success: false }
  }
  const inheritedRole = value.inheritedRole
  if (inheritedRole !== undefined && !isModelRole(inheritedRole)) return { success: false }
  return {
    success: true,
    data: {
      ...route,
      source,
      target,
      policyRevision,
      inheritedRole: inheritedRole as ModelRole | undefined,
    },
  }
}

export function editablePolicy(policy: AiPolicy): Omit<AiPolicy, 'revision'> {
  return { roles: { ...policy.roles }, purposes: { ...policy.purposes }, limits: { ...policy.limits } }
}

export const POLICY_CONFLICT_CODE = 'AI_POLICY_CONFLICT'

export function isPolicyConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  if (code === POLICY_CONFLICT_CODE) return true
  const message = error instanceof Error ? error.message : ''
  return /策略已被|revision|conflict/i.test(message)
}
