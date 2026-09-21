import { describe, expect, it, vi } from 'vitest'
import { TavilySearchProvider } from './tavily.ts'
function adapter(payload: unknown) {
  const transport = vi.fn(async () => Response.json(payload))
  return { transport, provider: new TavilySearchProvider({ apiKey: 'fixture-secret', fetch: transport }) }
}
describe('Tavily direct API adapter', () => {
  it('normalizes results and never requests auto-depth, an answer, images or raw content', async () => {
    const { provider, transport } = adapter({ results: [{ title: 'A', url: 'https://example.com/a', content: 'Source', published_date: '2026-01-01' }] })
    expect(provider.available()).toBe(true); expect(transport).not.toHaveBeenCalled()
    const result = await provider.search({ query: ' test ', maxResults: 3 })
    expect(result.sources[0]).toMatchObject({ title: 'A', url: 'https://example.com/a', snippet: 'Source', publishedAt: '2026-01-01T00:00:00.000Z' })
    const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.tavily.com/search')
    expect(options.redirect).toBe('error')
    expect(options.headers).toMatchObject({ authorization: 'Bearer fixture-secret' })
    expect(JSON.parse(String(options.body))).toMatchObject({ query: 'test', max_results: 3, search_depth: 'basic', auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false })
  })
  it('drops unsafe or credential-bearing links and preserves optional fields honestly', async () => {
    const { provider } = adapter({ results: [
      { url: 'javascript:alert(1)' }, { url: 'https://secret@example.com' }, { url: 'not a url' },
      { url: 'https://example.com', published_date: 'unknown' },
    ] })
    const result = await provider.search({ query: 'test' })
    expect(result.sources).toEqual([{ url: 'https://example.com/' }])
  })
  it('caps over-returned sources', async () => {
    const { provider } = adapter({ results: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }] })
    expect(await provider.search({ query: 'test', maxResults: 1 })).toMatchObject({ sources: [{ url: 'https://example.com/a' }], truncated: true })
  })
  it.each([401, 429, 500])('does not retry or leak an HTTP %s response body', async status => {
    const transport = vi.fn(async () => new Response('fixture-secret echo', { status }))
    const provider = new TavilySearchProvider({ apiKey: 'fixture-secret', fetch: transport })
    const error = await provider.search({ query: 'test' }).catch(error => error)
    expect(error.code).toBe('WEB_PROVIDER_ERROR'); expect(error.message).not.toContain('fixture-secret')
    expect(transport).toHaveBeenCalledOnce()
  })
  it('rejects malformed and oversized responses', async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response('{ invalid')).mockResolvedValueOnce(new Response('x'.repeat(2_000_001)))
    const provider = new TavilySearchProvider({ apiKey: 'fixture-secret', fetch: transport })
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
  it('does not send invalid queries, result counts, missing credentials or cancelled calls', async () => {
    const { provider, transport } = adapter({ results: [] })
    await expect(provider.search({ query: ' ' })).rejects.toMatchObject({ code: 'WEB_INVALID_REQUEST' })
    await expect(provider.search({ query: 'ok', maxResults: 21 })).rejects.toMatchObject({ code: 'WEB_INVALID_REQUEST' })
    await expect(provider.search({ query: 'ok' }, AbortSignal.abort())).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await expect(new TavilySearchProvider({ apiKey: '', fetch: transport }).search({ query: 'ok' })).rejects.toMatchObject({ code: 'WEB_CREDENTIAL_MISSING' })
    expect(transport).not.toHaveBeenCalled()
  })
})
