import type { Context } from '@deepseek-ai/cordis'
import { createElement as e, useCallback, useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode, type RefObject } from 'react'
import {
  PLUGINS_RPC_CHANNEL,
  PLUGINS_SETTINGS_SLOT,
  type MarketplaceListing,
  type PluginCard,
  type PluginInspectReport,
  type PluginInventory,
  type PluginsRpcResult,
} from './contracts.ts'
import { pluginsClientStyles } from './client-styles.ts'
import {
  authorPluginError,
  enabledState,
  groupByPackage,
  groupOptionalFeatures,
  toggleableCards,
  type FeatureGroupView,
} from './client-groups.ts'

export const name = 'dsh-editor-plugins-client'
export const inject = ['slots', 'connection'] as const

type RpcCaller = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
}
type SlotHandle = {
  inject: (key: string, callback: () => unknown) => unknown
  register: (spec: { name: string; id?: string; order?: number; label?: string }, render: unknown) => unknown
}
type PluginsClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
}

function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-plugins-styles', '')
  style.textContent = pluginsClientStyles
  document.head.appendChild(style)
  return () => style.remove()
}

async function callRpc<T>(caller: RpcCaller, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<PluginsRpcResult<T>> {
  return await caller.call(PLUGINS_RPC_CHANNEL, endpoint, payload, signal) as PluginsRpcResult<T>
}

function errorText(result: PluginsRpcResult<unknown> | undefined, fallback: string): string {
  if (!result || result.ok) return fallback
  return authorPluginError(result.error.message, fallback, result.error.details).message
}

function errorView(result: PluginsRpcResult<unknown> | undefined, fallback: string): { message: string; detail?: string } {
  if (!result || result.ok) return { message: fallback }
  return authorPluginError(result.error.message, fallback, result.error.details)
}

function toggleTestId(card: PluginCard): string {
  const id = card.entryId.includes(':') ? card.entryId.slice(card.entryId.indexOf(':') + 1) : card.entryId
  return `plugins-toggle-${id}`
}

function phaseLabel(card: PluginCard): string {
  if (!card.enabled) return '已停用'
  if (card.fiberPhase === 'failed') return '启用失败'
  if (card.fiberPhase === 'pending' || card.fiberPhase === 'loading') return '启动中'
  if (card.fiberPhase === 'unloading') return '正在停用'
  return '已启用'
}

function Switch(props: {
  checked: boolean
  mixed?: boolean
  disabled?: boolean
  busy?: boolean
  labelledBy?: string
  describedBy?: string
  testId?: string
  onToggle(): void
}) {
  return e('button', {
    type: 'button',
    role: 'switch',
    className: `dsh-plugins-switch${props.checked ? ' is-on' : ''}${props.mixed ? ' is-mixed' : ''}${props.busy ? ' is-pending' : ''}`,
    'aria-checked': props.checked,
    'aria-labelledby': props.labelledBy,
    'aria-describedby': props.describedBy,
    'data-testid': props.testId,
    disabled: props.disabled || props.busy,
    onClick: () => { if (!props.disabled && !props.busy) props.onToggle() },
    onKeyDown: (event: { key: string; preventDefault(): void }) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      if (!props.disabled && !props.busy) props.onToggle()
    },
  }, e('span', { className: 'dsh-plugins-switch-thumb', 'aria-hidden': true }))
}

function FeatureCard(props: {
  groupId: string
  title: string
  description: string
  composition: string[]
  cards: PluginCard[]
  busy: boolean
  onToggle(cards: PluginCard[], enabled: boolean): void
  onUninstall?(card: PluginCard): void
}) {
  const { cards } = props
  const primary = cards[0]!
  const titleId = `plugin-title-${props.groupId.replace(/[^A-Za-z0-9._-]+/g, '-')}`
  const mixedId = `${titleId}-mixed`
  const state = enabledState(cards)
  const mixed = state === 'mixed'
  const phases = [...new Set(cards.map(phaseLabel))]
  const alert = mixed
    ? '部分启用'
    : phases.find((item) => item === '启用失败' || item === '启动中' || item === '正在停用')
  const extras = [
    primary.origin === 'installed' ? '已从市场安装' : '',
    primary.version ? primary.version : '',
    ...props.composition,
  ].filter(Boolean)
  const locked = cards.every((card) => card.locked)
  return e('article', { className: 'dsh-plugins-card', 'data-testid': `plugins-card-${primary.entryId}` },
    e('div', null,
      e('div', { id: titleId, className: 'dsh-plugins-card-title' }, props.title),
      e('div', { className: 'dsh-plugins-card-desc' }, props.description),
      alert
        ? e('div', { id: mixed ? mixedId : undefined, className: 'dsh-plugins-meta' }, alert)
        : null,
      extras.length > 0
        ? e('details', { className: 'dsh-plugins-composition' },
          e('summary', null, '详情'),
          e('ul', null, extras.map((row) => e('li', { key: row }, row))),
        )
        : null,
    ),
    e('div', { className: 'dsh-plugins-actions' },
      locked
        ? e('span', { className: 'dsh-plugins-locked' }, '核心')
        : e(Switch, {
          checked: state === true,
          mixed,
          busy: props.busy,
          labelledBy: titleId,
          describedBy: mixed ? mixedId : undefined,
          testId: `plugins-toggle-${props.groupId.includes('/') ? toggleTestId(primary) : props.groupId}`,
          onToggle: () => props.onToggle(toggleableCards(cards), state !== true),
        }),
      primary.origin === 'installed' && props.onUninstall
        ? e('button', {
          type: 'button',
          className: 'dsh-plugins-ghost',
          disabled: props.busy,
          onClick: () => props.onUninstall?.(primary),
        }, '卸载')
        : null,
    ),
  )
}

type HostDialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: string
  children?: ReactNode
  className?: string
  overlayClassName?: string
  dismissible?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
}

type PluginToggle = (cards: PluginCard[], enabled: boolean) => void

const VERDICT_LABEL = {
  ready: '静态检查认为可以挂上',
  warn: '能装，但可能看不见界面或版本不确定',
  blocked: '装了也不会生效',
} as const

function InspectReportView(props: { report: PluginInspectReport }) {
  const { report } = props
  return e('div', { className: `dsh-plugins-inspect dsh-plugins-inspect-${report.verdict}`, 'data-testid': 'plugins-inspect', role: 'status' },
    e('p', { className: 'dsh-plugins-inspect-verdict' }, VERDICT_LABEL[report.verdict],
      report.name ? ` · ${report.name}${report.version ? `@${report.version}` : ''}` : ''),
    report.entries.length
      ? e('p', { className: 'dsh-plugins-meta' }, `将挂入口：${report.entries.map((entry) => entry.id).join('、')}`)
      : null,
    report.findings.length
      ? e('ul', { className: 'dsh-plugins-findings' },
        report.findings.map((item, index) => e('li', {
          key: `${item.code}:${index}`,
          className: `dsh-plugins-finding dsh-plugins-finding-${item.severity}`,
        }, item.message)),
      )
      : null,
  )
}

function CoreGroup(props: { cards: PluginCard[] }) {
  if (props.cards.length === 0) return e('section', { className: 'dsh-plugins-group' },
    e('h3', null, '系统核心'),
    e('p', { className: 'dsh-plugins-empty' }, '未找到核心插件。'),
  )
  return e('section', { className: 'dsh-plugins-group' },
    e('details', { className: 'dsh-plugins-core' },
      e('summary', null, `系统核心（${props.cards.length}）`),
      e('p', { className: 'dsh-plugins-core-hint' }, '写作必需的部分，不能关闭。'),
      e('ul', { className: 'dsh-plugins-core-list' },
        props.cards.map((card) => e('li', { key: card.entryId },
          e('span', { className: 'dsh-plugins-card-title' }, card.title),
          e('span', { className: 'dsh-plugins-card-desc' }, card.description),
        )),
      ),
    ),
  )
}

function FeatureGroup(props: {
  title: string
  cards: PluginCard[]
  empty: string
  busyPackage: string | null
  onToggle: PluginToggle
  onUninstall?: (card: PluginCard) => void
  byPurpose?: boolean
}) {
  const groups: FeatureGroupView[] = props.byPurpose
    ? groupOptionalFeatures(props.cards)
    : groupByPackage(props.cards).map((cards) => ({
      id: cards[0]!.packageName,
      title: cards[0]!.title,
      description: cards.map((card) => card.description).filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join('；'),
      cards,
      composition: cards.map((card) => `${card.title}（${card.packageName}）`),
    }))
  if (groups.length === 0) return e('section', { className: 'dsh-plugins-group' },
    e('h3', null, props.title),
    e('p', { className: 'dsh-plugins-empty' }, props.empty),
  )
  return e('section', { className: 'dsh-plugins-group' },
    e('h3', null, props.title),
    groups.map((group) => e(FeatureCard, {
      key: group.id,
      groupId: group.id,
      title: group.title,
      description: group.description,
      composition: group.composition,
      cards: group.cards,
      busy: props.busyPackage === group.id || group.cards.some((card) => card.packageName === props.busyPackage),
      onToggle: props.onToggle,
      onUninstall: props.onUninstall,
    })),
  )
}

type PluginPanelProps = {
  inventory: PluginInventory | null
  listings: MarketplaceListing[]
  tab: 'installed' | 'market'
  query: string
  spec: string
  loading: boolean
  searching: boolean
  installing: boolean
  inspecting: boolean
  inspect: PluginInspectReport | null
  pendingUninstall: PluginCard | null
  error: string
  errorDetail?: string
  note: string
  onTab(tab: 'installed' | 'market'): void
  onQuery(value: string): void
  onSearch(): void
  onSpec(value: string): void
  onInstall(spec: string): void
  onInspect(spec: string): void
  onToggle(cards: PluginCard[], enabled: boolean): void
  busyPackage: string | null
  onUninstall(card: PluginCard): void
  onConfirmUninstall(): void
  onCancelUninstall(): void
  Dialog?: ComponentType<HostDialogProps>
}

function UninstallConfirm(props: {
  card: PluginCard | null
  Dialog?: ComponentType<HostDialogProps>
  onConfirm(): void
  onCancel(): void
}) {
  const cancel = useRef<HTMLButtonElement | null>(null)
  const HostDialog = props.Dialog
  if (HostDialog) {
    return e(HostDialog, {
      open: Boolean(props.card),
      onOpenChange: (next: boolean) => { if (!next) props.onCancel() },
      title: '卸载插件',
      description: props.card ? `卸载 ${props.card.title}？作品文件不会被删除，但需要重启后才会卸下。` : '',
      className: 'file-dialog confirm-dialog',
      overlayClassName: 'file-dialog-overlay confirm-overlay',
      initialFocusRef: cancel,
    },
      e('header', null, e('h2', null, '卸载插件')),
      e('p', null, props.card ? `卸载 ${props.card.title}？作品文件不会被删除，但需要重启后才会卸下。` : ''),
      e('footer', null,
        e('button', { ref: cancel, type: 'button', onClick: props.onCancel }, '取消'),
        e('button', { type: 'button', className: 'danger-action', onClick: props.onConfirm }, '确认卸载'),
      ),
    )
  }
  if (!props.card) return null
  return e('p', { className: 'dsh-plugins-note', role: 'alertdialog' },
    `卸载 ${props.card.title}？作品文件不会被删除，但需要重启后才会卸下。`,
    ' ',
    e('button', { type: 'button', className: 'dsh-plugins-primary', onClick: props.onConfirm }, '确认卸载'),
    ' ',
    e('button', { type: 'button', className: 'dsh-plugins-ghost', onClick: props.onCancel }, '取消'),
  )
}

function PluginPanel(props: PluginPanelProps) {
  const onSearchSubmit = (event: FormEvent) => { event.preventDefault(); props.onSearch() }
  const onInstallSubmit = (event: FormEvent) => { event.preventDefault(); props.onInstall(props.spec) }
  return e('section', { className: 'dsh-plugins', 'data-testid': 'plugins-settings', 'aria-label': '插件' },
    e('p', { className: 'dsh-plugins-intro' }, '写作界面本身不能关闭。可选功能可以按套开关；从市场安装前可以先检查能不能用。'),
    e('div', { className: 'dsh-plugins-tabs', role: 'tablist', 'aria-label': '插件分类' },
      e('button', { type: 'button', role: 'tab', 'aria-selected': props.tab === 'installed', 'data-testid': 'plugins-tab-installed', onClick: () => props.onTab('installed') }, '已安装'),
      e('button', { type: 'button', role: 'tab', 'aria-selected': props.tab === 'market', 'data-testid': 'plugins-tab-market', onClick: () => props.onTab('market') }, '市场'),
    ),
    props.note ? e('p', { className: 'dsh-plugins-note', role: 'status' }, props.note) : null,
    props.error
      ? e('div', { className: 'dsh-plugins-error', role: 'alert' },
        e('p', { className: 'dsh-plugins-error-message' }, props.error),
        props.errorDetail
          ? e('details', { className: 'dsh-plugins-error-detail' },
            e('summary', null, '技术详情'),
            e('pre', null, props.errorDetail),
          )
          : null,
      )
      : null,
    e(UninstallConfirm, {
      card: props.pendingUninstall,
      Dialog: props.Dialog,
      onConfirm: props.onConfirmUninstall,
      onCancel: props.onCancelUninstall,
    }),
    props.tab === 'installed'
      ? props.loading
        ? e('p', { className: 'dsh-plugins-status' }, '正在读取已安装插件…')
        : e('div', { className: 'dsh-plugins-groups' },
          e(CoreGroup, { cards: props.inventory?.core ?? [] }),
          e(FeatureGroup, { title: '写作功能', cards: props.inventory?.optional ?? [], empty: '没有可开关的写作功能。', busyPackage: props.busyPackage, onToggle: props.onToggle, byPurpose: true }),
          e(FeatureGroup, { title: '已安装的社区插件', cards: props.inventory?.community ?? [], empty: '还没有从市场安装插件。', busyPackage: props.busyPackage, onToggle: props.onToggle, onUninstall: props.onUninstall }),
        )
      : e('div', { className: 'dsh-plugins-market' },
        e('form', { className: 'dsh-plugins-search', onSubmit: onSearchSubmit },
          e('input', {
            type: 'search',
            value: props.query,
            'data-testid': 'plugins-search',
            placeholder: '搜索 GitHub 上的 dsh-plugin',
            'aria-label': '搜索插件市场',
            onChange: (event: { target: { value: string } }) => props.onQuery(event.target.value),
          }),
          e('button', { type: 'submit', className: 'dsh-plugins-primary', disabled: props.searching }, props.searching ? '搜索中…' : '搜索'),
        ),
        e('form', { className: 'dsh-plugins-spec', onSubmit: onInstallSubmit },
          e('input', {
            value: props.spec,
            'data-testid': 'plugins-install-spec',
            placeholder: 'owner/repo 或 github:owner/repo',
            'aria-label': 'GitHub 仓库',
            onChange: (event: { target: { value: string } }) => props.onSpec(event.target.value),
          }),
          e('button', { type: 'button', className: 'dsh-plugins-ghost', 'data-testid': 'plugins-inspect-run', disabled: props.inspecting || !props.spec.trim(), onClick: () => props.onInspect(props.spec) }, props.inspecting ? '检查中…' : '检查'),
          e('button', { type: 'submit', className: 'dsh-plugins-primary', 'data-testid': 'plugins-install', disabled: props.installing || !props.spec.trim() || props.inspect?.verdict === 'blocked' }, props.installing ? '安装中…' : '安装'),
        ),
        props.inspect ? e(InspectReportView, { report: props.inspect }) : null,
        props.searching ? e('p', { className: 'dsh-plugins-status' }, '正在搜索 GitHub…') : null,
        !props.searching && props.listings.length === 0
          ? e('p', { className: 'dsh-plugins-empty' }, '输入关键词搜索，或直接粘贴 GitHub 仓库名安装。')
          : e('div', { className: 'dsh-plugins-group' },
            props.listings.map((item) => e('article', { key: item.spec, className: 'dsh-plugins-card' },
              e('div', null,
                e('div', { className: 'dsh-plugins-card-title' }, item.owner, '/', item.repo),
                e('div', { className: 'dsh-plugins-card-desc' }, item.description || '暂无简介'),
                e('div', { className: 'dsh-plugins-meta' },
                  e('span', { className: 'dsh-plugins-stars' }, `★ ${item.stars}`),
                  ' · ',
                  e('a', { href: item.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 打开'),
                ),
              ),
              e('div', { className: 'dsh-plugins-actions' },
                e('button', {
                  type: 'button',
                  className: 'dsh-plugins-ghost',
                  disabled: props.inspecting,
                  onClick: () => props.onInspect(item.spec),
                }, '检查'),
                e('button', {
                  type: 'button',
                  className: 'dsh-plugins-primary',
                  disabled: props.installing,
                  onClick: () => props.onInstall(item.spec),
                }, '安装'),
              ),
            )),
          ),
      ),
  )
}

function PluginSettings(props: { rpc: RpcCaller; Dialog?: ComponentType<HostDialogProps> }) {
  const caller = props.rpc
  const [tab, setTab] = useState<'installed' | 'market'>('installed')
  const [inventory, setInventory] = useState<PluginInventory | null>(null)
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [query, setQuery] = useState('')
  const [spec, setSpec] = useState('')
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [inspect, setInspect] = useState<PluginInspectReport | null>(null)
  const [pendingUninstall, setPendingUninstall] = useState<PluginCard | null>(null)
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [note, setNote] = useState('')
  const [busyPackage, setBusyPackage] = useState<string | null>(null)

  const showError = (message: string, detail?: string) => {
    setError(message)
    setErrorDetail(detail ?? '')
  }

  const refresh = useCallback(async (quiet = false): Promise<PluginInventory | null> => {
    if (!quiet) {
      setLoading(true)
      setError('')
      setErrorDetail('')
    }
    try {
      const result = await callRpc<PluginInventory>(caller, 'inventory.list', {})
      if (result.ok) {
        setInventory(result.value)
        return result.value
      }
      const view = errorView(result, '未能读取插件列表')
      showError(view.message, view.detail)
      return null
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : '未能读取插件列表')
      return null
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [caller])

  useEffect(() => { void refresh() }, [refresh])

  const onToggle = async (cards: PluginCard[], enabled: boolean) => {
    const targets = toggleableCards(cards)
    const pkg = targets[0]?.packageName ?? cards[0]?.packageName ?? ''
    const title = cards[0]?.title ?? pkg
    if (targets.length === 0) return
    setBusyPackage(pkg)
    setError('')
    setErrorDetail('')
    setNote('')
    let restart = false
    let failed: { message: string; detail?: string } | undefined
    try {
      const entryIds = targets.map((card) => card.entryId)
      const result = await callRpc<{ restartRequired: boolean }>(caller, 'entries.setEnabled', { entryIds, enabled })
      if (!result.ok) failed = errorView(result, `未能更新「${title}」`)
      else if (result.value.restartRequired) restart = true
    } catch (cause) {
      failed = authorPluginError(cause instanceof Error ? cause.message : '', `未能更新「${title}」`)
    } finally {
      const listed = await refresh(true).catch(() => null)
      setBusyPackage(null)
      if (failed) showError(failed.message, failed.detail)
      else if (listed) {
        const current = [...listed.optional, ...listed.community].filter((card) => targets.some((item) => item.entryId === card.entryId))
        const allMatch = current.length > 0 && current.every((card) => card.enabled === enabled)
        if (restart && !allMatch) setNote('已保存。需要重启后才会完全生效。')
        else if (allMatch) setNote(enabled ? `已启用 ${title}。` : `已停用 ${title}。`)
        else showError('插件状态未完全同步，请重试或重启后再确认。')
      }
    }
  }

  const onUninstall = (card: PluginCard) => setPendingUninstall(card)
  const onConfirmUninstall = async () => {
    const card = pendingUninstall
    if (!card) return
    setInstalling(true)
    setError('')
    setErrorDetail('')
    try {
      const result = await callRpc<{ restartRequired: boolean }>(caller, 'marketplace.uninstall', { name: card.packageName })
      if (!result.ok) {
        const view = errorView(result, '未能卸载')
        showError(view.message, view.detail)
      }
      else {
        setNote(`已卸载 ${card.title}。请重启应用。`)
        setPendingUninstall(null)
        await refresh()
      }
    } finally {
      setInstalling(false)
    }
  }

  const onSearch = async () => {
    setSearching(true)
    setError('')
    setErrorDetail('')
    try {
      const result = await callRpc<{ listings: MarketplaceListing[] }>(caller, 'marketplace.search', { query })
      if (result.ok) setListings(result.value.listings)
      else {
        const view = errorView(result, '搜索失败')
        showError(view.message, view.detail)
      }
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : '搜索失败')
    } finally {
      setSearching(false)
    }
  }

  const onInspect = async (value: string) => {
    setInspecting(true)
    setError('')
    setErrorDetail('')
    setInspect(null)
    try {
      const result = await callRpc<PluginInspectReport>(caller, 'marketplace.inspect', { spec: value })
      if (result.ok) setInspect(result.value)
      else {
        const view = errorView(result, '检查失败')
        showError(view.message, view.detail)
      }
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : '检查失败')
    } finally {
      setInspecting(false)
    }
  }

  const onInstall = async (value: string) => {
    setInstalling(true)
    setError('')
    setErrorDetail('')
    try {
      const result = await callRpc<{ name: string; restartRequired: boolean; inspect?: PluginInspectReport }>(caller, 'marketplace.install', { spec: value })
      if (!result.ok) {
        const view = errorView(result, '安装失败')
        showError(view.message, view.detail)
      }
      else {
        if (result.value.inspect) setInspect(result.value.inspect)
        const extra = result.value.inspect?.verdict === 'warn' ? '静态检查有注意事项，见下方。' : ''
        setNote(`已安装 ${result.value.name}。请重启应用后使用。${extra}`)
        setTab('installed')
        await refresh()
      }
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : '安装失败')
    } finally {
      setInstalling(false)
    }
  }

  return e(PluginPanel, {
    inventory, listings, tab, query, spec, loading, searching, installing, inspecting, inspect, pendingUninstall, error, errorDetail, note,
    busyPackage,
    onTab: setTab, onQuery: setQuery, onSearch: () => void onSearch(), onSpec: setSpec,
    onInstall: (value) => void onInstall(value),
    onInspect: (value) => void onInspect(value),
    onToggle: (cards, enabled) => void onToggle(cards, enabled),
    onUninstall,
    onConfirmUninstall: () => void onConfirmUninstall(),
    onCancelUninstall: () => setPendingUninstall(null),
    Dialog: props.Dialog,
  })
}

export function apply(ctx: Context): void {
  if (typeof document !== 'undefined') ctx.effect(() => injectStyles(), 'dsh-editor-plugins-client.styles')
  const client = ctx as PluginsClientContext
  function PluginsSettingsContribution(props?: { Dialog?: ComponentType<HostDialogProps> }) {
    return e(PluginSettings, { rpc: client.connection.rpc, Dialog: props?.Dialog })
  }
  client.slots.inject(PLUGINS_SETTINGS_SLOT, () =>
    client.slots.register({ name: PLUGINS_SETTINGS_SLOT, id: 'plugins', order: 0, label: '插件' }, PluginsSettingsContribution))
}
