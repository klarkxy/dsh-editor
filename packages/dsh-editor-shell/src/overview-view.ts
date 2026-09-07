import type { ChapterStatus, ChapterSummary, ProgressDay, ProgressWeek, ProjectOverview } from 'dsh-editor-workbench/contracts'
import { formatNumber, intlLocale, t } from './i18n/index.ts'
import { localDateKey } from './writing-progress.ts'

export type { ChapterStatus }

export const CHAPTER_STATUSES = ['draft', 'revising', 'final'] as const

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  get draft() { return t('status.draft') },
  get revising() { return t('status.revising') },
  get final() { return t('status.final') },
}

const CHAR_BUCKETS = [
  { id: 'empty', max: 0 },
  { id: 'short', max: 2_000 },
  { id: 'medium', max: 8_000 },
  { id: 'long', max: Number.POSITIVE_INFINITY },
] as const

function charBucketLabel(id: (typeof CHAR_BUCKETS)[number]['id']): string {
  if (id === 'empty') return t('overview.bucketEmpty')
  if (id === 'short') return '1–2,000'
  if (id === 'medium') return '2,001–8,000'
  return '8,000+'
}

export function chapterStatusLabel(status: ChapterStatus): string {
  return CHAPTER_STATUS_LABELS[status] ?? CHAPTER_STATUS_LABELS.draft
}

export function chapterStatusGlyph(status: ChapterStatus): string {
  if (status === 'revising') return t('status.glyphRevising')
  if (status === 'final') return t('status.glyphFinal')
  return t('status.glyphDraft')
}

export function isChapterDocumentPath(path: string): boolean {
  return /^正文\/.+\.(?:md|txt)$/i.test(path)
}

/** Flatten project.overview into path → status for tree badges. Later entries win. */
export function buildChapterStatusMap(overview: ProjectOverview | null | undefined): Record<string, ChapterStatus> {
  const result: Record<string, ChapterStatus> = {}
  if (!overview) return result
  for (const chapter of overview.chapters) {
    if (!isChapterDocumentPath(chapter.path)) continue
    result[chapter.path] = chapter.status
  }
  return result
}

export function applyChapterStatus(overview: ProjectOverview, path: string, status: ChapterStatus): ProjectOverview {
  const chapters = overview.chapters.map((chapter) => chapter.path === path ? { ...chapter, status } : chapter)
  const byStatus: Record<ChapterStatus, number> = { draft: 0, revising: 0, final: 0 }
  for (const chapter of chapters) byStatus[chapter.status]++
  const recentChapters = overview.recentChapters.map((chapter) => chapter.path === path ? { ...chapter, status } : chapter)
  const recent = overview.recent && overview.recent.path === path ? { ...overview.recent, status } : overview.recent
  return { ...overview, chapters, recentChapters, recent, totals: { ...overview.totals, byStatus } }
}

export type StatusBar = { status: ChapterStatus; label: string; count: number; ratio: number }

export function statusDistributionBars(byStatus: Record<ChapterStatus, number>): StatusBar[] {
  const total = CHAPTER_STATUSES.reduce((sum, status) => sum + Math.max(0, byStatus[status] ?? 0), 0)
  return CHAPTER_STATUSES.map((status) => {
    const count = Math.max(0, byStatus[status] ?? 0)
    return { status, label: chapterStatusLabel(status), count, ratio: scaleBar(count, total) }
  })
}

/** Map a value onto 0–1 against `max`. Zero max or non-positive values stay at 0. */
export function scaleBar(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0
  return Math.min(1, value / max)
}

export function barHeight(ratio: number, maxPx: number): number {
  if (!(ratio > 0) || !(maxPx > 0)) return 0
  return Math.max(2, Math.round(ratio * maxPx))
}

export type ChapterCharBar = { path: string; title: string; chars: number; empty: boolean; ratio: number }

export function chapterCharBars(chapters: readonly Pick<ChapterSummary, 'path' | 'title' | 'chars' | 'empty'>[]): ChapterCharBar[] {
  const max = chapters.reduce((current, chapter) => Math.max(current, chapter.chars), 0)
  return chapters.map((chapter) => ({
    path: chapter.path,
    title: chapter.title,
    chars: chapter.chars,
    empty: chapter.empty,
    ratio: scaleBar(chapter.chars, max),
  }))
}

export type CharBucket = { id: string; label: string; count: number; ratio: number }

export function chapterCharBuckets(chapters: readonly Pick<ChapterSummary, 'chars' | 'empty'>[]): CharBucket[] {
  const counts = { empty: 0, short: 0, medium: 0, long: 0 }
  for (const chapter of chapters) {
    if (chapter.empty || chapter.chars <= 0) { counts.empty++; continue }
    if (chapter.chars <= 2_000) counts.short++
    else if (chapter.chars <= 8_000) counts.medium++
    else counts.long++
  }
  const max = Math.max(counts.empty, counts.short, counts.medium, counts.long)
  return CHAR_BUCKETS.map((bucket) => ({
    id: bucket.id,
    label: charBucketLabel(bucket.id),
    count: counts[bucket.id],
    ratio: scaleBar(counts[bucket.id], max),
  }))
}

export type CurveBar = {
  key: string
  label: string
  chars: number
  delta: number
  today: boolean
  ratio: number
}

function shiftLocalDate(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return localDateKey(new Date(year!, month! - 1, day! + days))
}

export function dailyCurveSeries(days: readonly ProgressDay[], today: string, span = 30): CurveBar[] {
  const byDate = new Map(days.map((row) => [row.date, row]))
  const rows: Array<{ date: string; chars: number; delta: number }> = []
  for (let offset = span - 1; offset >= 0; offset--) {
    const date = shiftLocalDate(today, -offset)
    const row = byDate.get(date)
    rows.push({ date, chars: row?.chars ?? 0, delta: row?.delta ?? 0 })
  }
  const max = rows.reduce((current, row) => Math.max(current, Math.abs(row.delta)), 0)
  return rows.map((row) => ({
    key: row.date,
    label: row.date.slice(5),
    chars: row.chars,
    delta: row.delta,
    today: row.date === today,
    ratio: scaleBar(Math.abs(row.delta), max),
  }))
}

export function weeklyCurveSeries(weeks: readonly ProgressWeek[], count = 12): CurveBar[] {
  const rows = weeks.slice(-count)
  const max = rows.reduce((current, row) => Math.max(current, Math.abs(row.delta)), 0)
  return rows.map((row) => ({
    key: row.weekStart,
    label: row.weekStart.slice(5),
    chars: row.chars,
    delta: row.delta,
    today: false,
    ratio: scaleBar(Math.abs(row.delta), max),
  }))
}

export function formatCount(value: number): string {
  return formatNumber(Math.max(0, Math.floor(value)))
}

export function formatModifiedAt(iso: string | null): string {
  if (!iso) return t('common.emDash')
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return t('common.emDash')
  return new Date(stamp).toLocaleString(intlLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
