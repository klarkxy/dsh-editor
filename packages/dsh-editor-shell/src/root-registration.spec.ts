import { describe, expect, it } from 'vitest'
import { ROOT_CHILDREN, ROOT_ID, registerRoot } from './root-registration.ts'

describe('root registration', () => {
  it('keeps the private root while declaring the native settings child seat', () => {
    let received: unknown
    registerRoot({ slots: { register: (spec) => { received = spec } } } as never, () => null)
    expect(received).toEqual({ name: 'root', id: ROOT_ID, priority: -100, label: 'DSH 编辑器', children: ROOT_CHILDREN })
  })
})
