import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useState } from 'react'
import { WEB_SEARCH_RPC_CHANNEL, providerKey, type RpcResult, type WebSettings, type WebStatus } from './contracts.ts'
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
export function NetworkSearchSettings({ client }: { client: Client }) {
  const [status, setStatus] = useState<WebStatus>()
  const [draft, setDraft] = useState<WebSettings>()
  const [apiKey, setApiKey] = useState('')
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
  const selected = status?.providers.find(provider => provider.kind === 'search' && provider.id === draft?.searchProvider)
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
  async function save(enableSearch: boolean) {
    if (!draft || !status) return
    const savedDraft = structuredClone(draft)
    let base = status
    // Stop active searches BEFORE replacing a key; never send a new key to the old endpoint.
    if (apiKey.trim()) {
      if (!selected?.credentialRef) throw new Error('请先选择搜索供应商。')
      // Check the revision before mutating credentials, including when search was already off.
      base = await update({ ...editable(base.settings), searchEnabled: false }, base.settings.revision)
      unwrap(await client.remote.credentials.set(selected.credentialRef, apiKey.trim()))
      setApiKey('')
    }
    await update({ ...editable(savedDraft), searchEnabled: enableSearch }, base.settings.revision)
    await load()
    setNote(enableSearch ? '搜索已启用。后续请求会使用所选供应商并可能产生费用。' : '设置已保存，联网搜索保持关闭。')
  }
  async function removeKey() {
    if (!selected?.credentialRef || !status) return
    await update({ ...editable(status.settings), searchEnabled: false }, status.settings.revision)
    unwrap(await client.remote.credentials.unset(selected.credentialRef))
    setApiKey(''); await load(); setNote('已关闭搜索并删除托管凭据。环境或其他只读凭据须在其来源处移除。')
  }
  if (!status || !draft) return <section className="web-search-settings"><h2>网络搜索</h2>
    <p role="status">{error || '正在读取设置…'}</p><button type="button" onClick={() => void action(async () => { await load() })}>重新连接</button></section>
  const searches = status.providers.filter(provider => provider.kind === 'search')
  const fetchers = status.providers.filter(provider => provider.kind === 'fetch')
  return <section className="web-search-settings" data-testid="web-search-settings">
    <header><h2>网络搜索</h2><p>只有你主动配置并启用后，模型和接入此能力的插件才能联网。搜索与网页读取分别授权。</p></header>
    {error && <p role="alert" className="web-search-error">{error}</p>}
    {note && <p role="status">{note}</p>}
    {status.storageFailed && <p role="alert">配置保存异常，当前运行已暂停网络访问。请重新保存。</p>}
    <fieldset disabled={busy}><legend>联网搜索 · {status.searchActive ? '已启用' : '未启用'}</legend>
      <label>搜索供应商<select value={draft.searchProvider} onChange={event => {
        setApiKey(''); setDraft({ ...draft, searchProvider: event.target.value })
      }}><option value="">请选择供应商</option>{searches.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
      {selected && <p>{selected.description} {selected.billing === 'model-and-tools' ? '包含辅助模型与工具调用费用。' : '按供应商 API 规则计费。'}</p>}
      {selected?.defaultBaseURL && <label>API 地址<input type="url" value={draft.endpoints[providerKey('search', selected.id)] ?? selected.defaultBaseURL}
        onChange={event => setDraft({ ...draft, endpoints: { ...draft.endpoints, [providerKey('search', selected.id)]: event.target.value } })} />
        <small>密钥会发送到此地址，仅填写你信任的 HTTPS 服务。</small></label>}
      {selected?.credentialRef && <><label>API Key<input type="password" autoComplete="off" spellCheck={false} value={apiKey}
        placeholder={selected.configured ? '已配置，留空不替换' : '请输入 API Key'} onChange={event => setApiKey(event.target.value)} /></label>
        <p>{selected.configured ? '已检测到凭据。' : '尚未配置凭据。'} 凭据由 Host 管理，不写入作品或普通设置。</p>
        <button type="button" disabled={!selected.configured || writable[selected.credentialRef] === false} onClick={() => void action(removeKey)}>关闭搜索并删除 Key</button></>}
      <div className="web-search-actions">
        <button type="button" onClick={() => void action(() => save(false))}>保存设置（不启用搜索）</button>
        <button type="button" disabled={!selected || (!selected.configured && !apiKey.trim())} onClick={() => void action(() => save(true))}>保存并启用搜索</button>
        <button type="button" disabled={!status.settings.searchEnabled} onClick={() => void action(async () => {
          await update({ ...editable(status.settings), searchEnabled: false }, status.settings.revision); setNote('联网搜索已关闭。')
        })}>关闭搜索</button>
        <button type="button" disabled={!status.searchActive} onClick={() => void action(async () => {
          const result = await call<{ sources: number }>('test'); await load(); setNote(`连接正常，返回 ${result.sources} 条来源。`)
        })}>测试连接（可能计费）</button>
      </div>
      <small>测试仅查询固定的 IANA 示例域名，不发送作品内容。不会自动测试或切换供应商。</small>
    </fieldset>
    <fieldset disabled={busy}><legend>网页读取 · {status.fetchActive ? '已启用' : '未启用'}</legend>
      <label>读取方式<select value={draft.fetchProvider} onChange={event => setDraft({ ...draft, fetchProvider: event.target.value })}>
        {fetchers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
      </select></label>
      <p>允许读取模型或用户指定的公开网页。直接 HTTP 读取不需要搜索 Key，不访问本机或内网地址。</p>
      <button type="button" onClick={() => void action(async () => {
        await update({ ...editable(status.settings), fetchProvider: draft.fetchProvider, fetchEnabled: !status.settings.fetchEnabled }, status.settings.revision)
        setNote(status.settings.fetchEnabled ? '网页读取已关闭。' : '网页读取已启用。')
      })}>{status.settings.fetchEnabled ? '关闭网页读取' : '启用网页读取'}</button>
    </fieldset>
    <fieldset disabled={busy}><legend>请求限制</legend>
      {([
        ['maxResults', '每条查询的结果上限', 1, 20], ['maxQueries', '每次模型工具调用的查询上限', 1, 5],
        ['timeoutMs', '请求超时（毫秒）', 1000, 120000], ['maxFetchChars', '网页正文字符上限', 1000, 200000],
      ] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} step={1}
        value={draft[key]} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })} /></label>)}
      <small>更改限制后点击上方保存按钮。一次模型工具调用可以包含多条查询；结果数不等于计费调用数。</small>
    </fieldset>
    <details><summary>当前运行的调用统计与扩展</summary>
      {status.providers.map(provider => <p key={providerKey(provider.kind, provider.id)}>{provider.label}：尝试 {provider.calls} 次，失败 {provider.failures} 次。</p>)}
      <p>统计仅覆盖当前 Host 运行，不是供应商账单；不保存查询、网页内容或 Key。安装供应商扩展插件后，在本页刷新即可配置。</p>
      <button type="button" disabled={busy} onClick={() => void action(async () => { await load(); setNote('供应商列表已刷新。') })}>刷新供应商</button>
    </details>
  </section>
}
const styles = `.web-search-settings{max-width:760px;display:grid;gap:18px;color:inherit;font:inherit}.web-search-settings header p,.web-search-settings small{opacity:.75;line-height:1.6}.web-search-settings fieldset{border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:10px;padding:16px;display:grid;gap:12px}.web-search-settings legend{padding:0 8px;font-weight:600}.web-search-settings label{display:grid;gap:6px}.web-search-settings input,.web-search-settings select{box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:7px;background:transparent;color:inherit;font:inherit}.web-search-settings button{padding:8px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:7px;background:transparent;color:inherit;cursor:pointer;font:inherit}.web-search-settings button:disabled{opacity:.45;cursor:not-allowed}.web-search-settings :focus-visible{outline:2px solid currentColor;outline-offset:3px}.web-search-actions{display:flex;flex-wrap:wrap;gap:8px}.web-search-error{color:#b42318}.web-search-settings p{margin:0;line-height:1.65}`
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
