/**
 * Three-class plugin catalog for the global plugins page.
 *
 * The contract below mirrors the private plugins bundle (`/dsh-editor-plugins`)
 * so the shell can render it without a package dependency. Every value is
 * normalized: an unknown shape drops one card instead of the whole page.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Badge, Button as ThemeButton, Callout, Flex, Heading, Switch, Text } from '@radix-ui/themes'
import { t } from '../i18n/index.ts'
import { errorMessage, safeRpcCall } from './shared.ts'
import {
  advancedCatalogCard,
  catalogBadgeLabel,
  catalogIconSource,
  catalogSectionLabel,
  catalogSectionsOf,
  catalogToggleRequest,
  changeReceipt,
  filterCatalogSections,
  filterWritingPresets,
  newUserCardKeys,
  presetEnabledRequest,
  rpcCallerOf,
  userSectionKeys,
  writingPresetsOf,
  CATALOG_ENDPOINT,
  PLUGINS_RPC_CHANNEL,
  PRESETS_ENDPOINT,
  type CatalogStatus,
  type PluginCatalogBundle,
  type PluginCatalogCard,
  type PluginCatalogSection,
  type PresetsStatus,
  type WritingPresetCard,
  type WritingPresetsBundle,
} from '../model/plugins-catalog.ts'
import { ActivityText, Button } from './ui/index.ts'

export function usePluginCatalog(ctx: unknown): PluginCatalogBundle {
  const [sections, setSections] = useState<PluginCatalogSection[] | null>(null)
  const [error, setError] = useState('')
  const [request, setRequest] = useState(0)
  const [pending, setPending] = useState('')
  const [actionError, setActionError] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  useEffect(() => {
    const call = rpcCallerOf(ctx)
    let live = true
    if (!call) {
      setError(t('plugins.catalogUnavailable'))
      return
    }
    void safeRpcCall<unknown>(() => call(PLUGINS_RPC_CHANNEL, CATALOG_ENDPOINT, {})).then((result) => {
      if (!live) return
      if (!result.ok) { setError(errorMessage(result) || t('plugins.catalogError')); return }
      setSections(catalogSectionsOf(result.value))
      setError('')
    })
    return () => { live = false }
  }, [ctx, request])
  const reload = useCallback(() => { setRequest((value) => value + 1) }, [])
  const toggle = useCallback(async (card: PluginCatalogCard, enabled: boolean) => {
    const call = rpcCallerOf(ctx)
    if (pending) return
    setPending(card.key)
    setActionError('')
    const shape = catalogToggleRequest(card, enabled)
    if (!call || !shape) {
      setPending('')
      setActionError(t('plugins.catalogToggleUnsupported'))
      return
    }
    const result = await safeRpcCall<unknown>(() => call(shape.channel, shape.endpoint, shape.payload))
    setPending('')
    if (!result.ok) { setActionError(errorMessage(result) || t('plugins.catalogError')); return }
    // The service answers with a ChangeResult receipt even when the write failed.
    const receipt = changeReceipt(result.value)
    if (receipt.application === 'failed') {
      setActionError(receipt.message || t('plugins.catalogError'))
      reload()
      return
    }
    // overridden means a higher-priority configuration won; the author must see that.
    if (receipt.application === 'overridden') setActionError(t('plugins.catalogOverridden'))
    else if (receipt.application === 'restart-required') setRestartRequired(true)
    reload()
  }, [ctx, pending, reload])
  const status: CatalogStatus = sections ? 'ready' : error ? 'error' : 'loading'
  return { status, sections: sections ?? [], error, pending, actionError, restartRequired, reload, toggle }
}

export function useWritingPresets(ctx: unknown): WritingPresetsBundle {
  const [presets, setPresets] = useState<WritingPresetCard[] | null>(null)
  const [error, setError] = useState('')
  const [request, setRequest] = useState(0)
  const [pending, setPending] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  useEffect(() => {
    const call = rpcCallerOf(ctx)
    let live = true
    if (!call) { setError(t('plugins.catalogUnavailable')); return }
    void safeRpcCall<unknown>(() => call(PLUGINS_RPC_CHANNEL, PRESETS_ENDPOINT, {})).then((result) => {
      if (!live) return
      if (!result.ok) { setError(errorMessage(result) || t('plugins.catalogError')); return }
      setPresets(writingPresetsOf(result.value))
      setError('')
    })
    return () => { live = false }
  }, [ctx, request])
  const setEnabled = useCallback(async (preset: WritingPresetCard, enabled: boolean) => {
    const call = rpcCallerOf(ctx)
    if (!call || pending) return
    setPending(preset.id)
    setError('')
    const shape = presetEnabledRequest(preset, enabled)
    const result = await safeRpcCall<{ restartRequired?: boolean }>(() => call(shape.channel, shape.endpoint, shape.payload))
    setPending('')
    if (!result.ok) { setError(errorMessage(result) || t('plugins.catalogError')); return }
    setRestartRequired(result.value?.restartRequired === true)
    setRequest((value) => value + 1)
  }, [ctx, pending])
  const status: PresetsStatus = presets ? 'ready' : error ? 'error' : 'loading'
  return { status, presets: presets ?? [], error, pending, restartRequired, setEnabled }
}

function monogramOf(title: string): string {
  return [...title.trim()][0]?.toLocaleUpperCase() ?? '·'
}

/** The icon tile shows the author's brand art, or the title's monogram. */
export function CatalogIcon(props: { icon?: string; title: string }) {
  const [failed, setFailed] = useState('')
  const source = catalogIconSource({ icon: props.icon, title: props.title }, failed)
  return <span className="plugins-catalog-icon" aria-hidden="true">
    {source
      ? <img className="plugins-catalog-icon-image" src={source} alt="" onError={() => setFailed(source)} />
      : monogramOf(props.title)}
  </span>
}

export function CatalogRow(props: {
  card: PluginCatalogCard
  pending: boolean
  /** True when the row also reaches a 插件配置 page and may offer the secondary control. */
  configurable: boolean
  /** True while a freshly installed user card carries its transient highlight. */
  highlighted: boolean
  onToggle(card: PluginCatalogCard, enabled: boolean): void
  onConfigure(card: PluginCatalogCard): void
  onDetail(card: PluginCatalogCard): void
}) {
  const card = props.card
  return <li className={props.highlighted ? 'plugins-catalog-row is-new' : 'plugins-catalog-row'}
    data-testid={`plugins-catalog-row-${card.key}`}>
    <CatalogIcon icon={card.icon} title={card.title} />
    <div className="plugins-catalog-row-text">
      <Flex className="plugins-catalog-row-head" align="center" gap="2">
        <Text className="plugins-catalog-row-title">{card.title}</Text>
        {card.badges.map((badge) => <Badge key={badge} variant="soft" color="gray" className="plugins-catalog-badge">
          {catalogBadgeLabel(badge)}
        </Badge>)}
      </Flex>
      {card.description
        ? <Text as="p" size="1" color="gray" className="plugins-catalog-row-desc" title={card.description}>{card.description}</Text>
        : null}
    </div>
    <div className="plugins-catalog-row-action">
      {card.action === 'switch'
        ? <>
          {props.configurable
            ? <ThemeButton variant="ghost" color="gray" className="plugins-catalog-action"
              data-testid={`plugins-catalog-config-${card.key}`} onClick={() => props.onConfigure(card)}>
              {t('plugins.catalogConfigure')}
            </ThemeButton>
            : null}
          <Switch className="plugins-catalog-switch" checked={card.enabled === true} disabled={props.pending}
            aria-label={card.title} data-testid={`plugins-catalog-toggle-${card.key}`}
            onCheckedChange={(enabled) => props.onToggle(card, enabled)} />
        </>
        : card.action === 'config'
          ? <ThemeButton variant="ghost" color="gray" className="plugins-catalog-action"
            data-testid={`plugins-catalog-config-${card.key}`} onClick={() => props.onConfigure(card)}>
            {t('plugins.catalogConfigure')}
          </ThemeButton>
          : <ThemeButton variant="ghost" color="gray" className="plugins-catalog-action"
            data-testid={`plugins-catalog-detail-${card.key}`} onClick={() => props.onDetail(card)}>
            {t('plugins.catalogDetails')}
          </ThemeButton>}
    </div>
  </li>
}

function PresetRow(props: {
  preset: WritingPresetCard
  pending: boolean
  onToggle(preset: WritingPresetCard, enabled: boolean): void
}) {
  const preset = props.preset
  return <li className="plugins-catalog-row" data-testid={`plugins-catalog-preset-${preset.id}`}>
    <CatalogIcon title={preset.title} />
    <div className="plugins-catalog-row-text">
      <Flex className="plugins-catalog-row-head" align="center" gap="2">
        <Text className="plugins-catalog-row-title">{preset.title}</Text>
        {preset.locked ? <Badge variant="soft" color="gray" className="plugins-catalog-badge">
          {t('plugins.badgeRequired')}
        </Badge> : null}
      </Flex>
      {preset.description
        ? <Text as="p" size="1" color="gray" className="plugins-catalog-row-desc" title={preset.description}>{preset.description}</Text>
        : null}
    </div>
    <div className="plugins-catalog-row-action">
      {preset.locked
        ? <Text size="1" color="gray" className="plugins-catalog-preset-locked">{t('plugins.badgeRequired')}</Text>
        : <Switch className="plugins-catalog-switch" checked={preset.enabled} disabled={props.pending}
          aria-label={preset.title} data-testid={`plugins-catalog-preset-toggle-${preset.id}`}
          onCheckedChange={(enabled) => props.onToggle(preset, enabled)} />}
    </div>
  </li>
}

function CatalogSection(props: {
  section: PluginCatalogSection
  presets: readonly WritingPresetCard[]
  query: string
  pending: string
  presetPending: string
  presetError: string
  restartRequired: boolean
  configKeys: readonly string[]
  /** Keys of user cards that just appeared, carrying the transient highlight. */
  freshKeys: readonly string[]
  /** The user section anchors the install scroll; other sections do not move. */
  sectionRef?: RefObject<HTMLElement>
  onToggle(card: PluginCatalogCard, enabled: boolean): void
  onTogglePreset(preset: WritingPresetCard, enabled: boolean): void
  onConfigure(card: PluginCatalogCard): void
  onDetail(card: PluginCatalogCard): void
}) {
  const { section } = props
  const items = section.items
  const ordinary = section.id === 'user' ? items : items.filter(card => !advancedCatalogCard(card))
  const advanced = section.id === 'user' ? [] : items.filter(advancedCatalogCard)
  const presets = section.id === 'builtin' ? props.presets : []
  const count = items.length + presets.length
  const empty = props.query.trim()
    ? t('plugins.catalogNoMatch')
    : section.id === 'user' ? t('plugins.catalogUserEmpty') : t('plugins.catalogEmpty')
  return <section className="plugins-catalog-section" ref={props.sectionRef}
    data-testid={`plugins-catalog-${section.id}`}>
    <Flex className="plugins-catalog-head" align="baseline" justify="between" gap="3">
      <Heading as="h2" size="3" className="plugins-catalog-title">{catalogSectionLabel(section.id)}</Heading>
      <Text size="1" color="gray" className="plugins-catalog-count">{count}</Text>
    </Flex>
    {ordinary.length
      ? <ul className="plugins-catalog-rows">{ordinary.map((card) => <CatalogRow key={card.key} card={card}
        pending={props.pending === card.key} configurable={props.configKeys.includes(card.key)}
        highlighted={props.freshKeys.includes(card.key)}
        onToggle={props.onToggle} onConfigure={props.onConfigure} onDetail={props.onDetail} />)}</ul>
      : null}
    {advanced.length ? <details className="plugins-catalog-advanced" open={props.query.trim() ? true : undefined}>
      <summary>{t('plugins.catalogAdvanced')} ({advanced.length})</summary>
      <Text as="p" size="1" color="gray" className="plugins-catalog-hint">{t('plugins.catalogAdvancedHint')}</Text>
      <ul className="plugins-catalog-rows">{advanced.map(card => <CatalogRow key={card.key} card={card}
        pending={props.pending === card.key} configurable={props.configKeys.includes(card.key)} highlighted={false}
        onToggle={props.onToggle} onConfigure={props.onConfigure} onDetail={props.onDetail} />)}</ul>
    </details> : null}
    {presets.length
      ? <div className="plugins-catalog-subsection">
        <Heading as="h3" size="2" className="plugins-catalog-subsection-title">{t('plugins.catalogPresets')}</Heading>
        <ul className="plugins-catalog-rows">{presets.map((preset) => <PresetRow key={preset.id} preset={preset}
          pending={props.presetPending === preset.id} onToggle={props.onTogglePreset} />)}</ul>
        <Text as="p" size="1" color="gray" className="plugins-catalog-hint">{t('plugins.catalogPresetHint')}</Text>
      </div>
      : null}
    {section.id === 'builtin' && props.presetError
      ? <Text as="p" size="1" color="red" role="alert" className="plugins-catalog-hint">{props.presetError}</Text>
      : null}
    {count ? null : <Text as="p" size="2" color="gray" className="plugins-catalog-empty">{empty}</Text>}
  </section>
}

const INSTALL_HIGHLIGHT_CLASS = 'is-new'
/** Only used when the environment reports no computed animation duration at all. */
const INSTALL_HIGHLIGHT_FALLBACK_MS = 2000

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * The highlight length is the CSS animation's own token-derived duration, read
 * back from the rendered row, so the class never outlives its own animation.
 * A missing row or a host without computed styles falls back to the caller.
 */
function animationMs(element: Element | null | undefined): number {
  if (!element || typeof globalThis.getComputedStyle !== 'function') return 0
  const raw = globalThis.getComputedStyle(element).animationDuration
  const first = raw?.split(',')[0]?.trim() ?? ''
  const value = Number.parseFloat(first)
  if (!Number.isFinite(value)) return 0
  return first.endsWith('ms') ? value : value * 1000
}

/**
 * The author's own bundles sit far below the fold, and the depth only matters
 * in one moment: right after installing one and returning to 插件总览. So a
 * refresh that grows the user section anchors to it and marks the new rows,
 * without adding a section or reordering the approved 官方/内置/用户 classes.
 *
 * `visible` is the current query's view: anchoring to a row the author has
 * filtered out would move them away from the search they are running.
 */
export function useInstalledUserCards(
  sections: readonly PluginCatalogSection[],
  status: CatalogStatus,
  visible: readonly string[],
): { freshKeys: readonly string[]; userSection: RefObject<HTMLElement> } {
  const userSection = useRef<HTMLElement>(null)
  const seen = useRef<readonly string[] | null>(null)
  const [freshKeys, setFreshKeys] = useState<readonly string[]>([])
  useEffect(() => {
    // A loading or failed catalog carries no inventory; it must not reset the baseline.
    if (status !== 'ready') return
    const keys = userSectionKeys(sections)
    const previous = seen.current
    // The baseline is the whole catalog, so a later query change never reads
    // as an installation; only what the refresh really added does.
    seen.current = keys
    // The first ready read is the page's own load, not an installation.
    if (!previous) return
    const added = newUserCardKeys(previous, keys).filter((key) => visible.includes(key))
    if (!added.length) return
    /* Reduced motion keeps the anchor scroll, which is information the author
       asked for, and drops the decorative highlight entirely. */
    if (prefersReducedMotion()) {
      userSection.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
      return
    }
    userSection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setFreshKeys(added)
  }, [sections, status, visible])
  useEffect(() => {
    if (!freshKeys.length) return
    const duration = animationMs(userSection.current?.querySelector(`.${INSTALL_HIGHLIGHT_CLASS}`))
    const timer = globalThis.setTimeout(
      () => setFreshKeys([]),
      duration || INSTALL_HIGHLIGHT_FALLBACK_MS,
    )
    return () => globalThis.clearTimeout(timer)
  }, [freshKeys])
  return { freshKeys, userSection }
}

export function PluginsCatalog(props: {
  status: CatalogStatus
  sections: readonly PluginCatalogSection[]
  error?: string
  query: string
  pending: string
  actionError: string
  /** Card keys whose row may offer the secondary 配置 control beside its switch. */
  configKeys?: readonly string[]
  presets?: readonly WritingPresetCard[]
  presetError?: string
  presetPending?: string
  restartRequired?: boolean
  onRetry?(): void
  onToggle(card: PluginCatalogCard, enabled: boolean): void
  onTogglePreset(preset: WritingPresetCard, enabled: boolean): void
  onConfigure(card: PluginCatalogCard): void
  onDetail(card: PluginCatalogCard): void
}) {
  const sections = useMemo(
    () => filterCatalogSections(props.sections, props.query),
    [props.sections, props.query],
  )
  const presets = useMemo(
    () => filterWritingPresets(props.presets ?? [], props.query),
    [props.presets, props.query],
  )
  const visibleUserKeys = useMemo(() => userSectionKeys(sections), [sections])
  const { freshKeys, userSection } = useInstalledUserCards(props.sections, props.status, visibleUserKeys)
  const body: ReactNode = props.status === 'loading'
    ? <ActivityText className="plugins-catalog-loading">{t('plugins.catalogLoading')}</ActivityText>
    : props.status === 'error'
      ? <Callout.Root color="red" role="alert" className="warning pad" data-testid="plugins-catalog-error">
        <Callout.Text>{props.error || t('plugins.catalogError')}</Callout.Text>
        {props.onRetry
          ? <Button type="button" onClick={props.onRetry}>{t('common.retry')}</Button>
          : null}
      </Callout.Root>
      : <>
        {props.actionError
          ? <Callout.Root color="red" role="alert" className="warning pad" data-testid="plugins-catalog-action-error">
            <Callout.Text>{props.actionError}</Callout.Text>
          </Callout.Root>
          : null}
        {props.restartRequired
          ? <Text as="p" size="1" color="red" role="alert" className="plugins-catalog-hint">{t('plugins.catalogPresetRestart')}</Text>
          : null}
        {sections.map((section) => <CatalogSection key={section.id} section={section} presets={presets}
          query={props.query} pending={props.pending} presetPending={props.presetPending ?? ''}
          presetError={props.presetError ?? ''} restartRequired={props.restartRequired === true}
          configKeys={props.configKeys ?? []} freshKeys={freshKeys}
          sectionRef={section.id === 'user' ? userSection : undefined}
          onToggle={props.onToggle} onTogglePreset={props.onTogglePreset}
          onConfigure={props.onConfigure} onDetail={props.onDetail} />)}
      </>
  return <section className="plugins-catalog" data-testid="plugins-catalog">{body}</section>
}
