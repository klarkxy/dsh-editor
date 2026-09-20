import { describe, expect, it, vi } from 'vitest'
import { BochaSearchProvider, BraveSearchProvider, FirecrawlSearchProvider, SerperSearchProvider } from './rest-search.ts'

describe('REST search adapters', () => {
  it('Brave GETs /web/search with the subscription header', async () => {
    const transport = vi.fn(async () => Response.json({
      web: { results: [{ title: 'A', url: 'https://example.com/a', description: 'alpha' }] },
    }))
    const result = await new BraveSearchProvider({ apiKey: 'brave-secret', fetch: transport }).search({ query: ' test ', maxResults: 3 })
    expect(result.sources[0]).toMatchObject({ title: 'A', url: 'https://example.com/a', snippet: 'alpha' })
    const [url, options] = transport.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.search.brave.com/res/v1/web/search?q=test&count=3')
    expect(options.method).toBe('GET')
    expect(options.headers).toMatchObject({ 'x-subscription-token': 'brave-secret' })
    expect(JSON.stringify(options)).not.toContain('brave-secret&')
  })

  it('Bocha POSTs Bing-shaped webPages', async () => {
    const transport = vi.fn(async () => Response.json({
      data: { webPages: { value: [{ name: 'B', url: 'https://example.com/b', snippet: 'beta' }] } },
    }))
    const result = await new BochaSearchProvider({ apiKey: 'bocha-secret', fetch: transport }).search({ query: 'ok' })
    expect(result.sources[0]).toMatchObject({ title: 'B', url: 'https://example.com/b', snippet: 'beta' })
    const [, options] = transport.mock.calls[0] as unknown as [URL, RequestInit]
    expect(options.headers).toMatchObject({ authorization: 'Bearer bocha-secret' })
    expect(JSON.parse(String(options.body))).toMatchObject({ query: 'ok', summary: false })
  })

  it('Serper reads organic[].link', async () => {
    const transport = vi.fn(async () => Response.json({
      organic: [{ title: 'C', link: 'https://example.com/c', snippet: 'gamma' }],
    }))
    const result = await new SerperSearchProvider({ apiKey: 'serper-secret', fetch: transport }).search({ query: 'ok' })
    expect(result.sources[0]).toMatchObject({ url: 'https://example.com/c', title: 'C' })
  })

  it('Firecrawl reads data[].url', async () => {
    const transport = vi.fn(async () => Response.json({
      data: [{ title: 'D', url: 'https://example.com/d', description: 'delta' }],
    }))
    const result = await new FirecrawlSearchProvider({ apiKey: 'fire-secret', fetch: transport }).search({ query: 'ok' })
    expect(result.sources[0]).toMatchObject({ url: 'https://example.com/d', title: 'D' })
  })

  it('does not leak secrets on HTTP errors', async () => {
    const transport = vi.fn(async () => new Response('echo fire-secret', { status: 401 }))
    const error = await new FirecrawlSearchProvider({ apiKey: 'fire-secret', fetch: transport }).search({ query: 'ok' }).catch(cause => cause)
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).not.toContain('fire-secret')
  })
})
