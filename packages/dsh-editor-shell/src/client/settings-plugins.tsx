import {
  Component,
  Fragment,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Box, Button, Callout } from '@radix-ui/themes'
import { OFFICIAL_SETTINGS_SLOT } from '../root-registration.ts'
import { getLocale, subscribeLocale, t } from '../i18n/index.ts'

/**
 * Official `settings.section` pages. Nav is a live ledger projection
 * (`entries` / `getVersion` / `subscribe` + locale revision). Pages render
 * through the root-injected `renderSlot` so inject/hooks/context stay intact.
 *
 * Public registration metadata is `options.{id,order,label}` only. The
 * renderer may stamp `registrant` from `fiber.name` for crash logs; that is
 * the Cordis plugin export name, not a documented npm package id. Owner
 * package identity is therefore unknown — do not map ledger rows onto
 * PluginCard.packageName from ids or names.
 */

export const PLUGIN_SETTINGS_TAB_PREFIX = 'plugin:'

const HOST_SETTINGS_SECTION_IDS = new Set(['general', 'models', 'usage', 'plugins'])

export type SettingsRenderSlot = (
  key: string,
  owner?: object,
  opts?: { only?: string },
) => ReactNode

export type OfficialSettingsSection = {
  id: string
  order: number
  label: string
  navId: string
}

type SlotLedgerEntry = {
  options?: {
    id?: string
    order?: number
    label?: string | (() => string)
  }
}

type SlotLedger = {
  entries(key: string): readonly SlotLedgerEntry[]
  getVersion(key: string): number
  subscribe(key: string, listener: () => void): () => void
}

type LocaleRevisionSource = {
  getSnapshot(): { revision?: number }
  subscribe(listener: () => void): () => void
}

function isSlotLedger(value: unknown): value is SlotLedger {
  if (!value || typeof value !== 'object') return false
  const row = value as SlotLedger
  return typeof row.entries === 'function'
    && typeof row.getVersion === 'function'
    && typeof row.subscribe === 'function'
}

function isLocaleSource(value: unknown): value is LocaleRevisionSource {
  if (!value || typeof value !== 'object') return false
  const row = value as LocaleRevisionSource
  return typeof row.getSnapshot === 'function' && typeof row.subscribe === 'function'
}

function readService(ctx: unknown, name: string): unknown {
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

function resolveSlotLabel(label: unknown, fallback: string): string {
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

function projectOfficialSettingsSections(slots: SlotLedger | undefined): OfficialSettingsSection[] {
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

function officialSettingsStamp(slots: SlotLedger | undefined, locale: LocaleRevisionSource | undefined): string {
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

export function useOfficialSettingsSections(ctx: unknown): { sections: OfficialSettingsSection[]; version: number } {
  const slotsRaw = readService(ctx, 'slots')
  const localeRaw = readService(ctx, 'locale')
  const slots = isSlotLedger(slotsRaw) ? slotsRaw : undefined
  const locale = isLocaleSource(localeRaw) ? localeRaw : undefined
  const subscribe = useCallback((listener: () => void) => {
    const offSlots = slots?.subscribe(OFFICIAL_SETTINGS_SLOT, listener)
    const offLocale = locale?.subscribe(listener)
    const offShellLocale = subscribeLocale(listener)
    return () => {
      offSlots?.()
      offLocale?.()
      offShellLocale()
    }
  }, [slots, locale])
  const getSnapshot = useCallback(() => officialSettingsStamp(slots, locale), [slots, locale])
  const stamp = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => {
    const version = Number.parseInt(stamp.split(':')[0] ?? '0', 10)
    return {
      sections: projectOfficialSettingsSections(slots),
      version: Number.isFinite(version) ? version : 0,
    }
  }, [stamp, slots])
}

type BoundaryProps = { identity: string; children?: ReactNode }
type BoundaryState = { identity: string; error: string | null; nonce: number }

function shortError(message: string): string {
  const line = message.trim().split(/\r?\n/, 1)[0] ?? ''
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

class OfficialSettingsPageBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { identity: '', error: null, nonce: 0 }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.identity === state.identity) return null
    return { identity: props.identity, error: null }
  }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: shortError(error instanceof Error ? error.message : String(error)) }
  }

  render() {
    if (this.state.error) {
      return (
        <Callout.Root
          color="red"
          role="alert"
          className="warning pad"
          data-testid="settings-official-error">
          <Callout.Text>
            {this.state.error ? `页面无法显示。${this.state.error}` : '页面无法显示。'}
          </Callout.Text>
          <Button
            type="button"
            variant="soft"
            color="gray"
            data-testid="settings-official-retry"
            onClick={() => this.setState((current) => ({ error: null, nonce: current.nonce + 1 }))}>
            {t('common.retry')}
          </Button>
        </Callout.Root>
      );
    }
    return (
      <Box className="settings-official-page" data-testid="settings-official-page" data-dsh-plugin-surface="">
        <Fragment key={this.state.nonce}>
          {this.props.children}
        </Fragment>
      </Box>
    );
  }
}

function OfficialSettingsSlotOutlet(props: {
  renderSlot: SettingsRenderSlot
  sectionId: string
  sessionId?: string
  locale?: 'zh' | 'en'
  onClose(): void
}) {
  return props.renderSlot(OFFICIAL_SETTINGS_SLOT, { close: props.onClose, sessionId: props.sessionId, locale: props.locale }, { only: props.sectionId }) ?? null
}

export function OfficialSettingsSectionPage(props: {
  renderSlot: SettingsRenderSlot
  sectionId: string
  version: number
  sessionId?: string
  locale?: 'zh' | 'en'
  onClose(): void
}) {
  return (
    <OfficialSettingsPageBoundary identity={`${props.sectionId}:${props.version}`}>
      <OfficialSettingsSlotOutlet
        renderSlot={props.renderSlot}
        sectionId={props.sectionId}
        sessionId={props.sessionId}
        locale={props.locale}
        onClose={props.onClose} />
    </OfficialSettingsPageBoundary>
  );
}
