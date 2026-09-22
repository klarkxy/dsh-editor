import { describe, expect, it } from 'vitest'
import { handleHostRpc, ModelCenter, name } from './index.ts'

describe('model center host', () => {
  it('exposes only activation status and does not start inference', async () => {
    expect(name).toBe('@klarkxy/dsh-model-center')
    const service = new ModelCenter()
    expect(service.status()).toEqual({ enabled: true, plugin: name })
    const ok = await handleHostRpc('status', {}, new AbortController().signal, service)
    expect(ok).toEqual({ ok: true, value: { enabled: true, plugin: name } })
    const unknown = await handleHostRpc('update', { policy: {} }, new AbortController().signal, service)
    expect(unknown.ok).toBe(false)
  })

  it('cancels status when the signal is aborted', async () => {
    const signal = AbortSignal.abort()
    const result = await handleHostRpc('status', {}, signal)
    expect(result.ok).toBe(false)
  })
})
