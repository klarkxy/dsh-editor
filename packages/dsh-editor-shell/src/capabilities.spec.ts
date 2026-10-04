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

 describe('author-controlled feature lifecycle', () => {
  it('accepts deliberately unloaded selected features without disabling the assistant', () => {
    const config = { features: { assistant: 'sessions', completion: 'manuscriptAssist' }, featureEntries: { assistant: ['editor-workbench-tools'], completion: ['manuscript-assist'] } }
    expect(resolveShellCapabilities(config, name => name === 'sessions' ? {} : undefined, () => true)).toEqual({ ok: true, value: { features: { assistant: true, completion: false } } })
    expect(resolveShellCapabilities(config, name => name === 'sessions' ? {} : undefined, () => false)).toMatchObject({ ok: false, error: { details: { missing: ['completion'] } } })
  })
  it('does not conceal a partially missing or untracked selected feature', () => {
    const config = { features: { zhihu: 'zhihu' }, featureEntries: { zhihu: ['zhihu', 'zhihu-tools'] } }
    expect(resolveShellCapabilities(config, () => undefined, id => id === 'zhihu')).toMatchObject({ ok: false })
    expect(resolveShellCapabilities({ features: config.features }, () => undefined, () => true)).toMatchObject({ ok: false })
  })
})
