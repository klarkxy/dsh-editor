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

export type SettingsRenderSlot = (
  key: string,
  owner?: object,
  opts?: { only?: string; entryKey?: string },
) => ReactNode

import { officialSettingsStamp, projectOfficialSettingsSections, isLocaleSource, isSlotLedger, readService, type LocaleRevisionSource, type OfficialSettingsSection, type SlotLedger } from '../model/settings-plugins.ts'

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

export function PluginSettingsContent(props: { contribution?: ReactNode; fallback: ReactNode }) {
  return props.contribution == null ? props.fallback : <div data-dsh-plugin-surface="" style={{ display: 'contents' }}>{props.contribution}</div>
}
