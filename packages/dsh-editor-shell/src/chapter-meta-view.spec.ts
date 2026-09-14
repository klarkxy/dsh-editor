import { describe, expect, it } from 'vitest'
import { isChapterMetaPath } from './chapter-meta-view.ts'

describe('chapter meta view helpers', () => {
  it('accepts only markdown manuscript chapters', () => {
    expect(isChapterMetaPath('正文/001.md')).toBe(true)
    expect(isChapterMetaPath('正文/第二卷/003.md')).toBe(true)
    expect(isChapterMetaPath('正文/003.txt')).toBe(false)
    expect(isChapterMetaPath('世界书/港口规则.md')).toBe(false)
    expect(isChapterMetaPath('大纲/总纲.md')).toBe(false)
  })
})
