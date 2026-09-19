import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime, WebError } from '@deepseek-ai/dsh-web'
import { WebSearchManager } from './manager.ts'
import { defaultSettings, type WebSettings } from './contracts.ts'

const fixtures: WebSearchManager[] = []
afterEach(async () => { await Promise.all(fixtures.splice(0).map(manager => manager.dispose())); vi.unstubAllEnvs() })
function setup(initial?: WebSettings) {
  vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', undefined)
  vi.stubEnv('DSH_WEB_FETCH_PROVIDER', undefined)
  const web = new WebRuntime(new Context(), {})
  const keys = new Map([['TEST_EXA_KEY', 'fixture-exa-secret'], ['TEST_TAVILY_KEY', 'fixture-tavily-secret']])
  const save = vi.fn(async (_settings: WebSettings) => {})
  const resolveCredential = vi.fn(async (ref: string) => keys.get(ref))
  const manager = new WebSearchManager({ web, initial, save, resolveCredential })
  fixtures.push(manager)
  const search = vi.fn(async () => ({ sources: [{ url: 'https://example.com', title: 'Example', snippet: 'source' }], truncated: false }))
  const factory = vi.fn((options) => ({ id: 'exa', available: () => Boolean(options.apiKey), search }))
  const off = manager.registerSearchProvider({ id: 'exa', label: 'Exa', description: 'test', credentialRef: 'TEST_EXA_KEY', defaultBaseURL: 'https://api.exa.ai', billing: 'request' }, factory)
  return { web, keys, save, manager, search, factory, off, resolveCredential }
}
async function update(manager: WebSearchManager, patch: Partial<WebSettings>) {
  const { revision, ...settings } = manager.status().settings
  return manager.update({ ...settings, ...patch }, revision)
}
describe('managed web authorization over the actual DSH WebRuntime', () => {
  it('is off with existing keys and does not call an adapter during registration or refresh', async () => {
    const { manager, web, search, factory } = setup()
    await manager.refresh()
    expect(manager.status().searchActive).toBe(false)
    await expect(web.search({ query: 'hello' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(search).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled()
  })
  it('requires an explicit available provider and never enables from a saved key alone', async () => {
    const { manager, keys } = setup()
    await expect(update(manager, { searchEnabled: true })).rejects.toMatchObject({ code: 'WEB_CREDENTIAL_MISSING' })
    keys.clear()
    await expect(update(manager, { searchProvider: 'exa', searchEnabled: true })).rejects.toMatchObject({ code: 'WEB_CREDENTIAL_MISSING' })
  })
  it('lets other plugins call ctx.web, resolves credentials per request, and never persists a secret', async () => {
    const { manager, web, keys, factory, save } = setup()
    await update(manager, { searchProvider: 'exa', searchEnabled: true })
    await web.search({ query: 'hello', maxResults: 2 })
    keys.set('TEST_EXA_KEY', 'rotated-fixture-secret')
    await web.search({ query: 'hello again' })
    expect(factory.mock.calls[1]?.[0].apiKey).toBe('rotated-fixture-secret')
    expect(JSON.stringify(manager.status())).not.toContain('secret')
    expect(JSON.stringify(save.mock.calls)).not.toContain('secret')
    keys.clear()
    await expect(web.search({ query: 'missing key' })).rejects.toMatchObject({ code: 'WEB_CREDENTIAL_MISSING' })
    expect(manager.status().searchActive).toBe(false)
  })
  it('selects one provider deterministically and never falls back on a provider error', async () => {
    const { manager, web, search } = setup()
    const other = vi.fn(async () => ({ sources: [], truncated: false }))
    manager.registerSearchProvider({ id: 'tavily', label: 'Tavily', description: 'test', credentialRef: 'TEST_TAVILY_KEY', billing: 'request' }, () => ({ id: 'tavily', available: () => true, search: other }))
    await update(manager, { searchEnabled: true, searchProvider: 'exa' })
    search.mockRejectedValueOnce(new Error('leaked fixture-exa-secret'))
    const error = await web.search({ query: 'hello' }).catch(error => error)
    expect(error).toBeInstanceOf(WebError); expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(JSON.stringify(error)).not.toContain('fixture-exa-secret')
    expect(other).not.toHaveBeenCalled()
    await update(manager, { searchProvider: 'tavily' })
    await web.search({ query: 'hello' })
    expect(other).toHaveBeenCalledOnce()
  })
  it('rejects duplicate IDs and unloads the provider without retaining a route', async () => {
    const { manager, web, off } = setup()
    expect(() => manager.registerSearchProvider({ id: 'exa', label: 'duplicate', description: '', billing: 'request', credentialRef: 'TEST_EXA_KEY' }, () => { throw new Error() })).toThrow()
    await update(manager, { searchEnabled: true, searchProvider: 'exa' })
    off(); off()
    expect(manager.status().providers).toHaveLength(0)
    await expect(web.search({ query: 'hello' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })
  it('cancels an in-flight adapter even if that adapter ignores cancellation', async () => {
    const { manager, web, search } = setup()
    search.mockImplementationOnce(() => new Promise(() => {}))
    await update(manager, { searchEnabled: true, searchProvider: 'exa' })
    const pending = web.search({ query: 'slow' }).catch(error => error)
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce())
    await update(manager, { searchEnabled: false })
    expect(await pending).toMatchObject({ code: 'WEB_ABORTED' })
  })
  it('does not start a request whose caller was already cancelled', async () => {
    const { manager, web, search } = setup()
    await update(manager, { searchEnabled: true, searchProvider: 'exa' })
    await expect(web.search({ query: 'hello' }, AbortSignal.abort())).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(search).not.toHaveBeenCalled()
  })
  it('fails closed when persistence fails and rejects stale configuration revisions', async () => {
    const { manager, save, web } = setup()
    const state = await update(manager, { searchProvider: 'exa', searchEnabled: true })
    const { revision: _revision, ...settings } = state.settings
    await expect(manager.update(settings, 0)).rejects.toMatchObject({ code: 'WEB_CONFIG_CONFLICT' })
    save.mockRejectedValueOnce(new Error('disk full'))
    await expect(update(manager, { searchEnabled: false })).rejects.toMatchObject({ code: 'WEB_CONFIG_SAVE_FAILED' })
    expect(manager.status()).toMatchObject({ storageFailed: true, searchActive: false })
    await expect(web.search({ query: 'hello' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })
  it('keeps fetch independent and caps sources for direct plugin consumers', async () => {
    const { manager, web, search } = setup()
    const fetch = vi.fn(async () => ({ url: 'https://example.com', statusCode: 200, body: { kind: 'text' as const, content: 'hello' }, truncated: false }))
    manager.registerFetchProvider({ id: 'http', label: 'HTTP', description: 'test', billing: 'none' }, () => ({ id: 'http', available: () => true, fetch }))
    await update(manager, { fetchEnabled: true })
    expect(manager.status()).toMatchObject({ fetchActive: true, searchActive: false })
    await web.fetch({ url: 'https://example.com' })
    expect(fetch).toHaveBeenCalledOnce()
    search.mockResolvedValueOnce({ sources: Array.from({ length: 9 }, (_, n) => ({ url: `https://example.com/${n}`, title: '', snippet: '' })), truncated: false })
    await update(manager, { searchEnabled: true, searchProvider: 'exa', maxResults: 3 })
    const result = await web.search({ query: 'bounded', maxResults: 10 })
    expect(result.sources).toHaveLength(3); expect(result.truncated).toBe(true)
  })
  it('rejects unsafe endpoints without sending requests and preserves previous settings', async () => {
    const { manager, search } = setup()
    await expect(update(manager, { endpoints: { 'search:exa': 'https://secret@example.com?api_key=secret' } })).rejects.toMatchObject({ code: 'WEB_INVALID_CONFIG' })
    expect(manager.status().settings).toEqual(defaultSettings())
    expect(search).not.toHaveBeenCalled()
  })
  it('still permits disabling after a provider with an endpoint override is uninstalled', async () => {
    const { manager, off } = setup()
    await update(manager, { searchEnabled: true, searchProvider: 'exa', endpoints: { 'search:exa': 'https://example.com/api' } })
    off()
    await expect(update(manager, { searchEnabled: false })).resolves.toMatchObject({ searchActive: false })
  })
  it('serializes concurrent updates and accepts only one writer for a revision', async () => {
    const { manager } = setup()
    const first = update(manager, { maxResults: 3 })
    const second = update(manager, { maxResults: 7 })
    const results = await Promise.allSettled([first, second])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(manager.status().settings.maxResults).toBe(3)
  })
})
