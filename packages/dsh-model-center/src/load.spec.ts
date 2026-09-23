import { describe, expect, it } from 'vitest'
import { RpcCallError } from './client-view.ts'
import { createGenerationGate, loadModelCenter, savePolicyUpdate } from './load.ts'

const limits = { concurrency: 1, timeoutMs: 30_000, maxInputChars: 4000, maxOutputTokens: 512, maxAttempts: 2 }
const policy = {
  revision: 2,
  roles: { normal: { provider: 'deepseek', model: 'deepseek-chat' } },
  purposes: {},
  limits,
}
const status = { policy, purposes: [], storageFailed: false }
const catalog = {
  default: { provider: 'deepseek', model: 'deepseek-chat' },
  groups: [{
    id: 'deepseek',
    name: 'DeepSeek',
    models: [{
      id: 'deepseek-chat',
      name: 'Chat',
      reasoning: { efforts: [{ id: 'off', name: 'Off' }], defaultEffort: 'off' },
    }],
  }],
}

describe('model center load and save', () => {
  it('loads catalog reasoning and skips provider remotes when the host supplies renderProviders', async () => {
    const calls: string[] = []
    const snapshot = await loadModelCenter({
      call: async (channel, endpoint) => {
        calls.push(`${channel}:${endpoint}`)
        if (endpoint === 'status') return { ok: true, value: status }
        throw new Error(endpoint)
      },
      loadProviders: false,
      llm: {
        listConfigurableProviders: async () => {
          calls.push('listConfigurableProviders')
          return { ok: true, value: [] }
        },
      },
      credentials: {
        describe: async () => {
          calls.push('credentials.describe')
          return { ok: true, value: {} }
        },
      },
      session: {
        modelCatalog: async () => ({ ok: true, value: catalog }),
      },
    }, () => true)
    expect(snapshot?.catalog.groups[0]?.models[0]?.reasoning?.efforts.map(item => item.id)).toEqual(['off'])
    expect(snapshot?.providers).toEqual([])
    expect(calls).toEqual(['/dsh-ai-services:status'])
  })

  it('describes only apiKeyEnv from configForms and never guesses PROVIDER_API_KEY', async () => {
    const described: string[][] = []
    const snapshot = await loadModelCenter({
      call: async (_channel, endpoint) => endpoint === 'status' ? { ok: true, value: status } : { ok: true, value: {} },
      loadProviders: true,
      llm: {
        listConfigurableProviders: async () => ({
          ok: true,
          value: [{
            provider: 'deepseek',
            displayName: 'DeepSeek',
            settingsNs: 'llm-deepseek',
            settingsPath: ['providers', 'official'],
          }],
        }),
      },
      credentials: {
        describe: async refs => {
          described.push(refs)
          return { ok: true, value: { MY_REAL_KEY: { configured: true, writable: false } } }
        },
      },
      configForms: {
        describe: () => ({
          getSnapshot: () => ({
            view: {
              namespaces: [{
                ns: 'llm-deepseek',
                value: { providers: { official: { apiKeyEnv: 'MY_REAL_KEY' } } },
              }],
            },
          }),
        }),
      },
      settingsSchema: {
        getPath: (value, path) => {
          let current: unknown = value
          for (const segment of path) {
            if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
            current = (current as Record<string, unknown>)[segment]
          }
          return current
        },
      },
    }, () => true)
    expect(described).toEqual([['MY_REAL_KEY']])
    expect(snapshot?.providers[0]?.credentialRef).toBe('MY_REAL_KEY')
    expect(JSON.stringify(snapshot?.providers)).not.toMatch(/DEEPSEEK_API_KEY/)
  })

  it('drops a late snapshot after the session generation changes', async () => {
    const gate = createGenerationGate()
    const token = gate.next()
    let release: () => void = () => {}
    const pending = new Promise<void>(resolve => { release = resolve })
    const loading = loadModelCenter({
      call: async (_channel, endpoint) => {
        if (endpoint === 'status') {
          await pending
          return { ok: true, value: status }
        }
        return { ok: true, value: {} }
      },
      loadProviders: false,
      sessionId: 'old',
    }, () => gate.isCurrent(token))
    gate.next()
    release()
    expect(await loading).toBeUndefined()
  })

  it('reports an update conflict without applying a stale policy', async () => {
    const result = await savePolicyUpdate(
      async () => { throw new RpcCallError('策略已被其他页面修改，请刷新后重试。', 'AI_POLICY_CONFLICT') },
      { expectedRevision: 2, policy: { roles: policy.roles, purposes: {}, limits } },
      () => true,
    )
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    const stale = await savePolicyUpdate(
      async () => ({ ok: true, value: { ...policy, revision: 3 } }),
      { expectedRevision: 2, policy: { roles: policy.roles, purposes: {}, limits } },
      () => false,
    )
    expect(stale).toEqual({ ok: false, reason: 'stale', error: '' })
  })
})

it('reports conflicts returned as RPC envelopes', async () => {
  const result = await savePolicyUpdate(async () => ({ ok: false, error: { code: 'AI_POLICY_CONFLICT', message: '策略已被修改' } }),
    { expectedRevision: 2, policy: { roles: policy.roles, purposes: {}, limits } }, () => true)
  expect(result).toMatchObject({ ok: false, reason: 'conflict' })
})
