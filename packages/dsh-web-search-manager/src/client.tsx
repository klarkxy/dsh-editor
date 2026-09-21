import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useId, useState } from 'react'
import { PROVIDER_PRICING_CHECKED, searchProviderInfo } from './provider-info.ts'
import {
  WEB_SEARCH_RPC_CHANNEL, pickActiveSearch, resolveSearchOrder,
  type ProviderView, type RpcResult, type WebSettings, type WebStatus,
} from './contracts.ts'

export const name = 'dsh-web-search-manager-client'
export const inject = ['slots', 'connection', 'remote', 'remote.credentials'] as const

interface Credentials {
  describe(refs: string[]): Promise<RpcResult<Record<string, { configured: boolean; writable: boolean; source?: string }>>>
  set(ref: string, value: string): Promise<RpcResult<unknown>>
  unset(ref: string): Promise<RpcResult<unknown>>
}
interface Client {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> } }
  remote: { credentials: Credentials }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; label: string; order: number }, render: unknown): () => void
  }
}

function unwrap<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
function editable(settings: WebSettings): Omit<WebSettings, 'revision'> {
  const { revision: _revision, ...rest } = settings
  return rest
}

export function isProviderOn(status: WebStatus, provider: ProviderView): boolean {
  const enabled = provider.kind === 'search' ? status.searchActive : status.fetchActive
  const selected = status.settings[provider.kind === 'search' ? 'searchProvider' : 'fetchProvider']
  return enabled && selected === provider.id
}

export function searchBackends(status: WebStatus): ProviderView[] {
  const all = status.providers.filter(provider => provider.kind === 'search')
  const order = resolveSearchOrder(
    all.map(provider => provider.id),
    status.settings,
    id => Boolean(all.find(provider => provider.id === id)?.credentialRef),
  )
  return order.flatMap(id => all.find(provider => provider.id === id) ?? [])
}

export function catalogSearchBackends(status: WebStatus): ProviderView[] {
  const enabled = searchBackends(status)
  const rest = status.providers.filter(provider => provider.kind === 'search' && !enabled.some(row => row.id === provider.id))
  return [...enabled, ...rest]
}

export function selectedSearchBackend(status: WebStatus): ProviderView | undefined {
  const backends = searchBackends(status)
  const id = pickActiveSearch(backends.map(provider => provider.id), id => Boolean(backends.find(provider => provider.id === id)?.configured))
  return backends.find(provider => provider.id === id)
}

function ExternalLink({ url, label, children }: { url: string; label: string; children: string }) {
  return <a href={url} target="_blank" rel="noreferrer noopener" aria-label={label}
    onClick={event => {
      const bridge = (globalThis as { dshWindow?: { openExternal?(url: string): void } }).dshWindow
      if (bridge?.openExternal) {
        event.preventDefault()
        bridge.openExternal(url)
      }
    }}>{children}</a>
}

export function canEnableSearch(
  order: readonly string[],
  providers: readonly ProviderView[],
  keys: Record<string, string>,
  writable: Record<string, boolean>,
): boolean {
  return order.some(id => {
    const provider = providers.find(item => item.kind === 'search' && item.id === id)
    if (!provider) return false
    if (provider.configured) return true
    const typed = (keys[provider.id] ?? '').trim()
    return Boolean(provider.credentialRef && typed && writable[provider.credentialRef] !== false)
  })
}

export function nextSearchEnabled(
  currentlyEnabled: boolean,
  nextOrder: readonly string[],
  providers: readonly ProviderView[],
  keys: Record<string, string>,
  writable: Record<string, boolean>,
): boolean {
  return currentlyEnabled && canEnableSearch(nextOrder, providers, keys, writable)
}

export function NetworkSearchSettings({ client }: { client: Client }) {
  const tabsId = useId()
  const [tab, setTab] = useState<'providers' | 'limits'>('providers')
  const [status, setStatus] = useState<WebStatus>()
  const [draft, setDraft] = useState<WebSettings>()
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [dragSource, setDragSource] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [sortAnnouncement, setSortAnnouncement] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [writable, setWritable] = useState<Record<string, boolean>>({})

  async function call<T>(endpoint: string, payload: unknown = {}): Promise<T> {
    return unwrap(await client.connection.rpc.call(WEB_SEARCH_RPC_CHANNEL, endpoint, payload) as RpcResult<T>)
  }
  async function load() {
    const next = await call<WebStatus>('status')
    setStatus(next); setDraft(next.settings)
    const refs = next.providers.flatMap(provider => provider.credentialRef ? [provider.credentialRef] : [])
    if (refs.length) {
      const credentials = unwrap(await client.remote.credentials.describe(refs))
      setWritable(Object.fromEntries(Object.entries(credentials).map(([ref, value]) => [ref, value.writable])))
    }
    return next
  }
  useEffect(() => { void load().catch(() => setError('无法读取网络搜索设置，请检查 Host 连接后重试。')) }, [client])

  async function action(run: () => Promise<void>) {
    setBusy(true); setNote(''); setError('')
    try { await run() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败。'); await load().catch(() => {}) }
    finally { setBusy(false) }
  }
  async function update(settings: Omit<WebSettings, 'revision'>, expectedRevision: number) {
    const next = await call<WebStatus>('update', { settings, expectedRevision })
    setStatus(next); setDraft(next.settings)
    return next
  }

  async function persist(on: boolean, order: string[]) {
    if (!status || !draft) return
    for (const provider of status.providers) {
      if (provider.kind !== 'search') continue
      const snapshot = keys[provider.id] ?? ''
      const typed = snapshot.trim()
      if (!provider.credentialRef || !typed) continue
      if (writable[provider.credentialRef] === false) throw new Error('当前凭据为只读，无法写入。')
      unwrap(await client.remote.credentials.set(provider.credentialRef, typed))
      setKeys(current => current[provider.id] === snapshot ? { ...current, [provider.id]: '' } : current)
    }
    await update({
      ...editable(status.settings),
      maxResults: draft.maxResults, maxQueries: draft.maxQueries,
      timeoutMs: draft.timeoutMs, maxFetchChars: draft.maxFetchChars,
      endpoints: draft.endpoints, searchOrder: order,
      searchEnabled: on, fetchProvider: 'http', fetchEnabled: on,
    }, status.settings.revision)
    await load()
  }

  async function removeKey(provider: ProviderView) {
    if (!provider.credentialRef || provider.credentialShared || !status) return
    unwrap(await client.remote.credentials.unset(provider.credentialRef))
    setKeys(current => ({ ...current, [provider.id]: '' }))
    await load()
    setNote('已删除 Key。')
  }

  if (!status || !draft) {
    return <section className="web-search-settings">
      <p role="status">{error || '正在读取设置…'}</p>
      <button type="button" onClick={() => void action(async () => { await load() })}>重新连接</button>
    </section>
  }

  const enabled = searchBackends(status)
  const backends = catalogSearchBackends(status)
  const selected = selectedSearchBackend(status)
  const on = status.settings.searchEnabled
  const order = enabled.map(provider => provider.id)
  const canEnable = canEnableSearch(order, status.providers, keys, writable)
  const limits = [
    ['maxResults', '每条查询的结果上限', 1, 20],
    ['maxQueries', '每次工具调用的查询上限', 1, 5],
    ['timeoutMs', '请求超时（毫秒）', 1000, 120000],
    ['maxFetchChars', '网页正文字符上限', 1000, 200000],
  ] as const

  function move(id: string, nextIndex: number) {
    const index = order.indexOf(id)
    if (busy || index < 0 || nextIndex < 0 || nextIndex >= order.length || index === nextIndex) return
    const next = [...order]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    void action(async () => {
      await persist(on, next)
      setSortAnnouncement((backends.find(provider => provider.id === id)?.label ?? id) + ' 已移至第 ' + (nextIndex + 1) + ' 位')
    })
  }

  function endDrag() {
    setDragSource(null)
    setDropTarget(null)
  }

  return <section className="web-search-settings" data-testid="web-search-settings">
    <div className="web-search-tabs" role="tablist" aria-label="网络搜索设置" onKeyDown={event => {
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
      {([['providers', '搜索服务'], ['limits', '请求限制']] as const).map(([key, label]) => (
        <button key={key} type="button" role="tab" id={tabsId + '-' + key + '-tab'}
          aria-controls={tabsId + '-' + key + '-panel'} aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>{label}</button>
      ))}
    </div>
    <span className="web-search-sr-only" role="status" aria-live="polite">{sortAnnouncement}</span>
    {error && <p role="alert" className="web-search-error">{error}</p>}
    {note && <p role="status">{note}</p>}
    {status.storageFailed && <p role="alert">配置保存异常，当前运行已暂停网络访问。请重新保存。</p>}
    <div role="tabpanel" id={tabsId + '-providers-panel'} aria-labelledby={tabsId + '-providers-tab'}
      hidden={tab !== 'providers'} tabIndex={0}>
      {backends.length === 0 ? <p className="web-search-empty">还没有可用的搜索后端。</p> : <article
        className="web-search-card"
        data-testid="web-search-tool"
        data-on={on ? 'true' : 'false'}>
        <header>
          <div>
            <h3>联网搜索</h3>
            {!canEnable && <p className="web-search-meta">请选择搜索服务并配置 Key。</p>}
          </div>
          <button
            type="button"
            role="switch"
            className={`web-search-switch${on ? ' is-on' : ''}`}
            aria-checked={on}
            aria-label={on ? '关闭联网搜索' : '启用联网搜索'}
            disabled={busy || (!on && !canEnable)}
            onClick={() => void action(() => persist(!on, order))}>
            <span className="web-search-switch-thumb" aria-hidden="true" />
          </button>
        </header>
        <ol className="web-search-rank" aria-label="搜索后端">
          {backends.map(provider => {
            const participating = order.includes(provider.id)
            const rank = order.indexOf(provider.id)
            const active = status.searchActive && selected?.id === provider.id
            const info = searchProviderInfo(provider)
            const needsKey = Boolean(provider.credentialRef)
            const shared = Boolean(provider.credentialShared)
            const showKey = needsKey && participating && (!shared || !provider.configured)
            const canSort = participating && order.length > 1
            return <li key={provider.id} className={active ? 'is-active' : undefined} data-testid={`web-search-rank-${provider.id}`}
              data-dragging={dragSource === provider.id || undefined}
              data-drop={dropTarget === provider.id && dragSource ? (order.indexOf(dragSource) < rank ? 'after' : 'before') : undefined}
              onDragOver={event => {
                if (busy || !canSort || !dragSource || dragSource === provider.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget(provider.id)
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
              }}
              onDrop={event => {
                if (busy || !canSort || !dragSource) return
                event.preventDefault()
                move(dragSource, rank)
                endDrag()
              }}>
              {canSort ? <button type="button" className="web-search-drag-handle"
                draggable={!busy} aria-disabled={busy}
                aria-label={'拖动排序 ' + provider.label}
                title="拖动排序，或用上下方向键调整"
                onDragStart={event => {
                  if (busy) { event.preventDefault(); return }
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('application/x-dsh-search-provider', provider.id)
                  const row = event.currentTarget.closest('li')
                  if (row) event.dataTransfer.setDragImage(row, 16, 16)
                  setDragSource(provider.id)
                  setSortAnnouncement('')
                }}
                onDragEnd={endDrag}
                onKeyDown={event => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  move(provider.id, rank + (event.key === 'ArrowUp' ? -1 : 1))
                }}>
                <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="5" r="1.5" /><circle cx="11" cy="5" r="1.5" />
                  <circle cx="5" cy="10" r="1.5" /><circle cx="11" cy="10" r="1.5" />
                  <circle cx="5" cy="15" r="1.5" /><circle cx="11" cy="15" r="1.5" />
                </svg>
              </button> : <span className="web-search-rank-index">{participating ? rank + 1 : '—'}</span>}
              <div className="web-search-provider">
                <div className="web-search-provider-heading">
                  <strong>{provider.label}</strong>
                  {active && <span className="web-search-meta">当前使用</span>}
                  {provider.signupUrl && <ExternalLink url={provider.signupUrl} label={provider.label + ' 去注册'}>去注册</ExternalLink>}
                </div>
                <div className="web-search-provider-info">
                  <p>{info.description}</p>
                  <p>{info.pricing}{info.pricingUrl && <> <ExternalLink url={info.pricingUrl}
                    label={provider.label + ' 费用说明'}>{provider.id === 'ddg' ? '官网' : '费用说明'}</ExternalLink></>}</p>
                </div>
                {participating && !provider.configured && <p className="web-search-meta">{needsKey ? '待配置 Key' : '暂不可用'}</p>}
                {shared && participating && <small>{provider.id === 'zhihu-global' ? '与「知乎资料」共用 Access Secret' : '与模型设置共用 Key'}</small>}
                {showKey ? <label>API Key
                  <input type="password" autoComplete="off" spellCheck={false}
                    disabled={busy || writable[provider.credentialRef ?? ''] === false}
                    value={keys[provider.id] ?? ''}
                    placeholder={provider.configured ? '已配置，留空不替换' : '请输入 API Key'}
                    onChange={event => setKeys(current => ({ ...current, [provider.id]: event.target.value }))} />
                </label> : null}
                {needsKey && !shared && provider.configured ? <button type="button"
                  disabled={busy || writable[provider.credentialRef ?? ''] === false}
                  onClick={() => void action(() => removeKey(provider))}>删除 Key</button> : null}
              </div>
              <div className="web-search-rank-move">
                <button
                  type="button"
                  role="switch"
                  className={`web-search-switch${participating ? ' is-on' : ''}`}
                  aria-checked={participating}
                  aria-label={`${participating ? '关闭' : '开启'} ${provider.label}`}
                  disabled={busy}
                  onClick={() => {
                    const next = participating ? order.filter(id => id !== provider.id) : [...order, provider.id]
                    void action(() => persist(nextSearchEnabled(status.settings.searchEnabled, next, status.providers, keys, writable), next))
                  }}>
                  <span className="web-search-switch-thumb" aria-hidden="true" />
                </button>
              </div>
            </li>
          })}
        </ol>
        <p className="web-search-meta">价格核对于 {PROVIDER_PRICING_CHECKED}，实际额度与费用以供应商账户为准。</p>
        {on ? <div className="web-search-card-actions">
          <button type="button" disabled={busy} onClick={() => void action(async () => {
            await persist(status.settings.searchEnabled, order)
            const result = await call<{ sources: number }>('test')
            await load()
            setNote(`连接正常，返回 ${result.sources} 条来源。`)
          })}>测试连接（可能计费）</button>
        </div> : null}
      </article>}
    </div>
    <div role="tabpanel" id={tabsId + '-limits-panel'} aria-labelledby={tabsId + '-limits-tab'}
      hidden={tab !== 'limits'} tabIndex={0}>
      <fieldset className="web-search-limits" disabled={busy} aria-label="请求限制">
        {limits.map(([key, label, min, max]) => (
          <label key={key}>{label}
            <input type="number" min={min} max={max} step={1} value={draft[key]}
              onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })} />
          </label>
        ))}
      </fieldset>
    </div>
    <button type="button" disabled={busy} onClick={() => void action(async () => {
      await persist(status.settings.searchEnabled, order)
      setNote('已保存。')
    })}>保存</button>
  </section>
}

const styles = `
.web-search-settings{max-width:760px;display:grid;gap:24px;color:inherit;font:400 var(--font-size-2,14px)/1.5 var(--default-font-family,system-ui,sans-serif)}
.web-search-settings p{margin:0;line-height:1.5}
.web-search-settings small,.web-search-meta,.web-search-empty{font-size:var(--font-size-1,13px);color:var(--gray-11,inherit)}
.web-search-error{color:var(--red-11,#b42318)}
.web-search-card{display:grid;gap:12px}
.web-search-card header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding-bottom:8px}
.web-search-card h3{margin:0;font-size:var(--font-size-3,16px);font-weight:600}
.web-search-provider{display:grid;gap:8px;min-width:0}
.web-search-provider-info{display:grid;gap:3px;font-size:var(--font-size-1,13px);color:var(--gray-11,inherit);overflow-wrap:anywhere}
.web-search-provider-heading{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;min-height:24px}
.web-search-provider-heading strong{font-weight:500}
.web-search-card label{display:grid;gap:6px}
.web-search-settings input{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:6px;background:var(--color-surface,transparent);color:inherit;font:inherit}
.web-search-settings button:not([role="switch"]){min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;justify-self:start}
.web-search-settings button:disabled{opacity:.45;cursor:not-allowed}
.web-search-tabs{display:flex;gap:20px;border-bottom:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent))}
.web-search-tabs button[role="tab"]{padding:8px 0;border:0;border-bottom:2px solid transparent;border-radius:0;color:var(--gray-11,inherit)}
.web-search-tabs button[aria-selected="true"]{border-bottom-color:var(--accent-9,#3b82f6);color:var(--accent-11,inherit);font-weight:600}
.web-search-settings .web-search-switch{all:unset;box-sizing:border-box;position:relative;display:inline-block;width:36px;height:20px;flex:none;border-radius:999px;background:var(--gray-7,color-mix(in srgb,currentColor 28%,transparent));cursor:pointer}
.web-search-switch.is-on{background:var(--accent-9,#3b82f6)}
.web-search-switch:disabled{cursor:not-allowed;opacity:.7}
.web-search-switch-thumb{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:999px;background:#fff;transition:transform 150ms ease}
.web-search-switch.is-on .web-search-switch-thumb{transform:translateX(16px)}
.web-search-settings :focus-visible{outline:2px solid currentColor;outline-offset:3px}
.web-search-card-actions{display:flex;flex-wrap:wrap;gap:8px}
.web-search-rank{margin:0;padding:0;list-style:none}
.web-search-rank li{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:start;padding:14px 0;border-top:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent))}
.web-search-settings button.web-search-drag-handle{display:grid;place-items:center;width:24px;height:24px;min-height:24px;padding:0;border:0;cursor:grab;color:inherit;opacity:.65}
.web-search-settings button.web-search-drag-handle:hover{opacity:1;background:var(--gray-3,color-mix(in srgb,currentColor 8%,transparent))}
.web-search-settings button.web-search-drag-handle:active{cursor:grabbing}
.web-search-settings button.web-search-drag-handle[aria-disabled="true"]{cursor:wait;opacity:.4}
.web-search-rank li[data-dragging]{opacity:.45}
.web-search-rank li[data-drop]::after{content:'';position:absolute;left:0;right:0;height:2px;background:var(--accent-9,#3b82f6);pointer-events:none}
.web-search-rank li[data-drop="before"]::after{top:-1px}
.web-search-rank li[data-drop="after"]::after{bottom:-1px}
.web-search-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.web-search-rank-index{opacity:.6;font-variant-numeric:tabular-nums;line-height:24px}
.web-search-rank-move{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end;padding-top:2px}
.web-search-settings a{color:var(--accent-11,currentColor);font-size:var(--font-size-1,13px);text-underline-offset:3px}
.web-search-limits{margin:0;border:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px}
.web-search-limits label{display:grid;gap:6px;font-size:var(--font-size-2,14px)}
@media(max-width:560px){.web-search-rank-move{flex-direction:column;align-items:flex-end}.web-search-limits{grid-template-columns:minmax(0,1fr)}}
@media(prefers-reduced-motion:reduce){.web-search-switch-thumb{transition:none}}
`

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-web-search-manager'); style.textContent = styles
    style.dataset.dshWebSearch = ''; document.head.appendChild(style)
    return () => style.remove()
  }, 'web-search-manager.styles')
  ctx.effect(() => client.slots.inject('settings.section', () => client.slots.register({
    name: 'settings.section', id: 'web-search', order: 70, label: '网络搜索',
  }, () => <NetworkSearchSettings client={client} />)), 'web-search-manager.settings')
}
