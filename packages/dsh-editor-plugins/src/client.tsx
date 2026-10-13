import type { Context } from '@deepseek-ai/cordis'
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import {
  PLUGINS_RPC_CHANNEL,
  PLUGINS_SETTINGS_SLOT,
  type MarketplaceListing,
  type PluginsRpcResult,
  type WritingPresetCard,
} from './contracts.ts'
import { pluginsClientStyles } from './client-styles.ts'
import type { ShellToolSeatContext } from 'dsh-editor-seats'
import { SeatButton } from 'dsh-editor-seats/seat-button'
import { parseGitHubSpec } from './github.ts'
import { parseNpmSpec } from './npm.ts'

export const name = 'dsh-editor-plugins-client'
export const inject = ['slots', 'connection'] as const

type RpcCaller = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
}
export type DiscoveryInventory = {
  status: string
  packages: readonly { name: string; installed: boolean; optional: boolean; enabled: boolean }[]
  install?: { phase: string }
}
type DiscoveryInventorySource = {
  getSnapshot(): DiscoveryInventory
  subscribe(listener: () => void): () => void
}
const UNAVAILABLE_INVENTORY: DiscoveryInventory = { status: 'unavailable', packages: [] }
function discoveryInstallBusy(inventory?: DiscoveryInventory): boolean {
  return Boolean(inventory?.install && !['idle', 'done', 'failed', 'cancelled'].includes(inventory.install.phase))
}
function discoveryCanInstall(inventory?: DiscoveryInventory, onInstall?: unknown): boolean {
  return inventory?.status === 'ready' && typeof onInstall === 'function' && !discoveryInstallBusy(inventory)
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
  style.setAttribute('data-plugin', 'dsh-editor-plugins')
  style.textContent = pluginsClientStyles
  return () => {}
}

async function callRpc<T>(caller: RpcCaller, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<PluginsRpcResult<T>> {
  return await caller.call(PLUGINS_RPC_CHANNEL, endpoint, payload, signal) as PluginsRpcResult<T>
}

type MarketplaceBridge = {
  openExternal?(url: string): void
  /** Preload shape is nested (`dshWindow.clipboard.writeText`); the flat name is kept as a fallback. */
  clipboard?: { writeText?(text: string): void | Promise<void> }
  clipboardWriteText?(text: string): void | Promise<void>
}

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

export function discoverInstallSpec(query: string): { spec: string; packageName?: string } | undefined {
  const npm = parseNpmSpec(query)
  if (npm?.version) return { spec: npm.spec, packageName: npm.name }
  const github = parseGitHubSpec(query)
  if (github) return { spec: github.spec }
  return undefined
}

export function nativeInstallSpec(spec: string): string {
  // Discovery uses npm: as a source marker; the native installer takes a bare
  // package spec. Preserve GitHub and local specs at this boundary.
  const npm = parseNpmSpec(spec)
  return npm ? npm.spec.slice(4) : spec
}

export async function copyInstallSpec(spec: string): Promise<string> {
  const installSpec = nativeInstallSpec(spec)
  const scope = globalThis as { window?: { dshWindow?: MarketplaceBridge }; navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }
  const bridge = scope.window?.dshWindow?.clipboard?.writeText ?? scope.window?.dshWindow?.clipboardWriteText
  if (bridge) {
    await bridge(installSpec)
    return installSpec
  }
  const writeText = scope.navigator?.clipboard?.writeText?.bind(scope.navigator.clipboard)
  if (!writeText) throw new Error('无法访问剪贴板')
  await writeText(installSpec)
  return installSpec
}

export function listingPresentation(item: MarketplaceListing): {
  title: string
  origin?: string
  showStars: boolean
  linkLabel?: string
  url?: string
} {
  if (item.source === 'local') {
    return {
      title: item.title?.trim() || item.packageName || item.repo,
      origin: '本地发行',
      showStars: false,
    }
  }
  return {
    title: `${item.owner}/${item.repo}`,
    showStars: item.source !== 'npm',
    linkLabel: item.source === 'npm' ? '在 npm 打开' : '在 GitHub 打开',
    url: item.url,
  }
}

type HostSwitchProps = { checked: boolean; busy?: boolean; labelledBy: string; testId: string; onToggle(): void }

function Switch(props: HostSwitchProps) {
  const state = [
    'dsh-plugins-switch',
    props.checked ? 'is-on' : '',
    props.busy ? 'is-pending' : '',
  ].filter(Boolean).join(' ')
  return <button type="button" role="switch" aria-checked={props.checked} aria-labelledby={props.labelledBy}
    data-testid={props.testId} className={state} disabled={props.busy} onClick={props.onToggle}>
    <span className="dsh-plugins-switch-thumb" aria-hidden="true" />
  </button>
}

/** Preset rows are rendered by the shell settings page; kept for reuse, not mounted here. */
export function WritingPresetGroup(props: {
  presets: WritingPresetCard[]
  busyPreset: string | null
  onToggle(id: string, enabled: boolean): void
}) {
  return (
    <details className="dsh-plugins-group dsh-plugins-core" data-testid="plugins-writing-presets">
      <summary>
        <h3>写作模式</h3>
      </summary>
      <p className="dsh-plugins-core-hint">仅影响新对话，进行中的对话不变。</p>
      {props.presets.map((preset) => {
        const titleId = `preset-title-${preset.id}`
        return (
          <article key={preset.id} className="dsh-plugins-card" data-testid={`plugins-preset-${preset.id}`}>
            <div>
              <div id={titleId} className="dsh-plugins-card-title">{preset.title}</div>
              {preset.description ? <div className="dsh-plugins-card-desc">{preset.description}</div> : null}
            </div>
            <div className="dsh-plugins-actions">
              {preset.locked
                ? <span className="dsh-plugins-locked">必需</span>
                : <Switch checked={preset.enabled} busy={props.busyPreset === preset.id} labelledBy={titleId}
                  testId={`plugins-preset-toggle-${preset.id}`} onToggle={() => props.onToggle(preset.id, !preset.enabled)} />}
            </div>
          </article>
        )
      })}
    </details>
  )
}

export function PluginDiscovery(props: {
  query: string
  listings: MarketplaceListing[]
  searching: boolean
  note: string
  error: string
  Button?: ShellToolSeatContext['Button']
  Input?: ShellToolSeatContext['Input']
  submittedQuery?: string
  onQuery(value: string): void
  onSearch(): void
  onCopy(spec: string): void
  inventory?: DiscoveryInventory
  onInstall?(spec: string): void
  onOpen?(packageName: string): void
}) {
  const parsed = discoverInstallSpec(props.query)
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    // An explicit version or source is the author's selection. The official
    // installer decides whether it can replace an already installed package.
    if (parsed && discoveryCanInstall(props.inventory, props.onInstall)) props.onInstall?.(nativeInstallSpec(parsed.spec))
    else props.onSearch()
  }
  return (
    <section className="dsh-plugins-group" data-testid="plugins-settings" aria-label="发现插件">
      <p className="dsh-plugins-intro">
        搜索写作需要的功能，或留空查看本机可选插件。选择「安装」后，在安装窗口确认；已有插件可打开配置与详情。
      </p>
      <form className="dsh-plugins-search" onSubmit={onSubmit}>
        {props.Input
          ? <props.Input aria-label="搜索插件" value={props.query} onChange={props.onQuery} placeholder="关键词、包名，或留空列出本机可选包" />
          : <input aria-label="搜索插件" value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="关键词、包名，或留空列出本机可选包" />}
        <SeatButton host={props.Button} type="submit" variant="primary" className="dsh-plugins-primary"
          disabled={props.searching || (Boolean(parsed) && !discoveryCanInstall(props.inventory, props.onInstall))}>
          {parsed?.packageName ? '安装指定版本' : parsed ? '安装' : '搜索'}
        </SeatButton>
      </form>
      {props.note ? <p className="dsh-plugins-status" role="status">{props.note}</p> : null}
      {props.error ? <p className="dsh-plugins-error" role="alert">{props.error}</p> : null}
      {props.inventory?.status !== 'ready' ? <p className="dsh-plugins-status" role="status">
        {props.inventory?.status === 'loading' || props.inventory?.status === 'idle' ? '正在读取已安装状态…' : '安装管理当前不可用，暂时无法安装或确认已安装状态。'}
      </p> : discoveryInstallBusy(props.inventory) ? <p className="dsh-plugins-status" role="status">安装正在进行，请在「安装与卸载」页查看进度。</p> : null}
      {props.searching ? <p className="dsh-plugins-status">正在搜索…</p> : null}
      {!props.searching && props.listings.length === 0
        ? (props.submittedQuery?.trim()
          ? <p className="dsh-plugins-empty">没有找到与「{props.submittedQuery.trim()}」匹配的插件。</p>
          : <p className="dsh-plugins-empty">留空点「搜索」列出本机可选包，或输入关键词搜索 GitHub、npm 包名、GitHub 仓库。</p>)
        : <div className="dsh-plugins-group">
          {props.listings.map((item) => {
            const view = listingPresentation(item)
            const npm = parseNpmSpec(item.spec)
            const explicit = discoverInstallSpec(item.spec)
            const packageName = item.packageName || npm?.name
            const installed = packageName ? props.inventory?.packages.find(row => row.name === packageName) : undefined
            return <article key={item.spec} className="dsh-plugins-card">
              <div>
                <div className="dsh-plugins-card-title">{view.title}</div>
                <div className="dsh-plugins-card-desc">{item.description || '暂无简介'}</div>
                <div className="dsh-plugins-meta">
                  {view.origin ? <span>{view.origin}</span> : null}
                  {props.inventory?.status === 'ready' ? <span>{view.origin ? ' · ' : ''}{installed
                    ? `${installed.installed ? '已安装' : '应用内可用'} · ${installed.enabled ? '已启用' : '未启用'}`
                    : packageName ? '未安装' : '安装时确认状态'}</span> : null}
                  {view.showStars ? <Fragment>
                    {view.origin ? ' · ' : null}
                    <span className="dsh-plugins-stars">{`★ ${item.stars}`}</span>
                  </Fragment> : null}
                  {view.url ? <Fragment>
                    {(view.origin || view.showStars) ? ' · ' : null}
                    <a href={view.url} target="_blank" rel="noreferrer"
                      onClick={(event: { preventDefault(): void }) => handleMarketplaceGithubClick(event, view.url!)}>
                      {view.linkLabel}
                    </a>
                  </Fragment> : null}
                </div>
              </div>
              <div className="dsh-plugins-actions">
                {installed && packageName && !explicit
                  ? <SeatButton host={props.Button} variant="default"
                    disabled={!props.onOpen} onClick={() => props.onOpen?.(packageName)}>配置与详情</SeatButton>
                  : <SeatButton host={props.Button} variant="primary" className="dsh-plugins-primary"
                    disabled={!discoveryCanInstall(props.inventory, props.onInstall)}
                    onClick={() => props.onInstall?.(nativeInstallSpec(item.spec))}>{explicit?.packageName ? '安装指定版本' : '安装'}</SeatButton>}
              </div>
              <details className="dsh-plugins-composition">
                <summary>高级信息</summary>
                <div className="dsh-plugins-spec">{nativeInstallSpec(item.spec)}</div>
                <SeatButton host={props.Button} onClick={() => props.onCopy(item.spec)}>复制规格</SeatButton>
              </details>
            </article>
          })}
        </div>}
    </section>
  )
}

function PluginSettings(props: {
  rpc: RpcCaller
  Button?: ShellToolSeatContext['Button']
  Input?: ShellToolSeatContext['Input']
  openBundle?(packageName: string): void
  inventory?: DiscoveryInventorySource
  onInstall?(spec: string): void
}) {
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searching, setSearching] = useState(true)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const mounted = useRef(true)
  const request = useRef<AbortController>()
  const subscribe = useCallback((listener: () => void) => props.inventory?.subscribe(listener) ?? (() => {}), [props.inventory])
  const getSnapshot = useCallback(() => props.inventory?.getSnapshot() ?? UNAVAILABLE_INVENTORY, [props.inventory])
  const inventory = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const search = useCallback(async (value: string) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setSubmittedQuery(value)
    setSearching(true)
    setError('')
    try {
      const result = await callRpc<{ listings: MarketplaceListing[] }>(props.rpc, 'marketplace.search', { query: value }, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      if (!result.ok) { setError(result.error.message); setListings([]); return }
      setListings(result.value.listings)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (mounted.current && !controller.signal.aborted) setSearching(false)
    }
  }, [props.rpc])
  useEffect(() => {
    mounted.current = true
    void search('')
    return () => { mounted.current = false; request.current?.abort() }
  }, [search])
  const onCopy = async (spec: string) => {
    try {
      const copied = await copyInstallSpec(spec)
      if (mounted.current) setNote(`已复制 ${copied}。`)
    } catch {
      if (mounted.current) setNote(`请手动复制：${nativeInstallSpec(spec)}`)
    }
  }
  return <div className="dsh-plugins">
    <PluginDiscovery query={query} listings={listings} searching={searching} note={note} error={error}
      Button={props.Button} Input={props.Input} submittedQuery={submittedQuery}
      onQuery={setQuery} onSearch={() => { void search(query) }}
      onCopy={(spec) => { void onCopy(spec) }} onOpen={props.openBundle} inventory={inventory} onInstall={props.onInstall} />
  </div>
}

export function apply(ctx: Context): void {
  if (typeof document !== 'undefined') ctx.effect(() => injectStyles(), 'dsh-editor-plugins-client.styles')
  const client = ctx as PluginsClientContext
  function PluginsSettingsContribution(props?: {
    Button?: ShellToolSeatContext['Button']
    Input?: ShellToolSeatContext['Input']
    inventory?: DiscoveryInventorySource
    onInstall?(spec: string): void
    onOpen?(packageName: string): void
  }) {
    let openBundle: ((packageName: string) => void) | undefined = props?.onOpen
    try {
      const navigation = (ctx as Context & { pluginNavigation?: { openBundle(name: string): void } }).pluginNavigation
      if (!openBundle && navigation) openBundle = (packageName) => navigation.openBundle(packageName)
    } catch { /* native pluginNavigation mounts with the official page */ }
    return <PluginSettings rpc={client.connection.rpc} Button={props?.Button} Input={props?.Input} openBundle={openBundle}
      inventory={props?.inventory} onInstall={props?.onInstall} />
  }
  client.slots.inject(PLUGINS_SETTINGS_SLOT, () =>
    client.slots.register({ name: PLUGINS_SETTINGS_SLOT, id: 'plugins', order: 0, label: '插件' }, PluginsSettingsContribution))
}
