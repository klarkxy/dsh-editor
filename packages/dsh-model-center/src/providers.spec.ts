import { describe, expect, it } from 'vitest'
import {
  authLabel, canDiscoverModels, canOpenSettingsDocument, credentialRefsToDescribe, joinProviderListings,
  resolveApiKeyEnv, shouldLoadNativeProviders,
} from './providers.ts'

describe('native provider listing', () => {
  it('joins configurable directory and live adapters without inventing credential refs', () => {
    const rows = joinProviderListings(
      [{ provider: 'deepseek', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }],
      [{ id: 'openai', name: 'OpenAI' }, { id: 'deepseek' }],
      { DEEPSEEK_API_KEY: { configured: true, writable: true } },
    )
    expect(rows.map(row => row.id)).toEqual(['deepseek', 'openai'])
    expect(rows[0]?.live).toBe(true)
    expect(rows[0]?.credentialRef).toBeUndefined()
    expect(rows[0]?.auth).toBe('unknown')
    expect(credentialRefsToDescribe(rows)).toEqual([])
    expect(JSON.stringify(rows)).not.toMatch(/DEEPSEEK_API_KEY/)
    expect(JSON.stringify(rows)).not.toMatch(/OPENAI_API_KEY/)
  })

  it('uses only apiKeyEnv resolved from settingsScope/settingsSchema', () => {
    const namespaces = new Map<string, unknown>([
      ['llm-deepseek', { providers: { official: { apiKeyEnv: 'MY_REAL_KEY' } } }],
    ])
    const schema = {
      getPath(value: unknown, path: string[]) {
        let current: unknown = value
        for (const segment of path) {
          if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
          current = (current as Record<string, unknown>)[segment]
        }
        return current
      },
    }
    expect(resolveApiKeyEnv(namespaces, 'llm-deepseek', ['providers', 'official'], schema)).toBe('MY_REAL_KEY')
    expect(resolveApiKeyEnv(namespaces, 'llm-deepseek', ['providers', 'missing'], schema)).toBeUndefined()
    const rows = joinProviderListings(
      [{ provider: 'deepseek', settingsNs: 'llm-deepseek', settingsPath: ['providers', 'official'] }],
      [],
      { MY_REAL_KEY: { configured: true, writable: false } },
      new Map([['deepseek', 'MY_REAL_KEY']]),
    )
    expect(rows[0]?.credentialRef).toBe('MY_REAL_KEY')
    expect(rows[0]?.auth).toBe('configured')
    expect(authLabel('unknown')).toBe('密钥状态未知')
  })

  it('skips native provider reads when the host already supplies renderProviders', () => {
    expect(shouldLoadNativeProviders(() => null)).toBe(false)
    expect(shouldLoadNativeProviders(undefined)).toBe(true)
    expect(canOpenSettingsDocument({ openSettingsDocument: async () => ({}) })).toBe(true)
    expect(canDiscoverModels({ discoverModels: async () => [] })).toBe(true)
  })
})
