import { describe, expect, it } from 'vitest'
import {
  defaultCreateDirectory,
  exportDirectoryOf,
  firstOpenDocumentPath,
  isChapterDocumentPath,
  searchPathInDirectory,
  sortChapterPaths,
  sortDocumentPaths,
} from './project-files.ts'

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

  it('sorts every visible Markdown or TXT path in natural numeric order', () => {
    expect(sortDocumentPaths([
      '笔记/010.md',
      '人物卡/001.md',
      '笔记/002.txt',
      '.dsh-editor/作品索引.md',
      '封面.jpg',
      'AGENTS.md',
      '笔记/.hidden/a.md',
    ])).toEqual(['笔记/002.txt', '笔记/010.md', '人物卡/001.md', 'AGENTS.md'])
  })

  it('never auto-opens AGENTS.md and prefers a naturally ordered visible document', () => {
    expect(firstOpenDocumentPath(['AGENTS.md'])).toBeUndefined()
    expect(firstOpenDocumentPath(['AGENTS.md', '笔记/010.md', '笔记/002.txt'])).toBe('笔记/002.txt')
    expect(firstOpenDocumentPath(['正文/010.md', '资料/说明.txt'])).toBe('正文/010.md')
    expect(firstOpenDocumentPath(['文档/guide.md'])).toBe('文档/guide.md')
    expect(firstOpenDocumentPath(['guide.md'])).toBe('guide.md')
    expect(firstOpenDocumentPath(['.dsh-editor/作品索引.md'])).toBeUndefined()
    expect(firstOpenDocumentPath(['文档/.hidden.md'])).toBeUndefined()
  })

  it('picks new-file directories from tree context, then the current sibling, then the root', () => {
    expect(defaultCreateDirectory({ treeDirectory: '笔记/卷一', activePath: '正文/001.md' })).toBe('笔记/卷一')
    expect(defaultCreateDirectory({ treeDirectory: '.', activePath: '正文/001.md' })).toBe('')
    expect(defaultCreateDirectory({ treeDirectory: '', activePath: '正文/001.md' })).toBe('')
    expect(defaultCreateDirectory({ activePath: '正文/第一卷/003.md' })).toBe('正文/第一卷')
    expect(defaultCreateDirectory({ activePath: '根文档.md' })).toBe('')
    expect(defaultCreateDirectory({})).toBe('')
  })

  it('exports from the current document folder and treats a missing document as the project root', () => {
    expect(exportDirectoryOf('正文/第一卷/003.md')).toBe('正文/第一卷')
    expect(exportDirectoryOf('根文档.md')).toBe('')
    expect(exportDirectoryOf('')).toBe('')
    expect(exportDirectoryOf(undefined)).toBe('')
  })

  it('keeps search hits inside the selected folder without locking to 正文', () => {
    expect(searchPathInDirectory('笔记/卷一/002.md', '笔记')).toBe(true)
    expect(searchPathInDirectory('正文/001.md', '笔记')).toBe(false)
    expect(searchPathInDirectory('笔记/卷一/002.md', '')).toBe(true)
    expect(searchPathInDirectory('正文/001.md', '')).toBe(true)
  })

  it('treats any visible md/txt as a chapter document and excludes hidden or generated paths', () => {
    expect(isChapterDocumentPath('正文/001.md')).toBe(true)
    expect(isChapterDocumentPath('正文/第二卷/003.txt')).toBe(true)
    expect(isChapterDocumentPath('世界书/港口规则.md')).toBe(true)
    expect(isChapterDocumentPath('项目总览.md')).toBe(true)
    expect(isChapterDocumentPath('资料/说明.txt')).toBe(true)
    expect(isChapterDocumentPath('.dsh-editor/秘密.md')).toBe(false)
    expect(isChapterDocumentPath('dist/out.md')).toBe(false)
  })
})
