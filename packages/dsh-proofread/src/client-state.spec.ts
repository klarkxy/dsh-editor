import { describe, expect, it } from 'vitest'
import { createProofreadClientState } from './client-state.ts'

describe('proofread client state', () => {
  it('accepts a result while input and request are unchanged', () => {
    const state = createProofreadClientState()
    const { ticket } = state.begin()
    expect(state.isCurrent(ticket)).toBe(true)
  })

  it('aborts and suppresses the in-flight request when the input changes', () => {
    const state = createProofreadClientState()
    const { ticket, signal } = state.begin()
    const revision = state.noteInput()
    expect(signal.aborted).toBe(true)
    expect(state.isCurrent(ticket)).toBe(false)
    expect(revision).not.toBe(ticket.revision)
    // A rerun from the edited text is accepted again.
    const rerun = state.begin()
    expect(state.isCurrent(rerun.ticket)).toBe(true)
    expect(rerun.ticket.revision).toBe(revision)
  })

  it('suppresses a superseded request and aborts its signal', () => {
    const state = createProofreadClientState()
    const first = state.begin()
    const second = state.begin()
    expect(first.signal.aborted).toBe(true)
    expect(state.isCurrent(first.ticket)).toBe(false)
    expect(state.isCurrent(second.ticket)).toBe(true)
  })

  it('suppresses results after cancel (close or unmount)', () => {
    const state = createProofreadClientState()
    const { ticket, signal } = state.begin()
    state.cancel()
    expect(signal.aborted).toBe(true)
    expect(state.isCurrent(ticket)).toBe(false)
  })

  it('accepts a fresh request issued after an edit', () => {
    const state = createProofreadClientState()
    state.noteInput()
    const { ticket } = state.begin()
    expect(state.isCurrent(ticket)).toBe(true)
    expect(ticket.revision).toBe(state.revision())
  })
})
