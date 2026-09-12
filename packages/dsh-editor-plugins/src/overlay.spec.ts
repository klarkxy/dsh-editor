import { describe, expect, it } from 'vitest'
import { canReplaceHomePatch, emptyPluginState, isOwnedManagedPatch, parseManagedPatch, parsePluginState, renderOverridePatch } from './overlay.ts'

describe('plugin overlay persistence', () => {
  it('round-trips enable/disable overrides into a managed patch', () => {
    const patch = renderOverridePatch({ zhihu: false, proofread: true })
    expect(patch).toContain('managed-by: dsh-editor-plugins')
    expect(parseManagedPatch(patch)).toEqual({ proofread: true, zhihu: false })
    expect(parseManagedPatch('[]\n')).toEqual({})
    expect(parseManagedPatch('- id: ui-sidebar\n  disabled: true\n')).toBeUndefined()
  })

  it('only replaces empty or strictly generated managed patches', () => {
    expect(canReplaceHomePatch(undefined)).toBe(true)
    expect(canReplaceHomePatch('[]\n')).toBe(true)
    expect(canReplaceHomePatch(renderOverridePatch({ zhihu: false }))).toBe(true)
    expect(canReplaceHomePatch('- id: custom\n  config: {}\n')).toBe(false)
    const mixed = `${renderOverridePatch({ zhihu: true })}\n- id: custom-author-rule\n  config:\n    preserve: true\n`
    expect(isOwnedManagedPatch(mixed)).toBe(false)
    expect(canReplaceHomePatch(mixed)).toBe(false)
    expect(isOwnedManagedPatch(`# managed-by: dsh-editor-plugins\n- id: custom\n  config: {}\n`)).toBe(false)
  })

  it('ignores malformed state and unsafe identifiers', () => {
    expect(parsePluginState({ schema: 1, overrides: { zhihu: false, '../x': true }, installed: [{ name: 'ok-plug', spec: 'github:acme/ok', version: '1' }, { name: '../x' }] })).toEqual({
      schema: 1,
      overrides: { zhihu: false },
      installed: [{ name: 'ok-plug', spec: 'github:acme/ok', version: '1' }],
    })
    expect(parsePluginState({ schema: 2 })).toBeUndefined()
    expect(emptyPluginState().installed).toEqual([])
  })
})
