import { describe, expect, it } from 'vitest'
import { PROGRESS_RECORD_DEBOUNCE_MS, createDebouncedInvoker, progressRecordChars } from './progress-record.ts'

describe('progress record debounce', () => {
  it('exposes a 5s debounce window', () => {
    expect(PROGRESS_RECORD_DEBOUNCE_MS).toBe(5_000)
  })

  it('collapses rapid schedules into the latest task', () => {
    const pending = new Map<number, () => void>()
    let nextId = 1
    const invoker = createDebouncedInvoker(5_000, {
      setTimeout(handler) {
        const id = nextId++
        pending.set(id, handler)
        return id
      },
      clearTimeout(id) {
        pending.delete(id as number)
      },
    })
    const calls: string[] = []
    invoker.schedule(() => calls.push('first'))
    invoker.schedule(() => calls.push('second'))
    expect(pending.size).toBe(1)
    expect(calls).toEqual([])
    for (const run of pending.values()) run()
    expect(calls).toEqual(['second'])
  })

  it('does not fire a cancelled task', () => {
    const pending = new Map<number, () => void>()
    let nextId = 1
    const invoker = createDebouncedInvoker(5_000, {
      setTimeout(handler) {
        const id = nextId++
        pending.set(id, handler)
        return id
      },
      clearTimeout(id) {
        pending.delete(id as number)
      },
    })
    let fired = false
    invoker.schedule(() => { fired = true })
    invoker.cancel()
    expect(pending.size).toBe(0)
    expect(fired).toBe(false)
  })

  it('reads a non-negative integer total from overview totals', () => {
    expect(progressRecordChars(null)).toBeNull()
    expect(progressRecordChars({ totals: { chars: 12.5 } })).toBeNull()
    expect(progressRecordChars({ totals: { chars: -1 } })).toBeNull()
    expect(progressRecordChars({ totals: { chars: 0 } })).toBe(0)
    expect(progressRecordChars({ totals: { chars: 4200 } })).toBe(4200)
  })
})
