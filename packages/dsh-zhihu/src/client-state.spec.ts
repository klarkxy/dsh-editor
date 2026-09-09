import { describe, expect, it } from 'vitest'
import { createZhihuClientState } from './client-state.ts'

describe('zhihu client state', () => {
  it('accepts a result while query and request are unchanged', () => {
    const state = createZhihuClientState()
    const { ticket } = state.begin()
    expect(state.isCurrent(ticket)).toBe(true)
  })

  it('aborts and suppresses the in-flight request when the query changes', () => {
    const state = createZhihuClientState()
    const { ticket, signal } = state.begin()
    state.noteInput()
    expect(signal.aborted).toBe(true)
    expect(state.isCurrent(ticket)).toBe(false)
  })

  it('suppresses a result when the tab changed during the request', () => {
    const state = createZhihuClientState()
    const { ticket } = state.begin()
    state.cancel() // tab switch cancels the in-flight search
    expect(state.isCurrent(ticket)).toBe(false)
  })

  it('suppresses a superseded request and aborts its signal', () => {
    const state = createZhihuClientState()
    const first = state.begin()
    const second = state.begin()
    expect(first.signal.aborted).toBe(true)
    expect(state.isCurrent(first.ticket)).toBe(false)
    expect(state.isCurrent(second.ticket)).toBe(true)
  })

  it('suppresses results after cancel (panel close or unmount)', () => {
    const state = createZhihuClientState()
    const { ticket, signal } = state.begin()
    state.cancel()
    expect(signal.aborted).toBe(true)
    expect(state.isCurrent(ticket)).toBe(false)
  })

  it('drops a late async resolution once a newer query was issued', async () => {
    const state = createZhihuClientState()
    const stale = state.begin()
    let resolveStale!: (value: string) => void
    const stalePromise = new Promise<string>((resolve) => { resolveStale = resolve })
    state.noteInput() // user edits the query
    const fresh = state.begin()
    let resolveFresh!: (value: string) => void
    const freshPromise = new Promise<string>((resolve) => { resolveFresh = resolve })

    resolveStale('旧结果')
    const staleValue = await stalePromise
    const appliedStale = state.isCurrent(stale.ticket) ? staleValue : null
    expect(appliedStale).toBeNull()
    expect(stale.signal.aborted).toBe(true)

    resolveFresh('新结果')
    const freshValue = await freshPromise
    const appliedFresh = state.isCurrent(fresh.ticket) ? freshValue : null
    expect(appliedFresh).toBe('新结果')
  })

  it('accepts a fresh request issued after an edit', () => {
    const state = createZhihuClientState()
    state.noteInput()
    const { ticket } = state.begin()
    expect(state.isCurrent(ticket)).toBe(true)
    expect(ticket.revision).toBe(state.revision())
  })
})
