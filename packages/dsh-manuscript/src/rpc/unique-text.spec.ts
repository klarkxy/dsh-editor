import { describe, expect, it } from 'vitest'
import { countOccurrences, findUniqueIndex } from './unique-text.ts'

describe('unique text location', () => {
  it('counts overlapping needles instead of skipping the whole match', () => {
    expect(countOccurrences('她哈哈哈地笑了。', '哈哈')).toBe(2)
    expect(findUniqueIndex('她哈哈哈地笑了。', '哈哈')).toBe(-2)
  })

  it('accepts a single exact occurrence and rejects a missing needle', () => {
    expect(findUniqueIndex('她哈哈地笑了。', '哈哈')).toBe(1)
    expect(countOccurrences('她哈哈地笑了。', '哈哈')).toBe(1)
    expect(findUniqueIndex('她笑了。', '哈哈')).toBe(-1)
    expect(countOccurrences('她笑了。', '哈哈')).toBe(0)
  })

  it('treats an empty needle as missing rather than matching every index', () => {
    expect(findUniqueIndex('正文', '')).toBe(-1)
    expect(countOccurrences('正文', '')).toBe(0)
  })
})
