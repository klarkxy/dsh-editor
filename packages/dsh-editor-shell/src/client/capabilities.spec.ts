import { describe, expect, it } from 'vitest'
import { capabilityStateFromResult } from './capabilities.ts'

describe('capabilityStateFromResult', () => {
  it('maps the frozen contract to a ready state', () => {
    expect(capabilityStateFromResult({ ok: true, value: { features: { assistant: true, completion: false, zhihu: false } } }))
      .toEqual({ kind: 'ready', value: { features: { assistant: true, completion: false, zhihu: false } } })
    expect(capabilityStateFromResult({ ok: true, value: { features: {} } }))
      .toEqual({ kind: 'ready', value: { features: {} } })
  })

  it('treats an explicit error as an error state, never as ordinary disabled mode', () => {
    const state = capabilityStateFromResult({ ok: false, error: { code: 'internal', message: 'plugin broken', details: {} } })
    expect(state.kind).toBe('error')
    if (state.kind === 'error') expect(state.message).toBeTruthy()
  })

  it('rejects malformed payloads instead of silently disabling features', () => {
    for (const value of [null, undefined, [], 'yes', {}, { assistant: true }, { features: { assistant: 1 } }, { features: [] }]) {
      expect(capabilityStateFromResult({ ok: true, value }).kind, JSON.stringify(value)).toBe('error')
    }
  })
})
