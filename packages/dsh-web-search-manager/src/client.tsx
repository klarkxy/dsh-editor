import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useState } from 'react'
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

export function providerCostNote(billing: ProviderView['billing']): string {
  if (billing === 'model-and-tools') return '可能产生额外的搜索费用。'
  if (billing === 'request') return '按供应商 API 计费。'
  return ''
}

export function NetworkSearchSettings({ client }: { client: Client }) {
  const [status, setStatus] = useState<WebStatus>()
  const [draft, setDraft] = useState<WebSettings>()
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
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
    let base = status
    for (const provider of searchBackends(status)) {
      const typed = (keys[provider.id] ?? '').trim()
      if (!on || !provider.credentialRef || !typed) continue
      if (base.searchActive) {
        base = await update({ ...editable(base.settings), searchEnabled: false, fetchEnabled: false }, base.settings.revision)
      }
      unwrap(await client.remote.credentials.set(provider.credentialRef, typed))
      setKeys(current => ({ ...current, [provider.id]: '' }))
    }
    await update({
      ...editable(base.settings),
      maxResults: draft.maxResults, maxQueries: draft.maxQueries,
      timeoutMs: draft.timeoutMs, maxFetchChars: draft.maxFetchChars,
      endpoints: draft.endpoints, searchOrder: order,
      searchEnabled: on, fetchProvider: 'http', fetchEnabled: on,
    }, base.settings.revision)
    await load()
    setNote(on ? '联网搜索已启用。按优先级使用第一个已就绪的后端。' : '联网搜索已关闭。')
  }

  async function removeKey(provider: ProviderView) {
    if (!provider.credentialRef || provider.credentialShared || !status) return
    unwrap(await client.remote.credentials.unset(provider.credentialRef))
    setKeys(current => ({ ...current, [provider.id]: '' }))
    await load()
    setNote('已删除托管凭据。将改用优先级列表中下一个已就绪的后端。')
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
  const on = status.searchActive
  const order = enabled.map(provider => provider.id)
  const canEnable = backends.some(provider => !provider.credentialRef || provider.configured || Boolean((keys[provider.id] ?? '').trim()))
  const limits = [
    ['maxResults', '每条查询的结果上限', 1, 20],
    ['maxQueries', '每次工具调用的查询上限', 1, 5],
    ['timeoutMs', '请求超时（毫秒）', 1000, 120000],
    ['maxFetchChars', '网页正文字符上限', 1000, 200000],
  ] as const

  function move(id: string, direction: -1 | 1) {
    const index = order.indexOf(id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return
    const next = [...order]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    void action(() => persist(on, next))
  }

  return <section className="web-search-settings" data-testid="web-search-settings">
    <p className="web-search-intro">只需开启一个后端。默认只用 DuckDuckGo；其它厂商请自行注册。打开后按优先级选用第一个已就绪的后端，单次失败不会自动换家。</p>
    {error && <p role="alert" className="web-search-error">{error}</p>}
    {note && <p role="status">{note}</p>}
    {status.storageFailed && <p role="alert">配置保存异常，当前运行已暂停网络访问。请重新保存。</p>}
    {backends.length === 0 ? <p className="web-search-empty">还没有可用的搜索后端。</p> : <article
      className={`web-search-card${on ? ' is-on' : ''}`}
      data-testid="web-search-tool"
      data-on={on ? 'true' : 'false'}>
      <header>
        <div>
          <h3>联网搜索</h3>
          <p>{selected ? `当前使用 ${selected.label}。` : '开启任意一个已就绪的后端即可。'}</p>
        </div>
        <button
          type="button"
          role="switch"
          className={`web-search-switch${on ? ' is-on' : ''}`}
          aria-checked={on}
          aria-label={on ? '关闭联网搜索' : '启用联网搜索'}
          disabled={busy || (!on && !canEnable)}
          onClick={() => void action(() => persist(!on, order.length ? order : ['ddg']))}>
          <span className="web-search-switch-thumb" aria-hidden="true" />
        </button>
      </header>
      <ol className="web-search-rank" aria-label="搜索后端">
        {backends.map(provider => {
          const participating = order.includes(provider.id)
          const rank = order.indexOf(provider.id)
          const active = on && selected?.id === provider.id
          const cost = providerCostNote(provider.billing)
          const needsKey = Boolean(provider.credentialRef)
          const shared = Boolean(provider.credentialShared)
          const showKey = needsKey && participating && (!shared || !provider.configured)
          return <li key={provider.id} className={active ? 'is-active' : undefined} data-testid={`web-search-rank-${provider.id}`}>
            <span className="web-search-rank-index">{participating ? rank + 1 : '—'}</span>
            <div>
              <strong>{provider.label}</strong>
              <p className="web-search-meta">{provider.description}</p>
              {cost ? <p className={provider.billing === 'model-and-tools' ? 'web-search-cost' : 'web-search-meta'}>{cost}</p> : null}
              {provider.signupUrl ? <p><a href={provider.signupUrl} target="_blank" rel="noreferrer noopener">去注册</a></p> : null}
              <p className="web-search-meta">{active ? '当前使用' : participating ? (provider.configured ? '已就绪' : '未就绪，将跳过') : '未开启'}</p>
              {showKey ? <label>API Key
                <input type="password" autoComplete="off" spellCheck={false} disabled={busy}
                  value={keys[provider.id] ?? ''}
                  placeholder={provider.configured ? '已配置，留空不替换' : '请输入 API Key'}
                  onChange={event => setKeys(current => ({ ...current, [provider.id]: event.target.value }))} />
                {shared ? <small>与模型设置共用。不会在此删除。</small> : null}
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
                  void action(() => persist(next.length > 0, next))
                }}>
                <span className="web-search-switch-thumb" aria-hidden="true" />
              </button>
              {participating ? <>
                <button type="button" disabled={busy || rank === 0} aria-label={`提高 ${provider.label} 优先级`} onClick={() => move(provider.id, -1)}>上移</button>
                <button type="button" disabled={busy || rank === order.length - 1} aria-label={`降低 ${provider.label} 优先级`} onClick={() => move(provider.id, 1)}>下移</button>
              </> : null}
            </div>
          </li>
        })}
      </ol>
      {on ? <div className="web-search-card-actions">
        <button type="button" disabled={busy} onClick={() => void action(async () => {
          const result = await call<{ sources: number }>('test')
          await load()
          setNote(`连接正常，返回 ${result.sources} 条来源。`)
        })}>测试连接（可能计费）</button>
      </div> : null}
    </article>}
    <fieldset className="web-search-limits" disabled={busy}>
      <legend>请求限制</legend>
      {limits.map(([key, label, min, max]) => (
        <label key={key}>{label}
          <input type="number" min={min} max={max} step={1} value={draft[key]}
            onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })} />
        </label>
      ))}
      <button type="button" onClick={() => void action(async () => {
        await update({
          ...editable(status.settings),
          maxResults: draft.maxResults, maxQueries: draft.maxQueries,
          timeoutMs: draft.timeoutMs, maxFetchChars: draft.maxFetchChars, endpoints: draft.endpoints,
          searchOrder: order, fetchEnabled: status.settings.searchEnabled, fetchProvider: 'http',
        }, status.settings.revision)
        setNote('已保存。')
      })}>保存</button>
    </fieldset>
  </section>
}

const styles = `
.web-search-settings{max-width:760px;display:grid;gap:16px;color:inherit;font:inherit}
.web-search-intro,.web-search-settings small,.web-search-meta,.web-search-empty{margin:0;opacity:.75;line-height:1.6}
.web-search-settings p{margin:0;line-height:1.65}
.web-search-error{color:var(--red-11,#b42318)}
.web-search-cards{display:grid;gap:12px}
.web-search-card{display:grid;gap:10px;padding:14px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:10px;background:var(--gray-3,color-mix(in srgb,currentColor 10%,transparent))}
.web-search-card.is-on{border-color:var(--accent-8,#5b8def);background:var(--accent-a3,color-mix(in srgb,#5b8def 16%,transparent));box-shadow:0 0 0 1px var(--accent-a6,color-mix(in srgb,#5b8def 28%,transparent))}
.web-search-card header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start}
.web-search-card h3{margin:0;font-size:1em}
.web-search-cost{color:var(--amber-11,#dba15b)}
.web-search-card label{display:grid;gap:6px}
.web-search-settings input,.web-search-settings select{box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:7px;background:var(--color-surface,var(--gray-2,color-mix(in srgb,currentColor 6%,transparent)));color:inherit;font:inherit}
.web-search-settings button:not([role="switch"]){padding:8px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:7px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.web-search-settings button:disabled{opacity:.45;cursor:not-allowed}
.web-search-settings :focus-visible{outline:2px solid currentColor;outline-offset:3px}
.web-search-settings .web-search-switch{all:unset;box-sizing:border-box;position:relative;display:inline-block;width:36px;height:20px;flex:none;border-radius:999px;background:var(--gray-7,color-mix(in srgb,currentColor 28%,transparent));cursor:pointer}
.web-search-switch.is-on{background:var(--accent-9,#3b82f6)}
.web-search-switch:disabled{cursor:not-allowed;opacity:.7}
.web-search-switch-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:999px;background:var(--gray-1,#fff);transition:transform 150ms ease}
.web-search-switch.is-on .web-search-switch-thumb{transform:translateX(16px)}
.web-search-card-actions{display:flex;flex-wrap:wrap;gap:8px}
.web-search-rank{display:grid;gap:8px;margin:0;padding:0;list-style:none}
.web-search-rank li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:8px}
.web-search-rank li.is-active{border-color:var(--accent-8,#5b8def)}
.web-search-rank-index{opacity:.6;font-variant-numeric:tabular-nums;padding-top:2px}
.web-search-rank-move{display:flex;flex-direction:column;gap:4px;align-items:flex-end}
.web-search-settings a{color:var(--accent-11,#8cb4ff)}
.web-search-limits{border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:10px;padding:14px;display:grid;gap:10px;background:var(--gray-3,color-mix(in srgb,currentColor 10%,transparent))}
.web-search-limits legend{padding:0 8px;font-weight:600}
`

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style'); style.textContent = styles
    style.dataset.dshWebSearch = ''; document.head.appendChild(style)
    return () => style.remove()
  }, 'web-search-manager.styles')
  ctx.effect(() => client.slots.inject('settings.section', () => client.slots.register({
    name: 'settings.section', id: 'web-search', order: 70, label: '网络搜索',
  }, () => <NetworkSearchSettings client={client} />)), 'web-search-manager.settings')
}
