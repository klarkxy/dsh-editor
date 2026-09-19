import { ExaSearchProvider } from '@deepseek-ai/dsh-web-search-exa'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import type { WebSearchManager } from './manager.ts'

export function registerBuiltins(manager: WebSearchManager): () => void {
  const offExa = manager.registerSearchProvider({
    id: 'exa', label: 'Exa', description: '直接返回网页来源，复用 DSH 官方 Exa 适配器。',
    defaultBaseURL: 'https://api.exa.ai', credentialRef: 'DSH_EDITOR_WEB_EXA_API_KEY', billing: 'request',
  }, options => new ExaSearchProvider({
    apiKey: options.apiKey ?? '', baseURL: options.baseURL ?? 'https://api.exa.ai',
    searchType: 'auto', highlightsPerResult: 1,
  }))
  const offHttp = manager.registerFetchProvider({
    id: 'http', label: '直接 HTTP 获取', billing: 'none',
    description: '仅访问公开网页，复用 DSH 的 DNS、私有地址和重定向安全检查。',
  }, options => new HttpFetchProvider({
    maxResponseBytes: 5_000_000, maxBodyChars: options.maxFetchChars,
    timeoutMs: options.timeoutMs, maxRedirects: 5, userAgent: 'dsh-editor/managed-web',
  }))
  return () => { offHttp(); offExa() }
}
