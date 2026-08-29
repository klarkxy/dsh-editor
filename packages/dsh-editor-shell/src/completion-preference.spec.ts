import { describe, expect, it } from 'vitest'
import { automaticCompletionReady, COMPLETION_PREFERENCE_KEY, readCompletionPreference } from './completion-preference.ts'

describe('automatic completion preference', () => {
  it('defaults fail closed to manual and restores only the supported automatic value', () => {
    expect(readCompletionPreference(undefined)).toBe('manual')
    expect(readCompletionPreference({ getItem: () => 'unexpected' })).toBe('manual')
    expect(readCompletionPreference({ getItem: (key) => key === COMPLETION_PREFERENCE_KEY ? 'pause' : null })).toBe('pause')
    expect(readCompletionPreference({ getItem: () => { throw new Error('blocked') } })).toBe('manual')
  })

  it('offers a pause completion only for a fresh focused manuscript edit', () => {
    const ready = {
      preference: 'pause' as const,
      manuscript: true,
      userEditRevision: 2,
      requestedRevision: 1,
      focused: true,
      collapsedSelection: true,
      prefix: '雨声沿着长街渐渐逼近。',
      busy: false,
      blocked: false,
    }
    expect(automaticCompletionReady(ready)).toBe(true)
    expect(automaticCompletionReady({ ...ready, preference: 'manual' })).toBe(false)
    expect(automaticCompletionReady({ ...ready, manuscript: false })).toBe(false)
    expect(automaticCompletionReady({ ...ready, requestedRevision: 2 })).toBe(false)
    expect(automaticCompletionReady({ ...ready, collapsedSelection: false })).toBe(false)
    expect(automaticCompletionReady({ ...ready, prefix: '太短' })).toBe(false)
    expect(automaticCompletionReady({ ...ready, busy: true })).toBe(false)
    expect(automaticCompletionReady({ ...ready, blocked: true })).toBe(false)
  })
})
