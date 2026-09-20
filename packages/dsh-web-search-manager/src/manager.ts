import { WebError, type WebFetchProvider, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import {
  defaultSettings, migrateSearchOrder, pickActiveSearch, providerKey, resolveSearchOrder, validateBaseURL,
  type FetchProviderFactory, type ProviderDescriptor, type ProviderKind, type ProviderOptions,
  type SearchProviderFactory, type WebSettings, type WebStatus,
} from './contracts.ts'

export interface WebRegistry {
  registerSearchProvider(provider: WebSearchProvider): () => void
  registerFetchProvider(provider: WebFetchProvider): () => void
}
export interface ManagerOptions {
  web: WebRegistry
  initial?: Omit<WebSettings, 'searchOrder'> & { searchOrder?: string[] }
  resolveCredential(ref: string): Promise<string | undefined>
  save(settings: WebSettings): Promise<void>
}
type Entry = {
  descriptor: ProviderDescriptor; kind: ProviderKind; configured: boolean
  calls: number; failures: number; unregister(): void; active: Set<AbortController>
}
function fail(code: string, message: string): never { throw new WebError(message, code) }
function bounded(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) fail('WEB_INVALID_CONFIG', `${label}须为 ${min} 至 ${max} 的整数。`)
  return value
}
/** Enforce cancellation even when an extension ignores its cooperative signal. */
async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let off = () => {}
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new WebError('网络请求已取消或超时。', 'WEB_ABORTED'))
    signal.addEventListener('abort', onAbort, { once: true })
    off = () => signal.removeEventListener('abort', onAbort)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work() }), aborted])
  } finally { off() }
}

/** Manages consent and provider lifecycle. Selection and execution stay in ctx.web. */
export class WebSearchManager {
  private settings: WebSettings
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private pending = Promise.resolve()
  private epoch = 0
  private suspended = false
  private disposed = false
  private storageFailed = false

  constructor(private readonly options: ManagerOptions) {
    const initial = structuredClone(options.initial ?? defaultSettings())
    this.settings = { ...defaultSettings(), ...initial, searchOrder: migrateSearchOrder(initial) }
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private notify(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* observer failure cannot authorize a request */ }
    }
  }
  private knownSearchIds(): string[] {
    return [...this.entries.values()].filter(entry => entry.kind === 'search').map(entry => entry.descriptor.id)
  }
  private keyed(id: string): boolean {
    return Boolean(this.entries.get(providerKey('search', id))?.descriptor.credentialRef)
  }
  private configured(id: string): boolean {
    return Boolean(this.entries.get(providerKey('search', id))?.configured)
  }
  private searchOrder(settings: WebSettings = this.settings): string[] {
    return resolveSearchOrder(this.knownSearchIds(), settings, id => this.keyed(id))
  }
  private activeSearchId(settings: WebSettings = this.settings): string {
    return pickActiveSearch(this.searchOrder(settings), id => this.configured(id))
  }
  private selected(entry: Entry): boolean {
    if (this.disposed || this.suspended || !entry.configured) return false
    if (entry.kind === 'fetch') {
      return this.settings.fetchEnabled
        && this.settings.fetchProvider === entry.descriptor.id
        && this.entries.get(providerKey('fetch', entry.descriptor.id)) === entry
    }
    return this.settings.searchEnabled && this.activeSearchId() === entry.descriptor.id
  }
  status(): WebStatus {
    const entries = [...this.entries.values()]
    return {
      settings: structuredClone(this.settings), storageFailed: this.storageFailed,
      searchActive: entries.some(entry => entry.kind === 'search' && this.selected(entry)),
      fetchActive: entries.some(entry => entry.kind === 'fetch' && this.selected(entry)),
      providers: entries.map(entry => ({
        ...entry.descriptor, kind: entry.kind, configured: entry.configured,
        baseURL: this.settings.endpoints[providerKey(entry.kind, entry.descriptor.id)] ?? entry.descriptor.defaultBaseURL,
        calls: entry.calls, failures: entry.failures,
      })).sort((a, b) => providerKey(a.kind, a.id).localeCompare(providerKey(b.kind, b.id))),
    }
  }
  async refresh(): Promise<WebStatus> {
    const epoch = this.epoch
    await Promise.all([...this.entries.entries()].map(async ([key, entry]) => {
      let configured = !entry.descriptor.credentialRef
      if (entry.descriptor.credentialRef) {
        try { configured = Boolean((await this.options.resolveCredential(entry.descriptor.credentialRef))?.trim()) }
        catch { configured = false }
      }
      if (this.disposed || epoch !== this.epoch || this.entries.get(key) !== entry) return
      if (entry.configured !== configured) {
        entry.configured = configured
        if (!configured) this.abort(entry)
      }
    }))
    this.notify()
    return this.status()
  }
  private abort(entry?: Entry): void {
    for (const target of entry ? [entry] : this.entries.values()) {
      for (const controller of target.active) controller.abort()
    }
  }
  private add(kind: ProviderKind, descriptor: ProviderDescriptor): Entry {
    if (this.disposed) fail('WEB_DISABLED', '网络搜索插件已停止。')
    const key = providerKey(kind, descriptor.id)
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.id) || !descriptor.label.trim()) fail('WEB_INVALID_PROVIDER', '供应商标识或名称无效。')
    if (descriptor.credentialRef && !/^[A-Z][A-Z0-9_]{1,127}$/.test(descriptor.credentialRef)) fail('WEB_INVALID_PROVIDER', '供应商凭据引用无效。')
    if (descriptor.defaultBaseURL) validateBaseURL(descriptor.defaultBaseURL)
    if (descriptor.signupUrl) {
      try {
        const url = new URL(descriptor.signupUrl)
        if (url.protocol !== 'https:' || url.username || url.password) fail('WEB_INVALID_PROVIDER', '注册地址须为 HTTPS。')
      } catch { fail('WEB_INVALID_PROVIDER', '注册地址须为 HTTPS。') }
    }
    if (this.entries.has(key)) fail('WEB_DUPLICATE_PROVIDER', '供应商标识已注册。')
    const entry: Entry = {
      descriptor: Object.freeze({ ...descriptor }), kind, configured: !descriptor.credentialRef,
      calls: 0, failures: 0, unregister() {}, active: new Set(),
    }
    this.entries.set(key, entry)
    return entry
  }
  private registration(entry: Entry, register: () => () => void): () => void {
    const key = providerKey(entry.kind, entry.descriptor.id)
    try { entry.unregister = register() }
    catch (error) { this.entries.delete(key); throw error }
    void this.refresh()
    let removed = false
    return () => {
      if (removed) return
      removed = true
      this.abort(entry)
      this.entries.delete(key)
      entry.unregister()
      this.notify()
    }
  }
  registerSearchProvider(descriptor: ProviderDescriptor, factory: SearchProviderFactory): () => void {
    const entry = this.add('search', descriptor)
    return this.registration(entry, () => this.options.web.registerSearchProvider({
      id: descriptor.id, available: () => this.selected(entry),
      search: (request, signal) => {
        if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 4000) fail('WEB_INVALID_REQUEST', '查询须为 1 至 4000 字符。')
        const count = Math.min(bounded(request.maxResults ?? this.settings.maxResults, 1, 100, '结果数'), this.settings.maxResults)
        return this.execute(entry, signal, async (options, combined) => {
          const provider = factory(options)
          if (!provider.available()) fail('WEB_PROVIDER_ERROR', '供应商配置不可用。')
          const result = await provider.search({ query: request.query.trim(), maxResults: count }, combined)
          const sources = result.sources.slice(0, count).filter(source => {
            try { const url = new URL(source.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
          }).map(source => ({ ...source, title: source.title?.slice(0, 1000), snippet: source.snippet?.slice(0, 8000) }))
          return { ...result, content: result.content?.slice(0, 40_000), sources,
            truncated: result.truncated || result.sources.length > count }
        })
      },
    }))
  }
  registerFetchProvider(descriptor: ProviderDescriptor, factory: FetchProviderFactory): () => void {
    const entry = this.add('fetch', descriptor)
    return this.registration(entry, () => this.options.web.registerFetchProvider({
      id: descriptor.id, available: () => this.selected(entry),
      fetch: (request, signal) => this.execute(entry, signal, async (options, combined) => {
        const provider = factory(options)
        if (!provider.available()) fail('WEB_PROVIDER_ERROR', '供应商配置不可用。')
        const result = await provider.fetch(request, combined)
        const content = result.body.content.slice(0, options.maxFetchChars)
        return { ...result, body: { ...result.body, content },
          truncated: result.truncated || content.length !== result.body.content.length }
      }),
    }))
  }
  private async execute<T>(entry: Entry, signal: AbortSignal | undefined,
    run: (options: ProviderOptions, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.selected(entry)) fail('WEB_DISABLED', '请在设置 → 网络搜索中配置凭据并主动启用。')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.settings.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const epoch = this.epoch
    entry.active.add(controller)
    let started = false
    try {
      const ref = entry.descriptor.credentialRef
      const apiKey = ref ? await abortable(() => this.options.resolveCredential(ref), combined) : undefined
      if (ref && !apiKey?.trim()) {
        entry.configured = false
        this.abort(entry)
        this.notify()
        fail('WEB_CREDENTIAL_MISSING', '搜索凭据已删除或不可用，请重新配置。')
      }
      if (epoch !== this.epoch || !this.selected(entry)) fail('WEB_DISABLED', '网络访问设置已改变，请重新发起请求。')
      const options = {
        apiKey, baseURL: this.settings.endpoints[providerKey(entry.kind, entry.descriptor.id)] ?? entry.descriptor.defaultBaseURL,
        timeoutMs: this.settings.timeoutMs, maxFetchChars: this.settings.maxFetchChars,
      }
      started = true
      entry.calls += 1
      const result = await abortable(() => run(options, combined), combined)
      if (epoch !== this.epoch || !this.selected(entry)) fail('WEB_ABORTED', '网络请求已取消。')
      return result
    } catch (error) {
      if (started) entry.failures += 1
      const code = error instanceof WebError ? error.code : undefined
      if (code === 'WEB_CREDENTIAL_MISSING') throw new WebError('搜索凭据不可用，请重新配置。', 'WEB_CREDENTIAL_MISSING')
      if (code === 'WEB_DISABLED') throw new WebError('网络搜索未启用或设置已改变。', 'WEB_DISABLED')
      if (combined.aborted || code === 'WEB_ABORTED') throw new WebError('网络请求已取消或超时。', 'WEB_ABORTED')
      // Do not forward raw provider responses, token-bearing errors, or causes.
      throw new WebError('网络供应商请求失败，请检查凭据、额度和连接。未切换到其他供应商。', 'WEB_PROVIDER_ERROR')
    } finally {
      clearTimeout(timeout)
      entry.active.delete(controller)
    }
  }
  update(next: Omit<WebSettings, 'revision'>, expectedRevision: number): Promise<WebStatus> {
    const task = this.pending.then(async () => {
      if (this.disposed) fail('WEB_DISABLED', '网络搜索插件已停止。')
      if (expectedRevision !== this.settings.revision) fail('WEB_CONFIG_CONFLICT', '设置已被其他页面修改，请刷新后重试。')
      const proposed: WebSettings = { ...structuredClone(next), revision: expectedRevision + 1 }
      bounded(proposed.maxResults, 1, 20, '结果上限')
      bounded(proposed.maxQueries, 1, 5, '查询上限')
      bounded(proposed.timeoutMs, 1000, 120_000, '超时毫秒数')
      bounded(proposed.maxFetchChars, 1000, 200_000, '正文长度')
      for (const [key, value] of Object.entries(proposed.endpoints)) {
        const entry = this.entries.get(key)
        if (entry && !entry.descriptor.defaultBaseURL) fail('WEB_INVALID_CONFIG', '供应商不支持自定义地址。')
        try { proposed.endpoints[key] = validateBaseURL(value) }
        catch { fail('WEB_INVALID_CONFIG', '供应商地址须为无凭据、无查询参数的 HTTPS 地址。') }
      }
      await this.refresh()
      proposed.searchOrder = this.searchOrder(proposed)
      proposed.searchProvider = this.activeSearchId(proposed)
      if (proposed.searchEnabled && !proposed.searchProvider) {
        fail('WEB_CREDENTIAL_MISSING', '请先选择已安装的供应商并填写有效凭据。')
      }
      if (proposed.searchEnabled && this.entries.get(providerKey('fetch', 'http'))) {
        proposed.fetchEnabled = true
        proposed.fetchProvider = 'http'
      }
      if (!proposed.searchEnabled) proposed.fetchEnabled = false
      if (proposed.fetchEnabled) {
        const entry = this.entries.get(providerKey('fetch', proposed.fetchProvider))
        if (!entry) proposed.fetchEnabled = false
        else if (!entry.configured) fail('WEB_CREDENTIAL_MISSING', '请先选择已安装的供应商并填写有效凭据。')
      }
      this.suspended = true
      this.epoch += 1
      this.abort()
      this.notify()
      try { await this.options.save(proposed) }
      catch {
        this.storageFailed = true
        this.notify()
        fail('WEB_CONFIG_SAVE_FAILED', '设置保存失败。为避免意外联网，本次运行已暂停网络访问。')
      }
      this.settings = proposed
      this.storageFailed = false
      this.suspended = false
      this.notify()
      return this.status()
    })
    this.pending = task.then(() => {}, () => {})
    return task
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.epoch += 1
    this.abort()
    this.notify()
    for (const entry of this.entries.values()) entry.unregister()
    this.entries.clear()
    this.listeners.clear()
    await this.pending
  }
}
