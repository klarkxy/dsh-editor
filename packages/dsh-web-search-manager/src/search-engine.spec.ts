import { describe, expect, it, vi } from 'vitest'
import {
  SEARCH_ENGINE_PAGE, SearchEngineProvider, parseSearchEngineHtml, searchEngineUrl, unwrapSearchHref,
} from './search-engine.ts'

const html = `
<a href="https://example.com/a">Alpha</a>
<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Beta</a>
<a href="https://duckduckgo.com/about">About DDG</a>
<a href="javascript:alert(1)">Nope</a>
<a href="https://secret@example.com">Cred</a>
`

describe('search engine URL concat', () => {
  it('builds an https search page with the query in q=', () => {
    expect(searchEngineUrl('foo bar')).toBe(`${SEARCH_ENGINE_PAGE}?q=foo+bar`)
    expect(searchEngineUrl('中文')).toContain('q=')
  })

  it('unwraps redirect links and drops search-engine chrome', () => {
    expect(unwrapSearchHref('https://example.com/a', SEARCH_ENGINE_PAGE)).toBe('https://example.com/a')
    expect(unwrapSearchHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb', SEARCH_ENGINE_PAGE))
      .toBe('https://example.com/b')
    expect(unwrapSearchHref('https://duckduckgo.com/about', SEARCH_ENGINE_PAGE)).toBeUndefined()
    expect(unwrapSearchHref('https://user:pass@example.com', SEARCH_ENGINE_PAGE)).toBeUndefined()
  })

  it('parses result anchors from a search-page HTML fixture', () => {
    expect(parseSearchEngineHtml(html)).toEqual([
      { url: 'https://example.com/a', title: 'Alpha' },
      { url: 'https://example.com/b', title: 'Beta' },
    ])
  })

  it('GETs the concatenated URL and caps sources', async () => {
    const transport = vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } }))
    const provider = new SearchEngineProvider({ fetch: transport })
    expect(provider.available()).toBe(true)
    const result = await provider.search({ query: ' test ', maxResults: 1 })
    expect(result).toEqual({ sources: [{ url: 'https://example.com/a', title: 'Alpha' }], truncated: true })
    expect(transport.mock.calls[0]?.[0]).toBe(searchEngineUrl('test'))
    expect((transport.mock.calls[0]?.[1] as RequestInit).method).toBe('GET')
  })

  it('does not send invalid queries or cancelled calls', async () => {
    const transport = vi.fn(async () => new Response(html))
    const provider = new SearchEngineProvider({ fetch: transport })
    await expect(provider.search({ query: ' ' })).rejects.toMatchObject({ code: 'WEB_INVALID_REQUEST' })
    await expect(provider.search({ query: 'ok' }, AbortSignal.abort())).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(transport).not.toHaveBeenCalled()
  })
})
