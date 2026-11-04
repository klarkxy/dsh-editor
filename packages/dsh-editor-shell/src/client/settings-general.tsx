import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Notice } from '../ui/index.ts'
import { SettingRow as Row, SettingsGroup } from './settings-layout.tsx'
import type { SettingsScope } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { Select } from './select.tsx'
import { ConfirmDialog } from './dialogs.tsx'
import { Switch, SegmentedControl } from '../ui/index.ts'
import { setLocale, t, useLocale, type Locale } from '../i18n/index.ts'
import {
  LIMIT_BREAK_SETTINGS_NAMESPACE,
  decodeLimitBreakSettings,
  type LimitBreakSettings,
} from '../limit-break-settings.ts'
import { BOT_SETTINGS_NAMESPACE, decodeBotSettings, type BotSettings } from '../bot-settings.ts'
import { botSettingsError, cacheTtlLabel, cacheTtlOptionMinutes } from '../model/bot-conversation.ts'
import { Input, Text } from '../ui/index.ts'

/*
 * 外观与语言 / 助手 / 高级三段分区:语言、外观与繁忙时 Enter 行为写上游
 * ui-theme / ui-conversation 两个 settings namespace;破限模式是高级分区里
 * 独立的卡片——常驻封号风险声明,从关到开必须过一次确认框。
 */

type ThemePreference = 'light' | 'dark' | 'system'
type LocalePreference = Locale
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

function usePreference<T>(scope: SettingsScope<{ preference: T }>, fallback: T): [T, (value: T) => void, boolean] {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const value = snapshot.status === 'ready' && snapshot.value ? snapshot.value.preference : fallback
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const set = (next: T) => { if (writable) void scope.set('preference', next).catch(() => { /* 宿主拒绝时快照会回弹 */ }) }
  return [value, set, writable]
}

export function SettingsBlock(props: { label: string; children: ReactNode }) {
  return <SettingsGroup title={props.label}>{props.children}</SettingsGroup>
}

/** 外观与语言分区:语言 + 主题（ui-theme namespace,写契约不变）。 */
export function AppearanceSection(props: { ctx: ShellContext }) {
  const scope = useMemo(
    () => props.ctx.configForms.get<NonNullable<ReturnType<typeof decodeThemePreference>>>('ui-theme'),
    [props.ctx],
  )
  const [theme, setTheme, themeWritable] = usePreference(scope, 'system')
  const locale = useLocale()
  const appearanceOptions: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
    { value: 'system', label: t('settings.themeSystem') },
  ]
  return (
    <section className="settings-general" aria-label={t('settings.appearanceTitle')}>
      <SettingsBlock label={t('settings.interface')}>
        <Row
          title={t('settings.language')}
          children={<Select
            value={locale}
            options={[{ value: 'zh', label: t('settings.chinese') }, { value: 'en', label: t('settings.english') }]}
            onChange={(value) => setLocale(value as Locale)}
            aria-label={t('settings.language')} />} />
        <Row
          title={t('settings.appearance')}
          children={<SegmentedControl
            aria-label={t('settings.appearance')}
            value={theme}
            options={appearanceOptions}
            disabled={!themeWritable}
            onValueChange={(value) => setTheme(value as ThemePreference)} />} />
      </SettingsBlock>
    </section>
  );
}

/** 助手分区里的一行:搭档忙碌时按 Enter 的发送方式（ui-conversation namespace）。 */
export function AssistantBusyEnterRow(props: { ctx: ShellContext }) {
  const scope = useMemo(
    () => props.ctx.configForms.get<NonNullable<ReturnType<typeof decodeBusyEnter>>>('ui-conversation'),
    [props.ctx],
  )
  const [busyEnter, setBusyEnter, writable] = useBusyEnter(scope)
  return (
    <Row
      title={t('settings.busyEnterTitle')}
      description={t('settings.busyEnterHint')}
      children={<Select
        value={busyEnter}
        disabled={!writable}
        options={[{ value: 'queue', label: t('settings.busyQueue') }, { value: 'steer', label: t('settings.busySteer') }]}
        onChange={(value) => setBusyEnter(value as BusyEnterBehavior)}
        aria-label={t('settings.busyEnterTitle')} />} />
  );
}

function useBotSetting<K extends keyof BotSettings>(scope: SettingsScope<BotSettings>, key: K): [BotSettings[K], (value: BotSettings[K]) => void, boolean] {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const value = (snapshot.status === 'ready' && snapshot.value ? decodeBotSettings(snapshot.value) : decodeBotSettings(undefined))[key]
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const set = (next: BotSettings[K]) => { if (writable) void scope.set(key, next).catch(() => { /* 写入失败保持现值 */ }) }
  return [value, set, writable]
}

/** 助手分区:对话整理（ui-bot namespace）——闲置回顾时间与缓存有效期。 */
export function AssistantBotBlock(props: { ctx: ShellContext }) {
  const scope = useMemo(
    () => props.ctx.configForms.get<BotSettings>(BOT_SETTINGS_NAMESPACE),
    [props.ctx],
  )
  const [idle, setIdle, writable] = useBotSetting(scope, 'idleRecapMinutes')
  const [ttl, setTtl] = useBotSetting(scope, 'cacheTtlMinutes')
  /* 草稿值与已保存值分离：输入未提交时验证错误也要立即可见，不只是提交后才报。 */
  const [idleDraft, setIdleDraft] = useState<string | undefined>()
  const draftMinutes = idleDraft === undefined ? idle : Math.round(Number(idleDraft))
  const draftValid = idleDraft === undefined || (Number.isFinite(draftMinutes) && draftMinutes >= 1 && draftMinutes <= 240)
  const ttlError = draftValid ? botSettingsError(draftMinutes, ttl) : 'idle-too-long' as const
  const commitIdle = (raw: string) => {
    setIdleDraft(undefined)
    const next = Math.round(Number(raw))
    if (!Number.isFinite(next) || next < 1 || next > 240) return
    if (botSettingsError(next, ttl)) return
    setIdle(next)
  }
  return (
    <SettingsBlock label={t('settings.botTitle')}>
      <Row
        title={t('settings.botIdleMinutes')}
        description={t('settings.botIdleHint')}
        children={<Input
          type="number" min={1} max={240} step={1} size="sm"
          value={idleDraft ?? String(idle)}
          invalid={Boolean(ttlError)}
          disabled={!writable}
          aria-label={t('settings.botIdleMinutes')}
          aria-invalid={Boolean(ttlError) || undefined}
          aria-describedby={ttlError ? 'bot-idle-error' : undefined}
          onChange={(raw) => setIdleDraft(raw)}
          onBlur={(event: React.FocusEvent<HTMLInputElement>) => commitIdle(event.currentTarget.value)}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') commitIdle(event.currentTarget.value) }} />} />
      <Row
        title={t('settings.botCacheTtl')}
        description={t('settings.botCacheTtlHint')}
        children={<Select
          value={String(ttl)}
          disabled={!writable}
          options={cacheTtlOptionMinutes().map((minutes) => ({ value: String(minutes), label: cacheTtlLabel(minutes, t) }))}
          onChange={(value) => setTtl(Number(value) as BotSettings['cacheTtlMinutes'])}
          aria-label={t('settings.botCacheTtl')} />} />
      {ttlError ? <Text id="bot-idle-error" className="settings-error" role="alert">{t('settings.botIdleTooLong')}</Text> : null}
    </SettingsBlock>
  );
}

/** 高级分区:审阅豁免（破限模式）。开关整行可点,确认流程不变。 */
export function AdvancedSection(props: {
  ctx: ShellContext
}) {
  const scopes = useMemo(() => ({
    limitBreak: props.ctx.configForms.get<NonNullable<ReturnType<typeof decodeLimitBreakSettings>>>(LIMIT_BREAK_SETTINGS_NAMESPACE),
  }), [props.ctx])

  const [limitBreakMode, setLimitBreakMode, limitBreakWritable] = useLimitBreakMode(scopes.limitBreak)
  const [limitBreakConfirm, setLimitBreakConfirm] = useState(false)
  /* 关闭立即生效；开启要过确认框,避免误触把封号风险打开。 */
  const requestLimitBreak = (next: boolean) => {
    if (next) setLimitBreakConfirm(true)
    else setLimitBreakMode(false)
  }

  return (
    <section className="settings-general" aria-label={t('settings.advanced')}>
      <SettingsBlock label={t('settings.reviewExemption')}>
        <Switch
          id="settings-limit-break"
          label={t('settings.limitBreak')}
          description={t('settings.limitBreakModeHint')}
          checked={limitBreakMode}
          disabled={!limitBreakWritable}
          onCheckedChange={requestLimitBreak} />
        <Notice className="warning" tone="danger" mt="2">
          {t('settings.limitBreakWarning')}
        </Notice>
      </SettingsBlock>
      {limitBreakConfirm ? <ConfirmDialog
        id="limit-break"
        title={t('settings.limitBreakConfirmTitle')}
        message={t('settings.limitBreakConfirmBody')}
        confirmLabel={t('settings.limitBreakConfirmAction')}
        note={t('settings.limitBreakWarning')}
        onCancel={() => setLimitBreakConfirm(false)}
        onConfirm={() => { setLimitBreakConfirm(false); setLimitBreakMode(true) }} /> : null}
    </section>
  );
}


export function useLimitBreakMode(scope: SettingsScope<LimitBreakSettings>): [boolean, (value: boolean) => void, boolean] {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const value = snapshot.status === 'ready' && snapshot.value ? snapshot.value.limitBreakMode : false
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const set = (next: boolean) => { if (writable) void scope.set('limitBreakMode', next).catch(() => { /* 同上 */ }) }
  return [value, set, writable]
}

function useBusyEnter(scope: SettingsScope<{ busyEnter: BusyEnterBehavior }>): [BusyEnterBehavior, (value: BusyEnterBehavior) => void, boolean] {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const value = snapshot.status === 'ready' && snapshot.value ? snapshot.value.busyEnter : 'queue'
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const set = (next: BusyEnterBehavior) => { if (writable) void scope.set('busyEnter', next).catch(() => { /* 同上 */ }) }
  return [value, set, writable]
}
