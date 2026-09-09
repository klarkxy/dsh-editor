import { describe, expect, it } from 'vitest'
import { ROOT_ID, registerRoot } from './root-registration.ts'

describe('root registration', () => {
  it('keeps the private root and declares only the generic extensions seat', () => {
    let received: unknown
    registerRoot({ slots: { register: (spec) => { received = spec } } } as never, () => null)
    expect(received).toEqual({
      name: 'root',
      id: ROOT_ID,
      priority: -100,
      label: 'DSH 编辑器',
      children: { 'dsh-editor.extensions': { kind: 'list', scope: 'root' } },
    })
  })
})
