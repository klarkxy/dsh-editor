import { describe, expect, it } from 'vitest'
import { dayKey } from './usage.ts'
import {
  createZhihuUsageRecorder,
  mergeZhihuUsage,
  type ZhihuUsageTableLike,
} from './zhihu-usage.ts'

function tableFixture(): ZhihuUsageTableLike & { rows: Map<string, ReturnType<ZhihuUsageTableLike['get']>> } {
  const rows = new Map<string, ReturnType<ZhihuUsageTableLike['get']>>()
  return {
    rows,
    get: (key) => rows.get(key),
    async put(key, value) {
      rows.set(key, value)
    },
  }
}

describe('zhihu search usage accounting', () => {
  it('counts every call, failures separately, and accumulates results on success', () => {
    const day = mergeZhihuUsage(undefined, { ok: true, results: 5 })
    const next = mergeZhihuUsage(day, { ok: false })
    const last = mergeZhihuUsage(next, { ok: true, results: 3 })
    expect(last.calls).toBe(3)
    expect(last.failures).toBe(1)
    expect(last.results).toBe(8)
  })

  it('normalizes non-positive or non-finite results to zero', () => {
    const day = mergeZhihuUsage(undefined, { ok: true, results: Number.NaN })
    expect(day.results).toBe(0)
    expect(day.calls).toBe(1)
    expect(day.failures).toBe(0)
  })

  it('persists via the table and reads back a contiguous window ending today', async () => {
    const table = tableFixture()
    const recorder = createZhihuUsageRecorder(table)
    await recorder.record({ ok: true, results: 4 })
    await recorder.record({ ok: false })

    const days = await recorder.read(3)
    expect(days).toHaveLength(3)
    const base = new Date()
    const prior = (offset: number) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
      d.setDate(d.getDate() - offset)
      return dayKey(d)
    }
    expect(days.map((row) => row.date)).toEqual([prior(2), prior(1), prior(0)])
    expect(days[2]).toMatchObject({ calls: 2, failures: 1, results: 4 })
    expect(days[0]).toMatchObject({ calls: 0, failures: 0, results: 0 })
    expect(days[1]).toMatchObject({ calls: 0 })
  })

  it('pins the stored row date to the storage key', async () => {
    const table = tableFixture()
    const recorder = createZhihuUsageRecorder(table)
    await recorder.record({ ok: true, results: 2 })
    const row = table.rows.get(dayKey())
    expect(row).toMatchObject({ date: dayKey(), calls: 1, results: 2 })
  })

  it('rejects out-of-range day counts', async () => {
    const recorder = createZhihuUsageRecorder(tableFixture())
    await expect(recorder.read(0)).rejects.toThrow('days must be at least 1')
    await expect(recorder.read(91)).rejects.toThrow('days must be no more than 90')
  })
})
