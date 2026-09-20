import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { registerBuiltins } from './builtins.ts'
import { WebSearchManager } from './manager.ts'
import type { WebSettings } from './contracts.ts'

const fixtures: WebSearchManager[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(manager => manager.dispose()))
  vi.unstubAllEnvs()
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
      'search:exa', 'search:firecrawl', 'search:serper',
    ])
    expect(providers.find(row => row.id === 'ddg')).toMatchObject({
      kind: 'search', billing: 'none', configured: true, label: 'DuckDuckGo',
    })
    expect(providers.find(row => row.id === 'deepseek-official')).toMatchObject({
      credentialRef: 'DEEPSEEK_API_KEY', credentialShared: true, billing: 'model-and-tools', configured: true,
    })
    expect(providers.find(row => row.id === 'http')).toMatchObject({
      kind: 'fetch', configured: true, billing: 'none',
    })
    off()
    expect(manager.status().providers).toHaveLength(0)
  })
})
