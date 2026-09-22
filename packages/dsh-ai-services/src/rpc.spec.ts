import { describe, expect, it } from 'vitest'
import { handleAiRpc } from './rpc.ts'
import { defaultPolicy } from './storage.ts'
import type { AiServices } from './contracts.ts'

function service(overrides: Partial<AiServices> = {}): AiServices & { storageFailedFlag: boolean } {
  const policy = defaultPolicy()
  return {
    storageFailedFlag: false,
    activate() { throw new Error('unused') },
    getPolicy: () => policy,
    updatePolicy: async next => ({ ...next, revision: 1 }),
    resolve: async () => ({ provider: 'stub', model: 'chat', source: 'default', target: { kind: 'model', provider: 'stub', model: 'chat' }, policyRevision: 0 }),
    purposes: () => [],
    usage: () => [],
    ...overrides,
  }
}

describe('host RPC validation', () => {
  it('serves status, resolve, usage and rejects unknown endpoints and extra fields', async () => {
    const signal = new AbortController().signal
    const host = service()
    expect(await handleAiRpc(host, 'status', {}, signal)).toMatchObject({ ok: true, value: { storageFailed: false } })
    expect(await handleAiRpc(host, 'usage', {}, signal)).toEqual({ ok: true, value: [] })
    expect(await handleAiRpc(host, 'resolve', { purpose: 'title' }, signal)).toMatchObject({ ok: true })
    expect(await handleAiRpc(host, 'run', {}, signal)).toMatchObject({ ok: false, error: { code: 'AI_INVALID_REQUEST' } })
    expect(await handleAiRpc(host, 'status', { extra: true }, signal)).toMatchObject({ ok: false, error: { code: 'AI_INVALID_REQUEST' } })
    expect(await handleAiRpc(host, 'update', { expectedRevision: 0, policy: { ...defaultPolicy(), prompt: 'x' } }, signal))
      .toMatchObject({ ok: false, error: { code: 'AI_INVALID_REQUEST' } })
  })

  it('rejects an unknown role override instead of coercing it', async () => {
    const result = await handleAiRpc(service(), 'resolve', {
      purpose: 'title', override: { kind: 'role', role: 'expert' },
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { code: 'AI_INVALID_REQUEST' } })
  })
})
