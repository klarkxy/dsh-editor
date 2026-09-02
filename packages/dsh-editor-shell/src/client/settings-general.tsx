import { createElement as e, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ShellContext } from './shared.ts'
import { Select } from './select.tsx'

/*
 * 通用设置页:语言 / 外观 / 繁忙时 Enter 行为,与上游 dsh-client-ui-settings-general
 * 的偏好写同一个 settings namespace,宿主其它模块(主题、会话 composer)照常生效。
 */

type ThemePreference = 'light' | 'dark' | 'system'
type LocalePreference = 'zh' | 'en'
type BusyEnterBehavior = 'queue' | 'steer'

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
  return e('div', { className: 'settings-row' },
    e('div', { className: 'settings-row-text' },
      e('span', { className: 'settings-row-title' }, props.title),
      props.description ? e('small', { className: 'settings-row-description' }, props.description) : null,
    ),
    props.children,
  )
}

export function SettingsGeneralSection(props: { ctx: ShellContext }) {
  const scopes = useMemo(() => ({
    theme: props.ctx.settingsScope.bind({ namespace: 'ui-theme', decode: decodeThemePreference }),
    locale: props.ctx.settingsScope.bind({ namespace: 'locale', decode: decodeLocalePreference }),
    conversation: props.ctx.settingsScope.bind({ namespace: 'ui-conversation', decode: decodeBusyEnter }),
  }), [props.ctx])

  const [theme, setTheme] = usePreference(scopes.theme, 'system')
  const [locale, setLocale] = usePreference(scopes.locale, 'zh')
  const [busyEnter, setBusyEnter] = useBusyEnter(scopes.conversation)

  const appearanceOptions: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
    { value: 'system', label: '跟随系统' },
  ]

  return e('section', { className: 'settings-general', 'aria-label': '通用设置' },
    e(Row, { title: '语言', children: e(Select, {
      value: locale,
      options: [{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }],
      onChange: (value) => setLocale(value as LocalePreference),
      'aria-label': '语言',
    }) }),
    e(Row, { title: '外观', children: e('div', { className: 'settings-segmented', role: 'group', 'aria-label': '外观' },
      appearanceOptions.map((option) => e('button', {
        key: option.value,
        type: 'button',
        className: theme === option.value ? 'active' : '',
        'aria-pressed': theme === option.value,
        onClick: () => setTheme(option.value),
      }, option.label)),
    ) }),
    e(Row, { title: '繁忙时 Enter 键行为', description: '仅在智能体运行时生效；Cmd/Ctrl+Enter 使用另一行为', children: e(Select, {
      value: busyEnter,
      options: [{ value: 'queue', label: '排队发送' }, { value: 'steer', label: '插话发送' }],
      onChange: (value) => setBusyEnter(value as BusyEnterBehavior),
      'aria-label': '繁忙时 Enter 键行为',
    }) }),
  )
}

function useBusyEnter(scope: SettingsScope<{ busyEnter: BusyEnterBehavior }>): [BusyEnterBehavior, (value: BusyEnterBehavior) => void] {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const value = snapshot.status === 'ready' && snapshot.value ? snapshot.value.busyEnter : 'queue'
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const set = (next: BusyEnterBehavior) => { if (writable) void scope.set('busyEnter', next).catch(() => { /* 同上 */ }) }
  return [value, set]
}
