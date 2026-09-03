import { describe, expect, it } from 'vitest'
import { sortChapterPaths } from './project-files.ts'

describe('project file naming', () => {
  it('builds a complete natural chapter order without hidden or non-manuscript files', () => {
    expect(sortChapterPaths([
      '正文/010.md',
      '人物卡/001.md',
      '正文/002.md',
      '正文/第2卷/003.txt',
      '正文/.archive/001.md',
      '正文/第10卷/001.md',
    ])).toEqual(['正文/002.md', '正文/010.md', '正文/第2卷/003.txt', '正文/第10卷/001.md'])
  })
})
