import { Packer } from 'docx'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildBook } from './export-book.ts'
import { buildDocxDocument, buildDocxModel } from './export-docx.ts'

describe('docx export', () => {
  const book = buildBook([
    { path: '正文/002.md', text: '# 第二章\n\n前。\n## 小节\n续。\n' },
    { path: '正文/010.md', text: '# 第十章\n\n后。\n' },
  ], '测试作品', '作者')

  it('builds a title page plus one section per chapter with Heading1 titles', () => {
    const model = buildDocxModel(book)
    expect(model.fontSizePt).toBe(12)
    expect(model.eastAsiaFont).toBe('宋体')
    expect(model.fontFamily).toBe('Noto Serif CJK SC')
    expect(model.lineSpacing).toBe(1.5)
    expect(model.firstLineIndent).toBe(true)
    expect(model.pageBreakBetweenChapters).toBe(true)
    expect(model.sections).toHaveLength(3)
    expect(model.sections[0].paragraphs).toEqual([
      { text: '测试作品', style: 'Title' },
      { text: '作者', style: 'Normal' },
    ])
    expect(model.sections[1].paragraphs[0]).toEqual({ text: '第二章', style: 'Heading1' })
    expect(model.sections[1].paragraphs).toContainEqual({ text: '前。', style: 'Normal', firstLineIndent: true })
    expect(model.sections[1].paragraphs).toContainEqual({ text: '小节', style: 'Normal', bold: true })
    expect(model.sections[2].paragraphs[0]).toMatchObject({ text: '第十章', style: 'Heading1' })
  })

  it('can keep chapters in one section without page breaks', () => {
    const model = buildDocxModel(book, { pageBreakBetweenChapters: false, firstLineIndent: false, fontSizePt: 14, fontFamily: '楷体' })
    expect(model.sections).toHaveLength(1)
    expect(model.sections[0].paragraphs.filter((item) => item.style === 'Heading1').map((item) => item.text)).toEqual(['第二章', '第十章'])
    expect(model.sections[0].paragraphs.some((item) => item.firstLineIndent)).toBe(false)
    expect(model.fontFamily).toBe('楷体')
    expect(model.fontSizePt).toBe(14)
  })

  it('packs a non-empty docx zip that contains word/document.xml and heading styles', async () => {
    const buffer = await Packer.toBuffer(buildDocxDocument(book))
    expect(buffer.byteLength).toBeGreaterThan(100)
    const zip = await JSZip.loadAsync(buffer)
    expect(Object.keys(zip.files)).toContain('word/document.xml')
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('测试作品')
    expect(xml).toContain('第二章')
    expect(xml).toContain('Heading1')
    expect(xml).toContain('Title')
  })
})
