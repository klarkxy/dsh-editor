import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { dayKey, recentDayKeys, resolveDays } from './usage.ts'

/** Daily counters for zhihu tool executions (search/global search/hot list/ask/knowledge). `results` accumulates returned items on successful calls. */
export type ZhihuDailyUsage = {
  date: string
  calls: number
  failures: number
  results: number
}

/** Metering payload emitted by dsh-editor-novel-kernel after each zhihu_search execution. */
export type ZhihuSearchEvent = { ok: boolean; results?: number }

const dailyRowSchema = z.object({
  date: z.string(),
  calls: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  results: z.number().int().nonnegative(),
})

export const zhihuUsageDomainSpec = defineDomain({
  name: 'dsh_editor_zhihu_usage',
  version: 1,
  tables: { daily: domainTable<string, z.infer<typeof dailyRowSchema>>(dailyRowSchema) },
})

function int(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function emptyDay(date: string): ZhihuDailyUsage {
  return { date, calls: 0, failures: 0, results: 0 }
}

/** Fold one zhihu_search execution into a daily row. */
export function mergeZhihuUsage(day: ZhihuDailyUsage | undefined, event: ZhihuSearchEvent): ZhihuDailyUsage {
  const next: ZhihuDailyUsage = day ? { ...day } : emptyDay('')
  next.calls += 1
  if (event.ok) next.results += int(event.results)
  else next.failures += 1
  return next
}

export interface ZhihuUsageTableLike {
  get(key: string): z.infer<typeof dailyRowSchema> | undefined
  put(key: string, value: z.infer<typeof dailyRowSchema>): Promise<void>
}

export interface ZhihuUsageRecorder {
  record(event: ZhihuSearchEvent): Promise<void>
  read(days: number): Promise<ZhihuDailyUsage[]>
}

/** Read-modify-write adapter over a storage-domain table, mirroring `createUsageRecorder`. */
export function createZhihuUsageRecorder(table: ZhihuUsageTableLike): ZhihuUsageRecorder {
  return {
    async record(event) {
      const date = dayKey()
      let stored: z.infer<typeof dailyRowSchema> | undefined
      try {
        stored = table.get(date)
      } catch {
        stored = undefined
      }
      const merged = mergeZhihuUsage(stored, event)
      await table.put(date, { ...merged, date })
    },
    async read(days) {
      const count = resolveDays(days)
      const keys = recentDayKeys(count)
      const byDate = new Map<string, ZhihuDailyUsage>()
      for (const key of keys) {
        const row = table.get(key)
        if (row) byDate.set(row.date, row)
      }
      return keys.map((date) => byDate.get(date) ?? emptyDay(date))
    },
  }
}
