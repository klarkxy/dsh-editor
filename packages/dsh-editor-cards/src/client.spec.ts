import { describe, expect, it } from 'vitest'
import { CENTER_OVERLAYS_SLOT, COMMANDS_SERVICE, SIDEBAR_TOOLS_SLOT, createCommandRegistry } from 'dsh-editor-seats'
import { apply } from './client.ts'

describe('cards client', () => {
  it('registers sidebar and overlay seats plus character/worldbook commands, then disposes them', () => {
    const commands = createCommandRegistry()
    const registered: Array<{ spec: { name: string; id?: string; label?: string; order?: number } }> = []
    const disposers: Array<() => void> = []
    const ctx = {
      effect(fn: () => (() => void) | void) {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
        return dispose
      },
      slots: {
        inject(_key: string, callback: () => unknown) {
          callback()
          return () => {}
        },
        register(spec: { name: string; id?: string; label?: string; order?: number }, _render: unknown) {
          registered.push({ spec })
          return () => {}
        },
      },
      connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
      [COMMANDS_SERVICE]: commands,
    }
    apply(ctx as never)
    expect(registered).toEqual([
      { spec: { name: SIDEBAR_TOOLS_SLOT, id: 'cards', order: 150, label: '卡片' } },
      { spec: { name: CENTER_OVERLAYS_SLOT, id: 'cards-detail', order: 150 } },
    ])
    expect(commands.list().map((item) => item.id)).toEqual(['cards-character', 'cards-worldbook'])
    expect(commands.list()[0]?.shortcut).toEqual({ key: 'c', ctrl: true, shift: true })
    expect(commands.list()[1]?.shortcut).toEqual({ key: 'w', ctrl: true, shift: true })
    expect(commands.list()[0]?.label).toEqual({ zh: '人物卡', en: 'Characters' })
    expect(commands.list()[1]?.label).toEqual({ zh: '世界书', en: 'Worldbook' })
    expect(commands.list()[0]?.keywords).toEqual(expect.arrayContaining(['character', '人物卡']))
    expect(commands.list()[1]?.keywords).toEqual(expect.arrayContaining(['worldbook', '世界书', '设定']))
    for (const dispose of disposers) dispose()
    expect(commands.list()).toEqual([])
  })
})
