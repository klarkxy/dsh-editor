import { describe, expect, it } from 'vitest'
import { BOT_SETTINGS_DEFAULTS, decodeBotSettings } from './bot-settings.ts'

describe('ui-bot settings decode', () => {
  it('applies defaults for missing or invalid fields', () => {
    expect(decodeBotSettings(undefined)).toEqual(BOT_SETTINGS_DEFAULTS)
    expect(decodeBotSettings({})).toEqual(BOT_SETTINGS_DEFAULTS)
    expect(decodeBotSettings({ idleRecapMinutes: 0, cacheTtlMinutes: 3 })).toEqual(BOT_SETTINGS_DEFAULTS)
    expect(decodeBotSettings({ idleRecapMinutes: 500 })).toEqual({ ...BOT_SETTINGS_DEFAULTS })
  })

  it('keeps valid values and lets 0 mean never-expire', () => {
    expect(decodeBotSettings({ idleRecapMinutes: 30, cacheTtlMinutes: 0 })).toEqual({ idleRecapMinutes: 30, cacheTtlMinutes: 0 })
    expect(decodeBotSettings({ idleRecapMinutes: 15, cacheTtlMinutes: 120 })).toEqual({ idleRecapMinutes: 15, cacheTtlMinutes: 120 })
  })
})
