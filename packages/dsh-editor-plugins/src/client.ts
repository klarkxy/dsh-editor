import type { Context } from '@deepseek-ai/cordis'
import { createElement as e, useCallback, useEffect, useState, type FormEvent } from 'react'
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
  return result.error.message || fallback
}

function Toggle(props: { card: PluginCard; busy: boolean; onToggle(card: PluginCard, enabled: boolean): void }) {
  const { card, busy } = props
  return e('button', {
    type: 'button',
    className: 'dsh-plugins-toggle',
    'data-testid': `plugins-toggle-${card.entryId}`,
    'aria-pressed': card.enabled,
    disabled: card.locked || busy,
    title: card.locked ? '系统核心插件不能关闭' : card.enabled ? '停用' : '启用',
    onClick: () => props.onToggle(card, !card.enabled),
  }, card.locked ? '核心' : card.enabled ? '开' : '关')
}

function PluginCardView(props: {
  card: PluginCard
  busy: boolean
  onToggle(card: PluginCard, enabled: boolean): void
  onUninstall?(card: PluginCard): void
}) {
  const { card } = props
  return e('article', { className: 'dsh-plugins-card', 'data-testid': `plugins-card-${card.entryId}` },
    e('div', null,
      e('div', { className: 'dsh-plugins-card-title' }, card.title),
      e('div', { className: 'dsh-plugins-card-desc' }, card.description),
      e('div', { className: 'dsh-plugins-meta' },
        card.packageName,
        card.version ? ` · ${card.version}` : '',
        card.origin === 'installed' ? ' · 已从市场安装' : '',
        card.fiberPhase && card.enabled ? ` · ${card.fiberPhase}` : '',
      ),
    ),
    e('div', { className: 'dsh-plugins-actions' },
      e(Toggle, { card, busy: props.busy, onToggle: props.onToggle }),
      card.origin === 'installed' && props.onUninstall
        ? e('button', {
          type: 'button',
          className: 'dsh-plugins-ghost',
          disabled: props.busy,
          onClick: () => props.onUninstall?.(card),
        }, '卸载')
        : null,
    ),
  )
}

type PluginToggle = (card: PluginCard, enabled: boolean) => void

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

function Group(props: { title: string; cards: PluginCard[]; empty: string; busy: boolean; onToggle: PluginToggle; onUninstall?: (card: PluginCard) => void }) {
  if (props.cards.length === 0) return e('section', { className: 'dsh-plugins-group' },
    e('h3', null, props.title),
    e('p', { className: 'dsh-plugins-empty' }, props.empty),
  )
  return e('section', { className: 'dsh-plugins-group' },
    e('h3', null, props.title),
    props.cards.map((card) => e(PluginCardView, {
      key: card.entryId, card, busy: props.busy, onToggle: props.onToggle, onUninstall: props.onUninstall,
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
  note: string
  onTab(tab: 'installed' | 'market'): void
  onQuery(value: string): void
  onSearch(): void
  onSpec(value: string): void
  onInstall(spec: string): void
  onInspect(spec: string): void
  onToggle(card: PluginCard, enabled: boolean): void
  onUninstall(card: PluginCard): void
  onConfirmUninstall(): void
  onCancelUninstall(): void
}

function PluginPanel(props: PluginPanelProps) {
  const onSearchSubmit = (event: FormEvent) => { event.preventDefault(); props.onSearch() }
  const onInstallSubmit = (event: FormEvent) => { event.preventDefault(); props.onInstall(props.spec) }
  return e('section', { className: 'dsh-plugins', 'data-testid': 'plugins-settings', 'aria-label': '插件' },
    e('p', { className: 'dsh-plugins-intro' }, '写作所需的最小核心不能关闭。其余插件可开关。社区插件安装前可先做静态检查：有没有构建产物、会不会和写作界面抢 root、入口文件能不能被 Loader 解析。检查通过也不等于运行时一定成功。'),
    e('div', { className: 'dsh-plugins-tabs', role: 'tablist', 'aria-label': '插件分类' },
      e('button', { type: 'button', role: 'tab', 'aria-selected': props.tab === 'installed', 'data-testid': 'plugins-tab-installed', onClick: () => props.onTab('installed') }, '已安装'),
      e('button', { type: 'button', role: 'tab', 'aria-selected': props.tab === 'market', 'data-testid': 'plugins-tab-market', onClick: () => props.onTab('market') }, '市场'),
    ),
    props.note ? e('p', { className: 'dsh-plugins-note', role: 'status' }, props.note) : null,
    props.error ? e('p', { className: 'dsh-plugins-error', role: 'alert' }, props.error) : null,
    props.pendingUninstall ? e('p', { className: 'dsh-plugins-note', role: 'alertdialog' },
      `卸载 ${props.pendingUninstall.title}？作品文件不会被删除，但需要重启后才会卸下。`,
      ' ',
      e('button', { type: 'button', className: 'dsh-plugins-primary', onClick: props.onConfirmUninstall }, '确认卸载'),
      ' ',
      e('button', { type: 'button', className: 'dsh-plugins-ghost', onClick: props.onCancelUninstall }, '取消'),
    ) : null,
    props.tab === 'installed'
      ? props.loading
        ? e('p', { className: 'dsh-plugins-status' }, '正在读取已安装插件…')
        : e('div', { className: 'dsh-plugins-groups' },
          e(Group, { title: '系统核心', cards: props.inventory?.core ?? [], empty: '未找到核心插件。', busy: props.installing, onToggle: props.onToggle }),
          e(Group, { title: '写作扩展', cards: props.inventory?.optional ?? [], empty: '当前组合没有可开关的写作扩展。', busy: props.installing, onToggle: props.onToggle }),
          e(Group, { title: '已安装的社区插件', cards: props.inventory?.community ?? [], empty: '还没有从市场安装插件。', busy: props.installing, onToggle: props.onToggle, onUninstall: props.onUninstall }),
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

function PluginSettings(props: { rpc: RpcCaller }) {
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
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await callRpc<PluginInventory>(caller, 'inventory.list', {})
      if (result.ok) setInventory(result.value)
      else setError(errorText(result, '未能读取插件列表'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能读取插件列表')
    } finally {
      setLoading(false)
    }
  }, [caller])

  useEffect(() => { void refresh() }, [refresh])

  const onToggle = async (card: PluginCard, enabled: boolean) => {
    setError('')
    const result = await callRpc<{ restartRequired: boolean }>(caller, 'entry.setEnabled', { entryId: card.entryId, enabled })
    if (!result.ok) { setError(errorText(result, '未能更新插件')); return }
    setNote(result.value.restartRequired ? '已保存。部分插件需要重启后才会完全生效。' : enabled ? `已启用 ${card.title}。` : `已停用 ${card.title}。`)
    await refresh()
  }

  const onUninstall = (card: PluginCard) => setPendingUninstall(card)
  const onConfirmUninstall = async () => {
    const card = pendingUninstall
    if (!card) return
    setInstalling(true)
    setError('')
    try {
      const result = await callRpc<{ restartRequired: boolean }>(caller, 'marketplace.uninstall', { name: card.packageName })
      if (!result.ok) setError(errorText(result, '未能卸载'))
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
    try {
      const result = await callRpc<{ listings: MarketplaceListing[] }>(caller, 'marketplace.search', { query })
      if (result.ok) setListings(result.value.listings)
      else setError(errorText(result, '搜索失败'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '搜索失败')
    } finally {
      setSearching(false)
    }
  }

  const onInspect = async (value: string) => {
    setInspecting(true)
    setError('')
    setInspect(null)
    try {
      const result = await callRpc<PluginInspectReport>(caller, 'marketplace.inspect', { spec: value })
      if (result.ok) setInspect(result.value)
      else setError(errorText(result, '检查失败'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '检查失败')
    } finally {
      setInspecting(false)
    }
  }

  const onInstall = async (value: string) => {
    setInstalling(true)
    setError('')
    try {
      const result = await callRpc<{ name: string; restartRequired: boolean; inspect?: PluginInspectReport }>(caller, 'marketplace.install', { spec: value })
      if (!result.ok) setError(errorText(result, '安装失败'))
      else {
        if (result.value.inspect) setInspect(result.value.inspect)
        const extra = result.value.inspect?.verdict === 'warn' ? '静态检查有注意事项，见下方。' : ''
        setNote(`已安装 ${result.value.name}。请重启应用后使用。${extra}`)
        setTab('installed')
        await refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '安装失败')
    } finally {
      setInstalling(false)
    }
  }

  return e(PluginPanel, {
    inventory, listings, tab, query, spec, loading, searching, installing, inspecting, inspect, pendingUninstall, error, note,
    onTab: setTab, onQuery: setQuery, onSearch: () => void onSearch(), onSpec: setSpec,
    onInstall: (value) => void onInstall(value),
    onInspect: (value) => void onInspect(value),
    onToggle: (card, enabled) => void onToggle(card, enabled),
    onUninstall,
    onConfirmUninstall: () => void onConfirmUninstall(),
    onCancelUninstall: () => setPendingUninstall(null),
  })
}

export function apply(ctx: Context): void {
  if (typeof document !== 'undefined') ctx.effect(() => injectStyles(), 'dsh-editor-plugins-client.styles')
  const client = ctx as PluginsClientContext
  const render = () => e(PluginSettings, { rpc: client.connection.rpc })
  client.slots.inject(PLUGINS_SETTINGS_SLOT, () =>
    client.slots.register({ name: PLUGINS_SETTINGS_SLOT, id: 'plugins', order: 0, label: '插件' }, render))
}
