import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Callout, Card, Flex, Heading, Separator, Text } from '@radix-ui/themes'
import type { SettingsScope } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { Select } from './select.tsx'
import { ConfirmDialog } from './dialogs.tsx'
import { Switch, SegmentedControl } from '../ui/index.ts'
import { setLocale, t, useLocale, type Locale } from '../i18n/index.ts'
import {
  DEVELOPER_SETTINGS_NAMESPACE,
  decodeDeveloperSettings,
  type DeveloperSettings,
} from '../developer-settings.ts'
import {
  LIMIT_BREAK_SETTINGS_NAMESPACE,
  decodeLimitBreakSettings,
  type LimitBreakSettings,
} from '../limit-break-settings.ts'

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

function Row(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <Flex className="settings-row" align="center" justify="between" gap="4" py="3">
      <Flex direction="column" className="settings-row-text" gap="1" minWidth="0">
        <Text size="2" weight="medium" className="settings-row-title">
          {props.title}
        </Text>
        {props.description ? <Text size="1" color="gray" className="settings-row-description">
          {props.description}
        </Text> : null}
      </Flex>
      {props.children}
    </Flex>
  );
}

export function SettingsBlock(props: { label: string; children: ReactNode }) {
  return <Card className="settings-block">
    <header className="settings-block-head">
      <Heading as="h3" size="3" className="settings-block-title">
        {props.label}
      </Heading>
    </header>
    {props.children}
  </Card>
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
        <Separator size="4" />
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

/** 高级分区:审阅豁免（破限模式）+ 开发者选项。开关整行可点,确认流程不变。 */
export function AdvancedSection(props: {
  ctx: ShellContext
  showDeveloperMode?: boolean
  onRevealDeveloper?(): void
}) {
  const scopes = useMemo(() => ({
    developer: props.ctx.configForms.get<NonNullable<ReturnType<typeof decodeDeveloperSettings>>>(DEVELOPER_SETTINGS_NAMESPACE),
    limitBreak: props.ctx.configForms.get<NonNullable<ReturnType<typeof decodeLimitBreakSettings>>>(LIMIT_BREAK_SETTINGS_NAMESPACE),
  }), [props.ctx])

  const [developerMode, setDeveloperMode, developerWritable] = useDeveloperMode(scopes.developer)
  const [limitBreakMode, setLimitBreakMode, limitBreakWritable] = useLimitBreakMode(scopes.limitBreak)
  const [limitBreakConfirm, setLimitBreakConfirm] = useState(false)
  const showDeveloperMode = props.showDeveloperMode === true
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
        <Callout.Root className="warning" color="red" role="alert" size="1" mt="2">
          <Callout.Text>
            {t('settings.limitBreakWarning')}
          </Callout.Text>
        </Callout.Root>
      </SettingsBlock>
      {showDeveloperMode ? <SettingsBlock label={t('settings.developer')}>
        <Switch
          id="settings-developer-mode"
          label={t('settings.developerMode')}
          description={t('settings.developerModeHint')}
          checked={developerMode}
          disabled={!developerWritable}
          onCheckedChange={setDeveloperMode} />
      </SettingsBlock> : props.onRevealDeveloper ? <SettingsBlock label={t('settings.developer')}>
        <Button
          type="button"
          variant="ghost"
          color="gray"
          size="1"
          className="settings-reveal-developer"
          onClick={props.onRevealDeveloper}>
          {t('settings.showDeveloper')}
        </Button>
      </SettingsBlock> : null}
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

export function useDeveloperMode(scope: SettingsScope<DeveloperSettings>): [boolean, (value: boolean) => void, boolean] {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const value = snapshot.status === 'ready' && snapshot.value ? snapshot.value.developerMode : false
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const set = (next: boolean) => { if (writable) void scope.set('developerMode', next).catch(() => { /* 同上 */ }) }
  return [value, set, writable]
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
