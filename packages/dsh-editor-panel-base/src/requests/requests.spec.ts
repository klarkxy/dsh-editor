import { describe, expect, it } from 'vitest'
import { createRequestManager } from './index.js'

describe('createRequestManager - ticket lifecycle', () => {
  it('consumes a request once and clears pending', () => {
    const manager = createRequestManager()
    const req = manager.request({ nonce: 1 })

    expect(manager.pending()).toEqual({ nonce: 1 })
    manager.consume(req)
    expect(manager.pending()).toBeNull()
  })

  it('ignores consume of non-matching nonce', () => {
    const manager = createRequestManager()
    const req1 = manager.request({ nonce: 1 })
    const req2 = { nonce: 2 }

    manager.consume(req2)
    expect(manager.pending()).toEqual(req1)
  })

  it('replaces pending on new request', () => {
    const manager = createRequestManager()
    manager.request({ nonce: 1 })
    const req2 = manager.request({ nonce: 2 })

    expect(manager.pending()).toEqual(req2)
  })

  it('notifies all subscribers on request', () => {
    const manager = createRequestManager()
    const received: number[] = []

    manager.subscribe((req) => received.push(req.nonce))
    manager.subscribe((req) => received.push(req.nonce + 100))

    manager.request({ nonce: 5 })
    expect(received).toEqual([5, 105])
  })

  it('stops notifying after unsubscribe', () => {
    const manager = createRequestManager()
    const received: number[] = []

    const unsubscribe = manager.subscribe((req) => received.push(req.nonce))
    manager.request({ nonce: 1 })

    unsubscribe()
    manager.request({ nonce: 2 })

    expect(received).toEqual([1])
  })
})
