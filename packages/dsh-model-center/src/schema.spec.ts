import { describe, expect, it } from 'vitest'
import { LIMIT_BOUNDS, ROUTE_BOUNDS, parseAiServicesStatus, parseModelRoute, parseModelTarget, parsePolicyUpdate } from './schema.ts'

const limits = { concurrency: 1, timeoutMs: 30_000, maxInputChars: 4000, maxOutputTokens: 512, maxAttempts: 2 }
const policy = {
  revision: 3,
  roles: { normal: { provider: 'openai', model: 'gpt' } },
  purposes: { compaction: { kind: 'role', role: 'weak' as const } },
  limits,
}

describe('policy schema', () => {
  it('accepts a complete update payload', () => {
    const parsed = parsePolicyUpdate({ expectedRevision: 3, policy: { roles: policy.roles, purposes: policy.purposes, limits } })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.expectedRevision).toBe(3)
  })

  it('rejects incomplete explicit models and out-of-range limits', () => {
    expect(parsePolicyUpdate({
      expectedRevision: 0,
      policy: { roles: {}, purposes: { x: { kind: 'model', provider: '', model: 'a' } }, limits },
    }).ok).toBe(false)
    expect(parsePolicyUpdate({
      expectedRevision: 0,
      policy: { roles: {}, purposes: {}, limits: { ...limits, timeoutMs: 10 } },
    }).ok).toBe(false)
    expect(parsePolicyUpdate({ expectedRevision: -1, policy: { roles: {}, purposes: {}, limits } }).ok).toBe(false)
  })

  it('aligns field bounds with the shared SDK and does not truncate', () => {
    expect(LIMIT_BOUNDS).toEqual({
      concurrency: { min: 1, max: 8 },
      timeoutMs: { min: 1_000, max: 300_000 },
      maxInputChars: { min: 1, max: 200_000 },
      maxOutputTokens: { min: 1, max: 8_192 },
      maxAttempts: { min: 1, max: 5 },
    })
    expect(ROUTE_BOUNDS).toEqual({ provider: 128, model: 256, effort: 64, purpose: 80 })
    const okLimits = { concurrency: 8, timeoutMs: 300_000, maxInputChars: 1, maxOutputTokens: 8_192, maxAttempts: 5 }
    expect(parsePolicyUpdate({ expectedRevision: 0, policy: { roles: {}, purposes: {}, limits: okLimits } }).ok).toBe(true)
    expect(parsePolicyUpdate({
      expectedRevision: 0,
      policy: { roles: {}, purposes: {}, limits: { ...okLimits, concurrency: 9 } },
    }).ok).toBe(false)
    expect(parsePolicyUpdate({
      expectedRevision: 0,
      policy: { roles: {}, purposes: {}, limits: { ...okLimits, maxOutputTokens: 8_193 } },
    }).ok).toBe(false)
    expect(parseModelRoute({ provider: 'p', model: 'm'.repeat(256), reasoningEffort: 'e'.repeat(64) })).toEqual({
      provider: 'p',
      model: 'm'.repeat(256),
      reasoningEffort: 'e'.repeat(64),
    })
    expect(parseModelRoute({ provider: 'p', model: 'm'.repeat(257) })).toBeUndefined()
    expect(parseModelRoute({ provider: 'p', model: 'm', reasoningEffort: 'e'.repeat(65) })).toBeUndefined()
  })

  it('parses status as { policy, purposes, storageFailed }', () => {
    const wrapped = parseAiServicesStatus({
      policy,
      purposes: [{ id: 'compaction', label: '会话压缩', plugin: 'dsh', defaultTarget: { kind: 'role', role: 'weak' } }],
      storageFailed: true,
    })
    expect(wrapped.ok).toBe(true)
    if (wrapped.ok) expect(wrapped.value.storageFailed).toBe(true)
    expect(parseAiServicesStatus(policy).ok).toBe(false)
  })

  it('keeps session distinct from role targets', () => {
    expect(parseModelTarget({ kind: 'session' })).toEqual({ kind: 'session' })
    expect(parseModelTarget({ kind: 'role', role: 'normal' })).toEqual({ kind: 'role', role: 'normal' })
    expect(parseModelTarget({ kind: 'role', role: 'session' })).toBeUndefined()
  })
})

it('round-trips fantasy bindings and capability targets without dropping their effort', () => {
  const fantasy = { provider: 'custom', model: 'writer', reasoningEffort: 'high' }
  const parsed = parsePolicyUpdate({ expectedRevision: 1, policy: { roles: { fantasy }, purposes: { creative: { kind: 'role', role: 'fantasy' } }, limits } })
  expect(parsed.ok).toBe(true)
  if (parsed.ok) {
    expect(parsed.value.policy.roles.fantasy).toEqual(fantasy)
    expect(parsed.value.policy.purposes.creative).toEqual({ kind: 'role', role: 'fantasy' })
  }
})
