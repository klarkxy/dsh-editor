import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WRITING_PROGRESS,
  PROGRESS_SETTINGS_NAMESPACE,
  computeTodayChars,
  decodeWritingProgress,
  goalReached,
  localDateKey,
  nextBaselines,
  progressFromSnapshot,
  progressSummary,
  shouldUpdateBaseline,
  writingProgressFor,
} from './writing-progress.ts'

describe('writing progress', () => {
  it('exposes the dsh-editor-progress namespace', () => {
    expect(PROGRESS_SETTINGS_NAMESPACE).toBe('dsh-editor-progress')
  })

  it('decodes stored progress tolerantly and drops bad entries', () => {
    expect(decodeWritingProgress(undefined)).toEqual({ goalChars: 0, baselines: {} })
    expect(decodeWritingProgress(null)).toEqual({ goalChars: 0, baselines: {} })
    expect(decodeWritingProgress([])).toEqual({ goalChars: 0, baselines: {} })
    expect(decodeWritingProgress('nope')).toEqual({ goalChars: 0, baselines: {} })
    expect(decodeWritingProgress({ goalChars: 3000, baselines: { 'ws-1': { date: '2025-03-10', startChars: 12000 } } }))
      .toEqual({ goalChars: 3000, baselines: { 'ws-1': { date: '2025-03-10', startChars: 12000 } } })
    expect(decodeWritingProgress({
      goalChars: '3000',
      baselines: {
        'ws-1': { date: '2025-03-10', startChars: 12000 },
        'ws-2': { date: 'not-a-date', startChars: 1 },
        'ws-3': { date: '2025-03-10', startChars: -5 },
        '': { date: '2025-03-10', startChars: 0 },
        'ws-4': null,
        'ws-5': { date: '2025-03-11', startChars: 200 },
      },
    })).toEqual({
      goalChars: 0,
      baselines: { 'ws-1': { date: '2025-03-10', startChars: 12000 }, 'ws-5': { date: '2025-03-11', startChars: 200 } },
    })
    /* 0 也算合法的"未设目标",负数/非数/超大值会被夹住 */
    expect(decodeWritingProgress({ goalChars: 0, baselines: {} }))
      .toEqual({ goalChars: 0, baselines: {} })
    expect(decodeWritingProgress({ goalChars: -10 }).goalChars).toBe(0)
    expect(decodeWritingProgress({ goalChars: Number.NaN }).goalChars).toBe(0)
    expect(decodeWritingProgress({ goalChars: 2_000_000 }).goalChars).toBe(1_000_000)
    expect(decodeWritingProgress({ goalChars: 3.7 }).goalChars).toBe(3)
  })

  it('uses local YYYY-MM-DD instead of UTC', () => {
    expect(localDateKey(new Date(2025, 0, 5))).toBe('2025-01-05')
    expect(localDateKey(new Date(2025, 11, 31, 23, 59, 59))).toBe('2025-12-31')
    /* 同 UTC 瞬间,但本地跨日的情况:本地时区比 UTC 早 8 小时时,UTC=15:00 仍是本地 23:00 */
    const local = new Date(2025, 4, 1, 23, 0, 0)
    expect(localDateKey(local)).toBe('2025-05-01')
  })

  it('requires a new baseline when the date is not today', () => {
    expect(shouldUpdateBaseline(undefined, '2025-03-10')).toBe(true)
    expect(shouldUpdateBaseline({ date: '2025-03-09', startChars: 100 }, '2025-03-10')).toBe(true)
    expect(shouldUpdateBaseline({ date: '2025-03-10', startChars: 100 }, '2025-03-10')).toBe(false)
  })

  it('clamps today progress at zero and never reports negative deltas', () => {
    expect(computeTodayChars({ date: '2025-03-10', startChars: 5000 }, 5000)).toBe(0)
    expect(computeTodayChars({ date: '2025-03-10', startChars: 5000 }, 4999)).toBe(0)
    expect(computeTodayChars({ date: '2025-03-10', startChars: 5000 }, 6240)).toBe(1240)
    expect(computeTodayChars(undefined, 99999)).toBe(0)
    /* 浮点总数取整,避免 1.9 之类尾巴让 progress 跳 1 */
    expect(computeTodayChars({ date: '2025-03-10', startChars: 100 }, 100.9)).toBe(0)
    expect(computeTodayChars({ date: '2025-03-10', startChars: 100 }, 102.4)).toBe(2)
  })

  it('marks goal as reached only when set and met', () => {
    expect(goalReached(0, 0)).toBe(false)
    expect(goalReached(100, 0)).toBe(false)
    expect(goalReached(2999, 3000)).toBe(false)
    expect(goalReached(3000, 3000)).toBe(true)
    expect(goalReached(3001, 3000)).toBe(true)
  })

  it('renders the chip text with the goal line only when set', () => {
    expect(progressSummary({ baseline: { date: '2025-03-10', startChars: 12000 }, currentChars: 13240, goalChars: 0 }).text)
      .toBe('今日 +1,240')
    expect(progressSummary({ baseline: { date: '2025-03-10', startChars: 12000 }, currentChars: 13240, goalChars: 3000 }).text)
      .toBe('今日 +1,240 / 目标 3,000')
    expect(progressSummary({ baseline: undefined, currentChars: 13240, goalChars: 3000 }).text)
      .toBe('今日 +0 / 目标 3,000')
    expect(progressSummary({ baseline: { date: '2025-03-10', startChars: 12000 }, currentChars: 13240, goalChars: 3000, today: '2025-03-10' }).reached)
      .toBe(false)
    expect(progressSummary({ baseline: { date: '2025-03-10', startChars: 12000 }, currentChars: 15000, goalChars: 3000 }).reached)
      .toBe(true)
  })

  it('falls back to defaults while the Host scope is still loading', () => {
    const loading = { status: 'loading' as const, value: undefined, user: undefined, base: undefined, revision: undefined, writable: false, mode: 'host' as const }
    expect(writingProgressFor(loading)).toEqual(DEFAULT_WRITING_PROGRESS)
    expect(writingProgressFor(undefined)).toEqual(DEFAULT_WRITING_PROGRESS)
    const ready = { ...loading, status: 'ready' as const, value: { goalChars: 1500, baselines: { w: { date: '2025-03-10', startChars: 1 } } } }
    expect(progressFromSnapshot(ready)).toEqual({ goalChars: 1500, baselines: { w: { date: '2025-03-10', startChars: 1 } } })
  })

  it('writes the next baseline only when the day or start changed', () => {
    const start = { goalChars: 3000, baselines: { 'ws-1': { date: '2025-03-10', startChars: 12000 } } }
    expect(nextBaselines(start, 'ws-1', '2025-03-10', 12000)).toBe(start.baselines)
    const rollover = nextBaselines(start, 'ws-1', '2025-03-11', 14000)
    expect(rollover).toEqual({ 'ws-1': { date: '2025-03-11', startChars: 14000 } })
    const newWorkspace = nextBaselines(start, 'ws-2', '2025-03-10', 200)
    expect(newWorkspace).toEqual({
      'ws-1': { date: '2025-03-10', startChars: 12000 },
      'ws-2': { date: '2025-03-10', startChars: 200 },
    })
    /* 空 workspaceId 直接返回原 map,不写入 */
    expect(nextBaselines(start, '', '2025-03-10', 99)).toBe(start.baselines)
  })
})
