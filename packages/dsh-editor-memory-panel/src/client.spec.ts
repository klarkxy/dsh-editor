import { describe, expect, it } from 'vitest'
import { COMMANDS_SERVICE, MESSAGE_CARDS_SERVICE, SIDEBAR_TOOLS_SLOT, createCommandRegistry, createMessageCardRegistry } from 'dsh-editor-seats'
import { apply } from './client.ts'

describe('memory panel client', () => {
  it('registers the sidebar seat, memory-open command, and memory-update card, then disposes them', () => {
    const commands = createCommandRegistry()
    const messageCards = createMessageCardRegistry()
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
      [MESSAGE_CARDS_SERVICE]: messageCards,
    }
    apply(ctx as never)
    expect(registered).toEqual([{ spec: { name: SIDEBAR_TOOLS_SLOT, id: 'memory', order: 200, label: '记忆' } }])
    expect(commands.list().map((item) => item.id)).toEqual(['memory-open'])
    expect(commands.list()[0]?.shortcut).toBeUndefined()
    expect(commands.list()[0]?.label).toEqual({ zh: '记忆维护', en: 'Memory maintenance' })
    expect(messageCards.get('novel_memory_update')?.toolName).toBe('novel_memory_update')
    expect(messageCards.get('novel_memory_update')?.render({
      result: { marker: 'dsh-editor.memory-update', version: 1, id: 'mu-1', path: '项目规则.md', summary: '记录', status: 'pending', createdAt: '2026-09-09T08:00:00.000Z' },
      context: {
        sessionId: 's1',
        locale: 'zh',
        onApplied: () => {},
        refresh: () => {},
        note: () => {},
      },
    })).not.toBeNull()
    expect(messageCards.get('novel_memory_update')?.render({
      result: 'not a receipt',
      context: {
        sessionId: 's1',
        locale: 'zh',
        onApplied: () => {},
        refresh: () => {},
        note: () => {},
      },
    })).toBeNull()
    for (const dispose of disposers) dispose()
    expect(commands.list()).toEqual([])
    expect(messageCards.get('novel_memory_update')).toBeUndefined()
  })

  it('forwards the seat owner into the memory panel', () => {
    const Select = () => null
    const Dialog = () => null
    let render: ((props: unknown) => { props: Record<string, unknown> }) | undefined
    const ctx = {
      effect(fn: () => (() => void) | void) { fn() },
      slots: {
        inject(_key: string, callback: () => unknown) {
          callback()
          return () => {}
        },
        register(_spec: unknown, next: unknown) {
          render = next as typeof render
          return () => {}
        },
      },
      connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
      [COMMANDS_SERVICE]: createCommandRegistry(),
      [MESSAGE_CARDS_SERVICE]: createMessageCardRegistry(),
    }
    apply(ctx as never)
    const tree = render?.({ sessionId: 's1', openDocument() {}, Select, Dialog })
    expect(tree?.props.Select).toBe(Select)
    expect(tree?.props.Dialog).toBe(Dialog)
  })
})
