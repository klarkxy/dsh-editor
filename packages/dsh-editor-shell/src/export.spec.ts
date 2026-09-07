import { describe, expect, it } from 'vitest'
import { buildExport, prepareExport } from './export.ts'

describe('novel export', () => {
  const chapters = [
    { path: '正文/010.md', text: '# 第十章\n\n后。\n' },
    { path: '正文/002.md', text: '# 第二章\n\n前。\n' },
  ]

  it('merges Markdown in numeric chapter order', () => {
    const result = buildExport(chapters, '测试作品', 'markdown')
    expect(result.filename).toBe('测试作品-全文.md')
    expect(result.content.indexOf('第二章')).toBeLessThan(result.content.indexOf('第十章'))
    expect(result.content).toContain('\n---\n')
  })

  it('creates clean text without heading markers', () => {
    const result = buildExport(chapters, '测试作品', 'text')
    expect(result.filename).toBe('测试作品-全文.txt')
    expect(result.content).not.toContain('# ')
    expect(result.content).toContain('第二章\n\n前。')
  })

  it('refuses an empty manuscript', () => {
    expect(() => buildExport([], '空书', 'markdown')).toThrow('正文为空')
  })

  it('previews the same naturally ordered Markdown and TXT payload that will be downloaded', () => {
    const prepared = prepareExport([
      { path: '正文/第一卷/010.txt', text: '第十章\n\n结尾。' },
      { path: '正文/第一卷/002.md', text: '# 第二章\n\n' },
      { path: '人物卡/主角.md', text: '忽略' },
    ], '混合稿', 'text')
    expect(prepared.chapters.map((item) => item.path)).toEqual(['正文/第一卷/002.md', '正文/第一卷/010.txt'])
    expect(prepared.chapters[0]).toMatchObject({ empty: true, chars: 4 })
    expect(prepared.totalChars).toBe(prepared.chapters.reduce((sum, item) => sum + item.chars, 0))
    expect(prepared.content.indexOf('第二章')).toBeLessThan(prepared.content.indexOf('第十章'))
  })
})
