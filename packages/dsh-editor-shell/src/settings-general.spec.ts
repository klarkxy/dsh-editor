import { describe, expect, it } from 'vitest'
import { decodeBusyEnter, decodeLocalePreference, decodeThemePreference } from './client/settings-general.tsx'

describe('settings general preference decoders', () => {
  it('decodes the host theme preference values', () => {
    expect(decodeThemePreference({ preference: 'light' })).toEqual({ preference: 'light' })
    expect(decodeThemePreference({ preference: 'dark' })).toEqual({ preference: 'dark' })
    expect(decodeThemePreference({ preference: 'system' })).toEqual({ preference: 'system' })
    expect(decodeThemePreference({ preference: 'sepia' })).toBeUndefined()
    expect(decodeThemePreference({})).toBeUndefined()
    expect(decodeThemePreference(null)).toBeUndefined()
  })

  it('decodes the locale preference values', () => {
    expect(decodeLocalePreference({ preference: 'zh' })).toEqual({ preference: 'zh' })
    expect(decodeLocalePreference({ preference: 'en' })).toEqual({ preference: 'en' })
    expect(decodeLocalePreference({ preference: 'ja' })).toBeUndefined()
    expect(decodeLocalePreference('zh')).toBeUndefined()
  })

  it('decodes the composer busy-enter behavior', () => {
    expect(decodeBusyEnter({ busyEnter: 'queue' })).toEqual({ busyEnter: 'queue' })
    expect(decodeBusyEnter({ busyEnter: 'steer' })).toEqual({ busyEnter: 'steer' })
    expect(decodeBusyEnter({ busyEnter: 'interrupt' })).toBeUndefined()
    expect(decodeBusyEnter({ preference: 'queue' })).toBeUndefined()
    expect(decodeBusyEnter(undefined)).toBeUndefined()
  })
})
