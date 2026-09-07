import { describe, expect, it } from 'vitest'
import type { ChapterSummary, ProjectOverview } from 'dsh-editor-workbench/contracts'
import {
  applyChapterStatus,
  barHeight,
  buildChapterStatusMap,
  chapterCharBars,
  chapterCharBuckets,
  chapterStatusGlyph,
  chapterStatusLabel,
  dailyCurveSeries,
  formatCount,
  formatModifiedAt,
  isChapterDocumentPath,
  scaleBar,
  statusDistributionBars,
  weeklyCurveSeries,
} from './overview-view.ts'

function chapter(path: string, extra: Partial<ChapterSummary> = {}): ChapterSummary {
  return { path, title: path, chars: 0, empty: true, excerpt: '', status: 'draft', modifiedAt: null, ...extra }
}

function overview(chapters: ChapterSummary[]): ProjectOverview {
  const byStatus = { draft: 0, revising: 0, final: 0 }
  for (const item of chapters) byStatus[item.status]++
  return {
    chapters,
    outlines: [],
    totals: { chapters: chapters.length, chars: chapters.reduce((sum, item) => sum + item.chars, 0), byStatus },
    recent: chapters[0] ?? null,
    recentChapters: chapters.slice(0, 5),
    truncated: false,
    skipped: 0,
  }
}

describe('overview view helpers', () => {
  it('maps chapter status labels and glyphs', () => {
    expect(chapterStatusLabel('draft')).toBe('草稿')
    expect(chapterStatusLabel('revising')).toBe('修订中')
    expect(chapterStatusLabel('final')).toBe('已定稿')
    expect(chapterStatusGlyph('draft')).toBe('草')
    expect(chapterStatusGlyph('revising')).toBe('修')
    expect(chapterStatusGlyph('final')).toBe('定')
  })

  it('keeps status badges on manuscript chapter paths only', () => {
    expect(isChapterDocumentPath('正文/001.md')).toBe(true)
    expect(isChapterDocumentPath('正文/第二卷/003.txt')).toBe(true)
    expect(isChapterDocumentPath('世界书/港口规则.md')).toBe(false)
    expect(isChapterDocumentPath('项目总览.md')).toBe(false)
    expect(buildChapterStatusMap(null)).toEqual({})
    expect(buildChapterStatusMap(overview([
      chapter('正文/001.md', { status: 'draft' }),
      chapter('正文/001.md', { status: 'revising' }),
      chapter('正文/第二卷/003.txt', { status: 'final' }),
      chapter('大纲/章纲.md', { status: 'draft' }),
    ]))).toEqual({
      '正文/001.md': 'revising',
      '正文/第二卷/003.txt': 'final',
    })
  })

  it('applies an optimistic status change and rebuilds the status totals', () => {
    const start = overview([
      chapter('正文/001.md', { status: 'draft', chars: 12, empty: false }),
      chapter('正文/002.md', { status: 'final', chars: 40, empty: false }),
    ])
    const next = applyChapterStatus(start, '正文/001.md', 'revising')
    expect(next.chapters[0]?.status).toBe('revising')
    expect(next.totals.byStatus).toEqual({ draft: 0, revising: 1, final: 1 })
    expect(next.recent?.status).toBe('revising')
  })

  it('builds status bars and chapter char bars against the current max', () => {
    expect(statusDistributionBars({ draft: 2, revising: 1, final: 1 })).toEqual([
      { status: 'draft', label: '草稿', count: 2, ratio: 0.5 },
      { status: 'revising', label: '修订中', count: 1, ratio: 0.25 },
      { status: 'final', label: '已定稿', count: 1, ratio: 0.25 },
    ])
    expect(statusDistributionBars({ draft: 0, revising: 0, final: 0 }).map((bar) => bar.ratio)).toEqual([0, 0, 0])
    const bars = chapterCharBars([
      { path: '正文/001.md', title: '一', chars: 100, empty: false },
      { path: '正文/002.md', title: '二', chars: 50, empty: false },
      { path: '正文/003.md', title: '三', chars: 0, empty: true },
    ])
    expect(bars.map((bar) => bar.ratio)).toEqual([1, 0.5, 0])
    expect(scaleBar(0, 10)).toBe(0)
    expect(scaleBar(5, 0)).toBe(0)
    expect(barHeight(0.5, 40)).toBe(20)
    expect(barHeight(0, 40)).toBe(0)
  })

  it('buckets chapters by empty / short / medium / long word counts', () => {
    const buckets = chapterCharBuckets([
      { chars: 0, empty: true },
      { chars: 800, empty: false },
      { chars: 2_000, empty: false },
      { chars: 4_000, empty: false },
      { chars: 12_000, empty: false },
    ])
    expect(buckets.map((bucket) => [bucket.id, bucket.count])).toEqual([
      ['empty', 1],
      ['short', 2],
      ['medium', 1],
      ['long', 1],
    ])
    expect(buckets[0]?.ratio).toBe(0.5)
    expect(buckets[1]?.ratio).toBe(1)
  })

  it('pads a 30-day writing curve and highlights today', () => {
    const series = dailyCurveSeries([
      { date: '2026-09-01', chars: 800, delta: 300 },
      { date: '2026-09-07', chars: 1100, delta: 150 },
    ], '2026-09-07', 7)
    expect(series).toHaveLength(7)
    expect(series[0]?.key).toBe('2026-09-01')
    expect(series[0]?.delta).toBe(300)
    expect(series[0]?.ratio).toBe(1)
    expect(series.at(-1)).toMatchObject({ key: '2026-09-07', today: true, delta: 150, ratio: 0.5 })
    expect(series[1]).toMatchObject({ key: '2026-09-02', delta: 0, today: false, ratio: 0 })
  })

  it('keeps the last twelve weekly sums and scales from the peak delta', () => {
    const weeks = Array.from({ length: 14 }, (_, index) => ({
      weekStart: `2026-0${index < 9 ? 1 : 2}-${String((index % 9) + 1).padStart(2, '0')}`,
      chars: 1000 + index,
      delta: index === 13 ? 80 : 20,
    }))
    const series = weeklyCurveSeries(weeks, 12)
    expect(series).toHaveLength(12)
    expect(series[0]?.key).toBe(weeks[2]!.weekStart)
    expect(series.at(-1)?.ratio).toBe(1)
    expect(series[0]?.ratio).toBe(0.25)
  })

  it('formats counts and missing modification times', () => {
    expect(formatCount(1240)).toBe('1,240')
    expect(formatModifiedAt(null)).toBe('—')
    expect(formatModifiedAt('not-a-date')).toBe('—')
    expect(formatModifiedAt('2026-09-07T04:05:00.000Z')).toMatch(/\d/)
  })
})
