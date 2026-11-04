/*
 * 全页设置（shell-rewrite-spec §7）：工作台原位保留但 inert+hidden，编辑器
 * 实例与排版不因设置开合重建（C40）。设置与插件是同一页：左侧分组导航
 * （写作/模型/助手、外观与语言/快捷键、插件含已安装/发现/安装与卸载与插件
 * 配置、用量/关于/高级），Escape 或「返回写作」关闭并把焦点还给发起者。
 */
import {
  Fragment,
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
import { composeSettingsNavGroups, isPluginsSection, persistTab } from '../../model/settings.ts'
import { configTargetOf, mergeSections, type ConfigLink } from '../../model/plugins-page.ts'
import { type PluginCatalogCard } from '../../model/plugins-catalog.ts'
import { PluginDetailPage } from '../../client/plugin-detail.tsx'
import { PluginInstallDialog } from '../../client/plugin-install-dialog.tsx'
import { AdvancedSection, AppearanceSection, AssistantBotBlock, AssistantBusyEnterRow } from '../../client/settings-general.tsx'
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
import { PluginsCatalog, usePluginCatalog } from '../../client/plugins-catalog.tsx'
import { pluginManagerStoreOf, usePluginManager } from '../../client/plugin-manager.ts'
import { PLUGINS_SETTINGS_SLOT } from '../../root-registration.ts'
import { titleBarDoubleClick } from '../../model/window-controls.ts'
import { WindowControls } from '../../client/window-controls.tsx'
import { Button, ChevronDownIcon, ChevronLeftIcon, Drawer, ListRow, scheduleReturnFocus, SearchField, takeInvokerOnOpen, WarningIcon } from '../../ui/index.ts'
import { Button as SeatButton, Input as SeatInput } from '../../client/ui/index.ts'
import './settings.styles.ts'

/** The discovery panel consumes the official inventory shape; the store projects bundles onto it. */
function useManagerInventory(store: ReturnType<typeof pluginManagerStoreOf>): {
  getSnapshot(): { status: string; packages: readonly { name: string; installed: boolean; optional: boolean; enabled: boolean }[]; install?: { phase: string } }
  subscribe(listener: () => void): () => void
} | undefined {
  return useMemo(() => {
    if (!store) return undefined
    /* useSyncExternalStore compares snapshot identity; cache the projection on
       the store's own immutable snapshot so identity is stable between ticks. */
    let cached: { snap: unknown; out: { status: string; packages: readonly { name: string; installed: boolean; optional: boolean; enabled: boolean }[]; install: { phase: string } } } | undefined
    return {
      getSnapshot: () => {
        const snap = store.getSnapshot()
        if (cached?.snap !== snap) {
          const phase = snap.install.phase === 'settled' ? 'done' : snap.install.phase === 'unknown' ? 'unconfirmed' : snap.install.phase
          cached = {
            snap,
            out: {
              status: snap.status,
              packages: snap.bundles.map(bundle => ({ name: bundle.name, installed: bundle.installed, optional: bundle.optional, enabled: bundle.enabled })),
              install: { phase },
            },
          }
        }
        return cached.out
      },
      subscribe: (listener: () => void) => store.subscribe(listener),
    }
  }, [store])
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
  const managerStore = pluginManagerStoreOf(props.ctx)
  const { snapshot: managerSnapshot } = usePluginManager(props.ctx)
  const inventory = useManagerInventory(managerStore)
  const [managerError, setManagerError] = useState('')
  const [installOpen, setInstallOpen] = useState(false)
  const [installRequest, setInstallRequest] = useState<{ spec?: string; inspect: boolean } | undefined>()
  const [installedQuery, setInstalledQuery] = useState('')
  const [note, setNote] = useState('')
  const [aboutBusy, setAboutBusy] = useState(false)
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
  }, [visible])

  const links: ConfigLink[] = [
    ...(props.renderSlot ? official.entries.map(entry => ({ id: `official:${entry.id}`, label: entry.label, entry })) : []),
    ...(props.renderSlot ? models.sections.map(entry => ({ id: 'model:' + entry.id, label: entry.label })) : []),
    ...(official.legacyZhihu && props.zhihu != null ? [{ id: 'zhihu', label: t('settings.zhihu') }] : []),
    ...(props.renderSlot ? legacy.sections.map(entry => ({ id: entry.navId, label: entry.label })) : []),
  ]

  const assistantEnabled = props.assistant !== false
  const navGroups = composeSettingsNavGroups(assistantEnabled)
  const fixedIds = new Set(navGroups.flatMap(group => group.items.map(item => item.id)))
  const known = fixedIds.has(props.section as never) || (typeof props.section === 'string' && props.section.startsWith('plugin:'))
    || links.some(link => link.id === props.section)
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

  const sections = mergeSections(catalog.sections, official.entries, links)
  /* 配置页只从插件详情进入；没有任何卡片映射过去的链接保留为「其他插件配置」。 */
  const orphanLinks = links.filter(link => !sections.some(section => section.items.some(card =>
    configTargetOf(card, links) === link.id)))

  /* 安装/卸载后回到已安装或发现时刷新目录，不让清单停在旧状态。 */
  const seenActive = useRef(active)
  useEffect(() => {
    const previous = seenActive.current
    seenActive.current = active
    if ((active === 'plugins-installed' || active === 'plugins-discovery') && previous !== active) catalog.reload()
  }, [active, catalog.reload])
  useEffect(() => {
    if (!managerStore) return
    let bundles = managerStore.getSnapshot().bundles
    return managerStore.subscribe(() => {
      const next = managerStore.getSnapshot().bundles
      if (next === bundles) return
      bundles = next
      catalog.reload()
    })
  }, [managerStore, catalog.reload])
  useLayoutEffect(() => { contentRef.current?.scrollTo({ top: 0 }) }, [active])

  const selectSection = (id: string) => select(id)
  const openDetail = (card: PluginCatalogCard) => {
    if (card.packageName) { selectSection(`plugin:${card.packageName}`); return }
    const target = configTargetOf(card, links)
    selectSection(target ?? 'plugins-installed')
  }
  /* 添加插件对话框：发现页预填 spec 直接检查；未安装官方卡的开关也走这里装。 */
  const openInstall = (spec?: string) => {
    setManagerError('')
    setInstallRequest(spec === undefined ? { inspect: false } : { spec, inspect: true })
    setInstallOpen(true)
  }
  const toggleCard = (card: PluginCatalogCard, enabled: boolean) => {
    if (enabled && card.installed === false && card.installSpec) { openInstall(card.installSpec); return }
    void catalog.toggle(card, enabled)
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

  const navTree = (onPick: (id: string) => void) => navGroups.map(group => <Fragment key={group.label}>
    <div className="dsh-settings-nav-group">
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
    </div>
  </Fragment>)

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
          <AssistantBotBlock ctx={props.ctx} />
        </>)}
        {section('appearance', t('settings.appearanceTitle'), <AppearanceSection ctx={props.ctx} />)}
        {section('shortcuts', t('settings.shortcuts'), <ShortcutsSettings commands={props.commands} renderSlot={props.renderSlot} />)}
        {section('plugins-installed', t('settings.pluginsInstalled'), <>
          <PluginsCatalog
            status={catalog.status}
            sections={sections}
            error={catalog.error}
            query={installedQuery}
            pending={catalog.pending}
            actionError={catalog.actionError}
            restartRequired={catalog.restartRequired}
            installing={managerSnapshot.install.phase === 'starting' || managerSnapshot.install.phase === 'running' || managerSnapshot.install.phase === 'cancelling'}
            onRetry={catalog.reload}
            onToggle={toggleCard}
            onConfigure={openDetail}
            onDetail={openDetail} />
          {orphanLinks.length ? <div className="dsh-settings-nav-group plugins-orphan-config">
            <div className="dsh-settings-nav-group__label" aria-hidden="true">{t('plugins.otherConfig')}</div>
            {orphanLinks.map(link => <ListRow key={link.id} label={link.label}
              onSelect={() => selectSection(link.id)} className="dsh-settings-nav-item"
              data-testid={`plugins-orphan-${link.id}`} />)}
          </div> : null}
        </>, {
          tools: <>
            <SearchField
              data-testid="plugins-catalog-search"
              aria-label={t('plugins.searchCatalog')}
              placeholder={t('plugins.searchCatalog')}
              clearLabel={t('search.close')}
              value={installedQuery}
              onChange={setInstalledQuery}
              onClear={() => setInstalledQuery('')} />
            {(managerSnapshot.install.phase === 'starting' || managerSnapshot.install.phase === 'running' || managerSnapshot.install.phase === 'cancelling')
              ? <Button size="sm" data-testid="plugins-page-install-busy" onClick={() => setInstallOpen(true)}>{t('plugins.installBusy')}</Button>
              : <Button size="sm" data-testid="plugins-page-add-plugin" onClick={() => openInstall()}>{t('plugins.addPlugin')}</Button>}
          </>,
        })}
        <div hidden={active !== 'plugins-discovery'} className="dsh-settings-section" data-testid="plugins-discovery">
          <h2 className="dsh-settings-section__title" tabIndex={-1}>{t('plugins.navDiscovery')}</h2>
          <PluginSettingsContent contribution={props.renderSlot
            ? props.renderSlot(PLUGINS_SETTINGS_SLOT, { Button: SeatButton, Input: SeatInput, inventory,
              onInstall: openInstall, onOpen: (packageName: string) => openDetail({ key: `bundle:${packageName}`, packageName,
                title: '', description: '', badges: [], action: 'detail' }) })
            : props.plugins} fallback={<p className="dsh-settings-error">{t('plugins.unavailable')}</p>} />
        </div>
        {active.startsWith('plugin:') && !activeLegacy && props.renderSlot ? <PluginDetailPage
          key={active}
          packageName={active.slice('plugin:'.length)}
          ctx={props.ctx}
          renderSlot={props.renderSlot}
          entries={official.entries}
          links={links}
          catalogSections={sections}
          legacy={legacy}
          modelSections={models.sections}
          zhihu={props.zhihu}
          snapshot={managerSnapshot}
          store={managerStore}
          onBack={() => selectSection('plugins-installed')}
          onInstall={openInstall}
          onToggleCard={toggleCard}
          configVersion={official.version}
          renderModelSurface={(id) => <PluginModelSettingsSurface key={id} ctx={props.ctx} id={id}
            renderSlot={props.renderSlot!} sessionId={props.sessionId} locale={locale}
            renderProviders={() => <SettingsModelsSection ctx={props.ctx} writingScope={props.ctx.configForms.get('dsh-editor-writing')} showWritingRoutes={false} />}
            renderChatModel={() => <SettingsChatModelRoute ctx={props.ctx} writingScope={props.ctx.configForms.get('dsh-editor-writing')} />} />} /> : null}
        <PluginInstallDialog open={installOpen} onOpenChange={setInstallOpen}
          store={managerStore} snapshot={managerSnapshot} request={installRequest}
          onConsumed={() => setInstallRequest(undefined)}
          onOpenPlugin={(packageName) => selectSection(`plugin:${packageName}`)} />
        {section('usage', t('settings.usage'), <SettingsUsageSection ctx={props.ctx} />)}
        {section('about', t('settings.about'), <AboutSettingsSection active={active === 'about' && visible} onBusyChange={setAboutBusy} />)}
        {section('advanced', t('settings.advanced'), <AdvancedSection
          ctx={props.ctx} />)}
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

