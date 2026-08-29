import { describe, expect, it } from 'vitest'
import { documentTemplate, nextChapterPath, nextDocumentPath, sortChapterPaths } from './project-files.ts'

describe('project file naming', () => {
  it('allocates stable numeric chapters', () => {
    expect(nextChapterPath(['正文/001.md', '正文/007.md', 'notes.md'])).toBe('正文/008.md')
  })

  it('sanitizes document names and avoids collisions', () => {
    expect(nextDocumentPath('character', '阿/明', [])).toBe('人物卡/阿-明.md')
    expect(nextDocumentPath('world', '魔法', ['世界书/魔法.md', '世界书/魔法-2.md'])).toBe('世界书/魔法-3.md')
  })

  it('creates useful Markdown templates', () => {
    expect(documentTemplate('outline', '第一卷')).toContain('## 关键事件')
    expect(documentTemplate('character', '阿明')).toContain('## 知情边界')
  })

  it('builds a complete natural chapter order without hidden or non-manuscript files', () => {
    expect(sortChapterPaths([
      '\u6b63\u6587/010.md',
      '\u4eba\u7269\u5361/001.md',
      '\u6b63\u6587/002.md',
      '\u6b63\u6587/\u7b2c2\u5377/003.txt',
      '\u6b63\u6587/.archive/001.md',
      '\u6b63\u6587/\u7b2c10\u5377/001.md',
    ])).toEqual(['\u6b63\u6587/002.md', '\u6b63\u6587/010.md', '\u6b63\u6587/\u7b2c2\u5377/003.txt', '\u6b63\u6587/\u7b2c10\u5377/001.md'])
  })
})
