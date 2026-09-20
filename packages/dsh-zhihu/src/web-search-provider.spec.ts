import { describe, expect, it, vi } from 'vitest'
import type { ZhihuSearchFetcher } from './zhihu-client.ts'
import {
  bindZhihuWebSearch,
  createZhihuWebSearchProvider,
  registerZhihuGlobalSearchProvider,
  ZHIHU_WEB_SEARCH_DESCRIPTOR,
  ZHIHU_WEB_SEARCH_ID,
} from './web-search-provider.ts'

const ENVELOPE = (items: unknown[], code = 0, message = 'success') => ({ Code: code, Message: message, Data: { Items: items } })

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Awaited<ReturnType<ZhihuSearchFetcher>> {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  return { ok, status, async text() { return JSON.stringify(body) }, async json() { return body } }
}

function makeFetcher(
  handler: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Awaited<ReturnType<ZhihuSearchFetcher>>,
): ZhihuSearchFetcher {
  return (input, init) => Promise.resolve(handler(
    typeof input === 'string' ? input : String(input),
    init as { headers?: Record<string, string>; signal?: AbortSignal },
  ))
}

const ITEM = { Title: 'A', ContentType: 'article', Url: 'https://example.com/a', ContentText: '摘要' }

function host(fetcher: ZhihuSearchFetcher, events: Array<{ ok: boolean; results: number }> = []) {
  return {
    run: <T>(execute: (signal: AbortSignal) => Promise<T>, signal: AbortSignal) => execute(signal),
    toolOptions: { fetcher, onExecuted: (event: { ok: boolean; results: number }) => events.push(event) },
  }
}

describe('zhihu-global web search adapter', () => {
  it('calls global_search with SearchDB=all and maps http(s) sources', async () => {
    const fetcher = makeFetcher((url, init) => {
      const parsed = new URL(url)
      expect(parsed.pathname).toBe('/api/v1/content/global_search')
      expect(parsed.searchParams.get('Query')).toBe('写作工具')
      expect(parsed.searchParams.get('Count')).toBe('3')
      expect(parsed.searchParams.get('SearchDB')).toBe('all')
      expect(init?.headers?.Authorization).toBe('Bearer fixture-secret')
      return jsonResponse(ENVELOPE([ITEM, { Title: 'B', Url: 'javascript:alert(1)' }, { Title: 'C', Url: 'https://secret@example.com' }]))
    })
    const events: Array<{ ok: boolean; results: number }> = []
    const provider = createZhihuWebSearchProvider({ apiKey: 'fixture-secret', fetcher, onExecuted: event => events.push(event) })
    expect(provider.id).toBe(ZHIHU_WEB_SEARCH_ID)
    expect(provider.available()).toBe(true)
    const result = await provider.search({ query: ' 写作工具 ', maxResults: 3 })
    expect(result).toEqual({
      sources: [{ url: 'https://example.com/a', title: 'A', snippet: '摘要' }],
      truncated: false,
    })
    expect(events).toEqual([{ ok: true, results: 3 }])
  })

  it('caps over-returned sources and stays unavailable without a key', async () => {
    const fetcher = makeFetcher(() => jsonResponse(ENVELOPE([
      { Title: 'A', Url: 'https://example.com/a' },
      { Title: 'B', Url: 'https://example.com/b' },
    ])))
    const provider = createZhihuWebSearchProvider({ apiKey: 'fixture-secret', fetcher })
    expect(await provider.search({ query: 'q', maxResults: 1 })).toMatchObject({
      sources: [{ url: 'https://example.com/a', title: 'A' }],
      truncated: true,
    })
    expect(createZhihuWebSearchProvider({ apiKey: '  ', fetcher }).available()).toBe(false)
    await expect(createZhihuWebSearchProvider({ apiKey: '', fetcher }).search({ query: 'q' }))
      .rejects.toThrow(/Access Secret/)
  })

  it('rejects invalid queries before calling Zhihu, and meters aborted calls as failures', async () => {
    const events: Array<{ ok: boolean; results: number }> = []
    let calls = 0
    const fetcher = makeFetcher(() => {
      calls += 1
      return jsonResponse(ENVELOPE([]))
    })
    const provider = createZhihuWebSearchProvider({ apiKey: 'fixture-secret', fetcher, onExecuted: event => events.push(event) })
    await expect(provider.search({ query: ' ' })).rejects.toThrow('查询无效。')
    await expect(provider.search({ query: 'ok', maxResults: 21 })).rejects.toThrow('结果数须为 1 至 20。')
    await expect(provider.search({ query: 'ok' }, AbortSignal.abort())).rejects.toBeDefined()
    expect(calls).toBe(0)
    expect(events).toEqual([{ ok: false, results: 0 }])
  })
})

describe('bindZhihuWebSearch', () => {
  it('waits for webSearchManager and registers the shared-credential backend', () => {
    const registerSearchProvider = vi.fn(() => () => {})
    const inject = vi.fn((deps: readonly string[], apply: (inner: { get(name: string): unknown }) => unknown) => {
      expect(deps).toEqual(['webSearchManager'])
      apply({ get: (name: string) => name === 'webSearchManager' ? { registerSearchProvider } : undefined })
    })
    bindZhihuWebSearch({ inject }, host(makeFetcher(() => jsonResponse(ENVELOPE([])))))
    expect(registerSearchProvider).toHaveBeenCalledWith(ZHIHU_WEB_SEARCH_DESCRIPTOR, expect.any(Function))
    expect(ZHIHU_WEB_SEARCH_DESCRIPTOR).toMatchObject({
      id: 'zhihu-global',
      credentialRef: 'ZHIHU_ACCESS_TOKEN',
      credentialShared: true,
    })
    expect(ZHIHU_WEB_SEARCH_DESCRIPTOR.id).toMatch(/^[a-z][a-z0-9-]{0,63}$/)
    expect(ZHIHU_WEB_SEARCH_DESCRIPTOR.credentialRef).toMatch(/^[A-Z][A-Z0-9_]{1,127}$/)
  })

  it('does not register when the profile has no webSearchManager', () => {
    const inject = vi.fn()
    bindZhihuWebSearch({ inject }, host(makeFetcher(() => jsonResponse(ENVELOPE([])))))
    expect(inject).toHaveBeenCalledWith(['webSearchManager'], expect.any(Function))
    const apply = inject.mock.calls[0]?.[1] as (inner: { get(name: string): unknown }) => unknown
    expect(apply({ get: () => undefined })).toBeUndefined()
  })

  it('skips a namesake service that is not the manager', () => {
    const inject = vi.fn((_deps, apply: (inner: { get(name: string): unknown }) => unknown) => apply({ get: () => ({}) }))
    bindZhihuWebSearch({ inject }, host(makeFetcher(() => jsonResponse(ENVELOPE([])))))
    expect(inject).toHaveBeenCalled()
  })

  it('routes manager searches through the Zhihu service lifetime', async () => {
    const events: Array<{ ok: boolean; results: number }> = []
    const fetcher = makeFetcher(() => jsonResponse(ENVELOPE([ITEM])))
    let factory: ((options: { apiKey?: string; timeoutMs: number }) => { search: Function }) | undefined
    registerZhihuGlobalSearchProvider({
      registerSearchProvider(_descriptor, next) {
        factory = next
        return () => {}
      },
    }, host(fetcher, events))
    const provider = factory!({ apiKey: 'fixture-secret', timeoutMs: 15_000 })
    const result = await provider.search({ query: 'q', maxResults: 1 })
    expect(result.sources).toEqual([{ url: 'https://example.com/a', title: 'A', snippet: '摘要' }])
    expect(events).toEqual([{ ok: true, results: 1 }])
  })
})
