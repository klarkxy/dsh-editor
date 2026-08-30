import { describe, expect, it } from 'vitest'
import { referenceQuery } from './reference-navigation.ts'

describe('reference navigation query', () => {
  it('prefers a bounded editor selection', () => {
    expect(referenceQuery('人物卡/阿明.md', '# 阿明\n\n港口旧友', 6, 10)).toEqual({ query: '港口旧友', needsInput: false })
  })

  it('falls back to the first heading and then the filename', () => {
    expect(referenceQuery('世界书/港口.md', '---\ntriggers: [港口]\n---\n# 海关港\n', 0, 0)).toEqual({ query: '海关港', needsInput: false })
    expect(referenceQuery('人物卡/阿明.md', '# 阿明 #\n', 0, 0)).toEqual({ query: '阿明', needsInput: false })
    expect(referenceQuery('人物卡/阿明.md', '没有标题', 0, 0)).toEqual({ query: '阿明', needsInput: false })
  })

  it('requires explicit input for generic index documents', () => {
    expect(referenceQuery('人物卡/人物索引.md', '# 人物索引', 0, 0)).toEqual({ needsInput: true })
    expect(referenceQuery('世界书/设定总汇.md', '# 设定总汇', 0, 0)).toEqual({ needsInput: true })
  })

  it('does not create automatic queries for unrelated documents', () => {
    expect(referenceQuery('正文/001.md', '# 第一章', 0, 0)).toEqual({ needsInput: true })
  })
})
