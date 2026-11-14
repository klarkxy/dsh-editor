import { describe, expect, it } from 'vitest'
import { sortDocumentPaths, sortChapterPaths } from '../project-files.ts'

describe('sortDocumentPaths / sortChapterPaths', () => {
  it('按自然序排出章节顺序', () => {
    const input = ['正文/第十章.md', '正文/第二章.md', '正文/第一章.md', '正文/第九章.md']
    expect(sortChapterPaths(input)).toEqual([
      '正文/第一章.md', '正文/第二章.md', '正文/第九章.md', '正文/第十章.md',
    ])
    expect(sortDocumentPaths(input)).toEqual([
      '正文/第一章.md', '正文/第二章.md', '正文/第九章.md', '正文/第十章.md',
    ])
  })

  it('排序仍只保留可见文本文档', () => {
    expect(sortDocumentPaths(['b.md', '.hidden.md', 'a.txt', 'c.png'])).toEqual(['a.txt', 'b.md'])
  })
})
