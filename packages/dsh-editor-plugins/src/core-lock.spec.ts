import { describe, expect, it } from 'vitest'
import {
  CORE_PLUGIN_BUNDLE_NAMES,
  CORE_PLUGIN_ENTRY_IDS,
  corePluginPatchId,
  protectCorePluginBundles,
  protectCorePluginManager,
  protectCorePluginRows,
} from './core-lock.ts'

describe('core plugin lock', () => {
  it('marks missing read-only reasons on editor core rows without inventing a second store', () => {
    const rows = protectCorePluginRows([
      { entryId: 'include:editor-shell' },
      { entryId: 'editor-plugins', readOnlyReason: 'management-required' },
      { entryId: 'community-theme' },
      { entryId: 'editor-workbench' },
      { entryId: 'manuscript' },
    ])
    expect(corePluginPatchId('include:editor-shell')).toBe('editor-shell')
    expect(rows[0]?.readOnlyReason).toBe('management-required')
    expect(rows[1]?.readOnlyReason).toBe('management-required')
    expect(rows[2]?.readOnlyReason).toBeUndefined()
    expect(rows[3]?.readOnlyReason).toBe('management-required')
    expect(rows[4]?.readOnlyReason).toBe('management-required')
    expect(CORE_PLUGIN_ENTRY_IDS.has('proofread')).toBe(true)
    expect(CORE_PLUGIN_ENTRY_IDS.has('editor-workbench')).toBe(true)
    expect(CORE_PLUGIN_ENTRY_IDS.has('manuscript')).toBe(true)
  })

  it('stamps required editor bundles independently of native manager protection', () => {
    const rows = protectCorePluginBundles([
      { name: 'dsh-editor-shell' },
      { name: 'dsh-manuscript' },
      { name: 'dsh-editor-cards' },
      { name: '@klarkxy/dsh-web-search-manager' },
    ])
    expect(rows[0]?.readOnlyReason).toBe('management-required')
    expect(rows[1]?.readOnlyReason).toBe('management-required')
    expect(rows[2]?.readOnlyReason).toBeUndefined()
    expect(rows[3]?.readOnlyReason).toBeUndefined()
    expect(CORE_PLUGIN_BUNDLE_NAMES.has('dsh-editor-workbench')).toBe(true)
    expect(CORE_PLUGIN_BUNDLE_NAMES.has('dsh-proofread')).toBe(true)
    expect(CORE_PLUGIN_BUNDLE_NAMES.has('dsh-editor-profile-config')).toBe(true)
    expect(protectCorePluginBundles([{ name: 'dsh-editor-profile-config' }])[0]?.readOnlyReason).toBe('management-required')
  })

  it('blocks direct native mutation of core rows and restores originals on dispose', async () => {
    const calls: unknown[] = []
    const originalList = async () => [{ entryId: 'editor-shell' }, { entryId: 'zhihu' }]
    const originalSet = async (entryId: string, enabled: boolean) => {
      calls.push([entryId, enabled])
      return { changed: true, application: 'applied' }
    }
    const manager = {
      listPlugins: originalList,
      listBundles: async () => [{ name: 'dsh-editor-shell' }, { name: 'dsh-editor-profile-config' }, { name: 'dsh-editor-cards' }],
      setPluginEnabled: originalSet,
      setBundleEnabled: async (name: string, enabled: boolean) => {
        calls.push(['bundle', name, enabled])
        return { changed: true, application: 'applied' }
      },
      removeBundle: async (name: string) => {
        calls.push(['remove', name])
        return { changed: true, application: 'applied' }
      },
    }
    const dispose = protectCorePluginManager(manager)
    const listed = await manager.listPlugins() as Array<{ entryId: string; readOnlyReason?: string }>
    expect(listed[0]?.readOnlyReason).toBe('management-required')
    expect(listed[1]?.readOnlyReason).toBeUndefined()
    expect(await manager.setPluginEnabled('include:editor-workbench-tools', false)).toEqual({
      changed: false, application: 'failed', stage: 'enable', target: 'include:editor-workbench-tools', enabled: false,
      error: { code: 'management-required' },
    })
    expect(await manager.setPluginEnabled('manuscript', false)).toEqual({
      changed: false, application: 'failed', stage: 'enable', target: 'manuscript', enabled: false,
      error: { code: 'management-required' },
    })
    expect(await manager.setPluginEnabled('zhihu', false)).toEqual({ changed: true, application: 'applied' })
    expect(await manager.setBundleEnabled('dsh-editor-shell', false)).toEqual({
      changed: false, application: 'failed', stage: 'enable', target: 'dsh-editor-shell', enabled: false,
      error: { code: 'management-required' },
    })
    expect(await manager.removeBundle('dsh-manuscript')).toEqual({
      changed: false, application: 'failed', stage: 'remove', target: 'dsh-manuscript',
      error: { code: 'management-required' },
    })
    expect(await manager.removeBundle('dsh-editor-profile-config')).toEqual({
      changed: false, application: 'failed', stage: 'remove', target: 'dsh-editor-profile-config',
      error: { code: 'management-required' },
    })
    const bundles = await manager.listBundles() as Array<{ name: string; readOnlyReason?: string }>
    expect(bundles.find((row) => row.name === 'dsh-editor-profile-config')?.readOnlyReason).toBe('management-required')
    expect(await manager.setBundleEnabled('dsh-editor-cards', false)).toEqual({ changed: true, application: 'applied' })
    expect(calls).toEqual([['zhihu', false], ['bundle', 'dsh-editor-cards', false]])
    dispose()
    expect(manager.listPlugins).toBe(originalList)
    expect(manager.setPluginEnabled).toBe(originalSet)
  })
})
