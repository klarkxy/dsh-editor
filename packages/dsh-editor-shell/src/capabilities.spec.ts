import { describe, expect, it } from 'vitest'
import { featureEnabled, resolveShellCapabilities } from './capabilities.ts'

describe('shell capability resolution', () => {
  it('treats an empty feature map as a successful empty result', () => {
    expect(resolveShellCapabilities({ features: {} }, () => ({ }))).toEqual({ ok: true, value: { features: {} } })
    expect(featureEnabled({ features: {} }, 'assistant')).toBe(false)
  })

  it('reports selected features from live services and fails loud when one is missing', () => {
    const services = { sessions: {}, manuscriptAssist: {} }
    expect(resolveShellCapabilities(
      { features: { assistant: 'sessions', completion: 'manuscriptAssist' } },
      (name) => services[name as keyof typeof services],
    )).toEqual({ ok: true, value: { features: { assistant: true, completion: true } } })
    expect(resolveShellCapabilities(
      { features: { assistant: 'sessions', zhihu: 'zhihu' } },
      (name) => name === 'sessions' ? {} : undefined,
    )).toEqual({
      ok: false,
      error: { code: 'internal', message: '所选组合缺少已启用的插件', details: { missing: ['zhihu'] } },
    })
  })
})
