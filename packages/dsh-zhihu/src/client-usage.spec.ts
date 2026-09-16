import { describe, expect, it } from 'vitest'
import { formatUsageDate, summarizeUsage, usageChartTicks } from './client.tsx'

function day(date: string, calls: number, failures = 0, results = 0) {
  return { date, calls, failures, results }
}

describe('zhihu usage view', () => {
  it('formats ISO dates as short month/day labels', () => {
    expect(formatUsageDate('2026-08-17')).toBe('8/17')
    expect(formatUsageDate('2026-09-01')).toBe('9/1')
    expect(formatUsageDate('2026-09-15')).toBe('9/15')
    expect(formatUsageDate('bad')).toBe('bad')
  })

  it('sums the window, isolates today, and lists active days newest first', () => {
    const totals = summarizeUsage([
      day('2026-08-17', 0),
      day('2026-09-01', 8, 1, 34),
      day('2026-09-14', 2, 0, 6),
      day('2026-09-15', 2, 0, 8),
    ], '2026-09-15')
    expect(totals).toEqual({
      todayCalls: 2,
      calls: 12,
      failures: 1,
      results: 48,
      active: [
        day('2026-09-15', 2, 0, 8),
        day('2026-09-14', 2, 0, 6),
        day('2026-09-01', 8, 1, 34),
      ],
    })
  })

  it('treats a missing today row as zero calls', () => {
    expect(summarizeUsage([day('2026-09-01', 3, 1, 9)], '2026-09-15')).toMatchObject({
      todayCalls: 0,
      calls: 3,
      failures: 1,
      results: 9,
    })
  })

  it('labels sparse active days and drops ticks that would overlap the window end', () => {
    const days = Array.from({ length: 30 }, (_, index) => ({
      calls: index === 0 || index === 14 || index === 28 || index === 29 ? 2 : 0,
    }))
    expect(usageChartTicks(days)).toEqual([0, 14, 29])
  })

  it('keeps four even ticks when many days have calls', () => {
    const days = Array.from({ length: 30 }, () => ({ calls: 1 }))
    expect(usageChartTicks(days)).toEqual([0, 10, 19, 29])
  })

  it('labels an active day rather than an empty window end when they would overlap', () => {
    const days = Array.from({ length: 30 }, (_, index) => ({ calls: index === 28 ? 4 : 0 }))
    expect(usageChartTicks(days)).toEqual([0, 28])
  })
})
