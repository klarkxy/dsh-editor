import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@deepseek-ai/dsh-web'

/** Keyless `ctx.web` search backend. The model still calls official `web_search`. */
export const SEARCH_ENGINE_ID = 'ddg'
export const SEARCH_ENGINE_PAGE = 'https://lite.duckduckgo.com/lite/'
const MAX_RESPONSE_BYTES = 2_000_000
const USER_AGENT = 'Mozilla/5.0 (compatible; dsh-editor-search/1.0)'

export function searchEngineUrl(query: string, page = SEARCH_ENGINE_PAGE): string {
  const url = new URL(page)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid search page')
  url.searchParams.set('q', query)
  return url.href
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

export function unwrapSearchHref(href: string, pageUrl: string): string | undefined {
  let raw = decodeEntities(href.trim())
  let url: URL
  try { url = new URL(raw, pageUrl) } catch { return }
  const nested = url.searchParams.get('uddg') ?? url.searchParams.get('u')
  if (nested) {
    try { url = new URL(nested) } catch { return }
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) return
  return url.href
}

export function parseSearchEngineHtml(html: string, pageUrl = SEARCH_ENGINE_PAGE): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  const re = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const url = unwrapSearchHref(match[1] ?? match[2] ?? '', pageUrl)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = decodeEntities(stripTags(match[3] ?? '')).trim().slice(0, 1000)
    sources.push(title ? { url, title } : { url })
  }
  return sources
}

async function readText(response: Response, signal?: AbortSignal): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response')
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      signal?.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_RESPONSE_BYTES) throw new Error('Response too large')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(bytes)
}

/** Adapter for `ctx.web.search`; `dsh-tool-web` still owns the model-facing `web_search` tool. */
export class SearchEngineProvider implements WebSearchProvider {
  readonly id = SEARCH_ENGINE_ID
  constructor(private readonly options: { fetch?: typeof fetch } = {}) {}
  available(): boolean { return true }
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!request.query?.trim() || request.query.length > 4000) throw new WebError('查询无效。', 'WEB_INVALID_REQUEST')
    const count = request.maxResults ?? 5
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new WebError('结果数须为 1 至 20。', 'WEB_INVALID_REQUEST')
    try {
      signal?.throwIfAborted()
      const url = searchEngineUrl(request.query.trim())
      const response = await (this.options.fetch ?? fetch)(url, {
        method: 'GET', redirect: 'follow', signal,
        headers: { accept: 'text/html', 'user-agent': USER_AGENT },
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw new WebError(`搜索页请求失败（HTTP ${response.status}）。`, 'WEB_PROVIDER_ERROR')
      }
      const sources = parseSearchEngineHtml(await readText(response, signal), response.url || SEARCH_ENGINE_PAGE)
      return { sources: sources.slice(0, count), truncated: sources.length > count }
    } catch (error) {
      if (signal?.aborted) throw new WebError('搜索已取消。', 'WEB_ABORTED')
      if (error instanceof WebError) throw error
      throw new WebError('无法读取公开搜索页。', 'WEB_PROVIDER_ERROR')
    }
  }
}
