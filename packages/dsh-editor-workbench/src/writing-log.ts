import type { ProgressDay, ProgressHistory, ProgressRecordResult, ProgressWeek, WritingLogEntry } from './contracts.ts'
import {
  assertWritableMetadata,
  readMetadataText,
  writeMetadataTextAtomic,
  type MetadataAccess,
} from './metadata-io.ts'

export const WRITING_LOG_PATH = '.dsh-editor/writing-log.json'
export const WRITING_LOG_MAX_DAYS = 400
export const PROGRESS_HISTORY_DEFAULT_DAYS = 30

export class WritingLogError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'BLOCKED' | 'INVALID' | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'WritingLogError'
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftLocalDate(date: Date, days: number): string {
  return localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}

function isoWeekStart(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year!, month! - 1, day)
  const weekday = date.getDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset))
}

function isSafeChars(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value) && value >= 0
}

function parseWritingLog(text: string): WritingLogEntry[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const byDate = new Map<string, WritingLogEntry>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    if (typeof row.date !== 'string' || !DATE.test(row.date) || !isSafeChars(row.chars)) continue
    const entry: WritingLogEntry = { date: row.date, chars: row.chars }
    if (typeof row.delta === 'number' && Number.isInteger(row.delta) && Number.isSafeInteger(row.delta)) {
      entry.delta = row.delta
    }
    byDate.set(entry.date, entry)
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-WRITING_LOG_MAX_DAYS)
}

function serializeWritingLog(entries: readonly WritingLogEntry[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`
}

async function loadWritingLog(access: MetadataAccess): Promise<WritingLogEntry[]> {
  const text = await readMetadataText(access.path, WRITING_LOG_PATH)
  if (text === null) return []
  return parseWritingLog(text)
}

function withDeltas(entries: readonly WritingLogEntry[]): ProgressDay[] {
  return entries.map((entry, index) => {
    const previous = entries[index - 1]
    return {
      date: entry.date,
      chars: entry.chars,
      delta: previous ? entry.chars - previous.chars : 0,
    }
  })
}

function weeklySums(days: readonly ProgressDay[]): ProgressWeek[] {
  const weeks: ProgressWeek[] = []
  for (const day of days) {
    const weekStart = isoWeekStart(day.date)
    const current = weeks.at(-1)
    if (!current || current.weekStart !== weekStart) {
      weeks.push({ weekStart, chars: day.chars, delta: day.delta })
      continue
    }
    current.chars = day.chars
    current.delta += day.delta
  }
  return weeks
}

export async function recordWritingProgress(
  access: MetadataAccess,
  totalChars: unknown,
  now: Date = new Date(),
): Promise<ProgressRecordResult> {
  if (!isSafeChars(totalChars)) throw new WritingLogError('totalChars must be a non-negative integer', 'INVALID')
  assertWritableMetadata(access)
  const today = localDateKey(now)
  const entries = await loadWritingLog(access)
  const previous = [...entries].reverse().find((entry) => entry.date < today)
  const delta = previous ? totalChars - previous.chars : 0
  const next = entries.filter((entry) => entry.date !== today)
  next.push({ date: today, chars: totalChars, delta })
  next.sort((left, right) => left.date.localeCompare(right.date))
  const capped = next.slice(-WRITING_LOG_MAX_DAYS)
  await writeMetadataTextAtomic(access.path, WRITING_LOG_PATH, serializeWritingLog(capped))
  return { date: today, chars: totalChars, delta }
}

export async function readWritingHistory(
  access: MetadataAccess,
  days: unknown = PROGRESS_HISTORY_DEFAULT_DAYS,
  now: Date = new Date(),
): Promise<ProgressHistory> {
  const window = days === undefined ? PROGRESS_HISTORY_DEFAULT_DAYS : days
  if (typeof window !== 'number' || !Number.isInteger(window) || window < 1) {
    throw new WritingLogError('days must be a positive integer', 'INVALID')
  }
  const span = Math.min(window, WRITING_LOG_MAX_DAYS)
  const entries = await loadWritingLog(access)
  const start = shiftLocalDate(now, -(span - 1))
  const today = localDateKey(now)
  const startIndex = entries.findIndex((entry) => entry.date >= start && entry.date <= today)
  if (startIndex < 0) return { days: [], weeks: [] }
  const prior = startIndex > 0 ? [entries[startIndex - 1]!] : []
  const windowed = entries.filter((entry) => entry.date >= start && entry.date <= today)
  const computed = withDeltas([...prior, ...windowed])
  const daysOut = prior.length ? computed.slice(1) : computed
  return { days: daysOut, weeks: weeklySums(daysOut) }
}
