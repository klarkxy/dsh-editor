import {
  Component,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Box, Button, Callout, Heading } from '@radix-ui/themes'
import { getLocale, subscribeLocale, t } from '../i18n/index.ts'
import { ZHIHU_SETTINGS_SLOT } from '../root-registration.ts'
import type { SettingsScopeBinder } from './shared.ts'
import type { SettingsRenderSlot } from './settings-plugins.tsx'

const CONFIG_SLOTS = ['plugins.item', 'plugins.bundle.config', 'plugins.row.config'] as const
const TRACKED_SLOTS = [ZHIHU_SETTINGS_SLOT, ...CONFIG_SLOTS] as const
type ConfigSlot = typeof CONFIG_SLOTS[number]

/** Display names for adopted bundles that publish no label. Routing keeps the package key. */
const BUNDLE_FALLBACK_LABELS: Record<string, { zh: string; en: string }> = {
  '@deepseek-ai/dsh-experimental-voice-input-bundle': { zh: '语音输入', en: 'Voice input' },
  '@klarkxy/dsh-memory': { zh: '记忆', en: 'Memory' },
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
type SlotLedger = {
  entries(key: string): readonly LedgerEntry[]
  getVersion(key: string): number
  subscribe(key: string, listener: () => void): () => void
}
type LocaleSource = {
  getSnapshot(): { revision?: number }
  subscribe(listener: () => void): () => void
}
type ConfigurationContext = { configForms: SettingsScopeBinder }

function readService(ctx: unknown, name: string): unknown {
  if (!ctx || typeof ctx !== 'object') return undefined
  const record = ctx as Record<string, unknown> & { get?: (name: string) => unknown }
  try {
    if (record[name] !== undefined) return record[name]
  } catch { return undefined }
  try { return record.get?.(name) } catch { return undefined }
}

function asLedger(value: unknown): SlotLedger | undefined {
  if (!value || typeof value !== 'object') return undefined
  const ledger = value as SlotLedger
  return typeof ledger.entries === 'function' && typeof ledger.getVersion === 'function'
    && typeof ledger.subscribe === 'function' ? ledger : undefined
}

function asLocale(value: unknown): LocaleSource | undefined {
  if (!value || typeof value !== 'object') return undefined
  const locale = value as LocaleSource
  return typeof locale.getSnapshot === 'function' && typeof locale.subscribe === 'function'
    ? locale : undefined
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

/** Same route key the configuration nav keeps. Model center stays on its dedicated page. */
function officialRouteKey(slot: ConfigSlot, entry: LedgerEntry | undefined): string {
  const raw = slot === 'plugins.item' ? entry?.options?.id : entry?.options?.key
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (!key || (slot === 'plugins.bundle.config' && key === '@klarkxy/dsh-model-center')) return ''
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

function ledgerStamp(ledger: SlotLedger | undefined, locale: LocaleSource | undefined): string {
  try {
    return `${TRACKED_SLOTS.map((slot) => ledger?.getVersion(slot) ?? 0).join(':')}:${locale?.getSnapshot().revision ?? 0}:${getLocale()}`
  } catch { return `0:0:0:0:0:${getLocale()}` }
}

function stampVersion(stamp: string): number {
  let value = 2166136261
  for (let index = 0; index < stamp.length; index++) {
    value = Math.imul(value ^ stamp.charCodeAt(index), 16777619)
  }
  return value >>> 0
}

export function usePluginConfigurations(ctx: unknown): { entries: PluginConfigurationEntry[]; version: number; legacyZhihu: boolean } {
  const ledger = asLedger(readService(ctx, 'slots'))
  const locale = asLocale(readService(ctx, 'locale'))
  const subscribe = useCallback((listener: () => void) => {
    const offs = TRACKED_SLOTS.map((slot) => ledger?.subscribe(slot, listener))
    const offLocale = locale?.subscribe(listener)
    const offShellLocale = subscribeLocale(listener)
    return () => {
      for (const off of offs) off?.()
      offLocale?.()
      offShellLocale()
    }
  }, [ledger, locale])
  const getSnapshot = useCallback(() => ledgerStamp(ledger, locale), [ledger, locale])
  const stamp = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => ({
    entries: projectPluginConfigurations(ledger),
    legacyZhihu: legacyZhihuVisible(ledger),
    version: stampVersion(stamp),
  }), [ledger, stamp])
}

type PageProps = {
  ctx: ConfigurationContext
  renderSlot: SettingsRenderSlot
  entry: PluginConfigurationEntry
  version: number
  locale: 'zh' | 'en'
  onClose(): void
}

type BoundaryState = { identity: string; error: string | null; nonce: number }

class ConfigurationBoundary extends Component<{ identity: string; children: ReactNode }, BoundaryState> {
  state: BoundaryState = { identity: '', error: null, nonce: 0 }

  static getDerivedStateFromProps(props: { identity: string }, state: BoundaryState): Partial<BoundaryState> | null {
    return props.identity === state.identity ? null : { identity: props.identity, error: null }
  }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    const message = error instanceof Error ? error.message : String(error)
    return { error: (message.trim().split(/\r?\n/, 1)[0] ?? '').slice(0, 200) }
  }

  render() {
    if (this.state.error !== null) return (
      <Callout.Root color="red" role="alert" className="warning pad" data-testid="plugin-configuration-error">
        <Callout.Text>{this.state.error}</Callout.Text>
        <Button type="button" variant="soft" color="gray" data-testid="plugin-configuration-retry"
          onClick={() => this.setState((state) => ({ error: null, nonce: state.nonce + 1 }))}>
          {t('common.retry')}
        </Button>
      </Callout.Root>
    )
    return <Fragment key={this.state.nonce}>{this.props.children}</Fragment>
  }
}

function renderConfiguration(props: PageProps, form?: object): ReactNode {
  const selected = props.entry.slot === 'plugins.item' ? props.entry.namespace : props.entry.entryKey
  if (!selected) return null
  const owner = { view: 'page' as const, ...(form ? { form } : {}), close: props.onClose, locale: props.locale }
  const opts = props.entry.slot === 'plugins.item'
    ? { only: selected }
    : { entryKey: selected }
  return props.renderSlot(props.entry.slot, owner, opts) ?? null
}

function FormConfiguration(props: PageProps & { namespace: string }) {
  const form = useMemo(() => props.ctx.configForms.get<Record<string, unknown>>(props.namespace), [props.ctx, props.namespace])
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return <>{renderConfiguration(props, { state, mutate: form.mutate.bind(form) })}</>
}

function ConfigurationOutlet(props: PageProps) {
  const describe = useMemo(() => props.ctx.configForms.describe(), [props.ctx])
  const subscribe = useCallback((listener: () => void) => describe.subscribe(listener), [describe])
  const getSnapshot = useCallback(() => describe.getSnapshot(), [describe])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => { void describe.ensure().catch(() => { /* The Host snapshot carries the failure. */ }) }, [describe])
  const namespace = props.entry.namespace
  const hasForm = namespace !== undefined && snapshot.view?.namespaces.some((item) => item.ns === namespace)
  return hasForm && namespace
    ? <FormConfiguration {...props} namespace={namespace} />
    : <>{renderConfiguration(props)}</>
}

export function PluginConfigurationPage(props: PageProps) {
  return <Box className="plugin-configuration-page" data-testid="plugin-configuration-page">
    <Heading as="h2" size="4" className="plugin-configuration-title">{props.entry.label}</Heading>
    <Box data-dsh-plugin-surface="">
      <ConfigurationBoundary identity={`${props.entry.id}:${props.version}`}>
        <ConfigurationOutlet {...props} />
      </ConfigurationBoundary>
    </Box>
  </Box>
}
