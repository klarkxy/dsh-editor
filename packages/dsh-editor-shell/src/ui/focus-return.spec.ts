import { describe, expect, it } from 'vitest'
import { pickReturnFocus, scheduleReturnFocus, takeInvokerOnOpen } from './focus-return.ts'

describe('dialog invoker capture', () => {
  it('captures on first open even when the instance mounts already open', () => {
    const wasOpen = { current: false }
    expect(takeInvokerOnOpen(true, wasOpen)).toBeNull()
    expect(wasOpen.current).toBe(true)
    expect(takeInvokerOnOpen(true, wasOpen)).toBeUndefined()
  })

  it('recaptures on a later open after close', () => {
    const wasOpen = { current: false }
    takeInvokerOnOpen(true, wasOpen)
    takeInvokerOnOpen(false, wasOpen)
    expect(wasOpen.current).toBe(false)
    expect(takeInvokerOnOpen(true, wasOpen)).toBeNull()
  })

  it('prefers a supplied stable target over the captured invoker', () => {
    const supplied = { id: 'tree' } as unknown as HTMLElement
    const captured = { id: 'menuitem' } as unknown as HTMLElement
    expect(pickReturnFocus(supplied, captured)).toBe(supplied)
    expect(pickReturnFocus(null, captured)).toBe(captured)
    expect(pickReturnFocus(undefined, captured)).toBe(captured)
  })

  it('re-queries a disconnected invoker by its stable hook', async () => {
    /* 打开抽屉时 launcher 退场，关闭后挂回的是新节点——捕获的旧节点断连，
       按时恢复要落到新节点上。 */
    const live = { isConnected: true, focused: false, focus(this: { focused: boolean }) { this.focused = true } }
    const dead = { isConnected: false, dataset: { testid: 'dsh-shell-launcher' } } as unknown as HTMLElement
    const original = globalThis.document
    ;(globalThis as { document?: unknown }).document = {
      querySelector: (selector: string) => (selector === '[data-testid="dsh-shell-launcher"]' ? live : null),
    }
    const generation = { current: 1 }
    try {
      scheduleReturnFocus(dead, generation)
      await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
      expect(live.focused).toBe(true)
    } finally {
      if (original === undefined) delete (globalThis as { document?: unknown }).document
      else (globalThis as { document?: unknown }).document = original
    }
  })

  it('does not apply a stale restore after a newer generation', () => {
    const generation = { current: 1 }
    const calls: string[] = []
    const stale = { isConnected: true, focus() { calls.push('stale') } } as HTMLElement
    scheduleReturnFocus(stale, generation)
    generation.current = 2
    const fresh = { isConnected: true, focus() { calls.push('fresh') } } as HTMLElement
    scheduleReturnFocus(fresh, generation)
    return new Promise<void>((resolve) => {
      globalThis.setTimeout(() => {
        expect(calls).toEqual(['fresh'])
        resolve()
      }, 10)
    })
  })
})
