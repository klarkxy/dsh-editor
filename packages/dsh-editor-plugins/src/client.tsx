import type { Context } from '@deepseek-ai/cordis'
import {
  Fragment,
  useEffect,
  useRef,
  useState,
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

function nativeInstallSpec(spec: string): string {
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
  onQuery(value: string): void
  onSearch(): void
  onCopy(spec: string): void
  onOpen?(packageName: string): void
}) {
  const parsed = discoverInstallSpec(props.query)
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (parsed) props.onCopy(parsed.spec)
    else props.onSearch()
  }
  return (
    <details className="dsh-plugins-group dsh-plugins-core" data-testid="plugins-settings">
      <summary>
        <h3>发现插件</h3>
      </summary>
      <p className="dsh-plugins-intro">
        搜索用于发现插件。留空点「搜索」列出本机可选包。复制规格后，用下方「添加插件」粘贴。已安装的包可打开详情。
      </p>
      <form className="dsh-plugins-search" onSubmit={onSubmit}>
        {props.Input
          ? <props.Input value={props.query} onChange={props.onQuery} placeholder="关键词、包名，或留空列出本机可选包" />
          : <input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="关键词、包名，或留空列出本机可选包" />}
        <SeatButton host={props.Button} type="submit" variant="primary" className="dsh-plugins-primary" disabled={props.searching}>
          {parsed ? '复制规格' : '搜索'}
        </SeatButton>
      </form>
      {props.note ? <p className="dsh-plugins-status">{props.note}</p> : null}
      {props.error ? <p className="dsh-plugins-error">{props.error}</p> : null}
      {props.searching ? <p className="dsh-plugins-status">正在搜索…</p> : null}
      {!props.searching && props.listings.length === 0
        ? <p className="dsh-plugins-empty">留空点「搜索」列出本机可选包，或输入关键词搜索 GitHub、npm 包名、GitHub 仓库。</p>
        : <div className="dsh-plugins-group">
          {props.listings.map((item) => {
            const view = listingPresentation(item)
            const npm = parseNpmSpec(item.spec)
            return <article key={item.spec} className="dsh-plugins-card">
              <div>
                <div className="dsh-plugins-card-title">{view.title}</div>
                <div className="dsh-plugins-card-desc">{item.description || '暂无简介'}</div>
                <div className="dsh-plugins-meta">
                  {view.origin ? <span>{view.origin}</span> : null}
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
                <SeatButton host={props.Button} onClick={() => props.onCopy(item.spec)}>复制规格</SeatButton>
                {npm && props.onOpen
                  ? <SeatButton host={props.Button} variant="primary" className="dsh-plugins-primary" onClick={() => props.onOpen?.(npm.name)}>打开</SeatButton>
                  : null}
              </div>
            </article>
          })}
        </div>}
    </details>
  )
}

function PluginSettings(props: {
  rpc: RpcCaller
  Button?: ShellToolSeatContext['Button']
  Input?: ShellToolSeatContext['Input']
  openBundle?(packageName: string): void
}) {
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    void callRpc<{ listings: MarketplaceListing[] }>(props.rpc, 'marketplace.search', { query: '' }).then((result) => {
      if (!mounted.current || !result.ok) return
      setListings(result.value.listings)
    })
    return () => { mounted.current = false }
  }, [props.rpc])
  const onSearch = async () => {
    setSearching(true)
    setError('')
    const result = await callRpc<{ listings: MarketplaceListing[] }>(props.rpc, 'marketplace.search', { query })
    if (!mounted.current) return
    setSearching(false)
    if (!result.ok) {
      setError(result.error.message)
      setListings([])
      return
    }
    setListings(result.value.listings)
  }
  const onCopy = async (spec: string) => {
    try {
      const copied = await copyInstallSpec(spec)
      setNote(`已复制 ${copied}。请在「安装与卸载」页用「添加插件」粘贴。`)
    } catch {
      setNote(`请手动复制：${nativeInstallSpec(spec)}`)
    }
  }
  return <div className="dsh-plugins">
    <PluginDiscovery query={query} listings={listings} searching={searching} note={note} error={error}
      Button={props.Button} Input={props.Input} onQuery={setQuery} onSearch={() => { void onSearch() }}
      onCopy={(spec) => { void onCopy(spec) }} onOpen={props.openBundle} />
  </div>
}

export function apply(ctx: Context): void {
  if (typeof document !== 'undefined') ctx.effect(() => injectStyles(), 'dsh-editor-plugins-client.styles')
  const client = ctx as PluginsClientContext
  function PluginsSettingsContribution(props?: {
    Button?: ShellToolSeatContext['Button']
    Input?: ShellToolSeatContext['Input']
  }) {
    let openBundle: ((packageName: string) => void) | undefined
    try {
      const navigation = (ctx as Context & { pluginNavigation?: { openBundle(name: string): void } }).pluginNavigation
      if (navigation) openBundle = (packageName) => navigation.openBundle(packageName)
    } catch { /* native pluginNavigation mounts with the official page */ }
    return <PluginSettings rpc={client.connection.rpc} Button={props?.Button} Input={props?.Input} openBundle={openBundle} />
  }
  client.slots.inject(PLUGINS_SETTINGS_SLOT, () =>
    client.slots.register({ name: PLUGINS_SETTINGS_SLOT, id: 'plugins', order: 0, label: '插件' }, PluginsSettingsContribution))
}
