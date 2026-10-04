import { describe, expect, it } from 'vitest'
import { decodeBusyEnter, decodeLocalePreference, decodeThemePreference } from './client/settings-general.tsx'
import { authorSettingsChrome, DEVELOPER_SETTINGS_NAMESPACE, decodeDeveloperSettings } from './developer-settings.ts'
import { decodeLimitBreakSettings, LIMIT_BREAK_SETTINGS_NAMESPACE } from './limit-break-settings.ts'

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

  it('decodes the developer mode toggle', () => {
    expect(decodeDeveloperSettings({ developerMode: true })).toEqual({ developerMode: true })
    expect(decodeDeveloperSettings({ developerMode: false })).toEqual({ developerMode: false })
    expect(decodeDeveloperSettings({})).toBeUndefined()
    expect(decodeDeveloperSettings(undefined)).toBeUndefined()
  })

  it('decodes the limit-break toggle and keeps its own namespace', () => {
    expect(decodeLimitBreakSettings({ limitBreakMode: true })).toEqual({ limitBreakMode: true })
    expect(decodeLimitBreakSettings({ limitBreakMode: false })).toEqual({ limitBreakMode: false })
    expect(decodeLimitBreakSettings({})).toBeUndefined()
    expect(decodeLimitBreakSettings(undefined)).toBeUndefined()
    expect(decodeLimitBreakSettings({ developerMode: true })).toBeUndefined()
    expect(LIMIT_BREAK_SETTINGS_NAMESPACE).not.toBe(DEVELOPER_SETTINGS_NAMESPACE)
  })
})

describe('authorSettingsChrome', () => {
  it('hides developer mode and open-config from ordinary-author chrome', () => {
    expect(authorSettingsChrome(false)).toEqual({
      showDeveloperMode: false,
      showOpenConfig: false,
    })
  })

  it('shows developer mode and open-config after the developer gate', () => {
    expect(authorSettingsChrome(true)).toEqual({
      showDeveloperMode: true,
      showOpenConfig: true,
    })
  })
})
