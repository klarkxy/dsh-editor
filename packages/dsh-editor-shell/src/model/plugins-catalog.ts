/**
 * Three-class plugin catalog for the global plugins page.
 *
 * The contract below mirrors the private plugins bundle (`/dsh-editor-plugins`)
 * so the shell can render it without a package dependency. Every value is
 * normalized: an unknown shape drops one card instead of the whole page.
 */
import { t } from '../i18n/index.ts'
import type { PluginConfigurationEntry } from './plugin-configurations.ts'

export const PLUGINS_RPC_CHANNEL = '/dsh-editor-plugins'
/** The Connection only accepts one-segment channels; manager methods live under /api. */
export const PLUGIN_MANAGER_RPC_CHANNEL = '/api'
export const CATALOG_ENDPOINT = 'catalog.list'
export const PRESETS_ENDPOINT = 'presets.list'
export const PRESET_ENABLED_ENDPOINT = 'presets.setEnabled'
export const BUNDLE_ENABLED_ENDPOINT = 'pluginManager/setBundleEnabled'
export const PLUGIN_ENABLED_ENDPOINT = 'pluginManager/setPluginEnabled'

export type PluginCatalogBadge =
  | 'experimental'
  | 'required'
  | 'locked'
  | 'builtin'
  | 'preinstalled'
  | 'session-managed'
  | 'feature-managed'
  | 'installed'
export type PluginCatalogAction = 'switch' | 'config' | 'detail'
export type PluginCatalogCard = {
  /** Stable key: `bundle:<packageName>` or `entry:<entryId>`. */
  key: string
  title: string
  description: string
  packageName?: string
  entryId?: string
  /**
   * Author-supplied brand art as a plain data URI (`data:image/svg+xml;base64,…`).
   * Pure data from the Host, never markup; the monogram stays the fallback.
   */
  icon?: string
  badges: string[]
  /** Omit when the card carries no switch. */
  enabled?: boolean
  action: PluginCatalogAction
}
export type PluginCatalogSectionId = 'official' | 'builtin' | 'user'
export type PluginCatalogSection = { id: PluginCatalogSectionId; items: PluginCatalogCard[] }
export type WritingPresetCard = {
  id: string
  title: string
  description: string
  enabled: boolean
  locked: boolean
  packageName?: string
}

export type CatalogStatus = 'loading' | 'ready' | 'error'
/** Presets are optional: a host without them simply has no sub-group. */
export type PresetsStatus = 'loading' | 'ready' | 'error'

const SECTION_IDS: readonly PluginCatalogSectionId[] = ['official', 'builtin', 'user']
const ACTIONS: readonly PluginCatalogAction[] = ['switch', 'config', 'detail']

const SECTION_LABELS: Record<PluginCatalogSectionId, () => string> = {
  official: () => t('plugins.catalogOfficial'),
  builtin: () => t('plugins.catalogBuiltin'),
  user: () => t('plugins.catalogUser'),
}

const BADGE_LABELS: Record<string, () => string> = {
  experimental: () => t('plugins.badgeExperimental'),
  required: () => t('plugins.badgeRequired'),
  locked: () => t('plugins.badgeLocked'),
  builtin: () => t('plugins.badgeBuiltin'),
  preinstalled: () => t('plugins.badgePreinstalled'),
  'session-managed': () => t('plugins.badgeSessionManaged'),
  'feature-managed': () => t('plugins.badgeFeatureManaged'),
  installed: () => t('plugins.badgeInstalled'),
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Brand art is plain data from the Host. Only an inline image data URI is
 * accepted: a remote URL would leak the author's browsing and a `javascript:`
 * URI would turn the row into script, so both fall back to the monogram.
 */
function iconOf(value: unknown): string {
  const source = text(value)
  return /^data:image\/[a-z0-9.+-]+[;,]/i.test(source) ? source : ''
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function catalogBadgeLabel(badge: string): string {
  return (BADGE_LABELS[badge] ?? BADGE_LABELS.experimental)()
}

export function catalogSectionLabel(id: PluginCatalogSectionId): string {
  return (SECTION_LABELS[id] ?? SECTION_LABELS.official)()
}

function cardOf(value: unknown): PluginCatalogCard | null {
  const row = recordOf(value)
  const key = text(row.key)
  if (!key) return null
  const packageName = text(row.packageName)
  const entryId = text(row.entryId)
  const icon = iconOf(row.icon)
  return {
    key,
    title: text(row.title) || packageName || entryId || key,
    description: text(row.description),
    ...(packageName ? { packageName } : {}),
    ...(entryId ? { entryId } : {}),
    ...(icon ? { icon } : {}),
    badges: Array.isArray(row.badges)
      ? row.badges.map(text).filter((badge) => badge.length > 0)
      : [],
    ...(typeof row.enabled === 'boolean' ? { enabled: row.enabled } : {}),
    action: ACTIONS.includes(row.action as PluginCatalogAction) ? row.action as PluginCatalogAction : 'detail',
  }
}

/** Always three sections in the fixed order, so the page keeps its shape. */
export function catalogSectionsOf(value: unknown): PluginCatalogSection[] {
  const rows = Array.isArray(recordOf(value).sections) ? recordOf(value).sections as unknown[] : []
  const byId = new Map<PluginCatalogSectionId, PluginCatalogCard[]>()
  for (const sectionId of SECTION_IDS) byId.set(sectionId, [])
  for (const raw of rows) {
    const section = recordOf(raw)
    const id = text(section.id) as PluginCatalogSectionId
    if (!byId.has(id)) continue
    const items = Array.isArray(section.items)
      ? section.items.map(cardOf).filter((card): card is PluginCatalogCard => card !== null)
      : []
    byId.set(id, [...byId.get(id)!, ...items])
  }
  return SECTION_IDS.map((id) => ({ id, items: byId.get(id)! }))
}

export function writingPresetsOf(value: unknown): WritingPresetCard[] {
  const rows = Array.isArray(recordOf(value).presets) ? recordOf(value).presets as unknown[] : []
  return rows.flatMap((raw) => {
    const row = recordOf(raw)
    const id = text(row.id)
    if (!id) return []
    const packageName = text(row.packageName)
    return [{
      id,
      title: text(row.title) || id,
      description: text(row.description),
      enabled: row.enabled === true,
      locked: row.locked === true,
      ...(packageName ? { packageName } : {}),
    }]
  })
}

/**
 * The shell owns the configuration routes, so every `plugins.item` entry also
 * appears as a configuration card at the end of the official section.
 */
export function mergeConfigurationCards(
  sections: readonly PluginCatalogSection[],
  entries: readonly PluginConfigurationEntry[],
): PluginCatalogSection[] {
  const existing = new Set(sections.flatMap((section) => section.items.map((card) => card.key)))
  const cards: PluginCatalogCard[] = []
  for (const entry of entries) {
    if (entry.slot !== 'plugins.item') continue
    const key = `entry:${entry.id}`
    if (existing.has(key)) continue
    existing.add(key)
    cards.push({
      key,
      title: entry.label,
      description: t('plugins.catalogConfigDescription'),
      ...(entry.namespace ? { entryId: entry.namespace } : {}),
      badges: [],
      action: 'config',
    })
  }
  if (!cards.length) return sections.map((section) => ({ ...section }))
  return sections.map((section) => (section.id === 'official'
    ? { ...section, items: [...section.items, ...cards] }
    : { ...section, items: [...section.items] }))
}

function cardMatches(card: PluginCatalogCard, needle: string): boolean {
  if (!needle) return true
  return [card.title, card.description, card.packageName ?? '']
    .some((field) => field.toLocaleLowerCase().includes(needle))
}

/** Stable component identities, not localized labels, identify developer surfaces. */
export function advancedCatalogCard(card: PluginCatalogCard): boolean {
  const identity = `${card.packageName ?? ''}/${card.entryId ?? ''}/${card.key}`
  const developerSurface = /(?:^|[:/#-])(?:terminal|mcp|agent-loop|developer)(?:$|[:/#-])/i.test(identity)
  const internalRequired = card.badges.includes('required') && card.action === 'detail'
  const unnamedComponent = Boolean(card.packageName && card.title === card.packageName)
  return developerSurface || internalRequired || unnamedComponent
}

export function filterCatalogSections(
  sections: readonly PluginCatalogSection[],
  query: string,
): PluginCatalogSection[] {
  const needle = query.trim().toLocaleLowerCase()
  return sections.map((section) => ({
    ...section,
    items: section.items.filter((card) => cardMatches(card, needle)),
  }))
}

export function filterWritingPresets(presets: readonly WritingPresetCard[], query: string): WritingPresetCard[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return presets.filter((preset) => true)
  return presets.filter((preset) => [preset.title, preset.description, preset.packageName ?? '']
    .some((field) => field.toLocaleLowerCase().includes(needle)))
}

export type RpcCaller = (channel: string, endpoint: string, payload: Record<string, unknown>) => Promise<unknown>

/** The exact Host request a control issues. Null when the card carries neither owner. */
export type RpcRequestShape = { channel: string; endpoint: string; payload: Record<string, unknown> }

export function catalogToggleRequest(card: PluginCatalogCard, enabled: boolean): RpcRequestShape | null {
  // An `entry:` card toggles its own Cordis entry even when it also names a package.
  // The /api gateway requires `payload.args` to be one plain object of named fields.
  const entryId = card.key.startsWith('bundle:') ? undefined : card.entryId
  if (entryId) {
    return { channel: PLUGIN_MANAGER_RPC_CHANNEL, endpoint: PLUGIN_ENABLED_ENDPOINT, payload: { args: { id: entryId, enabled } } }
  }
  if (card.packageName) {
    return { channel: PLUGIN_MANAGER_RPC_CHANNEL, endpoint: BUNDLE_ENABLED_ENDPOINT, payload: { args: { name: card.packageName, enabled } } }
  }
  return null
}

export function presetEnabledRequest(preset: WritingPresetCard, enabled: boolean): RpcRequestShape {
  return { channel: PLUGINS_RPC_CHANNEL, endpoint: PRESET_ENABLED_ENDPOINT, payload: { id: preset.id, enabled } }
}

/** Cordis throws on uninjected service properties; an absent channel is a state, not a crash. */
export function rpcCallerOf(ctx: unknown): RpcCaller | undefined {
  const connection = recordOf(recordOf(ctx).connection)
  const rpc = recordOf(connection.rpc)
  if (typeof rpc.call !== 'function') return undefined
  const call = rpc.call as (channel: string, endpoint: string, payload: Record<string, unknown>) => unknown
  return (channel, endpoint, payload) => Promise.resolve(call.call(rpc, channel, endpoint, payload))
}

export type PluginCatalogBundle = {
  status: CatalogStatus
  sections: PluginCatalogSection[]
  error: string
  /** Card key whose switch write is in flight. */
  pending: string
  actionError: string
  /** An operation reported restart-required; cleared on the next successful reload. */
  restartRequired: boolean
  reload(): void
  toggle(card: PluginCatalogCard, enabled: boolean): Promise<void>
}

/** The official ChangeResult receipt: writes can fail without failing the RPC. */
export type ChangeReceipt = { changed?: boolean; application?: string; message?: string }

export function changeReceipt(value: unknown): ChangeReceipt {
  const row = recordOf(value)
  const error = recordOf(row.error)
  const warnings = Array.isArray(row.warnings) ? row.warnings.filter((item): item is string => typeof item === 'string') : []
  return {
    // `changed` reports a disk write, not success: an idempotent applied change may be false.
    changed: typeof row.changed === 'boolean' ? row.changed : undefined,
    application: typeof row.application === 'string' ? row.application : undefined,
    message: typeof error.diagnostic === 'string' && error.diagnostic
      ? error.diagnostic
      : (warnings[0] ?? (typeof error.code === 'string' ? error.code : undefined)),
  }
}

export type WritingPresetsBundle = {
  status: PresetsStatus
  presets: WritingPresetCard[]
  error: string
  pending: string
  restartRequired: boolean
  setEnabled(preset: WritingPresetCard, enabled: boolean): Promise<void>
}

/**
 * The author's brand art when the Host supplied one and it has not failed to
 * decode, otherwise an empty source so the title's monogram takes the tile. An
 * undecodable data URI must never leave a blank tile, so the failure is keyed
 * by the source itself rather than cleared on the next render.
 */
export function catalogIconSource(card: Pick<PluginCatalogCard, 'icon' | 'title'>, failed = ''): string {
  return card.icon && card.icon !== failed ? card.icon : ''
}

/** User-section card keys, in catalog order. The install signal is their growth. */
export function userSectionKeys(sections: readonly PluginCatalogSection[]): string[] {
  return sections.find((section) => section.id === 'user')?.items.map((card) => card.key) ?? []
}

/** Keys a catalog refresh added to the user section; the previous set stays authoritative. */
export function newUserCardKeys(previous: readonly string[], current: readonly string[]): string[] {
  const seen = new Set(previous)
  return current.filter((key) => !seen.has(key))
}
