import { OFFICIAL_SETTINGS_SLOT } from '../root-registration.ts'
import { getLocale } from '../i18n/index.ts'

export const PLUGIN_SETTINGS_TAB_PREFIX = 'plugin:'

const HOST_SETTINGS_SECTION_IDS = new Set(['general', 'models', 'usage', 'plugins'])

export type OfficialSettingsSection = {
  id: string
  order: number
  label: string
  navId: string
}

export type SlotLedgerEntry = {
  options?: {
    id?: string
    order?: number
    label?: string | (() => string)
  }
}

export type SlotLedger = {
  entries(key: string): readonly SlotLedgerEntry[]
  getVersion(key: string): number
  subscribe(key: string, listener: () => void): () => void
}

export type LocaleRevisionSource = {
  getSnapshot(): { revision?: number }
  subscribe(listener: () => void): () => void
}

export function isSlotLedger(value: unknown): value is SlotLedger {
  if (!value || typeof value !== 'object') return false
  const row = value as SlotLedger
  return typeof row.entries === 'function'
    && typeof row.getVersion === 'function'
    && typeof row.subscribe === 'function'
}

export function isLocaleSource(value: unknown): value is LocaleRevisionSource {
  if (!value || typeof value !== 'object') return false
  const row = value as LocaleRevisionSource
  return typeof row.getSnapshot === 'function' && typeof row.subscribe === 'function'
}

export function readService(ctx: unknown, name: string): unknown {
  if (!ctx || typeof ctx !== 'object') return undefined
  const record = ctx as Record<string, unknown> & { get?: (key: string) => unknown }
  /* Cordis 对未注入的服务属性会直接抛错；这里按"服务不可用"处理而不是让设置页崩溃。 */
  try {
    if (record[name] !== undefined) return record[name]
  } catch {
    return undefined
  }
  if (typeof record.get === 'function') {
    try { return record.get(name) } catch { return undefined }
  }
  return undefined
}

export function resolveSlotLabel(label: unknown, fallback: string): string {
  if (typeof label === 'string') {
    const text = label.trim()
    return text || fallback
  }
  if (typeof label === 'function') {
    try {
      const text = (label as () => unknown)()
      if (typeof text === 'string' && text.trim()) return text.trim()
    } catch { /* a throwing thunk must not take down settings chrome */ }
  }
  return fallback
}

export function projectOfficialSettingsSections(slots: SlotLedger | undefined): OfficialSettingsSection[] {
  if (!slots) return []
  try {
    const seen = new Set<string>()
    const rows: OfficialSettingsSection[] = []
    for (const entry of slots.entries(OFFICIAL_SETTINGS_SLOT) ?? []) {
      const id = typeof entry?.options?.id === 'string' ? entry.options.id.trim() : ''
      if (!id || HOST_SETTINGS_SECTION_IDS.has(id) || seen.has(id)) continue
      seen.add(id)
      const order = typeof entry.options?.order === 'number' && Number.isFinite(entry.options.order)
        ? entry.options.order
        : 0
      rows.push({
        id,
        order,
        label: resolveSlotLabel(entry.options?.label, id),
        navId: `${PLUGIN_SETTINGS_TAB_PREFIX}${id}`,
      })
    }
    rows.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    return rows
  } catch {
    return []
  }
}

export function officialSettingsStamp(slots: SlotLedger | undefined, locale: LocaleRevisionSource | undefined): string {
  try {
    const version = slots?.getVersion(OFFICIAL_SETTINGS_SLOT) ?? 0
    const revision = locale?.getSnapshot()?.revision ?? 0
    /* 壳内 i18n 语言也参与戳：语言切换时即使宿主未提供 locale 服务，分区标签也重新解析。 */
    return `${version}:${revision}:${getLocale()}`
  } catch {
    return '0:0'
  }
}

export function isPluginSettingsTab(tab: string): boolean {
  return tab.startsWith(PLUGIN_SETTINGS_TAB_PREFIX) && tab.length > PLUGIN_SETTINGS_TAB_PREFIX.length
}
