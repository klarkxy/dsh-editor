import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMMANDS_SERVICE, SIDEBAR_TOOLS_SLOT, createCommandRegistry } from 'dsh-editor-seats'
import { zh } from './messages.ts'
import { apply } from './client.ts'

const here = dirname(fileURLToPath(import.meta.url))

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
    expect(registered).toEqual([{ spec: { name: SIDEBAR_TOOLS_SLOT, id: 'proofread', order: 100, label: '文稿校对' } }])
    expect(commands.list().map((item) => item.id)).toEqual(['proofread-document', 'proofread-manuscript'])
    expect(commands.list()[0]?.label.zh).toBe('校对当前文档')
    expect(commands.list()[1]?.label.zh).toBe('校对全部文档')
    expect(commands.list()[0]?.shortcut).toEqual({ key: 'l', ctrl: true, shift: true })
    for (const dispose of disposers) dispose()
    expect(commands.list()).toEqual([])
  })

  it('forwards optional host Select and Dialog from the seat owner', () => {
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
    }
    apply(ctx as never)
    const tree = render?.({ sessionId: 's1', openDocument() {}, Select, Dialog })
    expect(tree?.props.Select).toBe(Select)
    expect(tree?.props.Dialog).toBe(Dialog)
  })

  it('scans through workbench proofread.scan and does not depend on the dsh-proofread entry', () => {
    const panel = readFileSync(resolve(here, 'panel.ts'), 'utf8')
    const view = readFileSync(resolve(here, 'proofread-view.ts'), 'utf8')
    const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    expect(panel).toContain('WORKBENCH_RPC_CHANNEL')
    expect(panel).toContain("'proofread.scan'")
    expect(panel).not.toMatch(/dsh-proofread/)
    expect(view).not.toMatch(/dsh-proofread/)
    expect(pkg.dependencies?.['dsh-proofread']).toBeUndefined()
    expect(pkg.devDependencies?.['dsh-proofread']).toBeUndefined()
    expect(pkg.peerDependencies?.['dsh-proofread']).toBeUndefined()
    expect(Object.keys(zh).filter((key) => key.includes('card'))).toEqual([])
    expect(zh['proofread.title']).toBe('文稿校对')
    expect(zh['proofread.currentDoc']).toBe('当前文档')
    expect(zh['proofread.wholeBook']).toBe('全部文档')
  })
})
