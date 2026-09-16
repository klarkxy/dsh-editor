import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { SettingsScope } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { Select } from './select.tsx'
import { ACCENT_VALUES, useAccent, type AccentValue } from './theme.tsx'
import { setLocale, t, useLocale, type Locale, type MessageKey } from '../i18n/index.ts'
import {
  DEVELOPER_SETTINGS_NAMESPACE,
  decodeDeveloperSettings,
  type DeveloperSettings,
} from '../developer-settings.ts'

/*
 * 通用设置页:语言 / 外观 / 繁忙时 Enter 行为,与上游 dsh-client-ui-settings-general
 * 的偏好写同一个 settings namespace,宿主其它模块(主题、会话 composer)照常生效。
 */

type ThemePreference = 'light' | 'dark' | 'system'
type LocalePreference = Locale
type BusyEnterBehavior = 'queue' | 'steer'

const ACCENT_LABEL_KEYS: Record<AccentValue, MessageKey> = {
  indigo: 'settings.accent.indigo',
  pine: 'settings.accent.pine',
  ochre: 'settings.accent.ochre',
  violet: 'settings.accent.violet',
}

function decodePreference<T extends string>(values: readonly T[]) {
  return (value: unknown): { preference: T } | undefined => {
    const preference = (value as { preference?: unknown } | null | undefined)?.preference
    return typeof preference === 'string' && values.includes(preference as T) ? { preference: preference as T } : undefined
  }
}

export const decodeThemePreference = decodePreference<ThemePreference>(['light', 'dark', 'system'])
export const decodeLocalePreference = decodePreference<LocalePreference>(['zh', 'en'])

export function decodeBusyEnter(value: unknown): { busyEnter: BusyEnterBehavior } | undefined {
  const busyEnter = (value as { busyEnter?: unknown } | null | undefined)?.busyEnter
  return busyEnter === 'queue' || busyEnter === 'steer' ? { busyEnter } : undefined
}

function usePreference<T>(scope: SettingsScope<{ preference: T }>, fallback: T): [T, (value: T) => void] {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const value = snapshot.status === 'ready' && snapshot.value ? snapshot.value.preference : fallback
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const set = (next: T) => { if (writable) void scope.set('preference', next).catch(() => { /* 宿主拒绝时快照会回弹 */ }) }
  return [value, set]
}

function Row(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-title">
          {props.title}
        </span>
        {props.description ? <small className="settings-row-description">
          {props.description}
        </small> : null}
      </div>
      {props.children}
    </div>
  );
}

export function SettingsGeneralSection(props: { ctx: ShellContext }) {
  const scopes = useMemo(() => ({
    theme: props.ctx.settingsScope.bind({ namespace: 'ui-theme', decode: decodeThemePreference }),
    conversation: props.ctx.settingsScope.bind({ namespace: 'ui-conversation', decode: decodeBusyEnter }),
    developer: props.ctx.settingsScope.bind({ namespace: DEVELOPER_SETTINGS_NAMESPACE, decode: decodeDeveloperSettings }),
  }), [props.ctx])

  const [theme, setTheme] = usePreference(scopes.theme, 'system')
  const [accent, setAccent] = useAccent()
  const locale = useLocale()
  const [busyEnter, setBusyEnter] = useBusyEnter(scopes.conversation)
  const [developerMode, setDeveloperMode] = useDeveloperMode(scopes.developer)

  const appearanceOptions: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
    { value: 'system', label: t('settings.themeSystem') },
  ]

  return (
    <section className="settings-general" aria-label={t('settings.general')}>
      <section className="settings-block">
        <header className="settings-block-head">
          <h3 className="settings-block-title">
            {t('settings.interface')}
          </h3>
        </header>
        <Row
          title={t('settings.language')}
          children={<Select
            value={locale}
            options={[{ value: 'zh', label: t('settings.chinese') }, { value: 'en', label: t('settings.english') }]}
            onChange={(value) => setLocale(value as Locale)}
            aria-label={t('settings.language')} />} />
        <Row
          title={t('settings.appearance')}
          children={<div
            className="settings-segmented"
            role="group"
            aria-label={t('settings.appearance')}>
            {appearanceOptions.map((option) => <button
              key={option.value}
              type="button"
              className={theme === option.value ? 'active' : ''}
              aria-pressed={theme === option.value}
              onClick={() => setTheme(option.value)}>
              {option.label}
            </button>)}
          </div>} />
        <Row
          title={t('settings.accent')}
          children={<div
            className="settings-swatches"
            role="group"
            aria-label={t('settings.accent')}>
            {ACCENT_VALUES.map((value) => <button
              key={value}
              type="button"
              className={accent === value ? 'accent-swatch active' : 'accent-swatch'}
              data-swatch={value}
              title={t(ACCENT_LABEL_KEYS[value])}
              aria-label={t(ACCENT_LABEL_KEYS[value])}
              aria-pressed={accent === value}
              onClick={() => setAccent(value)} />)}
          </div>} />
        <Row
          title={t('settings.busyEnter')}
          children={<Select
            value={busyEnter}
            options={[{ value: 'queue', label: t('settings.busyQueue') }, { value: 'steer', label: t('settings.busySteer') }]}
            onChange={(value) => setBusyEnter(value as BusyEnterBehavior)}
            aria-label={t('settings.busyEnter')} />} />
      </section>
      <section className="settings-block">
        <header className="settings-block-head">
          <h3 className="settings-block-title">
            {t('settings.developer')}
          </h3>
        </header>
        <Row
          title={t('settings.developerMode')}
          description={t('settings.developerModeHint')}
          children={<button
            type="button"
            role="switch"
            className="settings-switch"
            aria-checked={developerMode}
            aria-label={t('settings.developerMode')}
            onClick={() => setDeveloperMode(!developerMode)}>
            {<span className="settings-switch-knob" aria-hidden={true} />}
          </button>} />
      </section>
    </section>
  );
}

function useDeveloperMode(scope: SettingsScope<DeveloperSettings>): [boolean, (value: boolean) => void] {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const value = snapshot.status === 'ready' && snapshot.value ? snapshot.value.developerMode : false
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const set = (next: boolean) => { if (writable) void scope.set('developerMode', next).catch(() => { /* 同上 */ }) }
  return [value, set]
}

function useBusyEnter(scope: SettingsScope<{ busyEnter: BusyEnterBehavior }>): [BusyEnterBehavior, (value: BusyEnterBehavior) => void] {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const value = snapshot.status === 'ready' && snapshot.value ? snapshot.value.busyEnter : 'queue'
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const set = (next: BusyEnterBehavior) => { if (writable) void scope.set('busyEnter', next).catch(() => { /* 同上 */ }) }
  return [value, set]
}
