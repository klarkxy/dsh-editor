import { describe, expect, it } from 'vitest'
import { emptyPluginState, parsePluginState } from './overlay.ts'

describe('plugin overlay persistence', () => {
  it('ignores malformed state and unsafe identifiers', () => {
    expect(parsePluginState({ schema: 1, overrides: { zhihu: false, '../x': true }, installed: [{ name: 'ok-plug', spec: 'github:acme/ok', version: '1' }, { name: '../x' }] })).toEqual({
      schema: 1,
      overrides: { zhihu: false },
      presets: {},
      installed: [{ name: 'ok-plug', spec: 'github:acme/ok', version: '1' }],
    })
    expect(parsePluginState({ schema: 2 })).toBeUndefined()
    expect(emptyPluginState().installed).toEqual([])
  })

  it('round-trips first-party writing preset toggles and drops malformed rows', () => {
    expect(parsePluginState({
      schema: 1,
      overrides: {},
      presets: { 'dsh-editor-novel': false, 'dsh-editor-article': true, '../bad': false, 'dsh-editor-technical': 'yes' },
      installed: [],
    })).toEqual({
      schema: 1,
      overrides: {},
      presets: { 'dsh-editor-novel': false, 'dsh-editor-article': true },
      installed: [],
    })
    expect(parsePluginState({ schema: 1 })?.presets).toEqual({})
    expect(emptyPluginState().presets).toEqual({})
  })

  it('drops leftover host-locked writing entry overrides', () => {
    expect(parsePluginState({
      schema: 1,
      overrides: {
        zhihu: false,
        'editor-novel-kernel': true,
        'editor-workbench-tools': true,
        proofread: true,
        'editor-proofread-panel': true,
      },
      installed: [],
    })).toEqual({
      schema: 1,
      overrides: { zhihu: false, 'editor-proofread-panel': true },
      presets: {},
      installed: [],
    })
  })
})


it('ignores the retired Tavily plugin while preserving other plugin settings', () => {
  expect(parsePluginState({ schema: 1,
    overrides: { 'web-search-tavily': false, 'web-search-manager': true, zhihu: false },
    installed: [{ name: 'dsh-web-search-tavily', spec: 'old-tavily', version: '0.1.0' }, { name: 'community-plugin', spec: 'community-plugin', version: '1' }],
  })).toMatchObject({ overrides: { 'web-search-manager': true, zhihu: false },
    installed: [{ name: 'community-plugin', spec: 'community-plugin', version: '1' }] })
})

 describe('retired public plugin configuration migration', () => {
  it('drops obsolete on and off preferences without losing other plugin state', () => {
    const input = { schema: 1, overrides: { 'model-center': false, zhihu: false }, presets: { 'dsh-editor-article': false }, installed: [{ name: 'test-plugin', spec: 'github:acme/test', version: '1' }] }
    const parsed = parsePluginState(input)!
    expect(parsed.overrides).toEqual({ zhihu: false })
    expect(parsed.presets).toEqual(input.presets)
    expect(parsed.installed).toEqual(input.installed)
    expect(parsePluginState({ ...input, overrides: { 'model-center': true } })?.overrides).toEqual({})
  })
})
