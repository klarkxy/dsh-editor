import { NATIVE_PLUGIN_MANAGER_KEY, NATIVE_PLUGIN_MANAGER_SEAT } from './native-plugin-manager-seat.ts'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button as NavigationButton, Flex, Heading, IconButton, Text } from '@radix-ui/themes'
import type { ShellContext } from './shared.ts'
import { t, useLocale } from '../i18n/index.ts'
import { Button, Input } from './ui/index.ts'
import { WindowControls, titleBarDoubleClick } from './window-controls.tsx'
import { OfficialSettingsSectionPage, PluginSettingsContent, useOfficialSettingsSections, type SettingsRenderSlot } from './settings-plugins.tsx'
import { SettingsChatModelRoute, SettingsModelsSection } from './settings-models.tsx'
import { PluginModelSettingsSurface, usePluginModelSettings } from './plugin-surfaces.tsx'
import { usePluginConfigurations } from './plugin-configurations.tsx'

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

export function PluginsPage(props: Omit<PluginWorkspaceProps, 'children' | 'open'> & { visible?: boolean }) {
  const locale = useLocale()
  const legacy = useOfficialSettingsSections(props.ctx)
  const official = usePluginConfigurations(props.ctx)
  const models = usePluginModelSettings(props.ctx, locale)
  const [selected, setSelected] = useState('manage')
  const [query, setQuery] = useState('')
  const back = useRef<HTMLButtonElement>(null)
  const pages = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (props.visible === false) return
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
    back.current?.focus()
    return () => { globalThis.setTimeout(() => { if (invoker?.isConnected) invoker.focus() }, 0) }
  }, [props.visible])
  const entries = [
    ...(props.renderSlot ? models.sections.map(entry => ({ id: 'model:' + entry.id, label: entry.label })) : []),
    ...(official.legacyZhihu && props.zhihu != null ? [{ id: 'zhihu', label: t('settings.zhihu') }] : []),
    ...(props.renderSlot ? legacy.sections.map(entry => ({ id: entry.navId, label: entry.label })) : []),
  ]
  const active = selected === 'manage' || entries.some(entry => entry.id === selected) ? selected : 'manage'
  const activeModel = models.sections.find(entry => 'model:' + entry.id === active)
  const activeLegacy = legacy.sections.find(entry => entry.navId === active)
  const filtered = entries.filter(entry => entry.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  useLayoutEffect(() => { pages.current?.scrollTo({ top: 0 }) }, [active])
  return <section className="shell plugins-page" aria-label={t('plugins.title')} onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return
    if ((event.target as Element).closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return
    event.preventDefault()
    props.onClose()
  }}>
    <Flex className="chrome plugins-page-header" align="center" gap="3" onDoubleClick={titleBarDoubleClick}>
      <Button ref={back} onClick={props.onClose} className="plugins-back">{props.hasWorkspace ? t('plugins.backWriting') : t('plugins.backHome')}</Button>
      <Heading as="h1" size="4">{t('plugins.title')}</Heading>
      <Flex ml="auto"><WindowControls /></Flex>
    </Flex>
    <div className={entries.length ? 'plugins-page-layout' : 'plugins-page-layout is-single'}>
      {entries.length ? <nav className="plugins-page-nav" aria-label={t('plugins.title')}>
        <NavigationButton variant="ghost" color="gray" className="plugins-page-link" aria-current={active === 'manage' ? 'page' : undefined} onClick={() => setSelected('manage')}>
          {t('plugins.manage')}
        </NavigationButton>
        <Heading as="h2" size="2" className="plugins-config-label">{t('plugins.configuration')}</Heading>
        <Input aria-label={t('plugins.search')} placeholder={t('plugins.search')} value={query} onChange={setQuery} />
        <ul className="plugins-config-links">
          {filtered.map(entry => <li key={entry.id}><NavigationButton variant="ghost" color="gray" className="plugins-page-link" aria-current={active === entry.id ? 'page' : undefined}
            onClick={() => setSelected(entry.id)}>{entry.label}</NavigationButton></li>)}
          {!filtered.length ? <li><Text size="2" color="gray">{t('plugins.empty')}</Text></li> : null}
        </ul>
      </nav> : null}
      <div ref={pages} className="plugins-page-content" tabIndex={0} role="region"
        aria-label={active === 'manage' ? t('plugins.manage') : entries.find(entry => entry.id === active)?.label}>
        <div hidden={active !== 'manage'}>
          <PluginSettingsContent contribution={props.plugins} fallback={null} />
          <div data-dsh-plugin-surface="">
            {props.renderSlot ? props.renderSlot(NATIVE_PLUGIN_MANAGER_SEAT, {}, { entryKey: NATIVE_PLUGIN_MANAGER_KEY }) : <Text color="gray">{t('plugins.unavailable')}</Text>}
          </div>
        </div>
        {activeModel && props.renderSlot ? <PluginModelSettingsSurface key={activeModel.id} ctx={props.ctx} id={activeModel.id} renderSlot={props.renderSlot}
          sessionId={props.sessionId} locale={locale}
          renderProviders={() => <SettingsModelsSection ctx={props.ctx} writingScope={props.ctx.configForms.get('dsh-editor-writing')} showWritingRoutes={false} />}
          renderChatModel={() => <SettingsChatModelRoute ctx={props.ctx} writingScope={props.ctx.configForms.get('dsh-editor-writing')} />} /> : null}
        {active === 'zhihu' ? <PluginSettingsContent contribution={props.zhihu} fallback={null} /> : null}
        {activeLegacy && props.renderSlot ? <OfficialSettingsSectionPage renderSlot={props.renderSlot}
          sectionId={activeLegacy.id} version={legacy.version} sessionId={props.sessionId} locale={locale}
          onClose={() => setSelected('manage')} /> : null}
      </div>
    </div>
  </section>
}
