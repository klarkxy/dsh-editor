import { NATIVE_PLUGIN_MANAGER_KEY, NATIVE_PLUGIN_MANAGER_SEAT } from './native-plugin-manager-seat.ts'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button as NavigationButton, Flex, Heading, IconButton, Text } from '@radix-ui/themes'
import type { ShellContext } from './shared.ts'
import { t, useLocale } from '../i18n/index.ts'
import { Button, Input } from './ui/index.ts'
import { WindowControls, titleBarDoubleClick } from './window-controls.tsx'
import { OfficialSettingsSectionPage, PluginSettingsContent, useOfficialSettingsSections, type SettingsRenderSlot } from './settings-plugins.tsx'
import { SettingsChatModelRoute, SettingsModelsSection } from './settings-models.tsx'
import { PluginModelSettingsSurface, usePluginModelSettings } from './plugin-surfaces.tsx'
import { PluginConfigurationPage, usePluginConfigurations, type PluginConfigurationEntry } from './plugin-configurations.tsx'
import {
  mergeConfigurationCards,
  PluginsCatalog,
  usePluginCatalog,
  useWritingPresets,
  type PluginCatalogAction,
  type PluginCatalogCard,
  type PluginCatalogSection,
} from './plugins-catalog.tsx'

export function PluginsTrigger(props: { onOpen(): void }) {
  useLocale()
  return <IconButton type="button" variant="ghost" color="gray" size="2" className="plugins-trigger"
    aria-label={t('plugins.open')} title={t('plugins.open')} onClick={props.onOpen}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6v4a3 3 0 1 1 0 6v4H9a3 3 0 1 0-6 0v-6h4a3 3 0 1 1 2-8Z" />
    </svg>
  </IconButton>
}

type PluginWorkspaceProps = {
  open: boolean
  ctx: ShellContext
  renderSlot?: SettingsRenderSlot
  plugins?: ReactNode
  zhihu?: ReactNode
  sessionId?: string
  hasWorkspace: boolean
  onClose(): void
  children?: ReactNode
}

/** The manuscript keeps its instance and dimensions while the global page is open. */
export function PluginWorkspace(props: PluginWorkspaceProps) {
  const writing = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (writing.current) writing.current.inert = props.open }, [props.open])
  useLayoutEffect(() => { if (overlay.current) overlay.current.inert = !props.open }, [props.open])
  return <div className="plugin-workspace">
    <div ref={writing} className={props.open ? 'plugin-workspace-writing is-covered' : 'plugin-workspace-writing'} aria-hidden={props.open || undefined}>
      {props.children}
    </div>
    <div ref={overlay} hidden={!props.open} className="plugin-workspace-plugins">
      <PluginsPage {...props} visible={props.open} />
    </div>
  </div>
}

type ConfigLink = { id: string; label: string; entry?: PluginConfigurationEntry }
export type { ConfigLink }

const OVERVIEW = 'overview'
const DISCOVERY = 'discovery'
const MANAGER = 'manager'

const FIXED_PAGES = [
  { id: OVERVIEW, label: () => t('plugins.navOverview'), testId: 'plugins-nav-overview' },
  { id: DISCOVERY, label: () => t('plugins.navDiscovery'), testId: 'plugins-nav-discovery' },
  { id: MANAGER, label: () => t('plugins.navManager'), testId: 'plugins-nav-manager' },
]

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

export function PluginsPage(props: Omit<PluginWorkspaceProps, 'children' | 'open'> & { visible?: boolean }) {
  const locale = useLocale()
  const legacy = useOfficialSettingsSections(props.ctx)
  const official = usePluginConfigurations(props.ctx)
  const models = usePluginModelSettings(props.ctx, locale)
  const catalog = usePluginCatalog(props.ctx)
  const presets = useWritingPresets(props.ctx)
  const [selected, setSelected] = useState(OVERVIEW)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const back = useRef<HTMLButtonElement>(null)
  const pages = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (props.visible === false) return
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
    back.current?.focus()
    return () => { globalThis.setTimeout(() => { if (invoker?.isConnected) invoker.focus() }, 0) }
  }, [props.visible])
  const links: ConfigLink[] = [
    ...(props.renderSlot ? official.entries.map(entry => ({ id: `official:${entry.id}`, label: entry.label, entry })) : []),
    ...(props.renderSlot ? models.sections.map(entry => ({ id: 'model:' + entry.id, label: entry.label })) : []),
    ...(official.legacyZhihu && props.zhihu != null ? [{ id: 'zhihu', label: t('settings.zhihu') }] : []),
    ...(props.renderSlot ? legacy.sections.map(entry => ({ id: entry.navId, label: entry.label })) : []),
  ]
  const known = FIXED_PAGES.some(page => page.id === selected) || links.some(link => link.id === selected)
  const active = known ? selected : OVERVIEW
  const activeLink = links.find(link => link.id === active)
  const activeModel = models.sections.find(entry => 'model:' + entry.id === active)
  const activeLegacy = legacy.sections.find(entry => entry.navId === active)
  const filtered = links.filter(link => link.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const sections = mergeSections(catalog.sections, official.entries, links)
  const configKeys = secondaryConfigKeys(sections, links)
  /* Installs and removals happen on the manager page; refresh when the author
     comes back to the overview so the catalog never shows a stale inventory. */
  const seenActive = useRef(active)
  useEffect(() => {
    const previous = seenActive.current
    seenActive.current = active
    if (active === OVERVIEW && previous !== OVERVIEW) catalog.reload()
  }, [active, catalog.reload])
  useLayoutEffect(() => { pages.current?.scrollTo({ top: 0 }) }, [active])
  const openDetail = (card: PluginCatalogCard) => {
    const navigation = pluginNavigationOf(props.ctx)
    if (card.packageName && typeof navigation?.openBundle === 'function') {
      try {
        navigation.openBundle(card.packageName)
        // openBundle only switches the manager's own view: bring the manager
        // page up too, or the detail opens behind the hidden seat.
        setSelected(MANAGER)
        return
      } catch { /* An absent detail route falls back to the manager page. */ }
    }
    setSelected(MANAGER)
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
    setSelected(MANAGER)
  }
  const regionLabel = FIXED_PAGES.find(page => page.id === active)?.label() ?? activeLink?.label
  return <section className="shell plugins-page" aria-label={t('plugins.title')} onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return
    if ((event.target as Element).closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return
    event.preventDefault()
    props.onClose()
  }}>
    <Flex className="chrome plugins-page-header" align="center" gap="3" onDoubleClick={titleBarDoubleClick}>
      <Button ref={back} onClick={props.onClose} className="plugins-back">{props.hasWorkspace ? t('plugins.backWriting') : t('plugins.backHome')}</Button>
      <Heading as="h1" size="4">{t('plugins.title')}</Heading>
      <Flex ml="auto" align="center" gap="3" className="plugins-page-tools">
        <Input className="plugins-page-search" type="search" data-testid="plugins-catalog-search"
          aria-label={t('plugins.searchCatalog')} placeholder={t('plugins.searchCatalog')}
          value={search} onChange={setSearch} />
        <Button data-testid="plugins-page-add-plugin" onClick={() => setSelected(MANAGER)}>{t('plugins.addPlugin')}</Button>
        <WindowControls />
      </Flex>
    </Flex>
    <div className="plugins-page-layout">
      <nav className="plugins-page-nav" data-testid="plugins-page-nav" aria-label={t('plugins.title')}>
        {FIXED_PAGES.map(page => <NavigationButton key={page.id} data-testid={page.testId} variant="ghost" color="gray"
          className="plugins-page-link" aria-current={active === page.id ? 'page' : undefined} onClick={() => setSelected(page.id)}>
          {page.label()}
        </NavigationButton>)}
        <Heading as="h2" size="2" className="plugins-config-label">{t('plugins.configuration')}</Heading>
        <Input aria-label={t('plugins.search')} placeholder={t('plugins.search')} value={query} onChange={setQuery} />
        <ul className="plugins-config-links">
          {filtered.map(link => <li key={link.id}><NavigationButton variant="ghost" color="gray" className="plugins-page-link" aria-current={active === link.id ? 'page' : undefined}
            onClick={() => { if (link.entry) { openEntryInManager(link.entry); return } setSelected(link.id) }}>{link.label}</NavigationButton></li>)}
          {!filtered.length ? <li><Text size="2" color="gray">{t('plugins.empty')}</Text></li> : null}
        </ul>
      </nav>
      <div ref={pages} className="plugins-page-content" tabIndex={0} role="region" aria-label={regionLabel}>
        <div hidden={active !== OVERVIEW}>
          <PluginsCatalog
            status={catalog.status}
            sections={sections}
            error={catalog.error}
            query={search}
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
            onDetail={openDetail} />
        </div>
        <div hidden={active !== DISCOVERY} data-testid="plugins-discovery">
          <PluginSettingsContent contribution={props.plugins} fallback={null} />
        </div>
        {/* The official manager stays mounted while hidden: its pluginNavigation service must survive. */}
        <div hidden={active !== MANAGER} data-testid="plugins-manager-seat">
          <div data-dsh-plugin-surface="">
            {props.renderSlot ? props.renderSlot(NATIVE_PLUGIN_MANAGER_SEAT, {}, { entryKey: NATIVE_PLUGIN_MANAGER_KEY }) : <Text color="gray">{t('plugins.unavailable')}</Text>}
          </div>
        </div>
        {activeModel && props.renderSlot ? <PluginModelSettingsSurface key={activeModel.id} ctx={props.ctx} id={activeModel.id} renderSlot={props.renderSlot}
          sessionId={props.sessionId} locale={locale}
          renderProviders={() => <SettingsModelsSection ctx={props.ctx} writingScope={props.ctx.configForms.get('dsh-editor-writing')} showWritingRoutes={false} />}
          renderChatModel={() => <SettingsChatModelRoute ctx={props.ctx} writingScope={props.ctx.configForms.get('dsh-editor-writing')} />} /> : null}
        {active === 'zhihu' ? <PluginSettingsContent contribution={props.zhihu} fallback={null} /> : null}
        {activeLink?.entry && props.renderSlot ? <PluginConfigurationPage key={activeLink.entry.id} ctx={props.ctx} renderSlot={props.renderSlot}
          entry={activeLink.entry} version={official.version} locale={locale} onClose={() => setSelected(OVERVIEW)} /> : null}
        {activeLegacy && props.renderSlot ? <OfficialSettingsSectionPage renderSlot={props.renderSlot}
          sectionId={activeLegacy.id} version={legacy.version} sessionId={props.sessionId} locale={locale}
          onClose={() => setSelected(OVERVIEW)} /> : null}
      </div>
    </div>
  </section>
}

/**
 * The 插件配置 nav entry a card opens, or null when none is reachable.
 * A bundle card names its package, an entry card its Cordis entry; both routes
 * end at the same official configuration key.
 */
export function configTargetOf(card: PluginCatalogCard, links: readonly ConfigLink[]): string | null {
  const fromKey = card.key.startsWith('entry:') ? `official:${card.key.slice('entry:'.length)}` : ''
  if (fromKey && links.some(link => link.id === fromKey)) return fromKey
  const byEntry = card.entryId
    ? links.find(link => link.entry !== undefined
      && (link.entry.namespace === card.entryId || link.entry.entryKey === card.entryId))
    : undefined
  if (byEntry) return byEntry.id
  const byPackage = card.packageName ? links.find(link => link.entry?.entryKey === card.packageName) : undefined
  return byPackage?.id ?? null
}

/** Switch rows that also reach a configuration page carry a secondary 配置 control. */
export function secondaryConfigKeys(sections: readonly PluginCatalogSection[], links: readonly ConfigLink[]): string[] {
  return sections
    .flatMap((section) => section.items)
    .filter((card) => card.action === 'switch' && configTargetOf(card, links) !== null)
    .map((card) => card.key)
}

/**
 * Configuration cards that have no reachable 插件配置 entry fall back to the
 * detail control, so every row keeps exactly one control that does something.
 */
export function mergeSections(
  sections: readonly PluginCatalogSection[],
  entries: readonly PluginConfigurationEntry[],
  links: readonly ConfigLink[],
): PluginCatalogSection[] {
  return mergeConfigurationCards(sections, entries).map((section) => ({
    ...section,
    items: section.items.map((card) => (card.action === 'config' && !configTargetOf(card, links)
      ? { ...card, action: 'detail' as PluginCatalogAction }
      : card)),
  }))
}
