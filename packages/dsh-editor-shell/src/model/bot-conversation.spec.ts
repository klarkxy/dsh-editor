import { describe, expect, it } from 'vitest'
import { botSegmentMarkerTime, botSettingsError, cacheTtlLabel, cacheTtlOptionMinutes, idleRecapDue, recapForSegment, rolloverGuardBlocked, rolloverReasonAfterTurn, rolloverReasonOnSubmit } from './bot-conversation.ts'
import { emptyBotState } from './bot-test-helpers.ts'
import type { BotCheckResult } from 'dsh-editor-workbench/contracts'

const check = (over: Partial<BotCheckResult> = {}): BotCheckResult => ({
  hasMessages: true, promptChanged: false, wrapUpRequested: false, ...over,
})
const guard = { running: false, rolling: false, pendingInteractions: false }
const MIN = 60_000

describe('rolloverReasonOnSubmit', () => {
  it('skips when there are no messages', () => {
    expect(rolloverReasonOnSubmit(check({ hasMessages: false }), 60, 10_000_000)).toBeUndefined()
  })
  it('fires idle-expired only past the TTL boundary, never when TTL is 0', () => {
    const activity = 10_000_000
    expect(rolloverReasonOnSubmit(check({ lastActivityAt: activity - 60 * MIN }), 60, activity)).toBeUndefined()
    expect(rolloverReasonOnSubmit(check({ lastActivityAt: activity - 60 * MIN - 1 }), 60, activity)).toBe('idle-expired')
    expect(rolloverReasonOnSubmit(check({ lastActivityAt: activity - 9999 * MIN }), 0, activity)).toBeUndefined()
  })
  it('prefers idle-expired over prompt-changed', () => {
    expect(rolloverReasonOnSubmit(check({ lastActivityAt: 0, promptChanged: true }), 60, 10_000_000)).toBe('idle-expired')
    expect(rolloverReasonOnSubmit(check({ promptChanged: true }), 60, 10_000_000)).toBe('prompt-changed')
  })
})

describe('rolloverReasonAfterTurn', () => {
  it('context-full at exactly 0.7, wrap-up otherwise', () => {
    expect(rolloverReasonAfterTurn(check({ ratio: 0.7 }))).toBe('context-full')
    expect(rolloverReasonAfterTurn(check({ ratio: 0.69 }))).toBeUndefined()
    expect(rolloverReasonAfterTurn(check({ ratio: 0.69, wrapUpRequested: true }))).toBe('wrap-up')
    expect(rolloverReasonAfterTurn(check({ ratio: 0.8, wrapUpRequested: true }))).toBe('context-full')
  })
})

describe('idleRecapDue', () => {
  const base = { guard, check: check({ lastMessageSeq: 7 }), idleRecapMinutes: 15, lastPreparedSeq: undefined, lastActivityAt: 0, now: 20 * MIN }
  it('fires when idle past the setting with a newer message seq', () => {
    expect(idleRecapDue(base)).toBe(true)
  })
  it('dedupes on the prepared seq and respects the idle gap', () => {
    expect(idleRecapDue({ ...base, lastPreparedSeq: 7 })).toBe(false)
    expect(idleRecapDue({ ...base, lastActivityAt: 10 * MIN })).toBe(false)
    expect(idleRecapDue({ ...base, guard: { ...guard, running: true } })).toBe(false)
    expect(idleRecapDue({ ...base, check: check({ hasMessages: false }) })).toBe(false)
    expect(idleRecapDue({ ...base, check: check({ lastMessageSeq: undefined }) })).toBe(false)
  })
})

describe('guard and recaps', () => {
  it('blocks on any pending surface', () => {
    /* 提案板已删除：待处理提案不再阻塞 rollover，只有未决交互继续阻塞。 */
    expect(rolloverGuardBlocked({ ...guard, pendingInteractions: true })).toBe(true)
    expect(rolloverGuardBlocked(guard)).toBe(false)
  })
  it('recap visibility is per-segment and after the last author message', () => {
    const state = { ...emptyBotState(), recaps: [
      { sessionId: 's1', afterSeq: 1, text: '旧回顾', createdAt: 100 },
      { sessionId: 's1', afterSeq: 5, text: '新回顾', createdAt: 200 },
    ] }
    expect(recapForSegment(state, 's1', 150)?.text).toBe('新回顾')
    expect(recapForSegment(state, 's1', 250)).toBeUndefined()
    expect(recapForSegment(state, 's2')).toBeUndefined()
  })
})

describe('settings validation', () => {
  it('requires idle below a non-zero TTL and exposes the option list', () => {
    expect(botSettingsError(15, 60)).toBeUndefined()
    expect(botSettingsError(60, 60)).toBe('idle-too-long')
    expect(botSettingsError(240, 0)).toBeUndefined()
    expect(cacheTtlOptionMinutes()).toContain(0)
  })
})

describe('botSegmentMarkerTime', () => {
  const now = new Date(2026, 10, 4, 15, 30)
  it('shows HH:mm on the same day, month+day+time otherwise', () => {
    expect(botSegmentMarkerTime(new Date(2026, 10, 4, 8, 5).getTime(), 'zh', now)).toBe('08:05')
    expect(botSegmentMarkerTime(new Date(2026, 10, 4, 8, 5).getTime(), 'en', now)).toContain('08')
    expect(botSegmentMarkerTime(new Date(2026, 9, 20, 8, 5).getTime(), 'zh', now)).toContain('20')
    expect(botSegmentMarkerTime(new Date(2026, 9, 20, 8, 5).getTime(), 'zh', now)).toContain('08:05')
  })
})

describe('cacheTtlLabel', () => {
  const labels: Record<string, string> = {
    'settings.botCacheTtlNever': '永不失效',
    'settings.botCacheTtlMinutesShort': '{minutes} 分钟',
    'settings.botCacheTtlHours': '{hours} 小时',
  }
  const fakeT = ((key: string, params?: { [key: string]: string | number }) =>
    (labels[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))) as never
  it('uses minutes below 60, hours at 60+, never at 0', () => {
    expect(cacheTtlLabel(5, fakeT)).toBe('5 分钟')
    expect(cacheTtlLabel(30, fakeT)).toBe('30 分钟')
    expect(cacheTtlLabel(60, fakeT)).toBe('1 小时')
    expect(cacheTtlLabel(120, fakeT)).toBe('2 小时')
    expect(cacheTtlLabel(240, fakeT)).toBe('4 小时')
    expect(cacheTtlLabel(1440, fakeT)).toBe('24 小时')
    expect(cacheTtlLabel(0, fakeT)).toBe('永不失效')
  })
})
