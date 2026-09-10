import { describe, expect, it } from 'vitest'
import type { ChapterSummary, ProjectOverview } from 'dsh-editor-workbench/contracts'
import {
  buildChapterStatusMap,
  chapterStatusGlyph,
  chapterStatusLabel,
  isChapterDocumentPath,
} from './chapter-status-view.ts'

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

describe('chapter status tree helpers', () => {
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
})
