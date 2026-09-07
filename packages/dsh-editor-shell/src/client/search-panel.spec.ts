import { describe, expect, it } from 'vitest'
import { groupSearchHits, paperRevealRange, type SearchHit } from './search-panel.ts'

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
})
