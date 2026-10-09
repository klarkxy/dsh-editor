import {
  CORE_PLUGIN_BUNDLE_NAMES,
  CORE_PLUGIN_ENTRY_IDS,
  REQUIRED_CORE_BUNDLES,
  RETIRED_PLUGIN_PACKAGES,
} from '../../../apps/desktop/src/distribution-contract.ts'
import type {
  PluginCatalog,
  PluginCatalogAction,
  PluginCatalogBadge,
  PluginCatalogCard,
  PluginCatalogSection,
} from './contracts.ts'
import { corePluginPatchId } from './core-lock.ts'
import { readPreparedCatalog, type RuntimeCatalog } from './core.ts'
import type { NativeToolManager } from './native-tools.ts'

/** Upstream opt-in bundles the author switches from 官方插件. */
const EXPERIMENTAL_PACKAGE_PREFIX = '@deepseek-ai/dsh-experimental-'
/** Preinstalled public plugins ship with the distribution and belong to 内置功能. */
const PREINSTALLED_PUBLIC_PLUGINS: Readonly<Record<string, { title: string; description: string }>> = {
  '@klarkxy/dsh-web-search-manager': { title: '网页搜索', description: '' },
}

/**
 * Upstream experimental bundles carry no prepared-catalog entry of their own,
 * so their product names live next to the preinstalled map.
 */
const UPSTREAM_DISPLAY: Readonly<Record<string, { title: string; description: string }>> = {
  '@deepseek-ai/dsh-experimental-agent-team-profile': { title: '智能体团队', description: '启用团队协作、团队工具、成员列表和共享任务看板。' },
  '@deepseek-ai/dsh-experimental-auto-review': { title: '自动授权审查', description: '提供自动审查权限模式，由模型在每次工具调用前判断是否授权。' },
  '@deepseek-ai/dsh-experimental-schedule-bundle': { title: '自动化任务', description: '按设定的时间或周期，在会话中自动执行任务。' },
  '@deepseek-ai/dsh-experimental-voice-input-bundle': { title: '语音输入', description: '使用官方本地语音识别，将转写放入对话草稿。首次使用需准备模型。' },
}

const BUNDLE_NAME_SUFFIX = /-bundle$/
/** Words that do not identify a bundle on their own when folding catalog entries. */
const GENERIC_TITLE_TOKENS = new Set(['bundle', 'to', 'for', 'and', 'of', 'the', 'ui', 'client', 'api'])
const BADGE_ORDER: readonly PluginCatalogBadge[] = [
  'required',
  'locked',
  'builtin',
  'preinstalled',
  'experimental',
  'session-managed',
  'feature-managed',
]

type BundleRow = {
  name: string
  enabled?: unknown
  installed?: unknown
  readOnlyReason?: unknown
  description?: unknown
  meta?: { title?: unknown; description?: unknown }
}

/** Inventory display metadata is a plain string or a locale map (`{ zh, en }`). */
function metaText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const locales = value as Record<string, unknown>
    for (const key of ['zh', 'en']) {
      const text = locales[key]
      if (typeof text === 'string' && text.trim()) return text.trim()
    }
  }
  return ''
}

function rowTitle(row: BundleRow): string {
  return metaText(row.meta?.title)
}

function rowDescription(row: BundleRow): string {
  return metaText(row.meta?.description) || (typeof row.description === 'string' ? row.description.trim() : '')
}
type PluginRow = { entryId?: unknown; patchId?: unknown; enabled?: unknown; readOnlyReason?: unknown }
export type CatalogManager = Partial<Pick<NativeToolManager, 'listBundles' | 'listPlugins'>>

function readOnlyReason(row: { readOnlyReason?: unknown } | undefined): boolean {
  return typeof row?.readOnlyReason === 'string' && row.readOnlyReason.length > 0
}

function bundleRows(value: unknown): BundleRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => (
    row && typeof row === 'object' && !Array.isArray(row) && typeof (row as BundleRow).name === 'string'
      ? [row as BundleRow]
      : []
  ))
}

function pluginRows(value: unknown): PluginRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => (
    row && typeof row === 'object' && !Array.isArray(row) ? [row as PluginRow] : []
  ))
}

function pluginPatchId(row: PluginRow): string | undefined {
  if (typeof row.patchId === 'string' && row.patchId) return row.patchId
  return typeof row.entryId === 'string' && row.entryId ? corePluginPatchId(row.entryId) : undefined
}

function orderedBadges(badges: Iterable<PluginCatalogBadge>): PluginCatalogBadge[] {
  const wanted = new Set(badges)
  return BADGE_ORDER.filter((badge) => wanted.has(badge))
}

/** A card only carries a switch while the author can actually flip it. */
function cardAction(enabled: boolean | undefined, locked: boolean): PluginCatalogAction {
  if (enabled !== undefined) return 'switch'
  return locked ? 'config' : 'detail'
}

function isExperimental(packageName: string): boolean {
  return packageName.startsWith(EXPERIMENTAL_PACKAGE_PREFIX)
}

function titleTokens(packageName: string): string[] {
  if (!isExperimental(packageName)) return []
  return packageName
    .slice(EXPERIMENTAL_PACKAGE_PREFIX.length)
    .replace(BUNDLE_NAME_SUFFIX, '')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0 && !GENERIC_TITLE_TOKENS.has(token.toLowerCase()))
}

/**
 * Fold the prepared voice entries into their upstream 语音输入 bundle card so the
 * same feature never shows up twice. A bundle matches an entry when every
 * identifying token of the bundle name is part of the entry package name.
 */
function experimentalCopy(packageName: string, entries: Record<string, RuntimeCatalog['entries'][string]>, consumed: Set<string>): { title: string; description: string } {
  const wanted = titleTokens(packageName)
  for (const [id, entry] of Object.entries(entries)) {
    if (consumed.has(id) || !isExperimental(entry.packageName)) continue
    const available = new Set(titleTokens(entry.packageName))
    if (wanted.length > 0 && wanted.every((token) => available.has(token))) {
      consumed.add(id)
      return { title: entry.title || packageName, description: entry.description ?? '' }
    }
  }
  return { title: packageName, description: '' }
}

function catalogCopy(packageName: string, entries: Record<string, RuntimeCatalog['entries'][string]>): { title: string; description: string } | undefined {
  const row = Object.values(entries).find((entry) => entry.packageName === packageName)
  if (!row) return undefined
  return { title: row.title || packageName, description: row.description ?? '' }
}

/**
 * Assemble the three-class catalog. The prepared catalog is the only trust
 * source for `builtin`; the native manager only supplies live state.
 */
export function buildPluginCatalog(input: { catalog?: RuntimeCatalog; bundles?: unknown; plugins?: unknown }): PluginCatalog {
  const entries = input.catalog?.entries ?? {}
  const bundles = bundleRows(input.bundles)
  const plugins = pluginRows(input.plugins)
  const bundleByName = new Map(bundles.map((row) => [row.name, row]))
  const officialNames = new Set<string>()
  const builtinBundleNames = new Set<string>()
  const coveredPackages = new Set<string>()
  const consumedCatalogEntries = new Set<string>()
  const titledFromCatalog = new Set<PluginCatalogCard>()

  const official: PluginCatalogCard[] = []
  for (const row of bundles) {
    if (!isExperimental(row.name)) continue
    officialNames.add(row.name)
    const copy = experimentalCopy(row.name, entries, consumedCatalogEntries)
    const display = UPSTREAM_DISPLAY[row.name]
    const title = copy.title !== row.name ? copy.title : (display?.title ?? (rowTitle(row) || row.name))
    const description = copy.description || display?.description || rowDescription(row)
    const locked = readOnlyReason(row)
    const enabled = !locked && typeof row.enabled === 'boolean' ? row.enabled : undefined
    official.push({
      key: `bundle:${row.name}`,
      title,
      description,
      packageName: row.name,
      badges: orderedBadges(['experimental', ...(locked ? ['locked' as const] : [])]),
      ...(enabled === undefined ? {} : { enabled }),
      action: cardAction(enabled, locked),
    })
  }

  const builtin: PluginCatalogCard[] = []
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.builtin !== true) continue
    // Experimental entries are folded into their 官方 bundle card instead.
    if (isExperimental(entry.packageName)) continue
    if (RETIRED_PLUGIN_PACKAGES.has(entry.packageName)) continue
    const plugin = plugins.find((row) => pluginPatchId(row) === id)
    const locked = entry.locked || readOnlyReason(plugin)
    const required = CORE_PLUGIN_ENTRY_IDS.has(id) || REQUIRED_CORE_BUNDLES.has(entry.packageName)
    const enabled = !locked && typeof plugin?.enabled === 'boolean' ? plugin.enabled : undefined
    const card: PluginCatalogCard = {
      key: `entry:${id}`,
      title: entry.title || entry.packageName,
      description: entry.description ?? '',
      packageName: entry.packageName,
      entryId: id,
      badges: orderedBadges([
        ...(required ? ['required' as const] : []),
        ...(locked ? ['locked' as const] : []),
        'builtin',
        ...(entry.managedBy === 'session' ? ['session-managed' as const] : []),
        ...(entry.managedBy === 'feature' ? ['feature-managed' as const] : []),
      ]),
      ...(enabled === undefined ? {} : { enabled }),
      action: cardAction(enabled, locked),
    }
    builtin.push(card)
    coveredPackages.add(entry.packageName)
  }

  for (const name of [...(input.catalog?.bundles ?? []), ...REQUIRED_CORE_BUNDLES, ...CORE_PLUGIN_BUNDLE_NAMES]) {
    if (builtinBundleNames.has(name)) continue
    builtinBundleNames.add(name)
    if (officialNames.has(name) || coveredPackages.has(name) || RETIRED_PLUGIN_PACKAGES.has(name)) continue
    const row = bundleByName.get(name)
    const copy = catalogCopy(name, entries)
    // No product name means an implementation dependency (runtime plumbing,
    // profile config, shared libraries): it stays out of the author-facing list.
    if (!copy) continue
    const locked = readOnlyReason(row)
    const required = REQUIRED_CORE_BUNDLES.has(name)
    const enabled = !locked && typeof row?.enabled === 'boolean' ? row.enabled : undefined
    const card: PluginCatalogCard = {
      key: `bundle:${name}`,
      title: copy?.title ?? name,
      description: copy?.description ?? '',
      packageName: name,
      badges: orderedBadges([
        ...(required ? ['required' as const] : []),
        ...(locked ? ['locked' as const] : []),
        'builtin',
      ]),
      ...(enabled === undefined ? {} : { enabled }),
      action: cardAction(enabled, locked),
    }
    if (copy) titledFromCatalog.add(card)
    builtin.push(card)
  }

  for (const [packageName, preset] of Object.entries(PREINSTALLED_PUBLIC_PLUGINS)) {
    const existing = builtin.find((card) => card.packageName === packageName)
    if (existing) {
      existing.badges = orderedBadges([...existing.badges, 'preinstalled'])
      if (!titledFromCatalog.has(existing)) existing.title = preset.title
      continue
    }
    const row = bundleByName.get(packageName)
    const entry = Object.values(entries).find((item) => item.packageName === packageName)
    const locked = Boolean(entry?.locked) || readOnlyReason(row)
    const enabled = !locked && typeof row?.enabled === 'boolean' ? row.enabled : undefined
    const required = REQUIRED_CORE_BUNDLES.has(packageName)
    builtin.push({
      key: `bundle:${packageName}`,
      title: entry?.title || preset.title,
      description: entry?.description ?? preset.description,
      packageName,
      badges: orderedBadges([
        ...(required ? ['required' as const] : []),
        ...(locked ? ['locked' as const] : []),
        'builtin',
        'preinstalled',
      ]),
      ...(enabled === undefined ? {} : { enabled }),
      action: cardAction(enabled, locked),
    })
  }

  const user: PluginCatalogCard[] = []
  for (const row of bundles) {
    const name = row.name
    if (officialNames.has(name) || builtinBundleNames.has(name)) continue
    if (coveredPackages.has(name) || name in PREINSTALLED_PUBLIC_PLUGINS) continue
    // Upstream runtime packages are never author-installed plugins.
    if (name.startsWith('@deepseek-ai/')) continue
    if (RETIRED_PLUGIN_PACKAGES.has(name)) continue
    const copy = catalogCopy(name, entries)
    const locked = readOnlyReason(row)
    const enabled = !locked && typeof row.enabled === 'boolean' ? row.enabled : undefined
    user.push({
      key: `bundle:${name}`,
      title: copy?.title ?? (rowTitle(row) || name),
      description: copy?.description ?? rowDescription(row),
      packageName: name,
      badges: orderedBadges(locked ? ['locked' as const] : []),
      ...(enabled === undefined ? {} : { enabled }),
      action: cardAction(enabled, locked),
    })
  }

  const sections: PluginCatalogSection[] = [
    { id: 'official', items: official },
    { id: 'builtin', items: builtin },
    { id: 'user', items: user },
  ]
  return { sections }
}

/** Live state only: a missing or failing official manager still serves the distribution-owned catalog. */
export async function readPluginCatalog(profileDir: string, manager?: CatalogManager): Promise<PluginCatalog> {
  const catalog = await readPreparedCatalog(profileDir)
  const bundles = typeof manager?.listBundles === 'function'
    ? await manager.listBundles().catch(() => undefined)
    : undefined
  const plugins = typeof manager?.listPlugins === 'function'
    ? await manager.listPlugins().catch(() => undefined)
    : undefined
  return buildPluginCatalog({ catalog, bundles, plugins })
}
