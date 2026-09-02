import { describe, expect, it } from 'vitest'
import {
  createUsageRecorder,
  dayKey,
  mergeUsage,
  recentDayKeys,
  resolveDays,
  summarize,
  USAGE_DEFAULT_DAYS,
  USAGE_MAX_DAYS,
  UsageInputError,
  type DailyUsage,
  type UsageTableLike,
} from './usage.ts'

function tableFixture(): UsageTableLike & { rows: Map<string, ReturnType<UsageTableLike['get']>> } {
  const rows = new Map<string, ReturnType<UsageTableLike['get']>>()
  return {
    rows,
    get: (key) => rows.get(key),
    async put(key, value) {
      rows.set(key, value)
    },
  }
}

describe('LLM usage accounting', () => {
  it('formats a local-time YYYY-MM-DD day key', () => {
    expect(dayKey(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01')
    expect(dayKey(new Date(2026, 8, 30))).toBe('2026-09-30')
  })

  it('accumulates per-day totals, per-model breakdown, and the request counter', () => {
    const day = mergeUsage(undefined, 'dsh-official/dsh-v3', { inputTokens: 100, outputTokens: 40 }, { request: true })
    const next = mergeUsage(day, 'dsh-official/dsh-v3', { inputTokens: 50, outputTokens: 20, cacheReadTokens: 25 }, {
      request: true,
    })
    expect(next.requests).toBe(2)
    expect(next.inputTokens).toBe(150)
    expect(next.outputTokens).toBe(60)
    expect(next.cacheReadTokens).toBe(25)
    expect(next.byModel['dsh-official/dsh-v3']).toEqual({
      inputTokens: 150,
      outputTokens: 60,
      cacheReadTokens: 25,
      cacheWriteTokens: 0,
      requests: 2,
    })
  })

  it('creates a new day row when none is stored, and a new model entry on first use', () => {
    const created = mergeUsage(undefined, 'newapi/v3', { inputTokens: 10, outputTokens: 5 }, { request: true })
    expect(created.date).toBe('')
    expect(created.requests).toBe(1)
    expect(created.byModel['newapi/v3'].inputTokens).toBe(10)

    const second = mergeUsage(created, 'dsh-official/dsh-v3', { inputTokens: 1 }, { request: false })
    expect(second.byModel['newapi/v3'].inputTokens).toBe(10)
    expect(second.byModel['dsh-official/dsh-v3'].inputTokens).toBe(1)
    expect(second.byModel['dsh-official/dsh-v3'].requests).toBe(0)
  })

  it('preserves the existing date when merging, so calendar rollover does not lose the row', () => {
    const seeded: DailyUsage = {
      date: '2026-01-01',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      requests: 0,
      byModel: {},
    }
    const merged = mergeUsage(seeded, 'p/m', { inputTokens: 1 }, { request: true })
    expect(merged.date).toBe('2026-01-01')
  })

  it('treats fractional or non-positive usage as zero, never as negative debt', () => {
    const day = mergeUsage(undefined, 'p/m', { inputTokens: 1.7, outputTokens: -3, cacheReadTokens: 0 }, {
      request: true,
    })
    expect(day.inputTokens).toBe(1)
    expect(day.outputTokens).toBe(0)
    expect(day.cacheReadTokens).toBe(0)
  })

  it('builds a contiguous, oldest-first date sequence ending today', () => {
    const now = new Date(2026, 2, 10, 12, 0)
    const keys = recentDayKeys(5, now)
    expect(keys).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
  })

  it('fills missing days with zero rows and emits days in ascending order', () => {
    const rows: Array<DailyUsage | undefined> = [
      {
        date: '2026-03-08',
        inputTokens: 9,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        requests: 1,
        byModel: { 'p/m': { inputTokens: 9, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 1 } },
      },
    ]
    const summary = summarize(rows, 4, new Date(2026, 2, 9, 12, 0))
    expect(summary.map((row) => row.date)).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'])
    expect(summary[0]).toMatchObject({ requests: 0, inputTokens: 0 })
    expect(summary[2].requests).toBe(1)
    expect(summary[3]).toMatchObject({ requests: 0 })
  })

  it('clamps invalid day counts and falls back to the default', () => {
    expect(resolveDays(undefined)).toBe(USAGE_DEFAULT_DAYS)
    expect(resolveDays(7)).toBe(7)
    expect(() => resolveDays(0)).toThrow(UsageInputError)
    expect(() => resolveDays(USAGE_MAX_DAYS + 1)).toThrow(UsageInputError)
  })

  it('persists via the table and reads back a contiguous window ending today', async () => {
    const table = tableFixture()
    const recorder = createUsageRecorder(table)
    await recorder.record('p/m', { inputTokens: 5, outputTokens: 2 }, { request: true })
    await recorder.record('q/n', { inputTokens: 3, outputTokens: 1, cacheWriteTokens: 4 }, { request: true })

    const days = await recorder.read(3)
    expect(days).toHaveLength(3)
    // Re-derive "today" and the two prior days with the same `setDate` arithmetic
    // the implementation uses, so DST or a near-midnight run cannot flake this.
    const base = new Date()
    const prior = (offset: number) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
      d.setDate(d.getDate() - offset)
      return dayKey(d)
    }
    expect(days.map((row) => row.date)).toEqual([prior(2), prior(1), prior(0)])
    // The last slot is today, with the recorded totals merged across models.
    expect(days[2].requests).toBe(2)
    expect(days[2].inputTokens).toBe(8)
    expect(days[2].outputTokens).toBe(3)
    expect(days[2].cacheWriteTokens).toBe(4)
    expect(days[2].byModel['p/m'].inputTokens).toBe(5)
    expect(days[2].byModel['q/n'].inputTokens).toBe(3)
    // Earlier days are zero rows.
    expect(days[0].requests).toBe(0)
    expect(days[0].inputTokens).toBe(0)
    expect(days[1].requests).toBe(0)
  })

  it('records a usage event and merges it into the same day row', async () => {
    const table = tableFixture()
    const recorder = createUsageRecorder(table)
    await recorder.record('p/m', { inputTokens: 5, outputTokens: 2 }, { request: true })
    await recorder.record('p/m', { inputTokens: 3, outputTokens: 1, cacheWriteTokens: 4 }, { request: true })
    const today = dayKey()
    const row = table.rows.get(today)
    expect(row).toBeDefined()
    expect(row?.requests).toBe(2)
    expect(row?.inputTokens).toBe(8)
    expect(row?.outputTokens).toBe(3)
    expect(row?.cacheWriteTokens).toBe(4)
    expect(row?.byModel['p/m'].inputTokens).toBe(8)
  })
})
