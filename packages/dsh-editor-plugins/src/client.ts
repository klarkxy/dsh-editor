import type { Context } from '@deepseek-ai/cordis'
import { createElement as e, Fragment, useCallback, useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode, type RefObject } from 'react'
import {
  PLUGINS_RPC_CHANNEL,
  PLUGINS_SETTINGS_SLOT,
  type MarketplaceListing,
  type PluginCard,
  type PluginInspectReport,
  type PluginInventory,
  type PluginsRpcResult,
  type WritingPresetCard,
  type WritingPresetInventory,
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
import { parseGitHubSpec } from './github.ts'

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

type MarketplaceBridge = { openExternal?(url: string): void }

export function marketplaceOpenExternal(): ((url: string) => void) | undefined {
  const scope = globalThis as { window?: { dshWindow?: MarketplaceBridge }; dshWindow?: MarketplaceBridge }
  return scope.window?.dshWindow?.openExternal ?? scope.dshWindow?.openExternal
}

export function handleMarketplaceGithubClick(event: { preventDefault(): void }, url: string): void {
  const openExternal = marketplaceOpenExternal()
  if (!openExternal) return
  event.preventDefault()
  openExternal(url)
}

export function canConfirmPluginInstall(
  report: PluginInspectReport | null,
  phase: { inspecting?: boolean; installing?: boolean } = {},
): boolean {
  if (phase.inspecting || phase.installing) return false
  return report?.verdict === 'ready' || report?.verdict === 'warn'
}

export function pluginInstallNotice(name: string, report?: PluginInspectReport | null): string {
  const warnings = report?.findings.filter((item) => item.severity === 'warning').map((item) => item.message) ?? []
  const base = `已安装 ${name}。请重启应用后使用。`
  return warnings.length > 0 ? `${base}注意事项：${warnings.join('；')}` : base
}

export function isCurrentInstallAttempt(input: {
  mounted: boolean
  token: number
  currentToken: number
  openSpec: string | null | undefined
  resultSpec: string
}): boolean {
  return input.mounted && input.token === input.currentToken && input.openSpec === input.resultSpec
}

function toggleTestId(card: PluginCard): string {
  const id = card.entryId.includes(':') ? card.entryId.slice(card.entryId.indexOf(':') + 1) : card.entryId
  return `plugins-toggle-${id}`
}

/* 活动暗示:三点呼吸(参数改写自 Amicro pulse-dots,MIT);装饰 aria-hidden,
   关键帧在 client-styles.ts,reduced-motion 停循环后保留静态点。 */
const activityDots = () => e('span', { className: 'dsh-plugins-dots', 'aria-hidden': 'true' }, e('i'), e('i'), e('i'))

function phaseLabel(card: PluginCard): string {
  if (!card.enabled) return '已停用'
  if (card.fiberPhase === 'failed') return '启用失败'
  if (card.fiberPhase === 'pending' || card.fiberPhase === 'loading') return '启动中'
  if (card.fiberPhase === 'unloading') return '正在停用'
  return '已启用'
}

function communityRuntimeLabel(card: PluginCard): string {
  if (card.fiberPhase === 'failed') {
    const reason = card.failureReason?.trim()
    return reason ? `加载失败：${reason}` : '加载失败'
  }
  if (card.fiberPhase === 'pending' || card.fiberPhase === 'loading') return '正在加载'
  if (card.fiberPhase === 'unloading') return '正在停用'
  if (card.fiberPhase === 'active') return '已加载'
  if (!card.enabled && !card.pendingRestart) return '已停用'
  return ''
}

function communityCardStatus(cards: PluginCard[]): string {
  const mixed = enabledState(cards) === 'mixed'
  const parts: string[] = mixed ? ['部分启用'] : []
  const seen = new Set(parts)
  const push = (item: string) => {
    if (!item || seen.has(item)) return
    seen.add(item)
    parts.push(item)
  }
  for (const card of cards) {
    if (card.pendingRestart) push('待重启')
    const runtime = communityRuntimeLabel(card)
    if (runtime === '已停用' && mixed) continue
    push(runtime)
  }
  return parts.join(' · ')
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
  community?: boolean
  onToggle(cards: PluginCard[], enabled: boolean): void
  onUninstall?(card: PluginCard): void
}) {
  const { cards } = props
  const primary = cards[0]!
  const titleId = `plugin-title-${props.groupId.replace(/[^A-Za-z0-9._-]+/g, '-')}`
  const mixedId = `${titleId}-mixed`
  const state = enabledState(cards)
  const mixed = state === 'mixed'
  const pendingRestart = cards.some((card) => card.pendingRestart)
  const phases = [...new Set(cards.map(phaseLabel))]
  const alert = mixed
    ? '部分启用'
    : phases.find((item) => item === '启用失败' || item === '启动中' || item === '正在停用')
  const status = props.community
    ? communityCardStatus(cards)
    : [alert, pendingRestart ? '待重启' : ''].filter(Boolean).join(' · ')
  const extras = [
    primary.origin === 'installed' ? '已从市场安装' : '',
    primary.version ? primary.version : '',
    ...props.composition,
  ].filter(Boolean)
  const locked = cards.every((card) => card.locked)
  const canToggle = toggleableCards(cards).length > 0
  const activating = cards.some((card) => card.fiberPhase === 'pending' || card.fiberPhase === 'loading' || card.fiberPhase === 'unloading')
  return e('article', { className: 'dsh-plugins-card', 'data-testid': `plugins-card-${primary.entryId}` },
    e('div', null,
      e('div', { id: titleId, className: 'dsh-plugins-card-title' }, props.title),
      e('div', { className: 'dsh-plugins-card-desc' }, props.description),
      status
        ? e('div', { id: mixed ? mixedId : undefined, className: 'dsh-plugins-meta' }, activating ? activityDots() : null, status)
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
        : canToggle
          ? e(Switch, {
            checked: state === true,
            mixed,
            busy: props.busy,
            labelledBy: titleId,
            describedBy: mixed ? mixedId : undefined,
            testId: `plugins-toggle-${props.groupId.includes('/') ? toggleTestId(primary) : props.groupId}`,
            onToggle: () => props.onToggle(toggleableCards(cards), state !== true),
          })
          : null,
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
  ready: '可以安装',
  warn: '可以安装，但有兼容性提示',
  blocked: '无法安装',
} as const

function InspectReportView(props: { report: PluginInspectReport }) {
  const { report } = props
  const prominent = report.findings.filter((item) => item.severity === 'error' || item.severity === 'warning')
  const info = report.findings.filter((item) => item.severity === 'info')
  const technical = info.length > 0 || report.entries.length > 0
  return e('div', { className: `dsh-plugins-inspect dsh-plugins-inspect-${report.verdict}`, 'data-testid': 'plugins-inspect', role: 'status' },
    e('p', { className: 'dsh-plugins-inspect-verdict' }, VERDICT_LABEL[report.verdict],
      report.name ? ` · ${report.name}${report.version ? `@${report.version}` : ''}` : ''),
    prominent.length
      ? e('ul', { className: 'dsh-plugins-findings' },
        prominent.map((item, index) => e('li', {
          key: `${item.code}:${index}`,
          className: `dsh-plugins-finding dsh-plugins-finding-${item.severity}`,
        }, item.message)),
      )
      : null,
    technical
      ? e('details', { className: 'dsh-plugins-error-detail' },
        e('summary', null, '技术详情'),
        info.length
          ? e('ul', { className: 'dsh-plugins-findings' },
            info.map((item, index) => e('li', {
              key: `${item.code}:${index}`,
              className: `dsh-plugins-finding dsh-plugins-finding-${item.severity}`,
            }, item.message)),
          )
          : null,
        report.entries.length
          ? e('p', { className: 'dsh-plugins-meta' }, report.entries.map((entry) => entry.id).join('、'))
          : null,
      )
      : null,
  )
}

function WritingPresetGroup(props: {
  presets: WritingPresetCard[]
  busyPreset: string | null
  onToggle(id: string, enabled: boolean): void
}) {
  return e('section', { className: 'dsh-plugins-group', 'data-testid': 'plugins-writing-presets' },
    e('h3', null, '写作模式'),
    e('p', { className: 'dsh-plugins-core-hint' }, '新对话可选的写作模式。开关立即生效；进行中的对话不受影响。'),
    props.presets.map((preset) => {
      const titleId = `preset-title-${preset.id}`
      return e('article', { key: preset.id, className: 'dsh-plugins-card', 'data-testid': `plugins-preset-${preset.id}` },
        e('div', null,
          e('div', { id: titleId, className: 'dsh-plugins-card-title' }, preset.title),
          preset.description ? e('div', { className: 'dsh-plugins-card-desc' }, preset.description) : null,
          e('div', { className: 'dsh-plugins-meta' }, preset.locked ? '始终可用' : preset.enabled ? '已启用' : '已停用'),
        ),
        e('div', { className: 'dsh-plugins-actions' },
          preset.locked
            ? e('span', { className: 'dsh-plugins-locked' }, '核心')
            : e(Switch, {
              checked: preset.enabled,
              busy: props.busyPreset === preset.id,
              labelledBy: titleId,
              testId: `plugins-preset-toggle-${preset.id}`,
              onToggle: () => props.onToggle(preset.id, !preset.enabled),
            }),
        ),
      )
    }),
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
  community?: boolean
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
      community: props.community,
      onToggle: props.onToggle,
      onUninstall: props.onUninstall,
    })),
  )
}

type PluginInstallAttempt = {
  spec: string
  inspecting: boolean
  report: PluginInspectReport | null
  error: string
  errorDetail: string
}

type PluginPanelProps = {
  inventory: PluginInventory | null
  presets: WritingPresetCard[] | null
  listings: MarketplaceListing[]
  tab: 'installed' | 'market'
  query: string
  loading: boolean
  searching: boolean
  installing: boolean
  pendingInstall: PluginInstallAttempt | null
  pendingUninstall: PluginCard | null
  error: string
  errorDetail?: string
  note: string
  onTab(tab: 'installed' | 'market'): void
  onQuery(value: string): void
  onSearch(): void
  onInstall(spec: string): void
  onConfirmInstall(): void
  onCancelInstall(): void
  onRetryInspect(): void
  onToggle(cards: PluginCard[], enabled: boolean): void
  busyPackage: string | null
  busyPreset: string | null
  onTogglePreset(id: string, enabled: boolean): void
  onUninstall(card: PluginCard): void
  onConfirmUninstall(): void
  onCancelUninstall(): void
  uninstalling: boolean
  uninstallError: string
  uninstallErrorDetail?: string
  Dialog?: ComponentType<HostDialogProps>
}

function UninstallConfirm(props: {
  card: PluginCard | null
  busy?: boolean
  error?: string
  errorDetail?: string
  Dialog?: ComponentType<HostDialogProps>
  onConfirm(): void
  onCancel(): void
}) {
  const cancel = useRef<HTMLButtonElement | null>(null)
  const HostDialog = props.Dialog
  const busy = Boolean(props.busy)
  const errorNode = props.error
    ? e('div', { className: 'dsh-plugins-error', role: 'alert', 'data-testid': 'plugins-uninstall-error' },
      e('p', { className: 'dsh-plugins-error-message' }, props.error),
      props.errorDetail
        ? e('details', { className: 'dsh-plugins-error-detail' },
          e('summary', null, '技术详情'),
          e('pre', null, props.errorDetail),
        )
        : null,
    )
    : null
  if (HostDialog) {
    return e(HostDialog, {
      open: Boolean(props.card),
      onOpenChange: (next: boolean) => { if (!next && !busy) props.onCancel() },
      title: '卸载插件',
      description: props.card ? `卸载 ${props.card.title}？作品文件不会被删除，重启后才会完全卸载。` : '',
      className: 'file-dialog confirm-dialog',
      overlayClassName: 'file-dialog-overlay confirm-overlay',
      dismissible: !busy,
      initialFocusRef: cancel,
    },
      e('header', null, e('h2', null, '卸载插件')),
      e('p', null, props.card ? `卸载 ${props.card.title}？作品文件不会被删除，重启后才会完全卸载。` : ''),
      errorNode,
      e('footer', null,
        e('button', { ref: cancel, type: 'button', disabled: busy, onClick: props.onCancel }, '取消'),
        e('button', {
          type: 'button',
          className: 'danger-action',
          disabled: busy,
          onClick: props.onConfirm,
        }, busy ? e(Fragment, null, activityDots(), '卸载中…') : '确认卸载'),
      ),
    )
  }
  if (!props.card) return null
  return e('section', {
    className: 'dsh-plugins-note',
    role: 'alertdialog',
    'aria-busy': busy,
    onKeyDown: (event: { key: string; preventDefault(): void }) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      props.onCancel()
    },
  },
    e('p', null, `卸载 ${props.card.title}？作品文件不会被删除，重启后才会完全卸载。`),
    errorNode,
    e('p', null,
      e('button', {
        type: 'button',
        className: 'dsh-plugins-primary',
        disabled: busy,
        onClick: props.onConfirm,
      }, busy ? e(Fragment, null, activityDots(), '卸载中…') : '确认卸载'),
      ' ',
      e('button', { type: 'button', className: 'dsh-plugins-ghost', disabled: busy, onClick: props.onCancel }, '取消'),
    ),
  )
}

function InstallAttemptView(props: {
  spec: string
  inspecting: boolean
  installing: boolean
  report: PluginInspectReport | null
  error: string
  errorDetail?: string
  host?: boolean
  cancelRef: RefObject<HTMLButtonElement | null>
  onConfirm(): void
  onCancel(): void
  onRetry(): void
}) {
  const confirmDisabled = !canConfirmPluginInstall(props.report, {
    inspecting: props.inspecting,
    installing: props.installing,
  })
  const retry = !props.inspecting && !props.installing && !props.report && Boolean(props.error)
  const ghost = props.host ? undefined : 'dsh-plugins-ghost'
  const primary = props.host ? 'primary-action' : 'dsh-plugins-primary'
  return e('div', {
    className: 'dsh-plugins-install-body',
    'data-testid': 'plugins-install-dialog',
    'aria-busy': props.inspecting || props.installing,
  },
    e('header', null, e('h2', { id: 'plugins-install-title' }, '安装插件')),
    e('p', { id: 'plugins-install-desc' }, `将安装 ${props.spec}。先做静态检查，确认后再写入。`),
    props.inspecting
      ? e('p', { className: 'dsh-plugins-status', role: 'status', 'data-testid': 'plugins-inspect-status' }, activityDots(), '正在检查…')
      : props.report
        ? e(InspectReportView, { report: props.report })
        : null,
    props.error && !props.inspecting
      ? e('div', { className: 'dsh-plugins-error', role: 'alert', 'data-testid': 'plugins-install-error' },
        e('p', { className: 'dsh-plugins-error-message' }, props.error),
        props.errorDetail
          ? e('details', { className: 'dsh-plugins-error-detail' },
            e('summary', null, '技术详情'),
            e('pre', null, props.errorDetail),
          )
          : null,
      )
      : null,
    e('footer', null,
      e('button', {
        ref: props.cancelRef,
        type: 'button',
        className: ghost,
        'data-testid': 'plugins-install-cancel',
        disabled: props.installing,
        onClick: props.onCancel,
      }, '取消'),
      retry
        ? e('button', {
          type: 'button',
          className: ghost,
          'data-testid': 'plugins-install-retry',
          onClick: props.onRetry,
        }, '重新检查')
        : null,
      e('button', {
        type: 'button',
        className: primary,
        'data-testid': 'plugins-install-confirm',
        disabled: confirmDisabled,
        onClick: props.onConfirm,
      }, props.installing ? e(Fragment, null, activityDots(), '安装中…') : '确认安装'),
    ),
  )
}

function InstallConfirm(props: {
  attempt: PluginInstallAttempt | null
  installing: boolean
  Dialog?: ComponentType<HostDialogProps>
  onConfirm(): void
  onCancel(): void
  onRetry(): void
}) {
  const cancel = useRef<HTMLButtonElement | null>(null)
  const attempt = props.attempt
  const HostDialog = props.Dialog
  const body = attempt
    ? e(InstallAttemptView, {
      spec: attempt.spec,
      inspecting: attempt.inspecting,
      installing: props.installing,
      report: attempt.report,
      error: attempt.error,
      errorDetail: attempt.errorDetail,
      host: Boolean(HostDialog),
      cancelRef: cancel,
      onConfirm: props.onConfirm,
      onCancel: props.onCancel,
      onRetry: props.onRetry,
    })
    : null
  if (HostDialog) {
    return e(HostDialog, {
      open: Boolean(attempt),
      onOpenChange: (next: boolean) => { if (!next) props.onCancel() },
      title: '安装插件',
      description: attempt ? `将安装 ${attempt.spec}。先做静态检查，确认后再写入。` : '',
      className: 'file-dialog confirm-dialog',
      overlayClassName: 'file-dialog-overlay confirm-overlay',
      dismissible: !props.installing,
      initialFocusRef: cancel,
    }, body)
  }
  if (!attempt) return null
  return e('section', {
    className: 'dsh-plugins-install-fallback',
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': 'plugins-install-title',
    'aria-describedby': 'plugins-install-desc',
    onKeyDown: (event: { key: string; preventDefault(): void }) => {
      if (event.key !== 'Escape' || props.installing) return
      event.preventDefault()
      props.onCancel()
    },
  }, body)
}

function PluginPanel(props: PluginPanelProps) {
  const parsed = parseGitHubSpec(props.query)
  const onMarketSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (parsed) props.onInstall(parsed.spec)
    else props.onSearch()
  }
  const dialogOpen = Boolean(props.pendingInstall)
  const installBusy = props.installing || dialogOpen
  const submitBusy = props.searching || installBusy
  return e('section', { className: 'dsh-plugins', 'data-testid': 'plugins-settings', 'aria-label': '插件' },
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
      busy: props.uninstalling,
      error: props.uninstallError,
      errorDetail: props.uninstallErrorDetail,
      Dialog: props.Dialog,
      onConfirm: props.onConfirmUninstall,
      onCancel: props.onCancelUninstall,
    }),
    e(InstallConfirm, {
      attempt: props.pendingInstall,
      installing: props.installing,
      Dialog: props.Dialog,
      onConfirm: props.onConfirmInstall,
      onCancel: props.onCancelInstall,
      onRetry: props.onRetryInspect,
    }),
    props.tab === 'installed'
      ? props.loading
        ? e('p', { className: 'dsh-plugins-status' }, activityDots(), '正在读取已安装插件…')
        : e('div', { className: 'dsh-plugins-groups' },
          props.presets
            ? e(WritingPresetGroup, { presets: props.presets, busyPreset: props.busyPreset, onToggle: props.onTogglePreset })
            : null,
          e(CoreGroup, { cards: props.inventory?.core ?? [] }),
          e(FeatureGroup, { title: '写作功能', cards: props.inventory?.optional ?? [], empty: '没有可开关的写作功能。', busyPackage: props.busyPackage, onToggle: props.onToggle, byPurpose: true }),
          e(FeatureGroup, { title: '已安装的社区插件', cards: props.inventory?.community ?? [], empty: '还没有从市场安装插件。', busyPackage: props.busyPackage, onToggle: props.onToggle, onUninstall: props.onUninstall, community: true }),
        )
      : e('div', { className: 'dsh-plugins-market' },
        e('form', { className: 'dsh-plugins-search', onSubmit: onMarketSubmit },
          e('input', {
            type: 'search',
            value: props.query,
            'data-testid': 'plugins-search',
            placeholder: '搜索插件，或粘贴 GitHub 仓库地址',
            'aria-label': '搜索插件，或粘贴 GitHub 仓库地址',
            onChange: (event: { target: { value: string } }) => props.onQuery(event.target.value),
          }),
          e('button', {
            type: 'submit',
            className: 'dsh-plugins-primary',
            'data-testid': 'plugins-market-submit',
            disabled: submitBusy,
          }, parsed ? (props.installing ? e(Fragment, null, activityDots(), '安装中…') : '安装') : (props.searching ? e(Fragment, null, activityDots(), '搜索中…') : '搜索')),
        ),
        props.searching ? e('p', { className: 'dsh-plugins-status' }, activityDots(), '正在搜索 GitHub…') : null,
        !props.searching && props.listings.length === 0
          ? e('p', { className: 'dsh-plugins-empty' }, '输入关键词搜索，或粘贴 GitHub 仓库地址安装。')
          : e('div', { className: 'dsh-plugins-group' },
            props.listings.map((item) => e('article', { key: item.spec, className: 'dsh-plugins-card' },
              e('div', null,
                e('div', { className: 'dsh-plugins-card-title' }, item.owner, '/', item.repo),
                e('div', { className: 'dsh-plugins-card-desc' }, item.description || '暂无简介'),
                e('div', { className: 'dsh-plugins-meta' },
                  e('span', { className: 'dsh-plugins-stars' }, `★ ${item.stars}`),
                  ' · ',
                  e('a', {
                    href: item.url,
                    target: '_blank',
                    rel: 'noreferrer',
                    onClick: (event: { preventDefault(): void }) => handleMarketplaceGithubClick(event, item.url),
                  }, '在 GitHub 打开'),
                ),
              ),
              e('div', { className: 'dsh-plugins-actions' },
                e('button', {
                  type: 'button',
                  className: 'dsh-plugins-primary',
                  disabled: installBusy,
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
  const [presets, setPresets] = useState<WritingPresetCard[] | null>(null)
  const [busyPreset, setBusyPreset] = useState<string | null>(null)
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [pendingInstall, setPendingInstall] = useState<PluginInstallAttempt | null>(null)
  const [pendingUninstall, setPendingUninstall] = useState<PluginCard | null>(null)
  const [uninstalling, setUninstalling] = useState(false)
  const [uninstallError, setUninstallError] = useState('')
  const [uninstallErrorDetail, setUninstallErrorDetail] = useState('')
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [note, setNote] = useState('')
  const [busyPackage, setBusyPackage] = useState<string | null>(null)
  const attemptRef = useRef(0)
  const mountedRef = useRef(true)
  const inspectAbortRef = useRef<AbortController | null>(null)
  const confirmingRef = useRef(false)
  const uninstallingRef = useRef(false)

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
      const presetResult = await callRpc<WritingPresetInventory>(caller, 'presets.list', {}).catch(() => null)
      if (presetResult?.ok) setPresets(presetResult.value.presets)
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

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      attemptRef.current += 1
      inspectAbortRef.current?.abort()
      inspectAbortRef.current = null
      confirmingRef.current = false
      uninstallingRef.current = false
    }
  }, [])

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
        if (restart && !allMatch) setNote('已保存，重启应用后完全生效。')
        else if (allMatch) setNote(enabled ? `已启用 ${title}。` : `已停用 ${title}。`)
        else showError('插件状态未完全同步，请重试或重启后再确认。')
      }
    }
  }

  const onTogglePreset = async (id: string, enabled: boolean) => {
    const title = presets?.find((preset) => preset.id === id)?.title ?? id
    setBusyPreset(id)
    setError('')
    setErrorDetail('')
    setNote('')
    try {
      const result = await callRpc<{ restartRequired: boolean }>(caller, 'presets.setEnabled', { id, enabled })
      if (!result.ok) {
        const view = errorView(result, `未能更新「${title}」`)
        showError(view.message, view.detail)
      } else {
        setNote(enabled
          ? `已启用 ${title}。新对话立即可选；进行中的对话不受影响。`
          : `已停用 ${title}。新对话不再提供该模式；进行中的对话不受影响。`)
      }
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : `未能更新「${title}」`)
    } finally {
      const listed = await callRpc<WritingPresetInventory>(caller, 'presets.list', {}).catch(() => null)
      if (listed?.ok) setPresets(listed.value.presets)
      setBusyPreset(null)
    }
  }

  const onUninstall = (card: PluginCard) => {
    if (uninstallingRef.current) return
    setUninstallError('')
    setUninstallErrorDetail('')
    setPendingUninstall(card)
  }
  const onCancelUninstall = () => {
    if (uninstallingRef.current) return
    setPendingUninstall(null)
    setUninstallError('')
    setUninstallErrorDetail('')
  }
  const onConfirmUninstall = async () => {
    const card = pendingUninstall
    if (!card || uninstallingRef.current) return
    uninstallingRef.current = true
    setUninstalling(true)
    setUninstallError('')
    setUninstallErrorDetail('')
    try {
      const result = await callRpc<{ restartRequired: boolean }>(caller, 'marketplace.uninstall', { name: card.packageName })
      if (!mountedRef.current) return
      if (!result.ok) {
        const view = errorView(result, '未能卸载')
        setUninstallError(view.message)
        setUninstallErrorDetail(view.detail ?? '')
        return
      }
      setNote(`已卸载 ${card.title}。请重启应用后生效。`)
      setPendingUninstall(null)
      setUninstallError('')
      setUninstallErrorDetail('')
      await refresh()
    } catch (cause) {
      if (!mountedRef.current) return
      const view = authorPluginError(cause instanceof Error ? cause.message : '', '未能卸载')
      setUninstallError(view.message)
      setUninstallErrorDetail(view.detail ?? '')
    } finally {
      uninstallingRef.current = false
      if (mountedRef.current) setUninstalling(false)
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

  const runInspect = async (value: string, token: number, signal: AbortSignal) => {
    const apply = (next: PluginInstallAttempt) => {
      setPendingInstall((current) => {
        if (!isCurrentInstallAttempt({
          mounted: mountedRef.current,
          token,
          currentToken: attemptRef.current,
          openSpec: current?.spec,
          resultSpec: value,
        })) return current
        return next
      })
    }
    try {
      const result = await callRpc<PluginInspectReport>(caller, 'marketplace.inspect', { spec: value }, signal)
      if (result.ok) {
        apply({ spec: value, inspecting: false, report: result.value, error: '', errorDetail: '' })
        return
      }
      const view = errorView(result, '检查失败')
      apply({ spec: value, inspecting: false, report: null, error: view.message, errorDetail: view.detail ?? '' })
    } catch (cause) {
      if (signal.aborted) return
      apply({
        spec: value,
        inspecting: false,
        report: null,
        error: cause instanceof Error ? cause.message : '检查失败',
        errorDetail: '',
      })
    }
  }

  const beginInstall = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || installing || confirmingRef.current) return
    attemptRef.current += 1
    inspectAbortRef.current?.abort()
    const token = attemptRef.current
    const controller = new AbortController()
    inspectAbortRef.current = controller
    setPendingInstall({ spec: trimmed, inspecting: true, report: null, error: '', errorDetail: '' })
    setError('')
    setErrorDetail('')
    setNote('')
    void runInspect(trimmed, token, controller.signal)
  }

  const cancelInstall = () => {
    if (installing || confirmingRef.current) return
    attemptRef.current += 1
    inspectAbortRef.current?.abort()
    inspectAbortRef.current = null
    setPendingInstall(null)
  }

  const retryInspect = () => {
    const current = pendingInstall
    if (!current || current.inspecting || installing || confirmingRef.current) return
    attemptRef.current += 1
    inspectAbortRef.current?.abort()
    const token = attemptRef.current
    const controller = new AbortController()
    inspectAbortRef.current = controller
    setPendingInstall({ spec: current.spec, inspecting: true, report: null, error: '', errorDetail: '' })
    void runInspect(current.spec, token, controller.signal)
  }

  const confirmInstall = () => {
    const current = pendingInstall
    if (!current || confirmingRef.current || installing) return
    if (!canConfirmPluginInstall(current.report, { inspecting: current.inspecting })) return
    confirmingRef.current = true
    setInstalling(true)
    setPendingInstall({ ...current, error: '', errorDetail: '' })
    const token = attemptRef.current
    const specValue = current.spec
    const inspected = current.report
    void (async () => {
      try {
        const result = await callRpc<{ name: string; restartRequired: boolean; inspect?: PluginInspectReport }>(
          caller,
          'marketplace.install',
          { spec: specValue },
        )
        if (!isCurrentInstallAttempt({
          mounted: mountedRef.current,
          token,
          currentToken: attemptRef.current,
          openSpec: specValue,
          resultSpec: specValue,
        })) return
        if (!result.ok) {
          const view = errorView(result, '安装失败')
          confirmingRef.current = false
          setInstalling(false)
          setPendingInstall((open) => {
            if (!open || !isCurrentInstallAttempt({
              mounted: mountedRef.current,
              token,
              currentToken: attemptRef.current,
              openSpec: open.spec,
              resultSpec: specValue,
            })) return open
            return { ...open, error: view.message, errorDetail: view.detail ?? '' }
          })
          return
        }
        setNote(pluginInstallNotice(result.value.name, result.value.inspect ?? inspected))
        confirmingRef.current = false
        setInstalling(false)
        setPendingInstall(null)
        setTab('installed')
        await refresh()
      } catch (cause) {
        if (!isCurrentInstallAttempt({
          mounted: mountedRef.current,
          token,
          currentToken: attemptRef.current,
          openSpec: specValue,
          resultSpec: specValue,
        })) return
        confirmingRef.current = false
        setInstalling(false)
        setPendingInstall((open) => {
          if (!open || !isCurrentInstallAttempt({
            mounted: mountedRef.current,
            token,
            currentToken: attemptRef.current,
            openSpec: open.spec,
            resultSpec: specValue,
          })) return open
          return { ...open, error: cause instanceof Error ? cause.message : '安装失败', errorDetail: '' }
        })
      }
    })()
  }

  return e(PluginPanel, {
    inventory, presets, listings, tab, query, loading, searching, installing, pendingInstall, pendingUninstall, error, errorDetail, note,
    busyPackage, busyPreset, uninstalling, uninstallError, uninstallErrorDetail,
    onTab: setTab, onQuery: setQuery, onSearch: () => void onSearch(),
    onInstall: beginInstall,
    onConfirmInstall: confirmInstall,
    onCancelInstall: cancelInstall,
    onRetryInspect: retryInspect,
    onToggle: (cards, enabled) => void onToggle(cards, enabled),
    onTogglePreset: (id, enabled) => void onTogglePreset(id, enabled),
    onUninstall,
    onConfirmUninstall: () => void onConfirmUninstall(),
    onCancelUninstall,
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
