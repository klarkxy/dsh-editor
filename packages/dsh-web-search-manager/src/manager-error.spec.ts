import { expect, it } from 'vitest'
import { WebError, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { WebSearchManager } from './manager.ts'
it.each(['WEB_CREDENTIAL_MISSING', 'WEB_DISABLED', 'WEB_ABORTED', 'WEB_PROVIDER_ERROR'])(
  'redacts extension errors even when they use the trusted %s code', async code => {
    let registered: WebSearchProvider | undefined
    const manager = new WebSearchManager({
      web: {
        registerSearchProvider(provider) { registered = provider; return () => { registered = undefined } },
        registerFetchProvider() { return () => {} },
      },
      resolveCredential: async () => 'fixture-private-key', save: async () => {},
    })
    try {
      manager.registerSearchProvider({
        id: 'test', label: 'Test', description: 'Untrusted extension error fixture',
        credentialRef: 'TEST_WEB_API_KEY', billing: 'request',
      }, () => ({
        id: 'test', available: () => true,
        async search() { throw new WebError('provider echoed fixture-private-key', code) },
      }))
      const { revision, ...settings } = manager.status().settings
      await manager.update({ ...settings, searchEnabled: true, searchProvider: 'test' }, revision)
      expect(registered?.available()).toBe(true)
      const error = await registered!.search({ query: 'fixed fixture query' }).catch(error => error)
      expect(error).toBeInstanceOf(WebError)
      expect(error.code).toBe(code)
      expect(String(error)).not.toContain('fixture-private-key')
      expect(JSON.stringify(error)).not.toContain('fixture-private-key')
      expect(error.cause).toBeUndefined()
    } finally { await manager.dispose() }
  },
)
