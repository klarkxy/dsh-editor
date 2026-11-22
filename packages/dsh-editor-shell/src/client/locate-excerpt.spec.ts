import { describe, expect, it } from 'vitest'
import { locateExcerpt } from './locate-excerpt.ts'

describe('locateExcerpt', () => {
  it('uses the recorded start when that range still holds the excerpt', () => {
    const text = '会议室里有人。\n\n后来改成了会议室。'
    const excerpt = '会议室'
    const later = text.lastIndexOf(excerpt)
    expect(locateExcerpt(text, excerpt, later)).toBe(later)
    expect(later).toBeGreaterThan(text.indexOf(excerpt))
  })

  it('refuses an earlier duplicate when the recorded start no longer matches', () => {
    const text = '会议室里有人。\n\n后来改成了会议室。'
    expect(locateExcerpt(text, '会议室', 99)).toBe(-1)
    expect(locateExcerpt(text, '会议室')).toBe(-1)
  })

  it('falls back to a unique occurrence when start is missing', () => {
    expect(locateExcerpt('甲。乙洽谈室。丙。', '洽谈室')).toBe('甲。乙'.length)
    expect(locateExcerpt('甲。乙洽谈室。丙。', '没有')).toBe(-1)
    expect(locateExcerpt('正文', '')).toBe(-1)
  })
})
