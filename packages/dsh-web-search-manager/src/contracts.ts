import type { WebFetchProvider, WebSearchProvider } from '@deepseek-ai/dsh-web'

export const WEB_SEARCH_RPC_CHANNEL = '/web-search-manager'
export type RpcResult<T = unknown> = { ok: true; value: T } | {
  ok: false; error: { code: string; message: string; details: Record<string, unknown> }
}
export type ProviderKind = 'search' | 'fetch'
/** Management metadata only. Execution and source vocabulary belong to ctx.web. */
export interface ProviderDescriptor {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly defaultBaseURL?: string
  readonly credentialRef?: string
  readonly billing: 'request' | 'model-and-tools' | 'none'
}
export interface ProviderOptions {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly timeoutMs: number
  readonly maxFetchChars: number
}
export type SearchProviderFactory = (options: ProviderOptions) => WebSearchProvider
export type FetchProviderFactory = (options: ProviderOptions) => WebFetchProvider
/** Never store credential values here. Keys are resolved by reference per call. */
export interface WebSettings {
  revision: number
  searchEnabled: boolean
  fetchEnabled: boolean
  searchProvider: string
  fetchProvider: string
  maxResults: number
  maxQueries: number
  timeoutMs: number
  maxFetchChars: number
  endpoints: Record<string, string>
}
export const defaultSettings = (): WebSettings => ({
  revision: 0, searchEnabled: false, fetchEnabled: false,
  searchProvider: '', fetchProvider: 'http', maxResults: 5, maxQueries: 1,
  timeoutMs: 30_000, maxFetchChars: 100_000, endpoints: {},
})
export interface ProviderView extends ProviderDescriptor {
  kind: ProviderKind
  configured: boolean
  baseURL?: string
  calls: number
  failures: number
}
export interface WebStatus {
  settings: WebSettings
  providers: ProviderView[]
  searchActive: boolean
  fetchActive: boolean
  storageFailed: boolean
}
export function providerKey(kind: ProviderKind, id: string): string { return `${kind}:${id}` }
export function validateBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('供应商地址必须是 HTTPS，且不能包含用户名、密码、查询参数或片段。')
  }
  return url.href.replace(/\/+$/, '')
}
