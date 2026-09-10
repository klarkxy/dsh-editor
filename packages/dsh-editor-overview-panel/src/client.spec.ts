import { describe, expect, it } from 'vitest'
import { CENTER_OVERLAYS_SLOT, COMMANDS_SERVICE, createCommandRegistry } from 'dsh-editor-seats'
import { apply } from './client.ts'

describe('overview panel client', () => {
  it('registers the center-overlay seat and overview command, then disposes them', () => {
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
    expect(registered).toEqual([{ spec: { name: CENTER_OVERLAYS_SLOT, id: 'overview', order: 100, label: '概览' } }])
    expect(commands.list().map((item) => item.id)).toEqual(['overview'])
    expect(commands.list()[0]?.shortcut).toEqual({ key: 'o', ctrl: true, shift: true })
    expect(commands.list()[0]?.label.zh).toBe('作品概览')
    for (const dispose of disposers) dispose()
    expect(commands.list()).toEqual([])
  })
})
