import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Box, Callout, Flex, Heading, IconButton, Text } from '@radix-ui/themes'
import type { SettingsScope } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { WritingSettings, writingPreferences } from '../writing-settings.tsx'
import { normalizeAuthorPreferences } from '../author-preferences.ts'
import type { WritingMigration, WritingPreferences } from '../writing-settings.tsx'
import { ShortcutsSettings } from './settings-shortcuts.tsx'
import type { ShellCommandRegistry } from '../seats.ts'
import { AboutSettingsSection } from './settings-about.tsx'
import { AssistantSettings } from './settings-assistant.tsx'
import { completeAuthorDraftSave, reconcileAuthorDraft, type AuthorDraft } from '../model/settings-assistant.ts'
import { SettingsGeneralSection, useDeveloperMode } from './settings-general.tsx'
import { authorSettingsChrome, DEVELOPER_SETTINGS_NAMESPACE, decodeDeveloperSettings } from '../developer-settings.ts'
import { SettingsEditorModelsSection } from './settings-models.tsx'
import type { SettingsRenderSlot } from './settings-plugins.tsx'
import { composeSettingsNavGroups, composeSettingsNavTabs, persistTab, readStoredTab, type SettingsTab, SETTINGS_TABS } from '../model/settings.ts'
import { SettingsUsageSection } from './settings-usage.tsx'
import { t, useLocale, type MessageKey } from '../i18n/index.ts'
import { CrossIcon, SettingsIcon } from './icons.tsx'
import { Button, Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from './ui/index.ts'

export type { SettingsRenderSlot }


function SettingsTabPage(props: { tab: string; active: boolean; children?: ReactNode }) {
  return (
    <TabsContent value={props.tab} forceMount={true} hidden={!props.active}
      className={`settings-content${props.active ? ' is-active' : ''}`}>
      <div className="settings-page">{props.children}</div>
    </TabsContent>
  )
}

function tabLabel(tab: SettingsTab): string {
  if (tab === 'general') return t('settings.general')
  if (tab === 'models') return t('settings.models')
  if (tab === 'assistant') return t('settings.assistant')
  if (tab === 'writing') return t('settings.writing')
  if (tab === 'shortcuts') return t('settings.shortcuts')
  if (tab === 'about') return t('settings.about')
  return t('settings.usage')
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
  const writingSnapshot = useSyncExternalStore(
    props.writingScope.subscribe.bind(props.writingScope),
    props.writingScope.getSnapshot.bind(props.writingScope),
    props.writingScope.getSnapshot.bind(props.writingScope),
  )
  const hostAuthor = writingPreferences(writingSnapshot, globalThis.localStorage).authorPreferences
  const [authorState, setAuthorState] = useState<AuthorDraft>(() => ({ value: hostAuthor, saved: hostAuthor, conflicted: false }))
  // An unavailable scope is not a new saved value; keep the last confirmed baseline.
  const savedAuthor = writingSnapshot.status === 'ready' ? hostAuthor : authorState.saved
  const authorDraft = reconcileAuthorDraft(authorState, savedAuthor)
  const authorSavingRef = useRef(false)
  const [authorSaving, setAuthorSaving] = useState(false)
  const [authorWriteFailure, setAuthorWriteFailure] = useState('')
  useEffect(() => { setAuthorState(current => reconcileAuthorDraft(current, savedAuthor)) }, [savedAuthor])
  const changeAuthorDraft = (value: string) => {
    setAuthorWriteFailure('')
    setAuthorState(current => reconcileAuthorDraft({ ...current, value }, savedAuthor))
  }
  const saveAuthor = async () => {
    if (authorSavingRef.current || writingSnapshot.status !== 'ready'
      || authorDraft.conflicted || authorDraft.value === authorDraft.saved) return
    authorSavingRef.current = true
    setAuthorSaving(true)
    setAuthorWriteFailure('')
    const submitted = authorDraft.value
    const normalized = normalizeAuthorPreferences(submitted)
    const scope = props.writingScope
    try {
      if (await scope.mutate([{ op: 'set', path: ['authorPreferences'], value: normalized }], writingSnapshot.revision) === false) {
        throw new Error('Host refused settings write')
      }
      const committed = scope.getSnapshot().user
      if (!committed || typeof committed !== 'object' || Array.isArray(committed)
        || !Object.prototype.hasOwnProperty.call(committed, 'authorPreferences')
        || (committed as { authorPreferences?: unknown }).authorPreferences !== normalized) {
        throw new Error('write did not commit')
      }
      setAuthorState(current => completeAuthorDraftSave(current, submitted, normalized))
    } catch {
      setAuthorWriteFailure(t('writing.authorFailed'))
    } finally {
      authorSavingRef.current = false
      setAuthorSaving(false)
    }
  }
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
    ? ['general', 'writing', 'shortcuts', 'usage']
    : ['general', 'models', 'assistant', 'writing', 'shortcuts', 'usage']
  const navTabs = composeSettingsNavTabs(featureTabs)
  const navGroups = composeSettingsNavGroups(featureTabs)
  /* 能力在弹窗打开期间变为停用时，或动态插件页消失时，回落到仍可用的分类。 */
  const activeTab: SettingsTab = navTabs.includes(tab as SettingsTab) ? tab as SettingsTab : 'general'
  useEffect(() => { pagesRef.current?.scrollTo({ top: 0 }) }, [activeTab])
  const builtinPages = navTabs
  const content: Record<SettingsTab, () => ReactNode> = {
    general: () => <SettingsGeneralSection
      ctx={props.ctx}
      showDeveloperMode={authorChrome.showDeveloperMode}
      onRevealDeveloper={() => setDeveloperRevealed(true)} />,
    models: () => <SettingsEditorModelsSection ctx={props.ctx} writingScope={props.writingScope} />,
    assistant: () => <AssistantSettings snapshot={writingSnapshot} migrate={props.migrateWriting}
      authorDraft={authorDraft} saving={authorSaving} writeFailure={authorWriteFailure}
      onAuthorDraftChange={changeAuthorDraft}
      onUseLatest={() => setAuthorState({ value: savedAuthor, saved: savedAuthor, conflicted: false })}
      onKeepDraft={() => setAuthorState({ value: authorDraft.value, saved: savedAuthor, conflicted: false })}
      onSave={() => void saveAuthor()} />,
    writing: () => <WritingSettings scope={props.writingScope} migrate={props.migrateWriting} onOpenShortcuts={() => selectTab('shortcuts')} />,
    shortcuts: () => <ShortcutsSettings commands={props.commands} renderSlot={props.renderSlot} />,
    usage: () => <SettingsUsageSection ctx={props.ctx} />,
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
            {navGroups.map(group => <div key={group.label} className="settings-nav-section" role="presentation">
              <Text as="div" size="1" color="gray" className="settings-nav-group" role="presentation" aria-hidden="true">
                {t(group.label)}
              </Text>
              {group.tabs.map(key => <TabsTrigger
                key={key}
                value={key}
                className={`settings-tab${activeTab === key ? ' active' : ''}`}
                aria-current={activeTab === key ? 'true' : undefined}>
                {tabLabel(key)}
              </TabsTrigger>)}
            </div>)}
          </TabsList>
        </aside>
        <Flex className="settings-body" direction="column" minWidth="0" minHeight="0" overflow="hidden">
          <Flex className="settings-header" align="center" gap="2" px="4" py="3" flexShrink="0">
            <Heading size="4" className="settings-header-title">
              {tabLabel(activeTab)}
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
          <Box ref={pagesRef} className="settings-pages" tabIndex={0} role="region" aria-label={tabLabel(activeTab)} overflow="auto" flexGrow="1" minWidth="0" minHeight="0">
            {builtinPages.map((key) => <SettingsTabPage key={key} tab={key} active={key === activeTab}>
              {content[key]()}
            </SettingsTabPage>)}
          </Box>
        </Flex>
      </Tabs>
    </Dialog>
  );
}
