import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Callout, Flex, Heading, IconButton, Text } from '@radix-ui/themes'
import type { SettingsScope } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { WritingSettings } from '../writing-settings.tsx'
import type { WritingMigration, WritingPreferences } from '../writing-settings.tsx'
import { ShortcutsSettings } from './settings-shortcuts.tsx'
import type { ShellCommandRegistry } from '../seats.ts'
import { AboutSettingsSection } from './settings-about.tsx'
import { AssistantSettings } from './settings-assistant.tsx'
import { SettingsGeneralSection, useDeveloperMode } from './settings-general.tsx'
import { authorSettingsChrome, DEVELOPER_SETTINGS_NAMESPACE, decodeDeveloperSettings } from '../developer-settings.ts'
import { SettingsChatModelRoute, SettingsModelsSection } from './settings-models.tsx'
import { ModelSettingsSurface } from './plugin-surfaces.tsx'
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
import { CrossIcon, SettingsIcon } from './icons.tsx'
import { Button, Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from './ui/index.ts'

export type { SettingsRenderSlot }

export type SettingsTab = 'general' | 'models' | 'assistant' | 'writing' | 'shortcuts' | 'usage' | 'zhihu' | 'plugins' | 'about'

const SETTINGS_TAB_KEY = 'dsh-editor.settings.tab'
const SETTINGS_TABS: SettingsTab[] = ['general', 'models', 'assistant', 'writing', 'shortcuts', 'usage', 'zhihu', 'plugins', 'about']
/** 侧栏末两项：插件管理与关于。官方插件设置页插在它们前面。 */
const SETTINGS_TRAILING_TABS: SettingsTab[] = ['plugins', 'about']

export function composeSettingsNavTabs(
  featureTabs: readonly SettingsTab[],
  official: readonly Pick<OfficialSettingsSection, 'navId'>[],
): string[] {
  return [...featureTabs, ...official.map((section) => section.navId), ...SETTINGS_TRAILING_TABS]
}

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

function SettingsTabPage(props: { tab: string; active: boolean; children?: ReactNode }) {
  return (
    <TabsContent value={props.tab} forceMount={true} hidden={!props.active}
      className={`settings-content${props.active ? ' is-active' : ''}`}>
      <div className="settings-page">{props.children}</div>
    </TabsContent>
  )
}

export function PluginSettingsContent(props: { contribution?: ReactNode; fallback: ReactNode }) {
  return props.contribution == null ? props.fallback : <div data-dsh-plugin-surface="" style={{ display: 'contents' }}>
    {props.contribution}
  </div>
}

function tabLabel(tab: SettingsTab): string {
  if (tab === 'general') return t('settings.general')
  if (tab === 'models') return t('settings.models')
  if (tab === 'assistant') return t('settings.assistant')
  if (tab === 'writing') return t('settings.writing')
  if (tab === 'shortcuts') return t('settings.shortcuts')
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
  sessionId?: string
  commands?: ShellCommandRegistry
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
  const locale = useLocale()
  const open = props.open ?? true
  const [tab, setTab] = useState(readStoredTab)
  const [note, setNote] = useState('')
  const [aboutBusy, setAboutBusy] = useState(false)
  const [developerRevealed, setDeveloperRevealed] = useState(false)
  const developerScope = useMemo(() => props.ctx.configForms.get<NonNullable<ReturnType<typeof decodeDeveloperSettings>>>(DEVELOPER_SETTINGS_NAMESPACE), [props.ctx])
  const [developerMode] = useDeveloperMode(developerScope)
  const developerGate = developerRevealed || developerMode
  const authorChrome = authorSettingsChrome(developerGate)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const pagesRef = useRef<HTMLDivElement | null>(null)
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
    ? ['general', 'writing', 'shortcuts', 'usage', 'zhihu']
    : ['general', 'models', 'assistant', 'writing', 'shortcuts', 'usage', 'zhihu']
  const navTabs = composeSettingsNavTabs(featureTabs, officialSections)
  /* 能力在弹窗打开期间变为停用时，或动态插件页消失时，回落到仍可用的分类。 */
  const activeTab = navTabs.includes(tab) ? tab : 'general'
  useEffect(() => { pagesRef.current?.scrollTo({ top: 0 }) }, [activeTab])
  const activeOfficial = officialSections.find((section) => section.navId === activeTab)
  const builtinPages: SettingsTab[] = [...featureTabs, ...SETTINGS_TRAILING_TABS]
  const content: Record<SettingsTab, () => ReactNode> = {
    general: () => <SettingsGeneralSection
      ctx={props.ctx}
      showDeveloperMode={authorChrome.showDeveloperMode}
      onRevealDeveloper={() => setDeveloperRevealed(true)} />,
    models: () => <ModelSettingsSurface ctx={props.ctx} renderSlot={props.renderSlot} sessionId={props.sessionId} locale={locale}
      renderProviders={options => <SettingsModelsSection ctx={props.ctx} writingScope={props.writingScope}
        showWritingRoutes={options?.includeWritingRoutes !== false} />}
      renderChatModel={() => <SettingsChatModelRoute ctx={props.ctx} writingScope={props.writingScope} />} />,
    assistant: () => <AssistantSettings scope={props.writingScope} migrate={props.migrateWriting} />,
    writing: () => <WritingSettings scope={props.writingScope} migrate={props.migrateWriting} onOpenShortcuts={() => selectTab('shortcuts')} />,
    shortcuts: () => <ShortcutsSettings commands={props.commands} />,
    usage: () => <SettingsUsageSection ctx={props.ctx} />,
    zhihu: () => <PluginSettingsContent contribution={props.zhihuTab} fallback={<Text size="2" color="gray" className="muted">
      {t('settings.zhihuUnavailable')}
    </Text>} />,
    plugins: () => <PluginSettingsContent contribution={props.pluginsTab} fallback={<Text size="2" color="gray" className="muted">
      {t('settings.pluginsUnavailable')}
    </Text>} />,
    about: () => <AboutSettingsSection active={activeTab === 'about'} onBusyChange={setAboutBusy} />,
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !aboutBusy) props.onClose() }}
      title={t('common.settings')}
      className="file-dialog settings-dialog"
      overlayClassName="file-dialog-overlay settings-overlay"
      dismissible={!aboutBusy}>
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
              aria-current={activeTab === key ? 'true' : undefined}>
              {navLabel(key, officialSections)}
            </TabsTrigger>)}
          </TabsList>
        </aside>
        <Flex className="settings-body" direction="column" minWidth="0" minHeight="0" overflow="hidden">
          <Flex className="settings-header" align="center" gap="2" px="4" py="3" flexShrink="0">
            <Heading size="4" className="settings-header-title">
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
                <CrossIcon size={14} />
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
          <Box ref={pagesRef} className="settings-pages" tabIndex={0} role="region" aria-label={navLabel(activeTab, officialSections)} overflow="auto" flexGrow="1" minWidth="0" minHeight="0">
            {builtinPages.map((key) => <SettingsTabPage key={key} tab={key} active={key === activeTab}>
              {content[key]()}
            </SettingsTabPage>)}
            {open && activeOfficial && props.renderSlot
              ? <SettingsTabPage
              key={activeOfficial.navId}
              tab={activeOfficial.navId}
              active={true}>
              <OfficialSettingsSectionPage
                renderSlot={props.renderSlot}
                sectionId={activeOfficial.id}
                version={official.version}
                sessionId={props.sessionId}
                locale={locale}
                onClose={props.onClose} />
            </SettingsTabPage>
              : null}
          </Box>
        </Flex>
      </Tabs>
    </Dialog>
  );
}
