import { describe, expect, it } from 'vitest'
import { MANUSCRIPT_SLOT, registerManuscriptUi } from './slots.ts'

describe('registerManuscriptUi', () => {
  it('injects shell.overlay and never occupies root or conversation.view', () => {
    const calls: unknown[][] = []
    const slots = {
      inject(key: string, callback: () => unknown) {
        calls.push(['inject', key])
        return callback()
      },
      register(spec: { name: string; id?: string }, _render: unknown) {
        calls.push(['register', spec.name, spec.id])
        return () => undefined
      },
    }
    registerManuscriptUi(slots, () => null)
    expect(MANUSCRIPT_SLOT.name).toBe('shell.overlay')
    expect(calls).toEqual([
      ['inject', 'shell.overlay'],
      ['register', 'shell.overlay', 'manuscript'],
    ])
    expect(MANUSCRIPT_SLOT.order).toBe(100)
    expect(MANUSCRIPT_SLOT.label).toBe('稿纸')
    expect(calls.flat().includes('root')).toBe(false)
    expect(calls.flat().join(' ')).not.toMatch(/conversation\.view/)
  })
})
