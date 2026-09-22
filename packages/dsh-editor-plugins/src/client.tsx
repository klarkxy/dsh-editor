import type { Context } from '@deepseek-ai/cordis'
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
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
import { SeatButton } from 'dsh-editor-seats/seat-button'
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
  let style = document.head.querySelector('style[data-dsh-plugins-styles]')
  if (!style) {
    style = document.createElement('style')
    style.setAttribute('data-dsh-plugins-styles', '')
    document.head.appendChild(style)
  }
  // The module loader claims unowned styles for the next materialized module.
  // Declare ownership before HMR can mistake these styles for another plugin's.
  style.setAttribute('data-plugin', 'dsh-editor-plugins')
  style.textContent = pluginsClientStyles
  /* 设置页 React 树可能比 client fiber 活得更久；卸 fiber 时不要拆样式。 */
  return () => {}
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

/** Pinned DSH 0.1.5-rc.2 client-hmr ignores graph frames; boot ids stay until reload. */
export const CLIENT_GRAPH_RELOAD_NOTICE = '插件后台已更新。保存工作后，重启应用以更新界面。'

export function sortedClientEntryIds(ids: readonly string[]): string[] {
  return [...ids].sort()
}

export function bootClientEntryIds(boot: unknown = (globalThis as { __DSH_BOOT__?: unknown }).__DSH_BOOT__): string[] | undefined {
  if (!boot || typeof boot !== 'object') return undefined
  const entries = (boot as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return undefined
  const ids: string[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const id = (entry as { id?: unknown }).id
    if (typeof id === 'string') ids.push(id)
  }
  return ids
}

export function clientGraphNeedsReload(
  nativePackages: readonly string[] | undefined,
  bootEntryIds: readonly string[] | undefined,
): boolean {
  if (nativePackages === undefined || bootEntryIds === undefined) return false
  const native = sortedClientEntryIds(nativePackages)
  const boot = sortedClientEntryIds(bootEntryIds)
  return native.length !== boot.length || native.some((id, index) => id !== boot[index])
}

export function pluginToggleFollowUp(input: {
  restartRequired: boolean
  enabledMatches: boolean
  enabled: boolean
  title: string
  clientGraphChanged: boolean
}): { persist: boolean; error: boolean; message: string } {
  if (input.clientGraphChanged) {
    return { persist: true, error: false, message: CLIENT_GRAPH_RELOAD_NOTICE }
  }
  if (input.restartRequired) {
    return { persist: false, error: false, message: '已保存，重启应用后完全生效。' }
  }
  if (input.enabledMatches) {
    return {
      persist: false,
      error: false,
      message: input.enabled ? `已启用 ${input.title}。` : `已停用 ${input.title}。`,
    }
  }
  return { persist: false, error: true, message: '插件状态未完全同步，请重试或重启后再确认。' }
}

function toggleTestId(card: PluginCard): string {
  const id = card.entryId.includes(':') ? card.entryId.slice(card.entryId.indexOf(':') + 1) : card.entryId
  return `plugins-toggle-${id}`
}

/* 活动暗示:三点呼吸(参数改写自 Amicro pulse-dots,MIT);装饰 aria-hidden,
   关键帧在 client-styles.ts,reduced-motion 停循环后保留静态点。 */
const activityDots = () => <span className="dsh-plugins-dots" aria-hidden="true">
  <i />
  <i />
  <i />
</span>

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
  const parts: string[] = []
  const seen = new Set<string>()
  const push = (item: string) => {
    if (!item || seen.has(item)) return
    seen.add(item)
    parts.push(item)
  }
  for (const card of cards) {
    if (card.pendingRestart) push('待重启')
    push(communityRuntimeLabel(card))
  }
  return parts.join(' · ')
}

function Switch(props: {
  checked: boolean
  disabled?: boolean
  busy?: boolean
  labelledBy?: string
  describedBy?: string
  testId?: string
  onToggle(): void
}) {
  return (
    <button
      type="button"
      role="switch"
      className={`dsh-plugins-switch${props.checked ? ' is-on' : ''}${props.busy ? ' is-pending' : ''}`}
      aria-checked={props.checked}
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      data-testid={props.testId}
      disabled={props.disabled || props.busy}
      onClick={() => { if (!props.disabled && !props.busy) props.onToggle() }}>
      <span className="dsh-plugins-switch-thumb" aria-hidden={true} />
    </button>
  );
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
  hostButton?: ComponentType<HostButtonProps>
}) {
  const { cards } = props
  const primary = cards[0]!
  const titleId = `plugin-title-${props.groupId.replace(/[^A-Za-z0-9._-]+/g, '-')}`
  const on = enabledState(cards)
  const pendingRestart = cards.some((card) => card.pendingRestart)
  const phases = [...new Set(cards.map(phaseLabel))]
  const alert = phases.find((item) => item === '启用失败' || item === '启动中' || item === '正在停用')
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
  return (
    <article
      className="dsh-plugins-card"
      data-testid={`plugins-card-${primary.entryId}`}>
      <div>
        <div id={titleId} className="dsh-plugins-card-title">
          {props.title}
        </div>
        <div className="dsh-plugins-card-desc">
          {props.description}
        </div>
        {status
          ? <div className="dsh-plugins-meta">
          {activating ? activityDots() : null}
          {status}
        </div>
          : null}
        {extras.length > 0
          ? <details className="dsh-plugins-composition">
          <summary>
            详情
          </summary>
          <ul>
            {extras.map((row) => <li key={row}>
              {row}
            </li>)}
          </ul>
        </details>
          : null}
      </div>
      <div className="dsh-plugins-actions">
        {locked
          ? <span className="dsh-plugins-locked">
          核心
        </span>
          : canToggle
            ? <Switch
          checked={on}
          busy={props.busy}
          labelledBy={titleId}
          testId={`plugins-toggle-${props.groupId.includes('/') ? toggleTestId(primary) : props.groupId}`}
          onToggle={() => props.onToggle(toggleableCards(cards), !on)} />
            : null}
        {primary.origin === 'installed' && props.onUninstall
          ? <SeatButton
          host={props.hostButton}
          className="dsh-plugins-ghost"
          disabled={props.busy}
          onClick={() => props.onUninstall?.(primary)}>
          卸载
        </SeatButton>
          : null}
      </div>
    </article>
  );
}

type HostButtonProps = {
  type?: 'button' | 'submit'
  variant?: 'default' | 'primary' | 'danger' | 'icon'
  className?: string
  disabled?: boolean
  title?: string
  onClick?(event: ReactMouseEvent<HTMLButtonElement>): void
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-pressed'?: boolean
  'aria-expanded'?: boolean
  'aria-selected'?: boolean
  'aria-checked'?: boolean
  'aria-describedby'?: string
  'data-testid'?: string
  role?: string
  tabIndex?: number
  children?: ReactNode
}

type HostInputProps = {
  value: string
  onChange(value: string): void
  disabled?: boolean
  maxLength?: number
  placeholder?: string
  type?: 'text' | 'search' | 'password'
  'aria-label'?: string
  autoFocus?: boolean
  className?: string
  'data-testid'?: string
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
  return (
    <div
      className={`dsh-plugins-inspect dsh-plugins-inspect-${report.verdict}`}
      data-testid="plugins-inspect"
      role="status">
      <p className="dsh-plugins-inspect-verdict">
        {VERDICT_LABEL[report.verdict]}
        {report.name ? ` · ${report.name}${report.version ? `@${report.version}` : ''}` : ''}
      </p>
      {prominent.length
        ? <ul className="dsh-plugins-findings">
        {prominent.map((item, index) => <li
          key={`${item.code}:${index}`}
          className={`dsh-plugins-finding dsh-plugins-finding-${item.severity}`}>
          {item.message}
        </li>)}
      </ul>
        : null}
      {technical
        ? <details className="dsh-plugins-error-detail">
        <summary>
          技术详情
        </summary>
        {info.length
          ? <ul className="dsh-plugins-findings">
          {info.map((item, index) => <li
            key={`${item.code}:${index}`}
            className={`dsh-plugins-finding dsh-plugins-finding-${item.severity}`}>
            {item.message}
          </li>)}
        </ul>
          : null}
        {report.entries.length
          ? <p className="dsh-plugins-meta">
          {report.entries.map((entry) => entry.id).join('、')}
        </p>
          : null}
      </details>
        : null}
    </div>
  );
}

function WritingPresetGroup(props: {
  presets: WritingPresetCard[]
  busyPreset: string | null
  onToggle(id: string, enabled: boolean): void
  hostButton?: ComponentType<HostButtonProps>
}) {
  return (
    <section className="dsh-plugins-group" data-testid="plugins-writing-presets">
      <h3>
        写作模式
      </h3>
      <p className="dsh-plugins-core-hint">
        仅影响新对话，进行中的对话不变。
      </p>
      {props.presets.map((preset) => {
        const titleId = `preset-title-${preset.id}`
        return (
          <article
            key={preset.id}
            className="dsh-plugins-card"
            data-testid={`plugins-preset-${preset.id}`}>
            <div>
              <div id={titleId} className="dsh-plugins-card-title">
                {preset.title}
              </div>
              {preset.description ? <div className="dsh-plugins-card-desc">
                {preset.description}
              </div> : null}
            </div>
            <div className="dsh-plugins-actions">
              {preset.locked
                ? <span className="dsh-plugins-locked">
                核心
              </span>
                : <Switch
                checked={preset.enabled}
                busy={props.busyPreset === preset.id}
                labelledBy={titleId}
                testId={`plugins-preset-toggle-${preset.id}`}
                onToggle={() => props.onToggle(preset.id, !preset.enabled)} />}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function CoreGroup(props: { cards: PluginCard[] }) {
  if (props.cards.length === 0) return (
    <section className="dsh-plugins-group">
      <h3>
        系统核心
      </h3>
      <p className="dsh-plugins-empty">
        未找到核心插件。
      </p>
    </section>
  );
  return (
    <section className="dsh-plugins-group">
      <details className="dsh-plugins-core">
        <summary>
          {`系统核心（${props.cards.length}）`}
        </summary>
        <p className="dsh-plugins-core-hint">
          写作必需的部分，不能关闭。
        </p>
        <ul className="dsh-plugins-core-list">
          {props.cards.map((card) => <li key={card.entryId}>
            <span className="dsh-plugins-card-title">
              {card.title}
            </span>
            <span className="dsh-plugins-card-desc">
              {card.description}
            </span>
          </li>)}
        </ul>
      </details>
    </section>
  );
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
  hostButton?: ComponentType<HostButtonProps>
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
  if (groups.length === 0) return (
    <section className="dsh-plugins-group">
      <h3>
        {props.title}
      </h3>
      <p className="dsh-plugins-empty">
        {props.empty}
      </p>
    </section>
  );
  return (
    <section className="dsh-plugins-group">
      <h3>
        {props.title}
      </h3>
      {groups.map((group) => <FeatureCard
        key={group.id}
        groupId={group.id}
        title={group.title}
        description={group.description}
        composition={group.composition}
        cards={group.cards}
        busy={props.busyPackage === group.id || group.cards.some((card) => card.packageName === props.busyPackage)}
        community={props.community}
        onToggle={props.onToggle}
        onUninstall={props.onUninstall}
        hostButton={props.hostButton} />)}
    </section>
  );
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
  Button?: ComponentType<HostButtonProps>
  Input?: ComponentType<HostInputProps>
}

function UninstallConfirm(props: {
  card: PluginCard | null
  busy?: boolean
  error?: string
  errorDetail?: string
  Dialog?: ComponentType<HostDialogProps>
  Button?: ComponentType<HostButtonProps>
  onConfirm(): void
  onCancel(): void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const HostDialog = props.Dialog
  const busy = Boolean(props.busy)
  const errorNode = props.error
    ? <div
    className="dsh-plugins-error"
    role="alert"
    data-testid="plugins-uninstall-error">
    <p className="dsh-plugins-error-message">
      {props.error}
    </p>
    {props.errorDetail
      ? <details className="dsh-plugins-error-detail">
      <summary>
        技术详情
      </summary>
      <pre>
        {props.errorDetail}
      </pre>
    </details>
      : null}
  </div>
    : null
  if (HostDialog) {
    return (
      <HostDialog
        open={Boolean(props.card)}
        onOpenChange={(next: boolean) => { if (!next && !busy) props.onCancel() }}
        title="卸载插件"
        description={props.card ? `卸载 ${props.card.title}？作品文件不会被删除，重启后才会完全卸载。` : ''}
        className="file-dialog confirm-dialog"
        overlayClassName="file-dialog-overlay confirm-overlay"
        dismissible={!busy}
        initialFocusRef={cancel}>
        <header>
          <h2>
            卸载插件
          </h2>
        </header>
        <p>
          {props.card ? `卸载 ${props.card.title}？作品文件不会被删除，重启后才会完全卸载。` : ''}
        </p>
        {errorNode}
        <footer>
          <SeatButton ref={cancel} host={props.Button} disabled={busy} onClick={props.onCancel}>
            取消
          </SeatButton>
          <SeatButton
            host={props.Button}
            variant="danger"
            className="danger-action"
            disabled={busy}
            onClick={props.onConfirm}>
            {busy ? <Fragment>
              {activityDots()}
              卸载中…
            </Fragment> : '确认卸载'}
          </SeatButton>
        </footer>
      </HostDialog>
    );
  }
  if (!props.card) return null
  return (
    <section
      className="dsh-plugins-note"
      role="alertdialog"
      aria-busy={busy}
      onKeyDown={(event: { key: string; preventDefault(): void }) => {
        if (event.key !== 'Escape' || busy) return
        event.preventDefault()
        props.onCancel()
      }}>
      <p>
        {`卸载 ${props.card.title}？作品文件不会被删除，重启后才会完全卸载。`}
      </p>
      {errorNode}
      <p>
        <SeatButton
          host={props.Button}
          variant="primary"
          className="dsh-plugins-primary"
          disabled={busy}
          onClick={props.onConfirm}>
          {busy ? <Fragment>
            {activityDots()}
            卸载中…
          </Fragment> : '确认卸载'}
        </SeatButton>
        {' '}
        <SeatButton
          host={props.Button}
          className="dsh-plugins-ghost"
          disabled={busy}
          onClick={props.onCancel}>
          取消
        </SeatButton>
      </p>
    </section>
  );
}

function InstallAttemptView(props: {
  spec: string
  inspecting: boolean
  installing: boolean
  report: PluginInspectReport | null
  error: string
  errorDetail?: string
  host?: boolean
  cancelRef: RefObject<HTMLButtonElement>
  Button?: ComponentType<HostButtonProps>
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
  return (
    <div
      className="dsh-plugins-install-body"
      data-testid="plugins-install-dialog"
      aria-busy={props.inspecting || props.installing}>
      <header>
        <h2 id="plugins-install-title">
          安装插件
        </h2>
      </header>
      <p id="plugins-install-desc">
        {`将安装 ${props.spec}。先做静态检查，确认后再写入。`}
      </p>
      {props.inspecting
        ? <p
        className="dsh-plugins-status"
        role="status"
        data-testid="plugins-inspect-status">
        {activityDots()}
        正在检查…
      </p>
        : props.report
          ? <InspectReportView report={props.report} />
          : null}
      {props.error && !props.inspecting
        ? <div
        className="dsh-plugins-error"
        role="alert"
        data-testid="plugins-install-error">
        <p className="dsh-plugins-error-message">
          {props.error}
        </p>
        {props.errorDetail
          ? <details className="dsh-plugins-error-detail">
          <summary>
            技术详情
          </summary>
          <pre>
            {props.errorDetail}
          </pre>
        </details>
          : null}
      </div>
        : null}
      <footer>
        <SeatButton
          ref={props.cancelRef}
          host={props.Button}
          className={ghost}
          data-testid="plugins-install-cancel"
          disabled={props.installing}
          onClick={props.onCancel}>
          取消
        </SeatButton>
        {retry
          ? <SeatButton
          host={props.Button}
          className={ghost}
          data-testid="plugins-install-retry"
          onClick={props.onRetry}>
          重新检查
        </SeatButton>
          : null}
        <SeatButton
          host={props.Button}
          variant="primary"
          className={primary}
          data-testid="plugins-install-confirm"
          disabled={confirmDisabled}
          onClick={props.onConfirm}>
          {props.installing ? <Fragment>
            {activityDots()}
            安装中…
          </Fragment> : '确认安装'}
        </SeatButton>
      </footer>
    </div>
  );
}

function InstallConfirm(props: {
  Button?: ComponentType<HostButtonProps>
  attempt: PluginInstallAttempt | null
  installing: boolean
  Dialog?: ComponentType<HostDialogProps>
  onConfirm(): void
  onCancel(): void
  onRetry(): void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const attempt = props.attempt
  const HostDialog = props.Dialog
  const body = attempt
    ? <InstallAttemptView
    Button={props.Button}
    spec={attempt.spec}
    inspecting={attempt.inspecting}
    installing={props.installing}
    report={attempt.report}
    error={attempt.error}
    errorDetail={attempt.errorDetail}
    host={Boolean(HostDialog)}
    cancelRef={cancel}
    onConfirm={props.onConfirm}
    onCancel={props.onCancel}
    onRetry={props.onRetry} />
    : null
  if (HostDialog) {
    return (
      <HostDialog
        open={Boolean(attempt)}
        onOpenChange={(next: boolean) => { if (!next) props.onCancel() }}
        title="安装插件"
        description={attempt ? `将安装 ${attempt.spec}。先做静态检查，确认后再写入。` : ''}
        className="file-dialog confirm-dialog"
        overlayClassName="file-dialog-overlay confirm-overlay"
        dismissible={!props.installing}
        initialFocusRef={cancel}>
        {body}
      </HostDialog>
    );
  }
  if (!attempt) return null
  return (
    <section
      className="dsh-plugins-install-fallback"
      role="dialog"
      aria-modal={true}
      aria-labelledby="plugins-install-title"
      aria-describedby="plugins-install-desc"
      onKeyDown={(event: { key: string; preventDefault(): void }) => {
        if (event.key !== 'Escape' || props.installing) return
        event.preventDefault()
        props.onCancel()
      }}>
      {body}
    </section>
  );
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
  return (
    <section className="dsh-plugins" data-testid="plugins-settings" aria-label="插件">
      <div className="dsh-plugins-tabs" role="tablist" aria-label="插件分类" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        const index = buttons.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
        buttons[next]?.click()
      }}>
        <SeatButton
          host={props.Button}
          type="button"
          role="tab"
          aria-selected={props.tab === 'installed'}
          tabIndex={props.tab === 'installed' ? 0 : -1}
          data-testid="plugins-tab-installed"
          onClick={() => props.onTab('installed')}>
          已安装
        </SeatButton>
        <SeatButton
          host={props.Button}
          type="button"
          role="tab"
          aria-selected={props.tab === 'market'}
          tabIndex={props.tab === 'market' ? 0 : -1}
          data-testid="plugins-tab-market"
          onClick={() => props.onTab('market')}>
          市场
        </SeatButton>
      </div>
      {props.note ? <p
        className="dsh-plugins-note"
        role="status"
        data-testid={props.note === CLIENT_GRAPH_RELOAD_NOTICE ? 'plugins-client-reload-notice' : undefined}>
        {props.note}
      </p> : null}
      {props.error
        ? <div className="dsh-plugins-error" role="alert">
        <p className="dsh-plugins-error-message">
          {props.error}
        </p>
        {props.errorDetail
          ? <details className="dsh-plugins-error-detail">
          <summary>
            技术详情
          </summary>
          <pre>
            {props.errorDetail}
          </pre>
        </details>
          : null}
      </div>
        : null}
      <UninstallConfirm
        Button={props.Button}
        card={props.pendingUninstall}
        busy={props.uninstalling}
        error={props.uninstallError}
        errorDetail={props.uninstallErrorDetail}
        Dialog={props.Dialog}
        onConfirm={props.onConfirmUninstall}
        onCancel={props.onCancelUninstall} />
      <InstallConfirm
        Button={props.Button}
        attempt={props.pendingInstall}
        installing={props.installing}
        Dialog={props.Dialog}
        onConfirm={props.onConfirmInstall}
        onCancel={props.onCancelInstall}
        onRetry={props.onRetryInspect} />
      {props.tab === 'installed'
        ? props.loading
          ? <p className="dsh-plugins-status">
        {activityDots()}
        正在读取已安装插件…
      </p>
          : <div className="dsh-plugins-groups">
        {props.presets
          ? <WritingPresetGroup
          hostButton={props.Button}
          presets={props.presets}
          busyPreset={props.busyPreset}
          onToggle={props.onTogglePreset} />
          : null}
        <CoreGroup cards={props.inventory?.core ?? []} />
        <FeatureGroup
          hostButton={props.Button}
          title="写作功能"
          cards={props.inventory?.optional ?? []}
          empty="没有可开关的写作功能。"
          busyPackage={props.busyPackage}
          onToggle={props.onToggle}
          byPurpose={true} />
        <FeatureGroup
          hostButton={props.Button}
          title="已安装的社区插件"
          cards={props.inventory?.community ?? []}
          empty="还没有从市场安装插件。"
          busyPackage={props.busyPackage}
          onToggle={props.onToggle}
          onUninstall={props.onUninstall}
          community={true} />
      </div>
        : <div className="dsh-plugins-market">
        <form className="dsh-plugins-search" onSubmit={onMarketSubmit}>
          {props.Input
            ? <props.Input
            type="search"
            value={props.query}
            data-testid="plugins-search"
            placeholder="搜索插件，或粘贴 GitHub 仓库地址"
            aria-label="搜索插件，或粘贴 GitHub 仓库地址"
            onChange={props.onQuery} />
            : <input
            type="search"
            value={props.query}
            data-testid="plugins-search"
            placeholder="搜索插件，或粘贴 GitHub 仓库地址"
            aria-label="搜索插件，或粘贴 GitHub 仓库地址"
            onChange={(event: { target: { value: string } }) => props.onQuery(event.target.value)} />}
          <SeatButton
            host={props.Button}
            variant="primary"
            type="submit"
            className="dsh-plugins-primary"
            data-testid="plugins-market-submit"
            disabled={submitBusy}>
            {parsed ? (props.installing ? <Fragment>
              {activityDots()}
              安装中…
            </Fragment> : '安装') : (props.searching ? <Fragment>
              {activityDots()}
              搜索中…
            </Fragment> : '搜索')}
          </SeatButton>
        </form>
        {props.searching ? <p className="dsh-plugins-status">
          {activityDots()}
          正在搜索 GitHub…
        </p> : null}
        {!props.searching && props.listings.length === 0
          ? <p className="dsh-plugins-empty">
          输入关键词搜索，或粘贴 GitHub 仓库地址安装。
        </p>
          : <div className="dsh-plugins-group">
          {props.listings.map((item) => <article key={item.spec} className="dsh-plugins-card">
            <div>
              <div className="dsh-plugins-card-title">
                {item.owner}
                /
                {item.repo}
              </div>
              <div className="dsh-plugins-card-desc">
                {item.description || '暂无简介'}
              </div>
              <div className="dsh-plugins-meta">
                <span className="dsh-plugins-stars">
                  {`★ ${item.stars}`}
                </span>
                {' · '}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event: { preventDefault(): void }) => handleMarketplaceGithubClick(event, item.url)}>
                  在 GitHub 打开
                </a>
              </div>
            </div>
            <div className="dsh-plugins-actions">
              <SeatButton
                host={props.Button}
                variant="primary"
                className="dsh-plugins-primary"
                disabled={installBusy}
                onClick={() => props.onInstall(item.spec)}>
                安装
              </SeatButton>
            </div>
          </article>)}
        </div>}
      </div>}
    </section>
  );
}

function PluginSettings(props: {
  rpc: RpcCaller
  Dialog?: ComponentType<HostDialogProps>
  Button?: ComponentType<HostButtonProps>
  Input?: ComponentType<HostInputProps>
}) {
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
  const [clientReloadNotice, setClientReloadNotice] = useState(false)
  const attemptRef = useRef(0)
  const mountedRef = useRef(true)
  const inspectAbortRef = useRef<AbortController | null>(null)
  const confirmingRef = useRef(false)
  const uninstallingRef = useRef(false)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearNote = () => {
    if (noteTimerRef.current !== null) {
      clearTimeout(noteTimerRef.current)
      noteTimerRef.current = null
    }
    setNote('')
  }

  const flashNote = (message: string) => {
    setNote(message)
    if (noteTimerRef.current !== null) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      setNote('')
      noteTimerRef.current = null
    }, 2800)
  }

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
        setClientReloadNotice(clientGraphNeedsReload(result.value.clientPackages, bootClientEntryIds()))
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
      if (noteTimerRef.current !== null) {
        clearTimeout(noteTimerRef.current)
        noteTimerRef.current = null
      }
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
    clearNote()
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
        const followUp = pluginToggleFollowUp({
          restartRequired: restart,
          enabledMatches: allMatch,
          enabled,
          title,
          clientGraphChanged: clientGraphNeedsReload(listed.clientPackages, bootClientEntryIds()),
        })
        if (followUp.error) showError(followUp.message)
        else if (followUp.persist) {
          setClientReloadNotice(true)
          clearNote()
        }
        else flashNote(followUp.message)
      }
    }
  }

  const onTogglePreset = async (id: string, enabled: boolean) => {
    const title = presets?.find((preset) => preset.id === id)?.title ?? id
    setBusyPreset(id)
    setError('')
    setErrorDetail('')
    clearNote()
    try {
      const result = await callRpc<{ restartRequired: boolean }>(caller, 'presets.setEnabled', { id, enabled })
      if (!result.ok) {
        const view = errorView(result, `未能更新「${title}」`)
        showError(view.message, view.detail)
      } else {
        flashNote(enabled ? `已启用 ${title}。` : `已停用 ${title}。`)
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
      flashNote(`已卸载 ${card.title}。请重启应用后生效。`)
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
    clearNote()
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
        flashNote(pluginInstallNotice(result.value.name, result.value.inspect ?? inspected))
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

  return (
    <PluginPanel
      inventory={inventory}
      presets={presets}
      listings={listings}
      tab={tab}
      query={query}
      loading={loading}
      searching={searching}
      installing={installing}
      pendingInstall={pendingInstall}
      pendingUninstall={pendingUninstall}
      error={error}
      errorDetail={errorDetail}
      note={clientReloadNotice ? CLIENT_GRAPH_RELOAD_NOTICE : note}
      busyPackage={busyPackage}
      busyPreset={busyPreset}
      uninstalling={uninstalling}
      uninstallError={uninstallError}
      uninstallErrorDetail={uninstallErrorDetail}
      onTab={(next) => { clearNote(); setTab(next) }}
      onQuery={setQuery}
      onSearch={() => void onSearch()}
      onInstall={beginInstall}
      onConfirmInstall={confirmInstall}
      onCancelInstall={cancelInstall}
      onRetryInspect={retryInspect}
      onToggle={(cards, enabled) => void onToggle(cards, enabled)}
      onTogglePreset={(id, enabled) => void onTogglePreset(id, enabled)}
      onUninstall={onUninstall}
      onConfirmUninstall={() => void onConfirmUninstall()}
      onCancelUninstall={onCancelUninstall}
      Dialog={props.Dialog}
      Button={props.Button}
      Input={props.Input} />
  );
}

export function apply(ctx: Context): void {
  if (typeof document !== 'undefined') ctx.effect(() => injectStyles(), 'dsh-editor-plugins-client.styles')
  const client = ctx as PluginsClientContext
  function PluginsSettingsContribution(props?: {
    Dialog?: ComponentType<HostDialogProps>
    Button?: ComponentType<HostButtonProps>
    Input?: ComponentType<HostInputProps>
  }) {
    return <PluginSettings
      rpc={client.connection.rpc}
      Dialog={props?.Dialog}
      Button={props?.Button}
      Input={props?.Input} />;
  }
  client.slots.inject(PLUGINS_SETTINGS_SLOT, () =>
    client.slots.register({ name: PLUGINS_SETTINGS_SLOT, id: 'plugins', order: 0, label: '插件' }, PluginsSettingsContribution))
}
