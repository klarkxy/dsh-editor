import { describe, expect, it } from 'vitest'
import { ROOT_ID, registerRoot } from './root-registration.ts'

describe('root registration', () => {
  it('keeps the private root with no child seats — the settings dialog is our own now', () => {
    let received: unknown
    registerRoot({ slots: { register: (spec) => { received = spec } } } as never, () => null)
    expect(received).toEqual({ name: 'root', id: ROOT_ID, priority: -100, label: 'DSH 编辑器' })
  })
})
