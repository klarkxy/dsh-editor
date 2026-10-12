import { mergeConfigurationCards, type PluginCatalogAction, type PluginCatalogCard, type PluginCatalogSection } from './plugins-catalog.ts'
import type { PluginConfigurationEntry } from './plugin-configurations.ts'

export type ConfigLink = { id: string; label: string; entry?: PluginConfigurationEntry }

/**
 * The 插件配置 nav entry a card opens, or null when none is reachable.
 * A bundle card names its package, an entry card its Cordis entry; both routes
 * end at the same official configuration key.
 */
export function configTargetOf(card: PluginCatalogCard, links: readonly ConfigLink[]): string | null {
  const fromKey = card.key.startsWith('entry:') ? `official:${card.key.slice('entry:'.length)}` : ''
  if (fromKey && links.some(link => link.id === fromKey)) return fromKey
  const byEntry = card.entryId
    ? links.find(link => link.entry !== undefined
      && (link.entry.namespace === card.entryId || link.entry.entryKey === card.entryId))
    : undefined
  if (byEntry) return byEntry.id
  const byPackage = card.packageName ? links.find(link => link.entry?.entryKey === card.packageName) : undefined
  return byPackage?.id ?? null
}

/** Switch rows that also reach a configuration page carry a secondary 配置 control. */
export function secondaryConfigKeys(sections: readonly PluginCatalogSection[], links: readonly ConfigLink[]): string[] {
  return sections
    .flatMap((section) => section.items)
    .filter((card) => card.action === 'switch' && configTargetOf(card, links) !== null)
    .map((card) => card.key)
}

/**
 * Configuration cards that have no reachable 插件配置 entry fall back to the
 * detail control, so every row keeps exactly one control that does something.
 */
export function mergeSections(
  sections: readonly PluginCatalogSection[],
  entries: readonly PluginConfigurationEntry[],
  links: readonly ConfigLink[],
): PluginCatalogSection[] {
  return mergeConfigurationCards(sections, entries).map((section) => ({
    ...section,
    items: section.items.map((card) => (card.action === 'config' && !configTargetOf(card, links)
      ? { ...card, action: 'detail' as PluginCatalogAction }
      : card)),
  }))
}

