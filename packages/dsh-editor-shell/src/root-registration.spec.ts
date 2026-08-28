import { describe, expect, it } from 'vitest'
import { ROOT_ID, registerRoot } from './root-registration.ts'

describe('root registration', () => {
  it('intentionally claims only the public root slot', () => {
    let received: unknown
    registerRoot({ slots: { register: (spec) => { received = spec } } } as never, () => null)
    expect(received).toEqual({ name: 'root', id: ROOT_ID, priority: -100, label: 'DSH 编辑器' })
  })
})
