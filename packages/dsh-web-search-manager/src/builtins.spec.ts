import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { registerBuiltins } from './builtins.ts'
import { WebSearchManager } from './manager.ts'
import { defaultSettings, type WebSettings } from './contracts.ts'

const fixtures: WebSearchManager[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(manager => manager.dispose()))
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('builtin web providers', () => {
  it('registers a keyless search engine plus DeepSeek, Exa, and hidden HTTP fetch', async () => {
    vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', undefined)
    vi.stubEnv('DSH_WEB_FETCH_PROVIDER', undefined)
    const web = new WebRuntime(new Context(), {})
    const keys = new Map([['DEEPSEEK_API_KEY', 'fixture-deepseek-secret']])
    const manager = new WebSearchManager({
      web, save: async (_settings: WebSettings) => {},
      resolveCredential: async ref => keys.get(ref),
    })
    fixtures.push(manager)
    const off = registerBuiltins(manager)
    await manager.refresh()
    const providers = manager.status().providers
    expect(providers.map(row => `${row.kind}:${row.id}`).sort()).toEqual([
      'fetch:http',
      'search:bocha', 'search:brave', 'search:ddg', 'search:deepseek-official',
      'search:exa', 'search:firecrawl', 'search:serper', 'search:tavily',
    ])
    expect(providers.find(row => row.id === 'ddg')).toMatchObject({
      kind: 'search', billing: 'none', configured: true, label: 'DuckDuckGo',
    })
    expect(providers.find(row => row.id === 'deepseek-official')).toMatchObject({
      credentialRef: 'DEEPSEEK_API_KEY', credentialShared: true, credentialHint: '与模型设置共用 Key',
      billing: 'model-and-tools', configured: true,
    })
    expect(providers.find(row => row.id === 'http')).toMatchObject({
      kind: 'fetch', configured: true, billing: 'none',
    })
    off()
    expect(manager.status().providers).toHaveLength(0)
  })
})


describe('integrated Tavily configuration compatibility', () => {
  it.each([true, false])('retains existing credentials, order, endpoint and enabled=%s', async searchEnabled => {
    vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', undefined)
    vi.stubEnv('DSH_WEB_FETCH_PROVIDER', undefined)
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ results: [{ url: 'https://example.com/tavily', title: 'Existing configuration' }] }))
    vi.stubGlobal('fetch', transport)
    const initial: WebSettings = { ...defaultSettings(), revision: 7, searchEnabled,
      searchProvider: 'tavily', searchOrder: ['tavily', 'ddg'], endpoints: { 'search:tavily': 'https://search.example.org/tavily' } }
    const original = structuredClone(initial)
    const save = vi.fn(async () => {})
    const resolveCredential = vi.fn(async (ref: string) => ref === 'DSH_EDITOR_WEB_TAVILY_API_KEY' ? 'existing-fixture-key' : undefined)
    const web = new WebRuntime(new Context(), {})
    const manager = new WebSearchManager({ web, initial, save, resolveCredential })
    fixtures.push(manager)
    const off = registerBuiltins(manager)
    await manager.refresh()
    expect(manager.status().providers.filter(row => row.id === 'tavily')).toHaveLength(1)
    expect(manager.status().providers.find(row => row.id === 'tavily')).toMatchObject({
      configured: true, credentialRef: 'DSH_EDITOR_WEB_TAVILY_API_KEY', baseURL: initial.endpoints['search:tavily'],
    })
    expect(manager.status().settings).toEqual(original)
    expect(initial).toEqual(original)
    expect(save).not.toHaveBeenCalled()
    if (searchEnabled) {
      const result = await web.search({ query: 'existing Tavily setup' })
      expect(result.sources[0]?.url).toBe('https://example.com/tavily')
      expect(transport).toHaveBeenCalledOnce()
      expect(transport.mock.calls[0]?.[0]).toBe('https://search.example.org/tavily/search')
      expect(transport.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Bearer existing-fixture-key' } })
    } else {
      await expect(web.search({ query: 'do not activate search' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
      expect(transport).not.toHaveBeenCalled()
    }
    off()
    expect(manager.status().providers).toHaveLength(0)
  })
})
