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
import {
  CONFIG_SLOTS,
  legacyZhihuVisible,
  projectPluginConfigurations,
  type PluginConfigurationEntry,
  type SlotLedger,
} from '../model/plugin-configurations.ts'

const TRACKED_SLOTS = [ZHIHU_SETTINGS_SLOT, ...CONFIG_SLOTS] as const

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
