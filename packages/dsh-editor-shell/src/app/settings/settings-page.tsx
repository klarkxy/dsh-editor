/*
 * 全页设置（shell-rewrite-spec §7）：工作台原位保留但 inert+hidden，编辑器
 * 实例与排版不因设置开合重建（C40）。设置与插件是同一页：左侧分组导航
 * （写作/模型/助手、外观与语言/快捷键、插件含已安装/发现/安装与卸载与插件
 * 配置、用量/关于/高级），Escape 或「返回写作」关闭并把焦点还给发起者。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { t, useLocale } from '../../i18n/index.ts'
import type { SettingsScope } from '../../dsh-compat.ts'
import type { ShellContext } from '../../client/shared.ts'
import {
  WritingSettings,
  writingPreferences,
  type WritingMigration,
  type WritingPreferences,
} from '../../writing-settings.tsx'
import { normalizeAuthorPreferences } from '../../author-preferences.ts'
import { completeAuthorDraftSave, reconcileAuthorDraft, type AuthorDraft } from '../../model/settings-assistant.ts'
import { authorSettingsChrome, DEVELOPER_SETTINGS_NAMESPACE, decodeDeveloperSettings, type DeveloperSettings } from '../../developer-settings.ts'
import { composeSettingsNavGroups, isPluginsSection, persistTab } from '../../model/settings.ts'
import { configTargetOf, mergeSections, secondaryConfigKeys, type ConfigLink } from '../../model/plugins-page.ts'
import { advancedCatalogCard, type PluginCatalogCard } from '../../model/plugins-catalog.ts'
import { AdvancedSection, AppearanceSection, AssistantBusyEnterRow, useDeveloperMode } from '../../client/settings-general.tsx'
import { AssistantSettings } from '../../client/settings-assistant.tsx'
import { SettingsChatModelRoute, SettingsEditorModelsSection, SettingsModelsSection } from '../../client/settings-models.tsx'
import { ShortcutsSettings } from '../../client/settings-shortcuts.tsx'
import type { ShellCommandRegistry } from '../../seats.ts'
import { SettingsUsageSection } from '../../client/settings-usage.tsx'
import { AboutSettingsSection } from '../../client/settings-about.tsx'
import {
  OfficialSettingsSectionPage,
  PluginSettingsContent,
  useOfficialSettingsSections,
  type SettingsRenderSlot,
} from '../../client/settings-plugins.tsx'
import { PluginModelSettingsSurface, usePluginModelSettings } from '../../client/plugin-surfaces.tsx'
import { PluginConfigurationPage, usePluginConfigurations } from '../../client/plugin-configurations.tsx'
import type { PluginConfigurationEntry } from '../../model/plugin-configurations.ts'
import { PluginsCatalog, usePluginCatalog, useWritingPresets } from '../../client/plugins-catalog.tsx'
import {
  NATIVE_PLUGIN_MANAGER_KEY,
  NATIVE_PLUGIN_MANAGER_SEAT,
  nativePluginManagerBridge,
  nativePluginManagerVersion,
  subscribeNativePluginManager,
} from '../../client/native-plugin-manager-seat.ts'
import { PLUGINS_SETTINGS_SLOT } from '../../root-registration.ts'
import { titleBarDoubleClick } from '../../model/window-controls.ts'
import { WindowControls } from '../../client/window-controls.tsx'
import { Button, ChevronDownIcon, ChevronLeftIcon, Drawer, ListRow, scheduleReturnFocus, SearchField, takeInvokerOnOpen, WarningIcon } from '../../ui/index.ts'
import { Button as SeatButton, Input as SeatInput } from '../../client/ui/index.ts'
import './settings.styles.ts'

/** Cordis throws on uninjected service properties; a missing manager is a route change, not a crash. */
function pluginNavigationOf(ctx: unknown): { openBundle?(packageName: string): unknown } | undefined {
  if (!ctx || typeof ctx !== 'object') return undefined
  const record = ctx as Record<string, unknown> & { get?: (name: string) => unknown }
  try {
    const value = record.pluginNavigation
    if (value && typeof value === 'object') return value as { openBundle?(packageName: string): unknown }
  } catch { /* Cordis throws on uninjected properties; fall through to ctx.get. */ }
  try {
    const value = typeof record.get === 'function' ? record.get('pluginNavigation') : undefined
    return value && typeof value === 'object' ? value as { openBundle?(packageName: string): unknown } : undefined
  } catch { return undefined }
}

export type SettingsPageProps = {
  ctx: ShellContext
  sessionId?: string
  commands?: ShellCommandRegistry
  writingScope: SettingsScope<WritingPreferences>
  migrateWriting: WritingMigration
  /** 助手能力开关：false 时隐藏模型/助手分区；undefined 表示能力尚未加载。 */
  assistant?: boolean
  renderSlot?: SettingsRenderSlot
  plugins?: ReactNode
  zhihu?: ReactNode
  hasWorkspace: boolean
  section: string
  onSelectSection(id: string): void
  onClose(): void
  visible?: boolean
}

export function SettingsPage(props: SettingsPageProps) {
  const locale = useLocale()
  const legacy = useOfficialSettingsSections(props.ctx)
  const official = usePluginConfigurations(props.ctx)
  const models = usePluginModelSettings(props.ctx, locale)
  const catalog = usePluginCatalog(props.ctx)
  const presets = useWritingPresets(props.ctx)
  const subscribeManager = useCallback((listener: () => void) => subscribeNativePluginManager(props.ctx, listener), [props.ctx])
  const managerVersion = useCallback(() => nativePluginManagerVersion(props.ctx), [props.ctx])
  useSyncExternalStore(subscribeManager, managerVersion, managerVersion)
  const manager = nativePluginManagerBridge(props.ctx)
  const [managerError, setManagerError] = useState('')
  const [configQuery, setConfigQuery] = useState('')
  const [installedQuery, setInstalledQuery] = useState('')
  const [note, setNote] = useState('')
  const [aboutBusy, setAboutBusy] = useState(false)
  const [developerRevealed, setDeveloperRevealed] = useState(false)
  const developerScope = useMemoDevScope(props.ctx)
  const [developerMode] = useDeveloperMode(developerScope)
  const developerGate = developerRevealed || developerMode
  const authorChrome = authorSettingsChrome(developerGate)
  const backRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const visible = props.visible !== false

  /* ── 焦点：打开沿捕获发起者并聚焦「返回写作」；关闭沿回焦（发起者可能被
     卸载重建，按 testid/id 重查）。 ── */
  const wasOpen = useRef(false)
  const invokerRef = useRef<HTMLElement | null>(null)
  const returnGeneration = useRef(0)
  useLayoutEffect(() => {
    const invoker = takeInvokerOnOpen(visible, wasOpen)
    if (invoker !== undefined) invokerRef.current = invoker
  }, [visible])
  /* 父级 SettingsWorkspace 的 inert 清理在 layout effect 里、子级之后运行；
     这里必须在被动 effect 聚焦「返回写作」，否则此时页面仍 inert、focus() 无效。 */
  useEffect(() => {
    if (visible) backRef.current?.focus()
  }, [visible])
  const openRef = useRef(visible)
  useLayoutEffect(() => {
    const was = openRef.current
    openRef.current = visible
    if (was && !visible) {
      returnGeneration.current += 1
      scheduleReturnFocus(invokerRef.current, returnGeneration)
    }
  }, [visible])

  /* ── 助手作者侧写草稿（沿用旧设置弹窗的生命周期与写契约）。 ── */
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
    if (visible) return
    setNote('')
    setAboutBusy(false)
    if (!developerMode) setDeveloperRevealed(false)
  }, [visible, developerMode])

  const links: ConfigLink[] = [
    ...(props.renderSlot ? official.entries.map(entry => ({ id: `official:${entry.id}`, label: entry.label, entry })) : []),
    ...(props.renderSlot ? models.sections.map(entry => ({ id: 'model:' + entry.id, label: entry.label })) : []),
    ...(official.legacyZhihu && props.zhihu != null ? [{ id: 'zhihu', label: t('settings.zhihu') }] : []),
    ...(props.renderSlot ? legacy.sections.map(entry => ({ id: entry.navId, label: entry.label })) : []),
  ]

  const assistantEnabled = props.assistant !== false
  const navGroups = composeSettingsNavGroups(assistantEnabled)
  const fixedIds = new Set(navGroups.flatMap(group => group.items.map(item => item.id)))
  const known = fixedIds.has(props.section as never) || links.some(link => link.id === props.section)
  const active = known ? props.section : 'writing'
  const activeLink = links.find(link => link.id === active)
  const activeModel = models.sections.find(entry => 'model:' + entry.id === active)
  const activeLegacy = legacy.sections.find(entry => entry.navId === active)
  const select = (id: string) => {
    persistTab(id)
    props.onSelectSection(id)
  }

  /* 设置分区按需挂载、挂载后保留（关于页的下载进度不因切换分区丢掉）；
     插件三段与官方管理器座位始终挂载——pluginNavigation 服务依赖它存活。 */
  const mountedRef = useRef(new Set<string>(isPluginsSection(active) ? [] : [active]))
  if (!mountedRef.current.has(active)) mountedRef.current.add(active)
  const mounted = (id: string) => isPluginsSection(id) || mountedRef.current.has(id)

  const filteredLinks = links.filter(link => link.label.toLocaleLowerCase().includes(configQuery.trim().toLocaleLowerCase()))
  const sections = mergeSections(catalog.sections, official.entries, links)
  const advancedLink = (link: ConfigLink) => sections.some(section => section.id !== 'user' && section.items.some(card =>
    configTargetOf(card, links) === link.id && advancedCatalogCard(card)))
  const ordinaryLinks = filteredLinks.filter(link => !advancedLink(link))
  const advancedLinks = filteredLinks.filter(advancedLink)
  const configKeys = secondaryConfigKeys(sections, links)

  /* 安装/卸载后回到已安装或发现时刷新目录，不让清单停在旧状态。 */
  const seenActive = useRef(active)
  useEffect(() => {
    const previous = seenActive.current
    seenActive.current = active
    if ((active === 'plugins-installed' || active === 'plugins-discovery') && previous !== active) catalog.reload()
  }, [active, catalog.reload])
  useLayoutEffect(() => { contentRef.current?.scrollTo({ top: 0 }) }, [active])

  const selectSection = (id: string) => select(id)
  const openDetail = (card: PluginCatalogCard) => {
    const navigation = pluginNavigationOf(props.ctx)
    if (card.packageName && typeof navigation?.openBundle === 'function') {
      try {
        navigation.openBundle(card.packageName)
        // openBundle only switches the manager's own view: bring the manager
        // page up too, or the detail opens behind the hidden seat.
        selectSection('plugins-manager')
        return
      } catch { /* An absent detail route falls back to the manager page. */ }
    }
    selectSection('plugins-manager')
  }
  const openInstall = (spec?: string) => {
    selectSection('plugins-manager')
    try {
      const live = nativePluginManagerBridge(props.ctx)
      setManagerError(live?.openInstall(spec) ? '' : t('plugins.unavailable'))
    } catch { setManagerError(t('plugins.unavailable')) }
  }
  /* Plugin configuration pages live in the official manager's own slot context
     (the root entry may not render them), so their entries jump there. */
  const openEntryInManager = (entry: PluginConfigurationEntry) => {
    const navigation = pluginNavigationOf(props.ctx)
    const packageName = entry.slot === 'plugins.bundle.config'
      ? entry.entryKey
      : entry.slot === 'plugins.row.config' ? entry.entryKey?.split('#')[0] : undefined
    if (packageName && typeof navigation?.openBundle === 'function') {
      try { navigation.openBundle(packageName) } catch { /* fall through to the manager page */ }
    }
    selectSection('plugins-manager')
  }
  const openConfigFile = async () => {
    setNote('')
    try {
      const response = await props.ctx.remote.settings.openSettingsDocument()
      if (!response.ok) setNote(t('settings.openConfigFailed', { error: response.error.message ?? '' }))
    } catch (error) {
      setNote(t('settings.openConfigFailed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const labelOf = (id: string): string => {
    for (const group of navGroups) {
      const item = group.items.find(entry => entry.id === id)
      if (item) return t(item.label)
    }
    return links.find(link => link.id === id)?.label ?? t('common.settings')
  }

  /* 窄窗（<760px）：导航列换成「当前分区」触发行，同一棵导航树放进左侧抽屉；
     选定后关抽屉并把焦点移到分区标题（盖过抽屉自带的回焦）。 */
  const [navDrawerOpen, setNavDrawerOpen] = useState(false)
  const navFocusRef = useRef<HTMLElement | null>(null)
  const focusHeadRef = useRef(false)
  const selectFromDrawer = (id: string) => {
    select(id)
    /* 固定分区标题始终渲染（hidden 只遮内容），关抽屉前锁定为回焦目标；
       动态分区没有固定 testid，交给下面的可见标题兜底。 */
    navFocusRef.current = contentRef.current
      ?.querySelector<HTMLElement>(`[data-testid="settings-section-${id}"] .dsh-settings-section__title`) ?? null
    focusHeadRef.current = !navFocusRef.current
    setNavDrawerOpen(false)
  }
  useEffect(() => {
    if (navDrawerOpen || !focusHeadRef.current) return
    focusHeadRef.current = false
    const timer = setTimeout(() => {
      contentRef.current
        ?.querySelector<HTMLElement>('.dsh-settings-section:not([hidden]) .dsh-settings-section__title')
        ?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [navDrawerOpen])

  const navTree = (onPick: (id: string) => void) => navGroups.map(group => <div key={group.label} className="dsh-settings-nav-group">
    <div className="dsh-settings-nav-group__label" aria-hidden="true">{t(group.label)}</div>
    {group.items.map(item => <ListRow
      key={item.id}
      label={t(item.label)}
      leading={item.warn ? <WarningIcon /> : undefined}
      selected={active === item.id}
      onSelect={() => onPick(item.id)}
      className="dsh-settings-nav-item"
      data-warn={item.warn || undefined}
      data-testid={`settings-nav-${item.id}`} />)}
    {group.label === 'settings.plugins' ? <div className="dsh-settings-config">
      <div className="dsh-settings-config__label">{t('plugins.configuration')}</div>
      <SearchField
        aria-label={t('plugins.search')}
        placeholder={t('plugins.search')}
        clearLabel={t('search.close')}
        value={configQuery}
        onChange={setConfigQuery}
        onClear={() => setConfigQuery('')} />
      <ul className="dsh-settings-config__links">
        {ordinaryLinks.map(link => <li key={link.id}><ListRow
          density="compact"
          label={link.label}
          selected={active === link.id}
          onSelect={() => { if (link.entry) { openEntryInManager(link.entry); onPick('plugins-manager'); return } onPick(link.id) }}
          className="dsh-settings-nav-item" /></li>)}
        {!filteredLinks.length ? <li><p className="dsh-settings-config__empty">{t('plugins.empty')}</p></li> : null}
      </ul>
      {advancedLinks.length ? <details className="dsh-settings-config__advanced" open={configQuery.trim() ? true : undefined}>
        <summary>{t('plugins.catalogAdvanced')}</summary>
        <ul className="dsh-settings-config__links">{advancedLinks.map(link => <li key={link.id}><ListRow
          density="compact"
          label={link.label}
          selected={active === link.id}
          onSelect={() => { if (link.entry) { openEntryInManager(link.entry); onPick('plugins-manager') } else onPick(link.id) }}
          className="dsh-settings-nav-item" /></li>)}</ul>
      </details> : null}
    </div> : null}
  </div>)

  const section = (id: string, title: string, children: ReactNode, opts?: { tools?: ReactNode }) => (
    <div hidden={active !== id} className="dsh-settings-section" data-testid={`settings-section-${id}`}>
      {opts?.tools
        ? <div className="dsh-settings-section__head">
          <h2 className="dsh-settings-section__title" tabIndex={-1}>{title}</h2>
          <div className="dsh-settings-section__tools">{opts.tools}</div>
        </div>
        : <h2 className="dsh-settings-section__title" tabIndex={-1}>{title}</h2>}
      {mounted(id) ? children : null}
    </div>
  )

  /* Escape 是页面级关闭：焦点可能落在设置页之外（例如某个内联编辑器取消后
     控件被卸载、焦点回到 body），挂在 document 上才能可靠收到。 */
  const { onClose } = props
  useEffect(() => {
    if (!visible) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      if ((event.target as Element | null)?.closest?.('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return
      if (aboutBusy) return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [visible, aboutBusy, onClose])

  return <section className="dsh-settings-page" aria-label={t('common.settings')} data-testid="settings-page">
    <div className="dsh-settings-page__top chrome" onDoubleClick={titleBarDoubleClick}>
      <Button ref={backRef} variant="secondary" size="sm" data-testid="settings-back" className="plugins-back"
        disabled={aboutBusy} onClick={props.onClose} icon={<ChevronLeftIcon size="sm" />}>
        {props.hasWorkspace ? t('plugins.backWriting') : t('plugins.backHome')}
      </Button>
      <h1 className="dsh-settings-page__title">{t('common.settings')}</h1>
      <div className="dsh-settings-page__tools">
        {authorChrome.showOpenConfig && props.ctx.connection.isLoopback ? <Button
          variant="secondary" size="sm" className="settings-open-config"
          onClick={() => void openConfigFile()}>
          {t('settings.openConfig')}
        </Button> : null}
        <WindowControls />
      </div>
    </div>
    {note ? <p className="dsh-settings-error" role="alert">{note}</p> : null}
    <div className="dsh-settings-page__layout">
      <nav className="dsh-settings-page__nav" data-testid="settings-nav" aria-label={t('settings.nav')}>
        {navTree(select)}
      </nav>
      <div className="dsh-settings-nav-mobile">
        <button type="button" className="dsh-settings-nav-trigger" data-testid="settings-mobile-nav-trigger"
          aria-haspopup="dialog" aria-expanded={navDrawerOpen || undefined}
          onClick={() => setNavDrawerOpen(true)}>
          <span className="dsh-settings-nav-trigger__label">{labelOf(active)}</span>
          <ChevronDownIcon size="sm" />
        </button>
      </div>
      <div ref={contentRef} className="dsh-settings-page__content" data-testid="settings-content" tabIndex={0} role="region" aria-label={labelOf(active)}>
        {section('writing', t('settings.writing'),
          <WritingSettings scope={props.writingScope} migrate={props.migrateWriting} onOpenShortcuts={() => selectSection('shortcuts')} />)}
        {section('models', t('settings.models'),
          <SettingsEditorModelsSection ctx={props.ctx} writingScope={props.writingScope} />)}
        {section('assistant', t('settings.assistant'), <>
          <AssistantSettings snapshot={writingSnapshot} migrate={props.migrateWriting}
            authorDraft={authorDraft} saving={authorSaving} writeFailure={authorWriteFailure}
            onAuthorDraftChange={changeAuthorDraft}
            onUseLatest={() => setAuthorState({ value: savedAuthor, saved: savedAuthor, conflicted: false })}
            onKeepDraft={() => setAuthorState({ value: authorDraft.value, saved: savedAuthor, conflicted: false })}
            onSave={() => void saveAuthor()} />
          <AssistantBusyEnterRow ctx={props.ctx} />
        </>)}
        {section('appearance', t('settings.appearanceTitle'), <AppearanceSection ctx={props.ctx} />)}
        {section('shortcuts', t('settings.shortcuts'), <ShortcutsSettings commands={props.commands} renderSlot={props.renderSlot} />)}
        {section('plugins-installed', t('settings.pluginsInstalled'), <PluginsCatalog
          status={catalog.status}
          sections={sections}
          error={catalog.error}
          query={installedQuery}
          pending={catalog.pending}
          actionError={catalog.actionError}
          configKeys={configKeys}
          presets={presets.presets}
          presetError={presets.error}
          presetPending={presets.pending}
          restartRequired={catalog.restartRequired || presets.restartRequired}
          onRetry={catalog.reload}
          onToggle={(card, enabled) => { void catalog.toggle(card, enabled) }}
          onTogglePreset={(preset, enabled) => { void presets.setEnabled(preset, enabled) }}
          onConfigure={openDetail}
          onDetail={openDetail} />, {
          tools: <>
            <SearchField
              data-testid="plugins-catalog-search"
              aria-label={t('plugins.searchCatalog')}
              placeholder={t('plugins.searchCatalog')}
              clearLabel={t('search.close')}
              value={installedQuery}
              onChange={setInstalledQuery}
              onClear={() => setInstalledQuery('')} />
            <Button size="sm" data-testid="plugins-page-add-plugin" onClick={() => openInstall()}>{t('plugins.addPlugin')}</Button>
          </>,
        })}
        <div hidden={active !== 'plugins-discovery'} className="dsh-settings-section" data-testid="plugins-discovery">
          <h2 className="dsh-settings-section__title" tabIndex={-1}>{t('plugins.navDiscovery')}</h2>
          <PluginSettingsContent contribution={props.renderSlot
            ? props.renderSlot(PLUGINS_SETTINGS_SLOT, { Button: SeatButton, Input: SeatInput, inventory: manager?.inventory,
              onInstall: openInstall, onOpen: (packageName: string) => openDetail({ key: `bundle:${packageName}`, packageName,
                title: '', description: '', badges: [], action: 'detail' }) })
            : props.plugins} fallback={<p className="dsh-settings-error">{t('plugins.unavailable')}</p>} />
        </div>
        {/* The official manager stays mounted while hidden: its pluginNavigation service must survive. */}
        <div hidden={active !== 'plugins-manager'} className="dsh-settings-section" data-testid="plugins-manager-seat">
          <h2 className="dsh-settings-section__title" tabIndex={-1}>{t('plugins.navManager')}</h2>
          {managerError ? <p className="dsh-settings-error" role="alert">{managerError}</p> : null}
          <div data-dsh-plugin-surface="">
            {props.renderSlot ? props.renderSlot(NATIVE_PLUGIN_MANAGER_SEAT, {}, { entryKey: NATIVE_PLUGIN_MANAGER_KEY }) : <p className="dsh-settings-error">{t('plugins.unavailable')}</p>}
          </div>
        </div>
        {section('usage', t('settings.usage'), <SettingsUsageSection ctx={props.ctx} />)}
        {section('about', t('settings.about'), <AboutSettingsSection active={active === 'about' && visible} onBusyChange={setAboutBusy} />)}
        {section('advanced', t('settings.advanced'), <AdvancedSection
          ctx={props.ctx}
          showDeveloperMode={authorChrome.showDeveloperMode}
          onRevealDeveloper={() => setDeveloperRevealed(true)} />)}
        {activeModel && props.renderSlot ? <div className="dsh-settings-section">
          <PluginModelSettingsSurface key={activeModel.id} ctx={props.ctx} id={activeModel.id} renderSlot={props.renderSlot}
            sessionId={props.sessionId} locale={locale}
            renderProviders={() => <SettingsModelsSection ctx={props.ctx} writingScope={props.ctx.configForms.get('dsh-editor-writing')} showWritingRoutes={false} />}
            renderChatModel={() => <SettingsChatModelRoute ctx={props.ctx} writingScope={props.ctx.configForms.get('dsh-editor-writing')} />} />
        </div> : null}
        {active === 'zhihu' ? <div className="dsh-settings-section">
          <PluginSettingsContent contribution={props.zhihu} fallback={null} />
        </div> : null}
        {activeLink?.entry && props.renderSlot ? <PluginConfigurationPage key={activeLink.entry.id} ctx={props.ctx} renderSlot={props.renderSlot}
          entry={activeLink.entry} version={official.version} locale={locale} onClose={() => selectSection('plugins-installed')} /> : null}
        {activeLegacy && props.renderSlot ? <OfficialSettingsSectionPage renderSlot={props.renderSlot}
          sectionId={activeLegacy.id} version={legacy.version} sessionId={props.sessionId} locale={locale}
          onClose={() => selectSection('plugins-installed')} /> : null}
      </div>
    </div>
    <Drawer open={navDrawerOpen} side="left"
      onOpenChange={(next) => { if (next) navFocusRef.current = null; setNavDrawerOpen(next) }}
      returnFocusRef={navFocusRef}
      title={t('settings.nav')} closeLabel={t('search.close')}>
      <nav className="dsh-settings-nav-drawer" data-testid="settings-mobile-nav-drawer" aria-label={t('settings.nav')}>
        {navTree(selectFromDrawer)}
      </nav>
    </Drawer>
  </section>
}

/* configForms.get 的分区钩子需要一个稳定 scope 引用；宿主还没有 configForms
   时给一个只读占位，分区照常渲染且控件不可写。 */
const UNAVAILABLE_SCOPE = {
  subscribe: () => () => {},
  getSnapshot: () => ({ status: 'unavailable' }),
} as unknown as SettingsScope<DeveloperSettings>

function useMemoDevScope(ctx: ShellContext): SettingsScope<DeveloperSettings> {
  return useMemo(() => {
    const get = (ctx as { configForms?: { get?: unknown } }).configForms?.get
    if (typeof get !== 'function') return UNAVAILABLE_SCOPE
    return ctx.configForms.get<NonNullable<ReturnType<typeof decodeDeveloperSettings>>>(DEVELOPER_SETTINGS_NAMESPACE)
  }, [ctx])
}

/** The manuscript keeps its instance and dimensions while the settings page is open. */
export function SettingsWorkspace(props: SettingsPageProps & { open: boolean; children?: ReactNode }) {
  const writing = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (writing.current) writing.current.inert = props.open }, [props.open])
  useLayoutEffect(() => { if (overlay.current) overlay.current.inert = !props.open }, [props.open])
  return <div className="dsh-settings-workspace">
    <div ref={writing} className={props.open ? 'dsh-settings-workspace__under is-covered' : 'dsh-settings-workspace__under'} aria-hidden={props.open || undefined}>
      {props.children}
    </div>
    <div ref={overlay} hidden={!props.open} className="dsh-settings-workspace__page">
      <SettingsPage {...props} visible={props.open} />
    </div>
  </div>
}
