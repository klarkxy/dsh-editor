import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDraftSyncTimer } from './editor.tsx'

describe('createDraftSyncTimer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops a not-yet-fired run and still accepts a later schedule', () => {
    vi.useFakeTimers()
    const timer = createDraftSyncTimer()
    const first = vi.fn()
    const second = vi.fn()
    timer.schedule(250, first)
    timer.cancelPending()
    vi.advanceTimersByTime(250)
    expect(first).not.toHaveBeenCalled()
    timer.schedule(250, second)
    vi.advanceTimersByTime(249)
    expect(second).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(second).toHaveBeenCalledOnce()
  })

  it('replaces a pending run so only the latest scheduled callback fires', () => {
    vi.useFakeTimers()
    const timer = createDraftSyncTimer()
    const first = vi.fn()
    const second = vi.fn()
    timer.schedule(250, first)
    timer.schedule(250, second)
    vi.advanceTimersByTime(250)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})
