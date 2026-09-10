import { PLUGIN_STATE_SCHEMA } from './contracts.ts'
import { isSafeEntryId, isSafePackageName } from './core.ts'

export type InstalledPlugin = { name: string; spec: string; version: string }

export type PluginState = {
  schema: typeof PLUGIN_STATE_SCHEMA
  overrides: Record<string, boolean>
  installed: InstalledPlugin[]
}

export const MANAGED_PATCH_MARK = 'managed-by: dsh-editor-plugins'

export function emptyPluginState(): PluginState {
  return { schema: PLUGIN_STATE_SCHEMA, overrides: {}, installed: [] }
}

export function parsePluginState(value: unknown): PluginState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (row.schema !== PLUGIN_STATE_SCHEMA) return undefined
  const overrides: Record<string, boolean> = {}
  if (row.overrides && typeof row.overrides === 'object' && !Array.isArray(row.overrides)) {
    for (const [id, enabled] of Object.entries(row.overrides as Record<string, unknown>)) {
      if (isSafeEntryId(id) && typeof enabled === 'boolean') overrides[id] = enabled
    }
  }
  const installed: InstalledPlugin[] = []
  if (Array.isArray(row.installed)) {
    for (const item of row.installed) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      if (typeof record.name !== 'string' || !isSafePackageName(record.name)) continue
      if (typeof record.spec !== 'string' || record.spec.length > 200) continue
      installed.push({
        name: record.name,
        spec: record.spec,
        version: typeof record.version === 'string' ? record.version.slice(0, 80) : '',
      })
    }
  }
  return { schema: PLUGIN_STATE_SCHEMA, overrides, installed }
}

export function renderOverridePatch(overrides: Record<string, boolean>): string {
  const ids = Object.keys(overrides).filter(isSafeEntryId).sort()
  if (ids.length === 0) return `[]\n`
  const lines = [`# ${MANAGED_PATCH_MARK}`]
  for (const id of ids) {
    lines.push(`- id: ${id}`)
    lines.push(`  disabled: ${overrides[id] ? 'false' : 'true'}`)
  }
  return `${lines.join('\n')}\n`
}

export function parseManagedPatch(text: string): Record<string, boolean> | undefined {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed || trimmed === '[]') return {}
  if (!trimmed.includes(MANAGED_PATCH_MARK)) return undefined
  const overrides: Record<string, boolean> = {}
  const pattern = /- id:\s*([A-Za-z0-9._-]+)\r?\n\s+disabled:\s*(true|false)/g
  for (const match of trimmed.matchAll(pattern)) {
    if (isSafeEntryId(match[1])) overrides[match[1]] = match[2] === 'false'
  }
  return overrides
}

export function canReplaceHomePatch(existing: string | undefined): boolean {
  if (existing === undefined) return true
  const trimmed = existing.replace(/^\uFEFF/, '').trim()
  return !trimmed || trimmed === '[]' || trimmed.includes(MANAGED_PATCH_MARK)
}
