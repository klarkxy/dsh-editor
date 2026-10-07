import { HOST_LOCKED_ENTRY_IDS, RETIRED_PLUGIN_PACKAGES } from '../../../apps/desktop/src/distribution-contract.ts'
import { PLUGIN_STATE_SCHEMA } from './contracts.ts'
import { isSafeEntryId, isSafePackageName } from './core.ts'

export type InstalledPlugin = { name: string; spec: string; version: string }

export type PluginState = {
  schema: typeof PLUGIN_STATE_SCHEMA
  overrides: Record<string, boolean>
  /** 第一方写作模式 preset 的开关；缺省（无记录）视为启用。 */
  presets: Record<string, boolean>
  installed: InstalledPlugin[]
}

export const MANAGED_PATCH_MARK = 'managed-by: dsh-editor-plugins'

export function emptyPluginState(): PluginState {
  return { schema: PLUGIN_STATE_SCHEMA, overrides: {}, presets: {}, installed: [] }
}

export function parsePluginState(value: unknown): PluginState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (row.schema !== PLUGIN_STATE_SCHEMA) return undefined
  const overrides: Record<string, boolean> = {}
  if (row.overrides && typeof row.overrides === 'object' && !Array.isArray(row.overrides)) {
    for (const [id, enabled] of Object.entries(row.overrides as Record<string, unknown>)) {
      if (isSafeEntryId(id) && typeof enabled === 'boolean' && !HOST_LOCKED_ENTRY_IDS.has(id)) overrides[id] = enabled
    }
  }
  const installed: InstalledPlugin[] = []
  if (Array.isArray(row.installed)) {
    for (const item of row.installed) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      if (typeof record.name !== 'string' || !isSafePackageName(record.name) || RETIRED_PLUGIN_PACKAGES.has(record.name)) continue
      if (typeof record.spec !== 'string' || record.spec.length > 200) continue
      installed.push({
        name: record.name,
        spec: record.spec,
        version: typeof record.version === 'string' ? record.version.slice(0, 80) : '',
      })
    }
  }
  const presets: Record<string, boolean> = {}
  if (row.presets && typeof row.presets === 'object' && !Array.isArray(row.presets)) {
    for (const [id, enabled] of Object.entries(row.presets as Record<string, unknown>)) {
      if (isSafeEntryId(id) && typeof enabled === 'boolean') presets[id] = enabled
    }
  }
  return { schema: PLUGIN_STATE_SCHEMA, overrides, presets, installed }
}
