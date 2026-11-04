/** `plugin:<packageName>` 详情页：Editor 自己的插件详情，替代官方管理页。 */
import { Component, Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Badge, Button as ThemeButton, ConfirmDialog, Disclosure, EmptyState, Flex, Notice, SwitchControl, Text,
  Card, ChevronLeftIcon,
} from '../ui/index.ts'
import { t, useLocale } from '../i18n/index.ts'
import type { ShellContext } from './shared.ts'
import type { SettingsRenderSlot } from './settings-plugins.tsx'
import type { OfficialSettingsSection } from '../model/settings-plugins.ts'
import type { PluginManagerSnapshot, PluginManagerStore, BundleInfo } from './plugin-manager.ts'
import type { PluginConfigurationEntry } from '../model/plugin-configurations.ts'
import { installSpecOf, type ConfigLink } from '../model/plugins-page.ts'
import type { PluginCatalogCard, PluginCatalogSection, ChangeReceipt } from '../model/plugins-catalog.ts'
import { OfficialSettingsSectionPage } from './settings-plugins.tsx'
import { CatalogIcon } from './plugins-catalog.tsx'
import { catalogBadgeLabel } from '../model/plugins-catalog.ts'
import { SettingsGroup, SettingRow } from './settings-layout.tsx'
import { PluginSettingsContent } from './settings-plugins.tsx'
import { ConfigurationOutlet } from './plugin-configurations.tsx'

type ManagerBundle = BundleInfo

function cardOfPackage(sections: readonly PluginCatalogSection[], name: string): PluginCatalogCard | undefined {
  // bundle 卡优先；入口卡（entry:<id>，packageName 可能是运行时包而非
  // 管理器 bundle）次之。
  for (const section of sections) {
    const hit = section.items.find(card => card.key === `bundle:${name}`)
    if (hit) return hit
  }
  for (const section of sections) {
    const hit = section.items.find(card => card.packageName === name)
    if (hit) return hit
  }
  return undefined
}

function metaTextOf(value: unknown, locale: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const map = value as Record<string, unknown>
    const hit = map[locale] ?? map.zh ?? map.en
    if (typeof hit === 'string' && hit.trim()) return hit.trim()
  }
  return ''
}

export function PluginDetailPage(props: {
  packageName: string
  ctx: ShellContext
  renderSlot: SettingsRenderSlot
  entries: readonly PluginConfigurationEntry[]
  links: readonly ConfigLink[]
  catalogSections: readonly PluginCatalogSection[]
  legacy: { sections: OfficialSettingsSection[]; version: number }
  modelSections: readonly { id: string }[]
  zhihu?: ReactNode
  snapshot: PluginManagerSnapshot
  store: PluginManagerStore | undefined
  notice?: string
  onBack(): void
  onInstall(spec: string): void
  /** 非 bundle 目录卡的开关（如上游运行时组件），走目录卡的 toggle 路径。 */
  onToggleCard?(card: PluginCatalogCard, enabled: boolean): void
  /** model: 链接需要的 provider/chat 渲染器归设置页所有。 */
  renderModelSurface(id: string): ReactNode
  /** Configuration boundary identity version (config-entries ledger). */
  configVersion: number
}) {
  const locale = useLocale()
  const { snapshot, store } = props
  const name = props.packageName
  const bundle: ManagerBundle | undefined = snapshot.bundles.find(item => item.name === name)
  const card = cardOfPackage(props.catalogSections, name)
  const installSpec = bundle ? installSpecOf(bundle) : null
  const title = card?.title || metaTextOf(bundle?.meta?.title, locale) || name
  const description = card?.description || metaTextOf(bundle?.meta?.description, locale) || bundle?.description || ''
  const subject = {
    kind: 'bundle' as const,
    pkg: {
      name,
      ...(bundle?.version !== undefined ? { version: bundle.version } : {}),
      installed: bundle?.installed ?? false,
      availability: bundle?.availability ?? 'missing',
      official: bundle?.official ?? false,
      enabled: bundle?.enabled ?? false,
      rows: (bundle?.rows ?? []).map(row => ({ rowId: row.rowId, moduleName: row.moduleName, enabled: bundle?.enabled ?? false })),
    },
  }

  const [pending, setPending] = useState(false)
  const [pageError, setPageError] = useState('')
  const [exemptConfirm, setExemptConfirm] = useState<{ entry: { name: string; version: string; runtimeVersion: string }; retry: () => void } | undefined>()
  const [exemptions, setExemptions] = useState<Record<string, string[]>>({})
  const [removeConfirm, setRemoveConfirm] = useState(false)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (!store) return
    void store.listVersionExemptions().then(result => {
      if (result.ok && result.value) setExemptions(result.value.exemptions ?? {})
    }).catch(() => {})
  }, [store, snapshot.bundles])

  const runToggle = useCallback(async (enabled: boolean) => {
    if (!store || !bundle) return
    setPending(true); setPageError('')
    const receipt: ChangeReceipt = await store.setBundleEnabled(name, enabled)
    setPending(false)
    if (receipt.code === 'incompatible-version' && receipt.incompatible?.length) {
      setExemptConfirm({
        entry: receipt.incompatible[0],
        retry: () => { setExemptConfirm(undefined); void runToggle(enabled) },
      })
      return
    }
    if (!receipt.changed && receipt.message) setPageError(receipt.message)
  }, [store, bundle, name])

  const grantExemption = useCallback(async () => {
    if (!store || !exemptConfirm) return
    const { entry, retry } = exemptConfirm
    setPending(true)
    const result = await store.setVersionExemption(`${entry.name}@${entry.version}`, entry.runtimeVersion, true, true)
    setPending(false)
    if (!result.ok) { setPageError(result.error.message ?? t('plugins.unavailable')); setExemptConfirm(undefined); return }
    retry()
  }, [store, exemptConfirm])

  const revokeExemption = useCallback(async (packageVersion: string, runtimeVersion: string) => {
    if (!store) return
    setPending(true)
    const result = await store.setVersionExemption(packageVersion, runtimeVersion, false)
    setPending(false)
    if (!result.ok) setPageError(result.error.message ?? t('plugins.unavailable'))
    else setExemptions(prev => { const next = { ...prev }; delete next[packageVersion]; return next })
  }, [store])

  const runRemove = useCallback(async () => {
    if (!store) return
    setRemoving(true)
    const result = await store.removeBundle(name)
    setRemoving(false)
    if (!result.ok) { setPageError(result.error.message ?? t('plugins.unavailable')); setRemoveConfirm(false); return }
    props.onBack()
  }, [store, name, props])

  if (snapshot.status === 'ready' && !bundle && !card) {
    return <div className="dsh-settings-section" data-testid={`plugin-detail-seat-${name}`}>
      <EmptyState title={t('plugins.detailNotFound')} body={name}
        actions={<ThemeButton variant="secondary" data-testid="plugin-detail-back" onClick={props.onBack}>{t('plugins.detailBack')}</ThemeButton>} />
    </div>
  }

  const owner = { view: 'page' as const, close: props.onBack, locale }
  /* 配置组：bundle.config + row.config <name>#* + 行级 plugins.item + 编辑器侧页面 + detail.section。 */
  const formEntries = props.entries.filter(entry =>
    (entry.slot === 'plugins.bundle.config' && entry.entryKey === name)
    || (entry.slot === 'plugins.row.config' && typeof entry.entryKey === 'string' && entry.entryKey.startsWith(`${name}#`))
    || (entry.slot === 'plugins.item' && (bundle?.rows ?? []).some(row => row.entryId === entry.namespace || `plugins.item:${row.entryId}` === entry.id)))
  const editorLinks = props.links.filter(link => card && link.id === props.links.find(item => item.id === link.id)?.id
    && (link.entry?.entryKey === name || link.entry?.entryKey?.startsWith(`${name}#`)
      || (card.key.startsWith('entry:') && link.id === `official:${card.key.slice('entry:'.length)}`)
      || (card.entryId && (link.entry?.namespace === card.entryId))))
  const hasConfig = formEntries.length > 0 || editorLinks.length > 0

  const activeExemptions = Object.entries(exemptions)
    .flatMap(([packageVersion, versions]) => versions.map(runtimeVersion => ({ packageVersion, runtimeVersion })))
    .filter(item => item.packageVersion.startsWith(`${name}@`))

  return <div className="dsh-settings-section" data-testid={`plugin-detail-seat-${name}`}>
    <div className="dsh-settings-section__head">
      <ThemeButton variant="ghost" size="sm" data-testid="plugin-detail-back" onClick={props.onBack}
        icon={<ChevronLeftIcon size="sm" />}>
        {t('settings.pluginsInstalled')}
      </ThemeButton>
    </div>
    {props.notice ? <Notice tone="success" title={props.notice} /> : null}
    {pageError ? <Notice tone="danger" title={pageError} /> : null}

    <div className="plugin-detail-head">
      <CatalogIcon icon={card?.icon} title={title} kind={card ? (props.catalogSections.find(s => s.items.includes(card))?.id as 'official' | 'builtin' | 'user' | undefined) : undefined} />
      <div className="plugin-detail-head-text">
        <Flex align="center" gap="2" wrap="wrap">
          <h2 className="plugin-detail-title">{title}</h2>
          {card?.badges.map(badge => <Badge key={badge} tone="neutral">{catalogBadgeLabel(badge)}</Badge>)}
          {props.renderSlot('plugins.detail.badge', { subject })}
        </Flex>
        {description ? <Text as="p" size="1" color="gray">{description}</Text> : null}
      </div>
      <div className="plugin-detail-head-action">
        {bundle?.readOnlyReason
          ? <Text size="1" color="gray">{bundle.readOnlyReason}</Text>
          : bundle && installSpec
            ? <ThemeButton variant="primary" size="sm" data-testid="plugin-detail-install"
              onClick={() => props.onInstall(installSpec)}>{t('plugins.detailInstall')}</ThemeButton>
            : bundle
              ? <SwitchControl checked={bundle.enabled} disabled={pending}
                aria-label={title} data-testid="plugin-detail-toggle"
                onCheckedChange={(enabled) => void runToggle(enabled)} />
              : card && card.enabled !== undefined && !card.badges.includes('locked') && card.action === 'switch'
                ? <SwitchControl checked={card.enabled} disabled={pending}
                  aria-label={title} data-testid="plugin-detail-toggle"
                  onCheckedChange={(enabled) => props.onToggleCard?.(card, enabled)} />
                : null}
        {props.renderSlot('plugins.detail.actions', { subject })}
      </div>
    </div>

    {bundle?.error !== undefined && bundle.error !== null
      ? <Notice tone="danger" title={t('plugins.detailLoadError')}
        action={undefined}>
        {typeof bundle.error === 'object' && bundle.error && 'diagnostic' in (bundle.error as Record<string, unknown>)
          ? <Disclosure summary={t('plugins.detailDiagnostic')}>
            <pre className="plugin-detail-diagnostic">{String((bundle.error as Record<string, unknown>).diagnostic ?? bundle.error)}</pre>
          </Disclosure>
          : <pre className="plugin-detail-diagnostic">{String(bundle.error)}</pre>}
      </Notice>
      : null}

    {activeExemptions.map(item => <Notice key={`${item.packageVersion}@${item.runtimeVersion}`} tone="warning"
      title={t('plugins.exemptActive', { version: item.packageVersion })}
      action={<ThemeButton variant="secondary" size="sm" disabled={pending}
        data-testid={`plugin-detail-exempt-revoke-${item.packageVersion}`}
        onClick={() => void revokeExemption(item.packageVersion, item.runtimeVersion)}>{t('plugins.exemptRevoke')}</ThemeButton>} />)}

    <SettingsGroup title={t('plugins.detailConfig')}>
      {hasConfig ? <div data-dsh-plugin-surface="">
        {formEntries.map(entry => <ConfigBoundary key={entry.id} identity={entry.id}>
          {/* data-plugin-config is the official DOM contract upstream plugins
              scope their injected styles to; the module class is not reused. */}
          <section data-plugin-config>
            <ConfigurationOutlet ctx={props.ctx} renderSlot={props.renderSlot} entry={entry}
              version={props.configVersion} locale={locale} onClose={props.onBack} />
          </section>
        </ConfigBoundary>)}
        {editorLinks.map(link => <ConfigBoundary key={link.id} identity={`editor:${link.id}`}>
          {link.id.startsWith('official:')
            ? <OfficialSettingsSectionPage renderSlot={props.renderSlot} sectionId={link.id.slice('official:'.length)}
              version={props.legacy.version} locale={locale} onClose={props.onBack} />
            : link.id.startsWith('model:')
              ? props.renderModelSurface(link.id.slice('model:'.length))
              : <PluginSettingsContent contribution={props.zhihu} fallback={null} />}
        </ConfigBoundary>)}
        <ConfigBoundary identity={`detail-section:${name}`}>
          {props.renderSlot('plugins.detail.section', { subject })}
        </ConfigBoundary>
      </div>
        : <Text size="1" color="gray" className="plugin-detail-empty">{t('plugins.detailNoConfig')}</Text>}
    </SettingsGroup>

    {bundle ? <Card className="settings-block plugin-detail-components">
      <Disclosure summary={t('plugins.detailComponentsCount', { count: bundle.rows.length })} defaultOpen={Boolean(bundle.error)}>
        <ul className="plugin-detail-rows">
          {bundle.rows.map(row => <li key={row.rowId} className="plugin-detail-row">
            <span className="plugin-detail-row-title">{metaTextOf(row.meta?.title, locale) || row.rowId}</span>
            <span className="plugin-detail-row-meta">{row.moduleName}</span>
          </li>)}
          {!bundle.rows.length ? <li className="plugin-detail-row">{name}</li> : null}
        </ul>
      </Disclosure>
    </Card> : null}

    {bundle ? <SettingsGroup title={t('plugins.detailInfo')}>
      <SettingRow title={t('plugins.detailName')}><Text size="1">{name}</Text></SettingRow>
      <SettingRow title={t('plugins.detailVersion')}><Text size="1">{bundle.version ?? '—'}</Text></SettingRow>
      <SettingRow title={t('plugins.detailSource')}><Text size="1">{bundle.source ?? bundle.installTarget?.spec ?? '—'}</Text></SettingRow>
      <SettingRow title={t('plugins.detailAvailability')}><Text size="1">{t(`plugins.availability.${bundle.availability}` as never)}</Text></SettingRow>
    </SettingsGroup> : null}

    {/* 非 bundle 的目录卡（上游运行时组件）只有包名一条信息。 */}
    {!bundle && card ? <SettingsGroup title={t('plugins.detailInfo')}>
      <SettingRow title={t('plugins.detailName')}><Text size="1">{name}</Text></SettingRow>
    </SettingsGroup> : null}

    {bundle ? <SettingsGroup title={t('plugins.detailRemove')}>
      {bundle.installed && bundle.removable && !bundle.readOnlyReason
        ? <SettingRow title={t('plugins.detailUninstall')} description={t('plugins.uninstallHint')}>
          <ThemeButton variant="danger" size="sm" data-testid={`plugin-detail-uninstall-${name}`}
            onClick={() => setRemoveConfirm(true)}>{t('plugins.detailUninstall')}</ThemeButton>
        </SettingRow>
        : <SettingRow title={t('plugins.detailUninstall')} description={bundle.readOnlyReason ?? ''}>
          <span />
        </SettingRow>}
    </SettingsGroup> : null}

    <ConfirmDialog open={exemptConfirm !== undefined} onOpenChange={open => { if (!open) setExemptConfirm(undefined) }}
      title={t('plugins.exemptTitle')} tone="danger" busy={pending}
      message={t('plugins.exemptRisk', { name })}
      confirmLabel={t('plugins.exemptEnable')} cancelLabel={t('common.cancel')}
      onConfirm={() => void grantExemption()}
      onCancel={() => setExemptConfirm(undefined)} />
    <ConfirmDialog open={removeConfirm} onOpenChange={open => { if (!open) setRemoveConfirm(false) }}
      title={t('plugins.uninstallTitle', { title })} tone="danger" busy={removing}
      message={t('plugins.uninstallMessage')}
      confirmLabel={t('plugins.detailUninstall')} cancelLabel={t('common.cancel')}
      onConfirm={() => void runRemove()}
      onCancel={() => setRemoveConfirm(false)} />
  </div>
}

/* 配置槽位逐项隔离：任一项抛错不拖垮详情页其他配置。 */
class ConfigBoundary extends Component<{ identity: string; children: ReactNode }, { nonce: number }> {
  state = { nonce: 0 }
  static getDerivedStateFromError() { return null }
  componentDidCatch(error: unknown) {
    console.error(`plugin detail config ${this.props.identity} failed`, error)
    this.setState(prev => ({ nonce: prev.nonce + 1 }))
  }
  render() { return <Fragment key={this.state.nonce}>{this.props.children}</Fragment> }
}
