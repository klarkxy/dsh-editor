/**
 * Optional web-search-manager backend. Registers only when this profile already
 * provides `webSearchManager`; Zhihu still works without that plugin.
 * Official model tool remains `web_search`. Dedicated `zhihu_global_search` is unchanged.
 */
import { ZHIHU_CREDENTIAL_REF } from './contracts.ts'
import { reportExecuted, type ZhihuClientOptions, type ZhihuSearchExecuted } from './zhihu-client.ts'
import {
  executeZhihuGlobalSearch,
  ZHIHU_GLOBAL_SEARCH_MAX_COUNT,
} from './operations.ts'

type ZhihuWebSearchHost = {
  run<T>(execute: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>
  toolOptions: ZhihuClientOptions & { onExecuted: (event: ZhihuSearchExecuted) => void }
}

export const ZHIHU_WEB_SEARCH_ID = 'zhihu-global'

export const ZHIHU_WEB_SEARCH_DESCRIPTOR = {
  id: ZHIHU_WEB_SEARCH_ID,
  label: '知乎全网搜索',
  description: '融合知乎问答与全网内容，返回可溯源的搜索结果。',
  credentialRef: ZHIHU_CREDENTIAL_REF,
  credentialShared: true,
  credentialHint: '与「知乎资料」共用 Access Secret',
  billing: 'request' as const,
  pricing: '注册可获 5,000 次/天试用额度；超额价格需向平台咨询。',
  pricingUrl: 'https://developer.zhihu.com/',
  signupUrl: 'https://developer.zhihu.com',
}

export type ZhihuWebSearchSource = { url: string; title?: string; snippet?: string }
export type ZhihuWebSearchResult = { sources: ZhihuWebSearchSource[]; truncated?: boolean }
export type ZhihuWebSearchRequest = { query: string; maxResults?: number }

export type ZhihuWebSearchProvider = {
  readonly id: string
  available(): boolean
  search(request: ZhihuWebSearchRequest, signal?: AbortSignal): Promise<ZhihuWebSearchResult>
}

export type ZhihuWebSearchManager = {
  registerSearchProvider(
    descriptor: typeof ZHIHU_WEB_SEARCH_DESCRIPTOR,
    factory: (options: { apiKey?: string; timeoutMs: number }) => ZhihuWebSearchProvider,
  ): () => void
}

export type ZhihuWebSearchProviderOptions = ZhihuClientOptions & {
  apiKey?: string
  onExecuted?: (event: ZhihuSearchExecuted) => void
}

function sourceFrom(url: string, title: string, snippet: string): ZhihuWebSearchSource | undefined {
  let parsed: URL
  try { parsed = new URL(url) } catch { return }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return
  return {
    url: parsed.href,
    ...(title ? { title: title.slice(0, 1000) } : {}),
    ...(snippet ? { snippet: snippet.slice(0, 8000) } : {}),
  }
}

function isWebSearchManager(value: unknown): value is ZhihuWebSearchManager {
  return !!value && typeof value === 'object' && typeof (value as ZhihuWebSearchManager).registerSearchProvider === 'function'
}

export function createZhihuWebSearchProvider(options: ZhihuWebSearchProviderOptions): ZhihuWebSearchProvider {
  const { apiKey, onExecuted, ...client } = options
  return {
    id: ZHIHU_WEB_SEARCH_ID,
    available() { return Boolean(apiKey?.trim()) },
    async search(request, signal) {
      if (!apiKey?.trim()) throw new Error('知乎全网搜索未配置 Access Secret。')
      if (!request.query?.trim() || request.query.length > 4000) throw new Error('查询无效。')
      const count = request.maxResults ?? 5
      if (!Number.isInteger(count) || count < 1 || count > ZHIHU_GLOBAL_SEARCH_MAX_COUNT) {
        throw new Error(`结果数须为 1 至 ${ZHIHU_GLOBAL_SEARCH_MAX_COUNT}。`)
      }
      try {
        signal?.throwIfAborted()
        const result = await executeZhihuGlobalSearch(request.query.trim(), count, 'all', {
          ...client,
          signal,
          env: {},
          resolveCredential: async () => apiKey,
        })
        reportExecuted(onExecuted, { ok: true, results: result.items.length })
        const sources = result.items.flatMap(item => sourceFrom(item.url, item.title, item.summary) ?? [])
        return { sources: sources.slice(0, count), truncated: sources.length > count }
      } catch (error) {
        reportExecuted(onExecuted, { ok: false, results: 0 })
        throw error
      }
    },
  }
}

export function registerZhihuGlobalSearchProvider(
  manager: ZhihuWebSearchManager,
  service: ZhihuWebSearchHost,
): () => void {
  return manager.registerSearchProvider(ZHIHU_WEB_SEARCH_DESCRIPTOR, options => {
    const provider = createZhihuWebSearchProvider({
      ...service.toolOptions,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
    })
    return {
      id: provider.id,
      available: () => provider.available(),
      search: (request, signal) => service.run(
        combined => provider.search(request, combined),
        signal ?? new AbortController().signal,
      ),
    }
  })
}

/** Wait for `webSearchManager` if this profile loaded it; no-op otherwise. */
export function bindZhihuWebSearch(
  ctx: { inject(deps: readonly string[], apply: (inner: { get(name: string): unknown }) => (() => void) | void): unknown },
  service: ZhihuWebSearchHost,
): void {
  ctx.inject(['webSearchManager'], (inner) => {
    let manager: unknown
    try { manager = inner.get('webSearchManager') }
    catch { return }
    if (!isWebSearchManager(manager)) return
    return registerZhihuGlobalSearchProvider(manager, service)
  })
}
