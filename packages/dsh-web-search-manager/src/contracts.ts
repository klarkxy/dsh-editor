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
  /** True when the key is shared with another surface (e.g. the chat model Key). The page must not delete it. */
  readonly credentialShared?: boolean
  readonly billing: 'request' | 'model-and-tools' | 'none'
  /** Public HTTPS page where the user can create an API key. */
  readonly signupUrl?: string
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
  searchOrder: string[]
  maxResults: number
  maxQueries: number
  timeoutMs: number
  maxFetchChars: number
  endpoints: Record<string, string>
}
export const DEFAULT_SEARCH_ORDER = ['ddg'] as const

export const defaultSettings = (): WebSettings => ({
  revision: 0, searchEnabled: true, fetchEnabled: true,
  searchProvider: 'ddg', fetchProvider: 'http', searchOrder: [...DEFAULT_SEARCH_ORDER],
  maxResults: 5, maxQueries: 1,
  timeoutMs: 30_000, maxFetchChars: 100_000, endpoints: {},
})

/** Keyed backends first, keyless last — same idea as OpenClaw auto-detect. */
export function defaultSearchOrder(ids: readonly string[], keyed: (id: string) => boolean): string[] {
  return [...ids.filter(keyed), ...ids.filter(id => !keyed(id))]
}

export function resolveSearchOrder(
  knownIds: readonly string[],
  settings: Pick<WebSettings, 'searchOrder' | 'searchProvider'>,
  keyed: (id: string) => boolean,
): string[] {
  const known = knownIds.filter((id, index) => knownIds.indexOf(id) === index)
  const listed = settings.searchOrder.filter(id => known.includes(id))
  if (listed.length) return listed
  if (settings.searchProvider && known.includes(settings.searchProvider)) return [settings.searchProvider]
  if (settings.searchOrder.length) return []
  if (known.includes('ddg')) return ['ddg']
  return defaultSearchOrder(known, keyed)
}

export function pickActiveSearch(order: readonly string[], configured: (id: string) => boolean): string {
  return order.find(configured) ?? ''
}
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
