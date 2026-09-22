import { describe, expect, it } from 'vitest'
import { isCurrentRecapRequest, isUserActivity, nextActivityTimestamp, shouldRequestIdleReturn, shouldSkipRecapAutoRefresh } from './idle.ts'
import { DEFAULT_IDLE_RETURN_MS } from './contracts.ts'

describe('idle return trigger', () => {
  it('fires after default 15 minutes of user/application inactivity when the page is visible', () => {
    const idle = {
      now: 20 * 60_000,
      lastUserActivityAt: 4 * 60_000,
      idleReturnMs: DEFAULT_IDLE_RETURN_MS,
      cardsEnabled: true,
      visible: true,
    }
    expect(shouldRequestIdleReturn(idle)).toBe(true)
    expect(shouldRequestIdleReturn({ ...idle, now: 10 * 60_000 })).toBe(false)
    expect(shouldRequestIdleReturn({ ...idle, visible: false })).toBe(false)
    expect(shouldRequestIdleReturn({ ...idle, cardsEnabled: false })).toBe(false)
    expect(shouldRequestIdleReturn({ ...idle, assistantStreaming: true })).toBe(false)
    expect(shouldRequestIdleReturn({ ...idle, hidden: true })).toBe(false)
    expect(shouldRequestIdleReturn({ ...idle, focused: false })).toBe(false)
    expect(shouldRequestIdleReturn({ ...idle, focused: true })).toBe(true)
  })

  it('counts DOM focus and pointer activity, not assistant streams', () => {
    expect(isUserActivity('pointer')).toBe(true)
    expect(isUserActivity('focus')).toBe(true)
    expect(isUserActivity('visible')).toBe(true)
    expect(isUserActivity('assistant-stream')).toBe(false)
    expect(isUserActivity('assistant/message')).toBe(false)
    expect(nextActivityTimestamp('assistant-stream', 10, 99)).toBe(10)
    expect(nextActivityTimestamp('pointer', 10, 99)).toBe(99)
  })

  it('drops idle requests after unmount or session switch', () => {
    expect(isCurrentRecapRequest({
      mounted: true, sessionId: 's1', viewSessionId: 's1', requestId: 2, latestRequestId: 2,
    })).toBe(true)
    expect(isCurrentRecapRequest({
      mounted: true, sessionId: 's1', viewSessionId: 's2', requestId: 2, latestRequestId: 2,
    })).toBe(false)
    expect(isCurrentRecapRequest({
      mounted: false, sessionId: 's1', viewSessionId: 's1', requestId: 2, latestRequestId: 2,
    })).toBe(false)
    expect(isCurrentRecapRequest({
      mounted: true, sessionId: 's1', viewSessionId: 's1', requestId: 1, latestRequestId: 2,
    })).toBe(false)
    expect(isCurrentRecapRequest({
      mounted: true, disposed: true, sessionId: 's1', viewSessionId: 's1', requestId: 2, latestRequestId: 2,
    })).toBe(false)
    expect(isCurrentRecapRequest({
      mounted: true, sessionId: 's1', viewSessionId: 's1', requestId: 2, latestRequestId: 2,
      generation: 1, viewGeneration: 2,
    })).toBe(false)
    expect(isCurrentRecapRequest({
      mounted: true, sessionId: 's1', viewSessionId: 's1', requestId: 2, latestRequestId: 2,
      generation: 2, viewGeneration: 2,
    })).toBe(true)
  })

  it('skips auto refresh while a local edit or action is in progress', () => {
    expect(shouldSkipRecapAutoRefresh({ busy: false })).toBe(false)
    expect(shouldSkipRecapAutoRefresh({ busy: true })).toBe(true)
    expect(shouldSkipRecapAutoRefresh({ busy: false, editing: true })).toBe(true)
    expect(shouldSkipRecapAutoRefresh({ busy: false, disposed: true })).toBe(true)
  })
})
