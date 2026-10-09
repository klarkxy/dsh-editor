/**
 * Three-class plugin catalog for the global plugins page.
 *
 * The contract below mirrors the private plugins bundle (`/dsh-editor-plugins`)
 * so the shell can render it without a package dependency. Every value is
 * normalized: an unknown shape drops one card instead of the whole page.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge, Button as ThemeButton, Callout, Flex, Heading, Switch, Text } from '@radix-ui/themes'
import { t } from '../i18n/index.ts'
import { errorMessage, safeRpcCall } from './shared.ts'
import type { PluginConfigurationEntry } from './plugin-configurations.tsx'
import { ActivityText, Button } from './ui/index.ts'

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
export type PluginCatalogAction = 'switch' | 'config' | 'detail'
export type PluginCatalogCard = {
  /** Stable key: `bundle:<packageName>` or `entry:<entryId>`. */
  key: string
  title: string
  description: string
  packageName?: string
  entryId?: string
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
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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
  return {
    key,
    title: text(row.title) || packageName || entryId || key,
    description: text(row.description),
    ...(packageName ? { packageName } : {}),
    ...(entryId ? { entryId } : {}),
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

type RpcCaller = (channel: string, endpoint: string, payload: Record<string, unknown>) => Promise<unknown>

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
function rpcCallerOf(ctx: unknown): RpcCaller | undefined {
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

export function usePluginCatalog(ctx: unknown): PluginCatalogBundle {
  const [sections, setSections] = useState<PluginCatalogSection[] | null>(null)
  const [error, setError] = useState('')
  const [request, setRequest] = useState(0)
  const [pending, setPending] = useState('')
  const [actionError, setActionError] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  useEffect(() => {
    const call = rpcCallerOf(ctx)
    let live = true
    if (!call) {
      setError(t('plugins.catalogUnavailable'))
      return
    }
    void safeRpcCall<unknown>(() => call(PLUGINS_RPC_CHANNEL, CATALOG_ENDPOINT, {})).then((result) => {
      if (!live) return
      if (!result.ok) { setError(errorMessage(result) || t('plugins.catalogError')); return }
      setSections(catalogSectionsOf(result.value))
      setError('')
    })
    return () => { live = false }
  }, [ctx, request])
  const reload = useCallback(() => { setRequest((value) => value + 1) }, [])
  const toggle = useCallback(async (card: PluginCatalogCard, enabled: boolean) => {
    const call = rpcCallerOf(ctx)
    if (pending) return
    setPending(card.key)
    setActionError('')
    const shape = catalogToggleRequest(card, enabled)
    if (!call || !shape) {
      setPending('')
      setActionError(t('plugins.catalogToggleUnsupported'))
      return
    }
    const result = await safeRpcCall<unknown>(() => call(shape.channel, shape.endpoint, shape.payload))
    setPending('')
    if (!result.ok) { setActionError(errorMessage(result) || t('plugins.catalogError')); return }
    // The service answers with a ChangeResult receipt even when the write failed.
    const receipt = changeReceipt(result.value)
    if (receipt.application === 'failed') {
      setActionError(receipt.message || t('plugins.catalogError'))
      reload()
      return
    }
    // overridden means a higher-priority configuration won; the author must see that.
    if (receipt.application === 'overridden') setActionError(t('plugins.catalogOverridden'))
    else if (receipt.application === 'restart-required') setRestartRequired(true)
    reload()
  }, [ctx, pending, reload])
  const status: CatalogStatus = sections ? 'ready' : error ? 'error' : 'loading'
  return { status, sections: sections ?? [], error, pending, actionError, restartRequired, reload, toggle }
}

export type WritingPresetsBundle = {
  status: PresetsStatus
  presets: WritingPresetCard[]
  error: string
  pending: string
  restartRequired: boolean
  setEnabled(preset: WritingPresetCard, enabled: boolean): Promise<void>
}

export function useWritingPresets(ctx: unknown): WritingPresetsBundle {
  const [presets, setPresets] = useState<WritingPresetCard[] | null>(null)
  const [error, setError] = useState('')
  const [request, setRequest] = useState(0)
  const [pending, setPending] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  useEffect(() => {
    const call = rpcCallerOf(ctx)
    let live = true
    if (!call) { setError(t('plugins.catalogUnavailable')); return }
    void safeRpcCall<unknown>(() => call(PLUGINS_RPC_CHANNEL, PRESETS_ENDPOINT, {})).then((result) => {
      if (!live) return
      if (!result.ok) { setError(errorMessage(result) || t('plugins.catalogError')); return }
      setPresets(writingPresetsOf(result.value))
      setError('')
    })
    return () => { live = false }
  }, [ctx, request])
  const setEnabled = useCallback(async (preset: WritingPresetCard, enabled: boolean) => {
    const call = rpcCallerOf(ctx)
    if (!call || pending) return
    setPending(preset.id)
    setError('')
    const shape = presetEnabledRequest(preset, enabled)
    const result = await safeRpcCall<{ restartRequired?: boolean }>(() => call(shape.channel, shape.endpoint, shape.payload))
    setPending('')
    if (!result.ok) { setError(errorMessage(result) || t('plugins.catalogError')); return }
    setRestartRequired(result.value?.restartRequired === true)
    setRequest((value) => value + 1)
  }, [ctx, pending])
  const status: PresetsStatus = presets ? 'ready' : error ? 'error' : 'loading'
  return { status, presets: presets ?? [], error, pending, restartRequired, setEnabled }
}

function monogramOf(title: string): string {
  return [...title.trim()][0]?.toLocaleUpperCase() ?? '·'
}

function CatalogRow(props: {
  card: PluginCatalogCard
  pending: boolean
  /** True when the row also reaches a 插件配置 page and may offer the secondary control. */
  configurable: boolean
  onToggle(card: PluginCatalogCard, enabled: boolean): void
  onConfigure(card: PluginCatalogCard): void
  onDetail(card: PluginCatalogCard): void
}) {
  const card = props.card
  return <li className="plugins-catalog-row" data-testid={`plugins-catalog-row-${card.key}`}>
    <span className="plugins-catalog-icon" aria-hidden="true">{monogramOf(card.title)}</span>
    <div className="plugins-catalog-row-text">
      <Flex className="plugins-catalog-row-head" align="center" gap="2">
        <Text className="plugins-catalog-row-title">{card.title}</Text>
        {card.badges.map((badge) => <Badge key={badge} variant="soft" color="gray" className="plugins-catalog-badge">
          {catalogBadgeLabel(badge)}
        </Badge>)}
      </Flex>
      {card.description
        ? <Text as="p" size="1" color="gray" className="plugins-catalog-row-desc" title={card.description}>{card.description}</Text>
        : null}
    </div>
    <div className="plugins-catalog-row-action">
      {card.action === 'switch'
        ? <>
          {props.configurable
            ? <ThemeButton variant="ghost" color="gray" className="plugins-catalog-config"
              data-testid={`plugins-catalog-config-${card.key}`} onClick={() => props.onConfigure(card)}>
              {t('plugins.catalogConfigure')}
            </ThemeButton>
            : null}
          <Switch className="plugins-catalog-switch" checked={card.enabled === true} disabled={props.pending}
            aria-label={card.title} data-testid={`plugins-catalog-toggle-${card.key}`}
            onCheckedChange={(enabled) => props.onToggle(card, enabled)} />
        </>
        : card.action === 'config'
          ? <Button data-testid={`plugins-catalog-config-${card.key}`} onClick={() => props.onConfigure(card)}>
            {t('plugins.catalogConfigure')}
          </Button>
          : <Button data-testid={`plugins-catalog-detail-${card.key}`} onClick={() => props.onDetail(card)}>
            {t('plugins.catalogDetails')}
          </Button>}
    </div>
  </li>
}

function PresetRow(props: {
  preset: WritingPresetCard
  pending: boolean
  onToggle(preset: WritingPresetCard, enabled: boolean): void
}) {
  const preset = props.preset
  return <li className="plugins-catalog-row" data-testid={`plugins-catalog-preset-${preset.id}`}>
    <span className="plugins-catalog-icon" aria-hidden="true">{monogramOf(preset.title)}</span>
    <div className="plugins-catalog-row-text">
      <Flex className="plugins-catalog-row-head" align="center" gap="2">
        <Text className="plugins-catalog-row-title">{preset.title}</Text>
        {preset.locked ? <Badge variant="soft" color="gray" className="plugins-catalog-badge">
          {t('plugins.badgeRequired')}
        </Badge> : null}
      </Flex>
      {preset.description
        ? <Text as="p" size="1" color="gray" className="plugins-catalog-row-desc" title={preset.description}>{preset.description}</Text>
        : null}
    </div>
    <div className="plugins-catalog-row-action">
      {preset.locked
        ? <Text size="1" color="gray" className="plugins-catalog-preset-locked">{t('plugins.badgeRequired')}</Text>
        : <Switch className="plugins-catalog-switch" checked={preset.enabled} disabled={props.pending}
          aria-label={preset.title} data-testid={`plugins-catalog-preset-toggle-${preset.id}`}
          onCheckedChange={(enabled) => props.onToggle(preset, enabled)} />}
    </div>
  </li>
}

function CatalogSection(props: {
  section: PluginCatalogSection
  presets: readonly WritingPresetCard[]
  query: string
  pending: string
  presetPending: string
  presetError: string
  restartRequired: boolean
  configKeys: readonly string[]
  onToggle(card: PluginCatalogCard, enabled: boolean): void
  onTogglePreset(preset: WritingPresetCard, enabled: boolean): void
  onConfigure(card: PluginCatalogCard): void
  onDetail(card: PluginCatalogCard): void
}) {
  const { section } = props
  const items = section.items
  const presets = section.id === 'builtin' ? props.presets : []
  const count = items.length + presets.length
  const empty = props.query.trim()
    ? t('plugins.catalogNoMatch')
    : section.id === 'user' ? t('plugins.catalogUserEmpty') : t('plugins.catalogEmpty')
  return <section className="plugins-catalog-section" data-testid={`plugins-catalog-${section.id}`}>
    <Flex className="plugins-catalog-head" align="baseline" justify="between" gap="3">
      <Heading as="h2" size="3" className="plugins-catalog-title">{catalogSectionLabel(section.id)}</Heading>
      <Text size="1" color="gray" className="plugins-catalog-count">{count}</Text>
    </Flex>
    {items.length
      ? <ul className="plugins-catalog-rows">{items.map((card) => <CatalogRow key={card.key} card={card}
        pending={props.pending === card.key} configurable={props.configKeys.includes(card.key)}
        onToggle={props.onToggle} onConfigure={props.onConfigure} onDetail={props.onDetail} />)}</ul>
      : null}
    {presets.length
      ? <div className="plugins-catalog-subsection">
        <Heading as="h3" size="2" className="plugins-catalog-subsection-title">{t('plugins.catalogPresets')}</Heading>
        <ul className="plugins-catalog-rows">{presets.map((preset) => <PresetRow key={preset.id} preset={preset}
          pending={props.presetPending === preset.id} onToggle={props.onTogglePreset} />)}</ul>
        <Text as="p" size="1" color="gray" className="plugins-catalog-hint">{t('plugins.catalogPresetHint')}</Text>
      </div>
      : null}
    {section.id === 'builtin' && props.presetError
      ? <Text as="p" size="1" color="red" role="alert" className="plugins-catalog-hint">{props.presetError}</Text>
      : null}
    {count ? null : <Text as="p" size="2" color="gray" className="plugins-catalog-empty">{empty}</Text>}
  </section>
}

export function PluginsCatalog(props: {
  status: CatalogStatus
  sections: readonly PluginCatalogSection[]
  error?: string
  query: string
  pending: string
  actionError: string
  /** Card keys whose row may offer the secondary 配置 control beside its switch. */
  configKeys?: readonly string[]
  presets?: readonly WritingPresetCard[]
  presetError?: string
  presetPending?: string
  restartRequired?: boolean
  onRetry?(): void
  onToggle(card: PluginCatalogCard, enabled: boolean): void
  onTogglePreset(preset: WritingPresetCard, enabled: boolean): void
  onConfigure(card: PluginCatalogCard): void
  onDetail(card: PluginCatalogCard): void
}) {
  const sections = useMemo(
    () => filterCatalogSections(props.sections, props.query),
    [props.sections, props.query],
  )
  const presets = useMemo(
    () => filterWritingPresets(props.presets ?? [], props.query),
    [props.presets, props.query],
  )
  const body: ReactNode = props.status === 'loading'
    ? <ActivityText className="plugins-catalog-loading">{t('plugins.catalogLoading')}</ActivityText>
    : props.status === 'error'
      ? <Callout.Root color="red" role="alert" className="warning pad" data-testid="plugins-catalog-error">
        <Callout.Text>{props.error || t('plugins.catalogError')}</Callout.Text>
        {props.onRetry
          ? <Button type="button" onClick={props.onRetry}>{t('common.retry')}</Button>
          : null}
      </Callout.Root>
      : <>
        {props.actionError
          ? <Callout.Root color="red" role="alert" className="warning pad" data-testid="plugins-catalog-action-error">
            <Callout.Text>{props.actionError}</Callout.Text>
          </Callout.Root>
          : null}
        {props.restartRequired
          ? <Text as="p" size="1" color="red" role="alert" className="plugins-catalog-hint">{t('plugins.catalogPresetRestart')}</Text>
          : null}
        {sections.map((section) => <CatalogSection key={section.id} section={section} presets={presets}
          query={props.query} pending={props.pending} presetPending={props.presetPending ?? ''}
          presetError={props.presetError ?? ''} restartRequired={props.restartRequired === true}
          configKeys={props.configKeys ?? []}
          onToggle={props.onToggle} onTogglePreset={props.onTogglePreset}
          onConfigure={props.onConfigure} onDetail={props.onDetail} />)}
      </>
  return <section className="plugins-catalog" data-testid="plugins-catalog">{body}</section>
}
