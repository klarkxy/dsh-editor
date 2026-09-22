import { describe, expect, it } from 'vitest'
import { defaultPolicy, policySchema, storedReceiptsSchema, updatePolicySchema } from './storage.ts'

describe('policy and receipt storage contracts', () => {
  it('accepts defaults and rejects credential copies', () => {
    expect(policySchema.safeParse(defaultPolicy()).success).toBe(true)
    expect(policySchema.safeParse({ ...defaultPolicy(), apiKey: 'secret' }).success).toBe(false)
    expect(policySchema.safeParse({
      ...defaultPolicy(),
      roles: { normal: { provider: 'stub', model: 'chat', apiKey: 'secret' } },
    }).success).toBe(false)
  })

  it('rejects invalid revisions and unknown update fields', () => {
    const { revision: _revision, ...policy } = defaultPolicy()
    expect(updatePolicySchema.safeParse({ policy, expectedRevision: 0 }).success).toBe(true)
    expect(updatePolicySchema.safeParse({ policy, expectedRevision: -1 }).success).toBe(false)
    expect(updatePolicySchema.safeParse({ policy, expectedRevision: 0, prompt: 'hidden' }).success).toBe(false)
  })

  it('stores receipts without prompt or secret fields', () => {
    expect(storedReceiptsSchema.safeParse({
      items: [{
        id: 'r1', plugin: '@klarkxy/dsh-recap', purpose: 'title', sourceVersion: '1', status: 'success',
        attempts: 1, cost: null, startedAt: 1, finishedAt: 2,
      }],
    }).success).toBe(true)
    expect(storedReceiptsSchema.safeParse({
      items: [{
        id: 'r1', plugin: 'mood', purpose: 'title', sourceVersion: '1', status: 'success',
        attempts: 1, cost: 1.2, startedAt: 1, finishedAt: 2, prompt: 'secret',
      }],
    }).success).toBe(false)
  })
})
