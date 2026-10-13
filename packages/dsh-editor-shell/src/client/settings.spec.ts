import { describe, expect, it } from 'vitest'
import {
  composeSettingsNavGroups,
  isPluginsSection,
  normalizeSettingsSection,
} from '../model/settings.ts'

describe('application settings navigation', () => {
  it('lists the fixed sections in the spec order with plugin sub-sections', () => {
    const groups = composeSettingsNavGroups(true)
    expect(groups.map(group => group.label)).toEqual([
      'settings.groupWriting',
      'settings.groupApp',
      'settings.plugins',
      'settings.groupMore',
    ])
    expect(groups.flatMap(group => group.items.map(item => item.id))).toEqual([
      'writing', 'models', 'assistant',
      'appearance', 'shortcuts',
      'plugins-installed', 'plugins-discovery', 'plugins-manager',
      'usage', 'about', 'advanced',
    ])
    expect(groups[3]!.items.at(-1)).toMatchObject({ id: 'advanced', warn: true })
  })

  it('keeps settings usable without assistant capabilities', () => {
    const groups = composeSettingsNavGroups(false)
    const ids = groups.flatMap(group => group.items.map(item => item.id))
    expect(ids).toEqual([
      'writing',
      'appearance', 'shortcuts',
      'plugins-installed', 'plugins-discovery', 'plugins-manager',
      'usage', 'about', 'advanced',
    ])
    expect(ids).not.toContain('models')
    expect(ids).not.toContain('assistant')
  })

  it('migrates legacy tab names and stored values to section ids', () => {
    expect(normalizeSettingsSection('general')).toBe('appearance')
    expect(normalizeSettingsSection('plugins')).toBe('plugins-installed')
    expect(normalizeSettingsSection('about')).toBe('about')
    expect(normalizeSettingsSection(undefined)).toBe('writing')
    expect(normalizeSettingsSection('official:plugins.item:x')).toBe('official:plugins.item:x')
  })

  it('classifies plugin sub-sections and dynamic configuration pages', () => {
    expect(isPluginsSection('plugins-installed')).toBe(true)
    expect(isPluginsSection('plugins-discovery')).toBe(true)
    expect(isPluginsSection('plugins-manager')).toBe(true)
    expect(isPluginsSection('official:plugins.item:terminal')).toBe(true)
    expect(isPluginsSection('model:assistant')).toBe(true)
    expect(isPluginsSection('zhihu')).toBe(true)
    expect(isPluginsSection('plugin:custom')).toBe(true)
    expect(isPluginsSection('writing')).toBe(false)
    expect(isPluginsSection('appearance')).toBe(false)
  })
})
