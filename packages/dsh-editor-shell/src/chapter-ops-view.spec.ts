import { describe, expect, it } from 'vitest'
import { PROPOSAL_MARKER, parseProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import {
  PROPOSAL_VERSION,
  anchorOccurrences,
  basenameOf,
  buildMergeProposal,
  buildSplitProposal,
  dirnameOf,
  isMarkdownChapterPath,
  isValidChapterFileName,
  neighbourChapters,
  normalizeChapterFileName,
  paragraphAt,
  suggestSplitName,
} from './chapter-ops-view.ts'

describe('chapter-ops-view', () => {
  it('suggests 下 for titled chapters and -2 for numeric stems, skipping names already in the tree', () => {
    expect(suggestSplitName('正文/第三章.md', ['正文/第一章.md', '正文/第三章.md'])).toBe('正文/第三章-下.md')
    expect(suggestSplitName('正文/003.md', ['正文/003.md'])).toBe('正文/003-2.md')
    expect(suggestSplitName('正文/第一卷/003.md', ['正文/第一卷/003.md', '正文/第一卷/003-2.md'])).toBe('正文/第一卷/003-3.md')
    expect(suggestSplitName('正文/第三章.md', ['正文/第三章.md', '正文/第三章-下.md'])).toBe('正文/第三章-下2.md')
    expect(suggestSplitName('正文/序章.txt', [])).toBe('正文/序章-下.md')
  })

  it('counts non-overlapping anchor occurrences', () => {
    expect(anchorOccurrences('abcabcabc', 'abc')).toBe(3)
    expect(anchorOccurrences('aaa', 'aa')).toBe(1)
    expect(anchorOccurrences('没有这段', '锚点')).toBe(0)
    expect(anchorOccurrences('唯一锚点。', '唯一锚点。')).toBe(1)
    expect(anchorOccurrences('x', '')).toBe(0)
  })

  it('returns previous and next chapters in the given natural order', () => {
    const ordered = ['正文/001.md', '正文/002.txt', '正文/003.md']
    expect(neighbourChapters('正文/002.txt', ordered)).toEqual({ previous: '正文/001.md', next: '正文/003.md' })
    expect(neighbourChapters('正文/001.md', ordered)).toEqual({ next: '正文/002.txt' })
    expect(neighbourChapters('正文/003.md', ordered)).toEqual({ previous: '正文/002.txt' })
    expect(neighbourChapters('正文/缺失.md', ordered)).toEqual({})
  })

  it('builds split and merge markers the host parser accepts', () => {
    const split = buildSplitProposal({
      path: '正文/001.md',
      anchor: '### 转折',
      newPath: '正文/001-2.md',
      summary: '拆出后半',
    })
    const merge = buildMergeProposal({
      path: '正文/001.md',
      sourcePath: '正文/002.md',
      summary: '并入上一章',
    })
    expect(split).toEqual({
      marker: PROPOSAL_MARKER,
      version: PROPOSAL_VERSION,
      kind: 'split',
      summary: '拆出后半',
      path: '正文/001.md',
      anchor: '### 转折',
      newPath: '正文/001-2.md',
    })
    expect(merge).toEqual({
      marker: PROPOSAL_MARKER,
      version: PROPOSAL_VERSION,
      kind: 'merge',
      summary: '并入上一章',
      path: '正文/001.md',
      sourcePath: '正文/002.md',
    })
    expect(parseProposalMarker(JSON.stringify(split))?.kind).toBe('split')
    expect(parseProposalMarker(JSON.stringify(merge))?.kind).toBe('merge')
  })

  it('takes the paragraph (line) at the caret, skipping blank lines forward', () => {
    const text = '第一段\n\n第二段\n第三段\n'
    expect(paragraphAt(text, 0)).toBe('第一段')
    expect(paragraphAt(text, 2)).toBe('第一段')
    expect(paragraphAt(text, 3)).toBe('第二段')
    expect(paragraphAt(text, 7)).toBe('第二段')
    expect(paragraphAt(text, text.indexOf('第三'))).toBe('第三段')
    expect(paragraphAt(text, text.length)).toBe('第三段')
    expect(paragraphAt('', 0)).toBe('')
    expect(paragraphAt('\n\n', 0)).toBe('')
  })

  it('validates new chapter file names with the tree entry rules', () => {
    expect(isMarkdownChapterPath('正文/003.md')).toBe(true)
    expect(isMarkdownChapterPath('正文/003.txt')).toBe(false)
    expect(isMarkdownChapterPath('大纲/003.md')).toBe(false)
    expect(normalizeChapterFileName('第三章-下')).toBe('第三章-下.md')
    expect(normalizeChapterFileName('第三章-下.md')).toBe('第三章-下.md')
    expect(normalizeChapterFileName('第三章-下.txt')).toBe('')
    expect(isValidChapterFileName('第三章-下')).toBe(true)
    expect(isValidChapterFileName('003-2.md')).toBe(true)
    expect(isValidChapterFileName('../x.md')).toBe(false)
    expect(isValidChapterFileName('.hidden.md')).toBe(false)
    expect(isValidChapterFileName('con.md')).toBe(false)
    expect(isValidChapterFileName('a/b.md')).toBe(false)
    expect(dirnameOf('正文/第一卷/003.md')).toBe('正文/第一卷')
    expect(basenameOf('正文/第一卷/003.md')).toBe('003.md')
  })
})
