import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/** Token counts captured per model for one calendar day. `requests` is the call count for that model on that day. */
export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  requests: number
}

/** Aggregated daily usage across the active chat/fim/patch paths. `byModel` keys use the `provider/model` form. */
export type DailyUsage = {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  requests: number
  byModel: Record<string, ModelUsage>
}

export class UsageInputError extends Error {
  constructor(message: string, readonly code: 'DAYS_OUT_OF_RANGE') {
    super(message)
    this.name = 'UsageInputError'
  }
}

const modelUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
})

const dailyRowSchema = z.object({
  date: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  byModel: z.record(z.string(), modelUsageSchema),
})

export const usageDomainSpec = defineDomain({
  name: 'dsh_editor_usage',
  version: 1,
  tables: { daily: domainTable<string, z.infer<typeof dailyRowSchema>>(dailyRowSchema) },
})

/** Shape of one model-call usage event the recorder accepts; aligns with `@deepseek-ai/dsh-llm`'s `TokenUsage`. */
export type UsageChunk = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export const USAGE_DEFAULT_DAYS = 30
export const USAGE_MAX_DAYS = 90

/** Normalize a usage payload so every field is a non-negative integer, dropping anything else. */
function int(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** Local-timezone `YYYY-MM-DD` key. Pure so unit tests can pin a fixed `now`. */
export function dayKey(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function emptyDay(date: string): DailyUsage {
  return {
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    requests: 0,
    byModel: {},
  }
}

function ensureModel(day: DailyUsage, model: string): ModelUsage {
  let entry = day.byModel[model]
  if (!entry) {
    entry = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0 }
    day.byModel[model] = entry
  }
  return entry
}

/** Fold one provider-reported usage into a daily row, accumulating per-model and overall counts. */
export function mergeUsage(
  day: DailyUsage | undefined,
  model: string,
  usage: UsageChunk,
  counted: { request: boolean },
): DailyUsage {
  const next: DailyUsage = day
    ? {
        date: day.date,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        cacheReadTokens: day.cacheReadTokens,
        cacheWriteTokens: day.cacheWriteTokens,
        reasoningTokens: day.reasoningTokens,
        requests: day.requests,
        byModel: { ...day.byModel },
      }
    : emptyDay('')
  const inputTokens = int(usage.inputTokens)
  const outputTokens = int(usage.outputTokens)
  const cacheReadTokens = int(usage.cacheReadTokens)
  const cacheWriteTokens = int(usage.cacheWriteTokens)
  const reasoningTokens = int(usage.reasoningTokens)
  next.inputTokens += inputTokens
  next.outputTokens += outputTokens
  next.cacheReadTokens += cacheReadTokens
  next.cacheWriteTokens += cacheWriteTokens
  next.reasoningTokens += reasoningTokens
  if (counted.request) next.requests += 1
  const modelEntry = ensureModel(next, model)
  modelEntry.inputTokens += inputTokens
  modelEntry.outputTokens += outputTokens
  modelEntry.cacheReadTokens += cacheReadTokens
  modelEntry.cacheWriteTokens += cacheWriteTokens
  if (counted.request) modelEntry.requests += 1
  return next
}

/** Validate the `days` argument for `usage.summary`, clamping to the supported range. */
export function resolveDays(value: unknown): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : USAGE_DEFAULT_DAYS
  if (raw < 1) throw new UsageInputError('days must be at least 1', 'DAYS_OUT_OF_RANGE')
  if (raw > USAGE_MAX_DAYS) throw new UsageInputError(`days must be no more than ${USAGE_MAX_DAYS}`, 'DAYS_OUT_OF_RANGE')
  return raw
}

/** Build a date sequence of length `count` ending today, oldest first, using local time. */
export function recentDayKeys(count: number, now: Date = new Date()): string[] {
  const days: string[] = []
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(base)
    cursor.setDate(base.getDate() - offset)
    days.push(dayKey(cursor))
  }
  return days
}

/** Project stored rows onto a contiguous date range, filling missing days with zero rows. */
export function summarize(rows: Iterable<DailyUsage | undefined>, count: number, now: Date = new Date()): DailyUsage[] {
  const byDate = new Map<string, DailyUsage>()
  for (const row of rows) {
    if (!row) continue
    byDate.set(row.date, row)
  }
  return recentDayKeys(count, now).map((date) => byDate.get(date) ?? emptyDay(date))
}

export interface UsageTableLike {
  get(key: string): z.infer<typeof dailyRowSchema> | undefined
  put(key: string, value: z.infer<typeof dailyRowSchema>): Promise<void>
}

export interface UsageRecorder {
  record(modelKey: string, usage: UsageChunk, options: { request: boolean }): Promise<void>
  read(days: number): Promise<DailyUsage[]>
}

/** Read-modify-write adapter over a storage-domain table. Failures are surfaced to the caller for logging. */
export function createUsageRecorder(table: UsageTableLike): UsageRecorder {
  return {
    async record(modelKey, usage, counted) {
      const date = dayKey()
      let stored: z.infer<typeof dailyRowSchema> | undefined
      try {
        stored = table.get(date)
      } catch {
        stored = undefined
      }
      const merged = mergeUsage(stored, modelKey, usage, counted)
      // The merged row carries the date that was active when it was built; the
      // recorder is the one that knows which calendar day this belongs to, so
      // it pins the row's `date` field to match the storage key.
      await table.put(date, { ...merged, date })
    },
    async read(days) {
      const count = resolveDays(days)
      const rows: Array<z.infer<typeof dailyRowSchema> | undefined> = []
      for (const key of recentDayKeys(count)) rows.push(table.get(key))
      return summarize(rows, count)
    },
  }
}
