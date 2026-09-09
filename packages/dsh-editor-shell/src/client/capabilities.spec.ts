import { describe, expect, it } from 'vitest'
import { capabilityStateFromResult } from './capabilities.ts'

describe('capabilityStateFromResult', () => {
  it('maps the frozen contract to a ready state', () => {
    expect(capabilityStateFromResult({ ok: true, value: { assistant: true, completion: false, zhihu: false } }))
      .toEqual({ kind: 'ready', value: { assistant: true, completion: false, zhihu: false } })
  })

  it('treats an explicit error as an error state, never as ordinary disabled mode', () => {
    const state = capabilityStateFromResult({ ok: false, error: { code: 'internal', message: 'plugin broken', details: {} } })
    expect(state.kind).toBe('error')
    if (state.kind === 'error') expect(state.message).toBeTruthy()
  })

  it('rejects malformed payloads instead of silently disabling features', () => {
    for (const value of [null, undefined, [], 'yes', {}, { assistant: true }, { assistant: 1, completion: true, zhihu: true }]) {
      expect(capabilityStateFromResult({ ok: true, value }).kind, JSON.stringify(value)).toBe('error')
    }
  })
})
