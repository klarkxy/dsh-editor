import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { apply } from './client.ts'

describe('desktop proofread client registration', () => {
  it('keeps the official Web overlay and does not register desktop extensions', () => {
    const injected: string[] = []
    const names: string[] = []
    apply({
      effect(fn: () => (() => void) | void) { fn() },
      slots: {
        inject(key: string, callback: () => unknown) {
          injected.push(key)
          callback()
          return () => {}
        },
        register(spec: { name: string }, _render: unknown) {
          names.push(spec.name)
          return () => {}
        },
      },
      connection: { rpc: { call: async () => ({}) } },
    } as never)
    expect(injected).toEqual(['shell.overlay'])
    expect(names).toEqual(['shell.overlay'])
    const source = readFileSync(new URL('./client.ts', import.meta.url), 'utf8')
    expect(source).toContain("inject('shell.overlay'")
    expect(source).not.toContain("inject('dsh-editor.extensions'")
  })
})
