import { describe, expect, it } from 'vitest'
import type { ChapterSummary } from 'dsh-editor-workbench/contracts'
import {
  barHeight,
  chapterCharBars,
  chapterCharBuckets,
  chapterMetaMarks,
  filterChapters,
  dailyCurveSeries,
  formatCount,
  formatModifiedAt,
  scaleBar,
  weeklyCurveSeries,
} from './overview-view.ts'

function chapter(path: string, extra: Partial<ChapterSummary> = {}): ChapterSummary {
  return { path, title: path, chars: 0, empty: true, excerpt: '', modifiedAt: null, ...extra }
}

describe('overview view helpers', () => {
  it('filters chapters by title or path', () => {
    const chapters = [
      chapter('正文/001.md', { title: '雾闸' }),
      chapter('正文/002.md', { title: '回声' }),
    ]
    expect(filterChapters(chapters, '').map((item) => item.title)).toEqual(['雾闸', '回声'])
    expect(filterChapters(chapters, '回声').map((item) => item.path)).toEqual(['正文/002.md'])
    expect(filterChapters(chapters, '001').map((item) => item.path)).toEqual(['正文/001.md'])
    expect(filterChapters(chapters, '没有')).toEqual([])
  })

  it('builds chapter char bars against the current max', () => {
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

  it('marks chapters that carry beats or chapter-end state', () => {
    expect(chapterMetaMarks(undefined)).toEqual({ hasBeats: false, hasState: false })
    expect(chapterMetaMarks({ beats: 0, hasState: false })).toEqual({ hasBeats: false, hasState: false })
    expect(chapterMetaMarks({ beats: 2, hasState: true })).toEqual({ hasBeats: true, hasState: true })
    expect(chapterMetaMarks({ beats: ['阿秀在码头等船'], state: { now: '黄昏' } })).toEqual({
      hasBeats: true,
      hasState: true,
      firstBeat: '阿秀在码头等船',
    })
    expect(chapterMetaMarks({ beats: ['  ', '海关'], hasState: false })).toEqual({
      hasBeats: true,
      hasState: false,
      firstBeat: '海关',
    })
  })

  it('formats counts and missing modification times', () => {
    expect(formatCount(1240)).toBe('1,240')
    expect(formatModifiedAt(null)).toBe('—')
    expect(formatModifiedAt('not-a-date')).toBe('—')
    expect(formatModifiedAt('2026-09-07T04:05:00.000Z')).toMatch(/\d/)
  })
})
