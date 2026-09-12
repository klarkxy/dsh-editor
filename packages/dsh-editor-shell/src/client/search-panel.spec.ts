import { describe, expect, it } from 'vitest'
import { planReplace } from '../search-replace.ts'
import { acceptSearchResults, canReplaceAll, groupSearchHits, paperRevealRange, replaceBlockedByDirty, type SearchHit } from './search-panel.ts'

function hit(path: string, start: number, excerpt: string): SearchHit {
  return { path, line: 1, column: 1, start, end: start + excerpt.length, excerpt, version: 'v1' }
}

describe('search result grouping', () => {
  it('groups hits by file while keeping excerpt order', () => {
    const grouped = groupSearchHits([
      hit('正文/002.md', 10, '后港口'),
      hit('世界书/港口.md', 0, '港口'),
      hit('正文/002.md', 40, '再港口'),
    ])
    expect(grouped.map((group) => group.path)).toEqual(['正文/002.md', '世界书/港口.md'])
    expect(grouped[0]!.hits.map((item) => item.excerpt)).toEqual(['后港口', '再港口'])
    expect(grouped[1]!.hits).toHaveLength(1)
  })

  it('returns an empty list for no hits', () => {
    expect(groupSearchHits([])).toEqual([])
  })

  it('maps a search hit onto paper coordinates after worldbook frontmatter', () => {
    const text = '---\ntriggers: ["港口"]\nenabled: true\npriority: 1\n---\n港口规则'
    const range = paperRevealRange('世界书/港口.md', text, { start: text.indexOf('港口规则'), end: text.indexOf('港口规则') + 4 })
    expect(range.from).toBe(0)
    expect(range.to).toBe(4)
  })

  it('maps a search hit onto paper coordinates after chapter frontmatter', () => {
    const text = '---\nbeats: [码头]\n---\n港口规则'
    const range = paperRevealRange('正文/002.md', text, { start: text.indexOf('港口规则'), end: text.indexOf('港口规则') + 4 })
    expect(range.from).toBe(0)
    expect(range.to).toBe(4)
  })
})

describe('auxiliary search filtering', () => {
  it('drops AGENTS.md from accepted hits so replace never plans it', () => {
    const accepted = acceptSearchResults({
      results: [
        hit('AGENTS.md', 0, '隔离测试'),
        hit('正文/001.md', 4, '隔离测试'),
        hit('CLAUDE.md', 0, '隔离测试'),
      ],
      scannedFiles: 8,
      scannedBytes: 1200,
      skipped: 1,
      truncated: true,
    })
    expect(accepted.results.map((item) => item.path)).toEqual(['正文/001.md'])
    expect(accepted.scannedFiles).toBe(8)
    expect(accepted.skipped).toBe(1)
    expect(accepted.truncated).toBe(true)
    const plan = planReplace(accepted.results, '替换')
    expect(plan.files.map((file) => file.path)).toEqual(['正文/001.md'])
    expect(plan.files).toHaveLength(1)
  })
})

describe('replace panel helpers', () => {
  it('disables replace when there are no hits or the replacement equals the query', () => {
    expect(canReplaceAll({ query: 'foo', replacement: 'bar', hits: 0 })).toBe(false)
    expect(canReplaceAll({ query: 'foo', replacement: 'foo', hits: 3 })).toBe(false)
    expect(canReplaceAll({ query: 'foo', replacement: 'bar', hits: 3 })).toBe(true)
    expect(canReplaceAll({ query: 'Foo', replacement: 'foo', hits: 1 })).toBe(true)
  })

  it('blocks replace when the open dirty document is in the plan', () => {
    expect(replaceBlockedByDirty({ activePath: '正文/001.md', activeDirty: true, paths: ['正文/001.md'] })).toBe(true)
    expect(replaceBlockedByDirty({ activePath: '正文/001.md', activeDirty: true, paths: ['正文/002.md'] })).toBe(false)
    expect(replaceBlockedByDirty({ activePath: '正文/001.md', activeDirty: false, paths: ['正文/001.md'] })).toBe(false)
    expect(replaceBlockedByDirty({ activePath: '', activeDirty: true, paths: ['正文/001.md'] })).toBe(false)
  })
})
