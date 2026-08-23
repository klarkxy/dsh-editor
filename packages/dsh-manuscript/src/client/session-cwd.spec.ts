import { describe, expect, it } from 'vitest'
import { cwdFromSessionList } from './session-cwd.ts'

describe('cwdFromSessionList', () => {
  it('binds cwd from snapshot.current, not a root sessionId prop', () => {
    const snap = {
      current: 'sess-2',
      byId: {
        'sess-1': { cwd: 'D:/other' },
        'sess-2': { cwd: 'D:/novel' },
      },
    }
    expect(cwdFromSessionList(snap)).toBe('D:/novel')
  })

  it('returns empty when nothing is current', () => {
    expect(cwdFromSessionList(undefined)).toBe('')
    expect(cwdFromSessionList({ byId: { a: { cwd: 'D:/x' } } })).toBe('')
    expect(cwdFromSessionList({ current: 'missing', byId: {} })).toBe('')
  })
})
