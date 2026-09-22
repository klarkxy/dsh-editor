import { expect, it } from 'vitest'
import { listen } from './index.ts'

it('binds host listeners with ctx.on.call(ctx)', () => {
  const seen: unknown[] = []
  const ctx = {
    on(this: unknown, name: string) {
      seen.push(this)
      expect(name).toBe('agent/pre-step')
      return () => {}
    },
  }
  const off = listen(ctx as never, 'agent/pre-step', () => {})
  expect(seen).toEqual([ctx])
  expect(typeof off).toBe('function')
})
