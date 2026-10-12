import { getLocale } from '../i18n/index.ts'
import { ZHIHU_SETTINGS_SLOT } from '../root-registration.ts'

export const CONFIG_SLOTS = ['plugins.item', 'plugins.bundle.config', 'plugins.row.config'] as const
export type ConfigSlot = typeof CONFIG_SLOTS[number]

/** Display names for adopted bundles that publish no label. Routing keeps the package key. */
const BUNDLE_FALLBACK_LABELS: Record<string, { zh: string; en: string }> = {
  '@deepseek-ai/dsh-experimental-voice-input-bundle': { zh: '语音输入', en: 'Voice input' },
  '@klarkxy/dsh-web-search-manager': { zh: '网络搜索', en: 'Web search' },
}

export type PluginConfigurationEntry = {
  id: string
  label: string
  slot: string
  entryKey?: string
  namespace?: string
}

type LedgerEntry = {
  options?: { id?: string; key?: string; label?: string | (() => string); order?: number }
  /** Cordis fiber name stamped by the slot service. Same string means the same plugin. */
  registrant?: string
}
export type SlotLedger = {
  entries(key: string): readonly LedgerEntry[]
  getVersion(key: string): number
  subscribe(key: string, listener: () => void): () => void
}

function providedLabel(value: unknown): string | undefined {
  try {
    const text = typeof value === 'function' ? (value as () => unknown)() : value
    if (typeof text === 'string' && text.trim()) return text.trim()
  } catch { /* One faulty label must not hide the other entries. */ }
  return undefined
}

function textId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function configurationLabel(slot: ConfigSlot, key: string, label: unknown): string {
  const provided = providedLabel(label)
  if (provided) return provided
  if (slot === 'plugins.bundle.config' && Object.hasOwn(BUNDLE_FALLBACK_LABELS, key)) {
    const fallback = BUNDLE_FALLBACK_LABELS[key]
    if (fallback) return getLocale() === 'en' ? fallback.en : fallback.zh
  }
  return key
}

/** Same route key the native configuration nav keeps. */
function officialRouteKey(slot: ConfigSlot, entry: LedgerEntry | undefined): string {
  const raw = slot === 'plugins.item' ? entry?.options?.id : entry?.options?.key
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (!key) return ''
  return key
}

function slotEntries(ledger: SlotLedger, slot: string): LedgerEntry[] {
  try {
    return (ledger.entries(slot) ?? []).filter((entry): entry is LedgerEntry => !!entry && typeof entry === 'object')
  } catch {
    return []
  }
}

/**
 * The legacy Zhihu page stays only when that slot has a real registration
 * which the same plugin has not also published through an official configuration slot.
 * An empty Slot element is not a contribution.
 */
export function legacyZhihuVisible(ledger: SlotLedger | undefined): boolean {
  if (!ledger) return false
  const legacy = slotEntries(ledger, ZHIHU_SETTINGS_SLOT)
  if (!legacy.length) return false
  const registrants = new Set<string>()
  const keys = new Set<string>()
  for (const slot of CONFIG_SLOTS) {
    for (const entry of slotEntries(ledger, slot)) {
      const routeKey = officialRouteKey(slot, entry)
      if (!routeKey) continue
      const registrant = textId(entry.registrant)
      if (registrant) registrants.add(registrant)
      keys.add(routeKey)
    }
  }
  return legacy.some((entry) => {
    const registrant = textId(entry.registrant)
    if (registrant && registrants.has(registrant)) return false
    const id = textId(entry.options?.id)
    const key = textId(entry.options?.key)
    if ((id && keys.has(id)) || (key && keys.has(key))) return false
    return true
  })
}

function rowNamespace(key: string): string | undefined {
  const separator = key.lastIndexOf('#')
  return separator > 0 && separator < key.length - 1 ? key.slice(separator + 1) : undefined
}

/** Project the three official configuration ledgers without inventing package ownership. */
export function projectPluginConfigurations(ledger: SlotLedger | undefined): PluginConfigurationEntry[] {
  if (!ledger) return []
  const result: Array<PluginConfigurationEntry & { order: number }> = []
  const seen = new Set<string>()
  for (const slot of CONFIG_SLOTS) {
    let entries: readonly LedgerEntry[]
    try { entries = ledger.entries(slot) ?? [] } catch { continue }
    for (const entry of entries) {
      const key = officialRouteKey(slot, entry)
      if (!key) continue
      const id = `${slot}:${key}`
      if (seen.has(id)) continue
      seen.add(id)
      const order = entry.options?.order
      result.push({
        id,
        label: configurationLabel(slot, key, entry.options?.label),
        slot,
        ...(slot === 'plugins.item' ? { namespace: key } : { entryKey: key }),
        ...(slot === 'plugins.row.config' ? { namespace: rowNamespace(key) } : {}),
        order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
      })
    }
  }
  result.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return result.map(({ order: _order, ...entry }) => entry)
}
