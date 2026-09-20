import { describe, expect, it } from 'vitest'
import { composeSettingsNavTabs } from './settings.tsx'

describe('settings nav order', () => {
  it('keeps plugins and about as the last two items after official plugin pages', () => {
    expect(composeSettingsNavTabs(
      ['general', 'models', 'assistant', 'writing', 'usage', 'zhihu'],
      [{ navId: 'plugin:web-search' }, { navId: 'plugin:extra' }],
    )).toEqual([
      'general', 'models', 'assistant', 'writing', 'usage', 'zhihu',
      'plugin:web-search', 'plugin:extra',
      'plugins', 'about',
    ])
  })

  it('still pins plugins and about when assistant pages are hidden', () => {
    const tabs = composeSettingsNavTabs(
      ['general', 'writing', 'usage', 'zhihu'],
      [{ navId: 'plugin:web-search' }],
    )
    expect(tabs.slice(-2)).toEqual(['plugins', 'about'])
    expect(tabs).not.toContain('models')
    expect(tabs.indexOf('plugin:web-search')).toBeLessThan(tabs.indexOf('plugins'))
  })
})
