import { describe, expect, it } from 'vitest'
import { COMMANDS_SERVICE, SIDEBAR_TOOLS_SLOT, createCommandRegistry } from 'dsh-editor-seats'
import { apply } from './client.ts'

describe('proofread panel client', () => {
  it('registers the sidebar seat and two commands, then disposes them', () => {
    const commands = createCommandRegistry()
    const registered: Array<{ spec: { name: string; id?: string; label?: string } }> = []
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
        register(spec: { name: string; id?: string; label?: string }, _render: unknown) {
          registered.push({ spec })
          return () => {}
        },
      },
      connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
      [COMMANDS_SERVICE]: commands,
    }
    apply(ctx as never)
    expect(registered).toEqual([{ spec: { name: SIDEBAR_TOOLS_SLOT, id: 'proofread', order: 100, label: '校对' } }])
    expect(commands.list().map((item) => item.id)).toEqual(['proofread-document', 'proofread-manuscript'])
    expect(commands.list()[0]?.shortcut).toEqual({ key: 'l', ctrl: true, shift: true })
    for (const dispose of disposers) dispose()
    expect(commands.list()).toEqual([])
  })
})
