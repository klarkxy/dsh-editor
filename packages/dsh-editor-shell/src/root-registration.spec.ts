import { describe, expect, it } from 'vitest'
import { ROOT_ID, registerRoot } from './root-registration.ts'

describe('root registration', () => {
  it('keeps the private root and declares the extensions dock plus the plugins settings seat', () => {
    let received: unknown
    registerRoot({ slots: { register: (spec) => { received = spec } } } as never, () => null)
    expect(received).toEqual({
      name: 'root',
      id: ROOT_ID,
      priority: -100,
      label: 'DSH 编辑器',
      children: {
        'dsh-editor.extensions': { kind: 'list', scope: 'root' },
        'dsh-editor.settings.plugins': { kind: 'list', scope: 'root' },
      },
    })
  })
})
