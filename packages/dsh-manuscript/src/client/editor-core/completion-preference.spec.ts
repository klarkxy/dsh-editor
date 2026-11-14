import { describe, expect, it } from 'vitest'
import { automaticCompletionReady } from './completion-preference.ts'

describe('automatic completion eligibility', () => {
  const idleAtEnd = {
    preference: 'pause' as const,
    manuscript: true,
    userEditRevision: 2,
    requestedRevision: 1,
    focused: true,
    collapsedSelection: true,
    prefix: '已经写下足够的正文',
    atEnd: true,
    busy: false,
    blocked: false,
  }

  it('only offers an idle suggestion at the end of the document', () => {
    expect(automaticCompletionReady(idleAtEnd)).toBe(true)
    expect(automaticCompletionReady({ ...idleAtEnd, atEnd: false })).toBe(false)
    expect(automaticCompletionReady({ ...idleAtEnd, preference: 'manual' as const })).toBe(false)
  })
})
