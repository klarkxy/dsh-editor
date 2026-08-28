import { describe, expect, it } from 'vitest'
import { buildExport } from './export.ts'

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
})
