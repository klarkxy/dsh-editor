import { describe, expect, it } from 'vitest'
import { composeSettingsNavTabs } from '../model/settings.ts'

describe('application settings navigation', () => {
  it('contains application preferences without plugin management or contributed plugin pages', () => {
    expect(composeSettingsNavTabs(['general', 'models', 'assistant', 'writing', 'shortcuts', 'usage']))
      .toEqual(['general', 'models', 'assistant', 'writing', 'shortcuts', 'usage', 'about'])
  })
  it('keeps settings usable without assistant capabilities', () => {
    expect(composeSettingsNavTabs(['general', 'writing', 'shortcuts', 'usage']))
      .toEqual(['general', 'writing', 'shortcuts', 'usage', 'about'])
  })
})
