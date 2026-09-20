import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@deepseek-ai/dsh-web'
import { httpsEndpoint, readJSON, record, sourceFrom } from './http-json.ts'

export interface RestSearchOptions { apiKey: string; baseURL?: string; fetch?: typeof fetch }

type RestSpec = {
  id: string
  fallback: string
  path: string
  method: 'GET' | 'POST'
  headers(apiKey: string): Record<string, string>
  query?: (request: { query: string; count: number }) => Record<string, string>
  body?: (request: { query: string; count: number }) => unknown
  parse(payload: unknown): WebSearchSource[]
}

function createRestSearch(spec: RestSpec): new (options: RestSearchOptions) => WebSearchProvider {
  return class implements WebSearchProvider {
    readonly id = spec.id
    constructor(private readonly options: RestSearchOptions) {}
    available(): boolean {
      try { httpsEndpoint(this.options.baseURL ?? spec.fallback, spec.path); return Boolean(this.options.apiKey.trim()) }
      catch { return false }
    }
    async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
      if (!this.available()) throw new WebError(`${spec.id} 配置不可用。`, 'WEB_CREDENTIAL_MISSING')
      if (!request.query?.trim() || request.query.length > 4000) throw new WebError('查询无效。', 'WEB_INVALID_REQUEST')
      const count = request.maxResults ?? 5
      if (!Number.isInteger(count) || count < 1 || count > 20) throw new WebError('结果数须为 1 至 20。', 'WEB_INVALID_REQUEST')
      const query = request.query.trim()
      try {
        signal?.throwIfAborted()
        const url = new URL(httpsEndpoint(this.options.baseURL ?? spec.fallback, spec.path))
        for (const [key, value] of Object.entries(spec.query?.({ query, count }) ?? {})) url.searchParams.set(key, value)
        const response = await (this.options.fetch ?? fetch)(url, {
          method: spec.method, redirect: 'error', signal,
          headers: { accept: 'application/json', ...spec.headers(this.options.apiKey) },
          ...(spec.body ? { body: JSON.stringify(spec.body({ query, count })) } : {}),
        })
        if (!response.ok) {
          await response.body?.cancel().catch(() => {})
          throw new WebError(`搜索请求失败（HTTP ${response.status}）。`, 'WEB_PROVIDER_ERROR')
        }
        const sources = spec.parse(await readJSON(response, signal))
        return { sources: sources.slice(0, count), truncated: sources.length > count }
      } catch (error) {
        if (signal?.aborted) throw new WebError('搜索已取消。', 'WEB_ABORTED')
        if (error instanceof WebError) throw error
        throw new WebError('无法完成搜索请求。', 'WEB_PROVIDER_ERROR')
      }
    }
  }
}

export const BraveSearchProvider = createRestSearch({
  id: 'brave', fallback: 'https://api.search.brave.com', path: '/res/v1/web/search', method: 'GET',
  headers: apiKey => ({ 'x-subscription-token': apiKey }),
  query: ({ query, count }) => ({ q: query, count: String(count) }),
  parse(payload) {
    const results = record(record(payload)?.web)?.results
    return Array.isArray(results) ? results.flatMap(row => sourceFrom(row, 'url', 'title', 'description') ?? []) : []
  },
})

export const BochaSearchProvider = createRestSearch({
  id: 'bocha', fallback: 'https://api.bochaai.com', path: '/v1/web-search', method: 'POST',
  headers: apiKey => ({ authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }),
  body: ({ query, count }) => ({ query, count, freshness: 'noLimit', summary: false }),
  parse(payload) {
    const pages = record(record(record(payload)?.data)?.webPages)?.value
      ?? record(record(payload)?.webPages)?.value
    return Array.isArray(pages) ? pages.flatMap(row => sourceFrom(row, 'url', 'name', 'snippet') ?? []) : []
  },
})

export const SerperSearchProvider = createRestSearch({
  id: 'serper', fallback: 'https://google.serper.dev', path: '/search', method: 'POST',
  headers: apiKey => ({ 'x-api-key': apiKey, 'content-type': 'application/json' }),
  body: ({ query, count }) => ({ q: query, num: count }),
  parse(payload) {
    const organic = record(payload)?.organic
    return Array.isArray(organic) ? organic.flatMap(row => sourceFrom(row, 'link', 'title', 'snippet') ?? []) : []
  },
})

export const FirecrawlSearchProvider = createRestSearch({
  id: 'firecrawl', fallback: 'https://api.firecrawl.dev', path: '/v1/search', method: 'POST',
  headers: apiKey => ({ authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }),
  body: ({ query, count }) => ({ query, limit: count }),
  parse(payload) {
    const data = record(payload)?.data
    return Array.isArray(data) ? data.flatMap(row => sourceFrom(row, 'url', 'title', 'description') ?? []) : []
  },
})
