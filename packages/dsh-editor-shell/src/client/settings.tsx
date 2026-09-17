import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Callout, Flex, Heading, IconButton, Text } from '@radix-ui/themes'
import type { SettingsScope } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { WritingSettings } from '../writing-settings.tsx'
import type { WritingMigration, WritingPreferences } from '../writing-settings.tsx'
import { AboutSettingsSection } from './settings-about.tsx'
import { SettingsGeneralSection, useDeveloperMode } from './settings-general.tsx'
import { authorSettingsChrome, DEVELOPER_SETTINGS_NAMESPACE, decodeDeveloperSettings } from '../developer-settings.ts'
import { SettingsModelsSection } from './settings-models.tsx'
import {
  OfficialSettingsSectionPage,
  PLUGIN_SETTINGS_TAB_PREFIX,
  isPluginSettingsTab,
  useOfficialSettingsSections,
  type OfficialSettingsSection,
  type SettingsRenderSlot,
} from './settings-plugins.tsx'
import { SettingsUsageSection } from './settings-usage.tsx'
import { t, useLocale } from '../i18n/index.ts'
import { SettingsIcon } from './icons.tsx'
import { Button, Dialog, Tabs, TabsContent, TabsList, TabsTrigger, m } from './ui/index.ts'
import { useReducedMotion } from 'motion/react'

export type { SettingsRenderSlot }

export type SettingsTab = 'general' | 'models' | 'writing' | 'usage' | 'zhihu' | 'plugins' | 'about'

const SETTINGS_TAB_KEY = 'dsh-editor.settings.tab'
const SETTINGS_TABS: SettingsTab[] = ['general', 'models', 'writing', 'usage', 'zhihu', 'plugins', 'about']

function readStoredTab(): string {
  try {
    const value = globalThis.localStorage?.getItem(SETTINGS_TAB_KEY)
    if (value && (SETTINGS_TABS as string[]).includes(value)) return value
    if (value && isPluginSettingsTab(value)) return value
  } catch { /* optional preference */ }
  return 'general'
}

function persistTab(tab: string): void {
  try { globalThis.localStorage?.setItem(SETTINGS_TAB_KEY, tab) } catch { /* optional preference */ }
}

function SettingsTabPage(props: { tab: string; active: boolean; fromX?: number; children?: ReactNode }) {
  const reduce = useReducedMotion()
  /* 隐藏位姿保持方向中性(x:0):否则反向切回时会从上次留下的旧偏移滑入。
     方向只由入场 keyframes 携带——每次 activate,animate 从隐藏位姿变成新的
     keyframes,Motion 从 keyframes[0](本次切换方向)重新开始,不重挂、不丢 state。 */
  const enter = reduce
    ? { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }
    : { x: [props.fromX ?? 24, 0], opacity: [0, 1], y: [14, 0], filter: ['blur(4px)', 'blur(0px)'] }
  const pose = reduce
    ? { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }
    : props.active
      ? enter
      : { opacity: 0, x: 0, y: 12, filter: 'blur(3px)' }
  return (
    <TabsContent
      value={props.tab}
      forceMount={true}
      hidden={!props.active}
      className={`settings-content${props.active ? ' is-active' : ''}`}
      style={{ pointerEvents: props.active ? 'auto' : 'none' }}>
      <m.div
        className="settings-page"
        initial={false}
        animate={pose}
        transition={reduce ? { duration: 0 } : {
          type: 'spring' as const, stiffness: 340, damping: 26, mass: 0.85,
          /* blur 不走弹簧：keyframes + 欠阻尼 spring 过冲会把 filter 插成负数。 */
          filter: { type: 'tween' as const, duration: 0.45, ease: 'easeOut' },
        }}
        style={{ pointerEvents: props.active ? 'auto' : 'none' }}>
        {props.children}
      </m.div>
    </TabsContent>
  );
}

function tabLabel(tab: SettingsTab): string {
  if (tab === 'general') return t('settings.general')
  if (tab === 'models') return t('settings.models')
  if (tab === 'writing') return t('settings.writing')
  if (tab === 'plugins') return t('settings.plugins')
  if (tab === 'zhihu') return t('settings.zhihu')
  if (tab === 'about') return t('settings.about')
  return t('settings.usage')
}

function navLabel(tab: string, sections: readonly OfficialSettingsSection[]): string {
  if ((SETTINGS_TABS as string[]).includes(tab)) return tabLabel(tab as SettingsTab)
  return sections.find((section) => section.navId === tab)?.label ?? tab.slice(PLUGIN_SETTINGS_TAB_PREFIX.length)
}

/** 顶栏设置入口。保留 .native-settings-control 包裹和 aria-haspopup 约定（e2e 依赖）。 */
export function SettingsTrigger(props: { onOpen(): void }) {
  useLocale()
  return (
    <span className="native-settings-control">
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        size="2"
        className="settings-trigger"
        aria-haspopup="dialog"
        aria-label={t('common.settings')}
        title={t('common.settings')}
        onClick={props.onOpen}>
        <span className="settings-trigger-icon" aria-hidden={true}>
          <SettingsIcon size={16} />
        </span>
      </IconButton>
    </span>
  );
}

export function SettingsDialog(props: {
  ctx: ShellContext
  writingScope: SettingsScope<WritingPreferences>
  migrateWriting: WritingMigration
  /* 助手能力开关：false 时隐藏模型等助手专属设置；undefined 表示能力尚未加载，保持原样。 */
  assistant?: boolean
  pluginsTab?: ReactNode
  zhihuTab?: ReactNode
  renderSlot?: SettingsRenderSlot
  open?: boolean
  focusTab?: SettingsTab
  onClose(): void
}) {
  useLocale()
  const open = props.open ?? true
  const [tab, setTab] = useState(readStoredTab)
  const [note, setNote] = useState('')
  const [aboutBusy, setAboutBusy] = useState(false)
  const [developerRevealed, setDeveloperRevealed] = useState(false)
  const developerScope = useMemo(() => props.ctx.settingsScope.bind({
    namespace: DEVELOPER_SETTINGS_NAMESPACE,
    decode: decodeDeveloperSettings,
  }), [props.ctx])
  const [developerMode] = useDeveloperMode(developerScope)
  const developerGate = developerRevealed || developerMode
  const authorChrome = authorSettingsChrome(developerGate)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const official = useOfficialSettingsSections(props.ctx)
  const officialSections = props.renderSlot ? official.sections : []
  useEffect(() => {
    if (!open) {
      setNote('')
      setAboutBusy(false)
      if (!developerMode) setDeveloperRevealed(false)
    }
  }, [open, developerMode])
  const selectTab = (next: string) => {
    setTab(next)
    persistTab(next)
  }
  useEffect(() => {
    if (!open || !props.focusTab) return
    if (!(SETTINGS_TABS as string[]).includes(props.focusTab)) return
    setTab(props.focusTab)
    persistTab(props.focusTab)
  }, [open, props.focusTab])

  const openConfigFile = async () => {
    setNote('')
    try {
      const response = await props.ctx.remote.settings.openSettingsDocument()
      if (!response.ok) setNote(t('settings.openConfigFailed', { error: response.error.message ?? '' }))
    } catch (error) {
      setNote(t('settings.openConfigFailed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const featureTabs: SettingsTab[] = props.assistant === false
    ? ['general', 'writing', 'usage', 'zhihu', 'plugins']
    : ['general', 'models', 'writing', 'usage', 'zhihu', 'plugins']
  const navTabs: string[] = [...featureTabs, ...officialSections.map((section) => section.navId), 'about']
  /* 能力在弹窗打开期间变为停用时，或动态插件页消失时，回落到仍可用的分类。 */
  const activeTab = navTabs.includes(tab) ? tab : 'general'
  /* 页面切换方向感:往列表下方切内容从右滑入,往上切从左滑入。 */
  const previousTabRef = useRef(activeTab)
  const fromX = navTabs.indexOf(activeTab) >= navTabs.indexOf(previousTabRef.current) ? 24 : -24
  previousTabRef.current = activeTab
  const activeOfficial = officialSections.find((section) => section.navId === activeTab)
  const builtinPages: SettingsTab[] = [...featureTabs, 'about']
  const content: Record<SettingsTab, () => ReactNode> = {
    general: () => <SettingsGeneralSection
      ctx={props.ctx}
      showDeveloperMode={authorChrome.showDeveloperMode}
      onRevealDeveloper={() => setDeveloperRevealed(true)} />,
    models: () => <SettingsModelsSection ctx={props.ctx} writingScope={props.writingScope} />,
    writing: () => <WritingSettings scope={props.writingScope} migrate={props.migrateWriting} />,
    usage: () => <SettingsUsageSection ctx={props.ctx} />,
    zhihu: () => props.zhihuTab ?? <Text size="2" color="gray" className="muted">
      {t('settings.zhihuUnavailable')}
    </Text>,
    plugins: () => props.pluginsTab ?? <Text size="2" color="gray" className="muted">
      {t('settings.pluginsUnavailable')}
    </Text>,
    about: () => <AboutSettingsSection active={activeTab === 'about'} onBusyChange={setAboutBusy} />,
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !aboutBusy) props.onClose() }}
      title={t('common.settings')}
      className="file-dialog settings-dialog"
      overlayClassName="file-dialog-overlay settings-overlay"
      dismissible={!aboutBusy}
      initialFocusRef={closeRef}>
      <Tabs
        value={activeTab}
        onValueChange={selectTab}
        orientation="vertical"
        className="settings-tabs">
        <aside className="settings-nav">
          <Heading as="h2" size="4" id="settings-dialog-title" mb="3">
            {t('common.settings')}
          </Heading>
          <TabsList aria-label={t('settings.nav')}>
            {navTabs.map((key) => <TabsTrigger
              key={key}
              value={key}
              className={`settings-tab${activeTab === key ? ' active' : ''}`}
              aria-current={activeTab === key}>
              {navLabel(key, officialSections)}
            </TabsTrigger>)}
          </TabsList>
        </aside>
        <Flex className="settings-body" direction="column" minWidth="0" minHeight="0" overflow="hidden">
          <Flex className="settings-header" align="center" gap="2" px="4" py="3" flexShrink="0">
            <Heading size="3" className="settings-header-title">
              {navLabel(activeTab, officialSections)}
            </Heading>
            <Flex align="center" gap="2" ml="auto">
              {authorChrome.showOpenConfig && props.ctx.connection.isLoopback ? <Button
                className="settings-open-config"
                onClick={() => void openConfigFile()}>
                {t('settings.openConfig')}
              </Button> : null}
              <Button
                ref={closeRef}
                variant="icon"
                className="icon-button settings-close"
                aria-label={t('settings.close')}
                disabled={aboutBusy}
                onClick={props.onClose}>
                ×
              </Button>
            </Flex>
          </Flex>
          {note ? <Callout.Root color="red" role="alert" className="warning pad">
            <Callout.Text>
              {note}
            </Callout.Text>
          </Callout.Root> : null}
          {/*
            .settings-pages 必须是真正的 overflow 容器：e2e 读这个节点的
            scrollTop / scrollHeight。Themes ScrollArea 把滚动放在内层 viewport,
            所以这里用 Box 而不是 ScrollArea。
          */}
          <Box className="settings-pages" tabIndex={0} overflow="auto" flexGrow="1" minWidth="0" minHeight="0">
            {builtinPages.map((key) => <SettingsTabPage key={key} tab={key} active={key === activeTab} fromX={fromX}>
              {content[key]()}
            </SettingsTabPage>)}
            {open && activeOfficial && props.renderSlot
              ? <SettingsTabPage
              key={activeOfficial.navId}
              tab={activeOfficial.navId}
              active={true}
              fromX={fromX}>
              <OfficialSettingsSectionPage
                renderSlot={props.renderSlot}
                sectionId={activeOfficial.id}
                version={official.version}
                onClose={props.onClose} />
            </SettingsTabPage>
              : null}
          </Box>
        </Flex>
      </Tabs>
    </Dialog>
  );
}
