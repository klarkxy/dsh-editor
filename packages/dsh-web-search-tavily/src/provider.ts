import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@deepseek-ai/dsh-web'
export interface TavilyOptions { apiKey: string; baseURL?: string; fetch?: typeof fetch }
const MAX_RESPONSE_BYTES = 2_000_000
function endpoint(base: string): string {
  const url = new URL(base)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid endpoint')
  return `${url.href.replace(/\/+$/, '')}/search`
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
async function readJSON(response: Response, signal?: AbortSignal): Promise<unknown> {
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
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
/** Direct REST adapter. No auxiliary LLM, retries, anonymous fallback or auto-depth. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = 'tavily'
  constructor(private readonly options: TavilyOptions) {}
  available(): boolean {
    try { endpoint(this.options.baseURL ?? 'https://api.tavily.com'); return Boolean(this.options.apiKey.trim()) }
    catch { return false }
  }
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!this.available()) throw new WebError('Tavily 配置不可用。', 'WEB_CREDENTIAL_MISSING')
    if (!request.query?.trim() || request.query.length > 4000) throw new WebError('查询无效。', 'WEB_INVALID_REQUEST')
    const count = request.maxResults ?? 5
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new WebError('结果数须为 1 至 20。', 'WEB_INVALID_REQUEST')
    try {
      signal?.throwIfAborted()
      const response = await (this.options.fetch ?? fetch)(endpoint(this.options.baseURL ?? 'https://api.tavily.com'), {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          query: request.query.trim(), max_results: count, search_depth: 'basic', topic: 'general',
          auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false,
        }),
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw new WebError(`Tavily 请求失败（HTTP ${response.status}）。`, 'WEB_PROVIDER_ERROR')
      }
      const payload = record(await readJSON(response, signal))
      if (!Array.isArray(payload?.results)) throw new Error('Invalid response shape')
      const sources: WebSearchSource[] = []
      for (const raw of payload.results) {
        const row = record(raw)
        if (typeof row?.url !== 'string') continue
        let url: URL
        try { url = new URL(row.url) } catch { continue }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue
        sources.push({
          url: url.href,
          ...(typeof row.title === 'string' ? { title: row.title.slice(0, 1000) } : {}),
          ...(typeof row.content === 'string' ? { snippet: row.content.slice(0, 8000) } : {}),
          ...(typeof row.published_date === 'string' && Number.isFinite(Date.parse(row.published_date))
            ? { publishedAt: new Date(row.published_date).toISOString() } : {}),
        })
      }
      return { sources: sources.slice(0, count), truncated: sources.length > count }
    } catch (error) {
      if (signal?.aborted) throw new WebError('Tavily 搜索已取消。', 'WEB_ABORTED')
      if (error instanceof WebError) throw error
      throw new WebError('Tavily 返回无效响应或网络连接失败。', 'WEB_PROVIDER_ERROR')
    }
  }
}
