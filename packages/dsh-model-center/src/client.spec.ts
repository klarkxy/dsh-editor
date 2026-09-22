import { describe, expect, it } from 'vitest'
import { MODEL_SETTINGS_SLOT } from './contracts.ts'
import {
  activateClientUi, apply, presetLabel, purposeTargetFromValue, purposeTargetValue,
  registerModelCenterSlots, shouldAttach, type ModelCenterClient,
} from './client.tsx'

function mockClient(
  status: unknown,
  declared: string[] = [MODEL_SETTINGS_SLOT, 'settings.section'],
  extras: Partial<ModelCenterClient['remote']> = {},
): ModelCenterClient & { injected: string[]; registered: string[] } {
  const injected: string[] = []
  const registered: string[] = []
  const client: ModelCenterClient & { injected: string[]; registered: string[] } = {
    injected,
    registered,
    connection: {
      rpc: {
        call: async (channel: string, endpoint: string) => {
          if (channel === '/dsh-model-center' && endpoint === 'status') return status
          if (channel === '/dsh-ai-services' && endpoint === 'status') {
            return {
              ok: true,
              value: {
                policy: {
                  revision: 0,
                  roles: {},
                  purposes: {},
                  limits: { concurrency: 1, timeoutMs: 30_000, maxInputChars: 1000, maxOutputTokens: 256, maxAttempts: 1 },
                },
                purposes: [],
                storageFailed: false,
              },
            }
          }
          return { ok: true, value: [] }
        },
      },
    },
    remote: {
      llm: {
        listConfigurableProviders: async () => ({ ok: true, value: [] }),
        listProviders: async () => ({ ok: true, value: [] }),
        discoverModels: async () => ({ ok: true, value: [] }),
      },
      credentials: {
        describe: async () => ({ ok: true, value: {} }),
      },
      settings: {
        openSettingsDocument: async () => ({ ok: true, value: { path: 'config.yaml' } }),
      },
      session: {
        modelCatalog: async () => ({
          ok: true,
          value: { default: { provider: 'deepseek', model: 'deepseek-chat' }, groups: [] },
        }),
      },
      ...extras,
    },
    slots: {
      inject(key: string, callback: () => unknown) {
        injected.push(key)
        if (declared.includes(key)) callback()
        return () => {}
      },
      register(spec, _render: unknown) {
        registered.push(spec.name)
        return () => {}
      },
    },
  }
  return client
}

describe('model center client seats', () => {
  it('uses user-facing preset names and direct purpose model values', () => {
    expect(presetLabel('normal', 'zh')).toBe('默认模型')
    expect(presetLabel('weak', 'zh')).toBe('省资源模型')
    expect(presetLabel('strong', 'zh')).toBe('高质量模型')
    const target = { kind: 'model', provider: 'custom', model: 'm3' } as const
    expect(purposeTargetFromValue(purposeTargetValue(target))).toEqual(target)
    expect(purposeTargetFromValue('session')).toEqual({ kind: 'session' })
    expect(purposeTargetFromValue('role:weak')).toEqual({ kind: 'role', role: 'weak' })
  })

  it('does not replace native models UI when the host is off', async () => {
    expect(shouldAttach(false)).toBe(false)
    const client = mockClient({ ok: true, value: { enabled: false } })
    const dispose = await activateClientUi(client, () => false)
    dispose()
    expect(client.injected).toEqual([])
  })

  it('occupies only the editor replacement seat when that slot is already declared', async () => {
    const client = mockClient({ ok: true, value: { enabled: true, plugin: '@klarkxy/dsh-model-center' } })
    const renders: Array<(props: object) => { props: Record<string, unknown> }> = []
    client.slots.register = (spec, render) => {
      client.registered.push(spec.name)
      renders.push(render as (typeof renders)[number])
      return () => {}
    }
    const dispose = await activateClientUi(client, () => false)
    expect(client.injected).toEqual([MODEL_SETTINGS_SLOT])
    expect(client.registered).toEqual([MODEL_SETTINGS_SLOT])
    const hosted = renders[0]!({ sessionId: 's1', locale: 'zh', renderProviders: () => 'native-editor', renderChatModel: () => 'chat-model' })
    expect(hosted.props.sessionId).toBe('s1')
    expect(hosted.props.locale).toBe('zh')
    expect(typeof hosted.props.renderProviders).toBe('function')
    expect(typeof hosted.props.renderChatModel).toBe('function')
    dispose()
  })

  it('keeps a standalone settings.section page when the replacement seat is absent', async () => {
    const client = mockClient(
      { ok: true, value: { enabled: true, plugin: '@klarkxy/dsh-model-center' } },
      ['settings.section'],
    )
    const dispose = await activateClientUi(client, () => false)
    expect(client.registered).toEqual(['settings.section'])
    dispose()
  })

  it('passes native model surfaces through the slot renderer without cloning private editors', () => {
    const client = mockClient({ ok: true, value: { enabled: true } })
    const renders: Array<(props: object) => { props: Record<string, unknown> }> = []
    client.slots.register = (_spec, render) => {
      renders.push(render as (typeof renders)[number])
      return () => {}
    }
    const renderProviders = () => 'host-providers'
    const renderChatModel = () => 'chat-model'
    registerModelCenterSlots(client, props => ({ props } as never), 'zh')
    const element = renders[0]!({ renderProviders, renderChatModel })
    expect(element.props.renderProviders).toBe(renderProviders)
    expect(element.props.renderChatModel).toBe(renderChatModel)
  })

  it('apply waits for host status before injecting seats', async () => {
    const client = mockClient({ ok: true, value: { enabled: false } })
    const ctx = {
      effect(fn: () => (() => void) | void) { return fn() },
    }
    apply(Object.assign(ctx, client) as never)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(client.injected).toEqual([])
  })
})
