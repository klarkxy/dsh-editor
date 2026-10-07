import { CORE_PLUGIN_ENTRY_IDS, CORE_PLUGIN_BUNDLE_NAMES } from '../../../apps/desktop/src/distribution-contract.ts'
export { CORE_PLUGIN_ENTRY_IDS, CORE_PLUGIN_BUNDLE_NAMES } from '../../../apps/desktop/src/distribution-contract.ts'

export function corePluginPatchId(entryId: string): string {
  const colon = entryId.lastIndexOf(':')
  return colon === -1 ? entryId : entryId.slice(colon + 1)
}

export function protectCorePluginRows<T extends { entryId?: unknown; readOnlyReason?: unknown }>(rows: T[]): T[] {
  return rows.map((row) => {
    const id = typeof row.entryId === 'string' ? corePluginPatchId(row.entryId) : ''
    if (!CORE_PLUGIN_ENTRY_IDS.has(id) || row.readOnlyReason) return row
    return { ...row, readOnlyReason: 'management-required' }
  })
}

export function protectCorePluginBundles<T extends { name?: unknown; readOnlyReason?: unknown }>(rows: T[]): T[] {
  return rows.map((row) => {
    const name = typeof row.name === 'string' ? row.name : ''
    if (!CORE_PLUGIN_BUNDLE_NAMES.has(name) || row.readOnlyReason) return row
    return { ...row, readOnlyReason: 'management-required' }
  })
}

export type NativeChangeResult = {
  changed: false
  application: 'failed'
  stage: 'enable' | 'remove'
  target: string
  enabled?: boolean
  error: { code: 'management-required' }
}

function refusedChange(stage: 'enable' | 'remove', target: string, enabled?: boolean): NativeChangeResult {
  return {
    changed: false,
    application: 'failed',
    stage,
    target,
    ...(enabled === undefined ? {} : { enabled }),
    error: { code: 'management-required' },
  }
}

type NativePluginManager = {
  listPlugins: (...args: never[]) => Promise<unknown>
  listBundles?: (...args: never[]) => Promise<unknown>
  setPluginEnabled: (entryId: string, enabled: boolean, ...rest: never[]) => Promise<unknown>
  setBundleEnabled?: (name: string, enabled: boolean, ...rest: never[]) => Promise<unknown>
  removeBundle?: (name: string, ...rest: never[]) => Promise<unknown>
}

function rowId(row: { entryId?: unknown }): string | undefined {
  return typeof row.entryId === 'string' ? row.entryId : undefined
}

/** Finite in-place wrap of the official manager. Restores originals when the effect disposes. */
export function protectCorePluginManager(manager: NativePluginManager): () => void {
  const original = {
    listPlugins: manager.listPlugins,
    listBundles: manager.listBundles,
    setPluginEnabled: manager.setPluginEnabled,
    setBundleEnabled: manager.setBundleEnabled,
    removeBundle: manager.removeBundle,
  }
  manager.listPlugins = async function (this: NativePluginManager, ...args: never[]) {
    const rows = await original.listPlugins.apply(this, args)
    return Array.isArray(rows) ? protectCorePluginRows(rows as Array<{ entryId?: unknown; readOnlyReason?: unknown }>) : rows
  } as NativePluginManager['listPlugins']
  if (original.listBundles && manager.listBundles) {
    manager.listBundles = async function (this: NativePluginManager, ...args: never[]) {
      const rows = await original.listBundles!.apply(this, args)
      return Array.isArray(rows) ? protectCorePluginBundles(rows as Array<{ name?: unknown; readOnlyReason?: unknown }>) : rows
    } as NonNullable<NativePluginManager['listBundles']>
  }
  manager.setPluginEnabled = async function (this: NativePluginManager, entryId: string, enabled: boolean, ...rest: never[]) {
    const rows = await this.listPlugins()
    const row = Array.isArray(rows) ? (rows as Array<{ entryId?: unknown; readOnlyReason?: unknown }>).find((item) => rowId(item) === entryId) : undefined
    if (row?.readOnlyReason === 'management-required' || CORE_PLUGIN_ENTRY_IDS.has(corePluginPatchId(String(entryId)))) {
      return refusedChange('enable', entryId, enabled)
    }
    return original.setPluginEnabled.apply(this, [entryId, enabled, ...rest])
  } as NativePluginManager['setPluginEnabled']
  if (original.setBundleEnabled && manager.setBundleEnabled) {
    manager.setBundleEnabled = async function (this: NativePluginManager, name: string, enabled: boolean, ...rest: never[]) {
      if (CORE_PLUGIN_BUNDLE_NAMES.has(name)) return refusedChange('enable', name, enabled)
      return original.setBundleEnabled!.apply(this, [name, enabled, ...rest])
    } as NonNullable<NativePluginManager['setBundleEnabled']>
  }
  if (original.removeBundle && manager.removeBundle) {
    manager.removeBundle = async function (this: NativePluginManager, name: string, ...rest: never[]) {
      if (CORE_PLUGIN_BUNDLE_NAMES.has(name)) return refusedChange('remove', name)
      return original.removeBundle!.apply(this, [name, ...rest])
    } as NonNullable<NativePluginManager['removeBundle']>
  }
  return () => {
    manager.listPlugins = original.listPlugins
    if (original.listBundles && manager.listBundles) manager.listBundles = original.listBundles
    manager.setPluginEnabled = original.setPluginEnabled
    if (original.setBundleEnabled && manager.setBundleEnabled) manager.setBundleEnabled = original.setBundleEnabled
    if (original.removeBundle && manager.removeBundle) manager.removeBundle = original.removeBundle
  }
}
