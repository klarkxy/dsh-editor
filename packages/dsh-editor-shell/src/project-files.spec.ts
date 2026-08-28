import { describe, expect, it } from 'vitest'
import { documentTemplate, nextChapterPath, nextDocumentPath } from './project-files.ts'

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
})
