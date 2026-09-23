import { describe, expect, it } from 'vitest'
import { activeWorkspaceFromSessionList, cwdFromSessionList } from './session-cwd.ts'

describe('selected workspace', () => {
  it('uses the navigation selection and the catalog cwd', () => {
    const snap = { byId: { a: { cwd: 'D:/other' }, b: { cwd: 'D:/novel' } } }
    expect(cwdFromSessionList(snap, 'b')).toBe('D:/novel')
    expect(activeWorkspaceFromSessionList(snap, 'b')).toEqual({ sessionId: 'b', cwd: 'D:/novel' })
  })
  it('does not invent a selection from catalog membership', () => {
    expect(cwdFromSessionList(undefined)).toBe('')
    expect(cwdFromSessionList({ byId: { a: { cwd: 'D:/x' } } })).toBe('')
    expect(cwdFromSessionList({ byId: {} }, 'missing')).toBe('')
  })
})
