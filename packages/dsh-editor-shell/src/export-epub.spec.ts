import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildBook } from './export-book.ts'
import { buildEpubBlob } from './export-epub.ts'

function firstZipEntry(buffer: Uint8Array): { name: string; method: number } {
  const method = buffer[8] | (buffer[9] << 8)
  const nameLength = buffer[26] | (buffer[27] << 8)
  const name = new TextDecoder().decode(buffer.subarray(30, 30 + nameLength))
  return { name, method }
}

describe('epub export', () => {
  it('writes a valid EPUB 3 zip with uncompressed mimetype first and chapter spine order', async () => {
    const book = buildBook([
      { path: '正文/002.md', text: '# 第二章\n\n前。\n' },
      { path: '正文/010.md', text: '# 第十章\n\n后。\n' },
    ], '测试作品', '作者')
    const blob = await buildEpubBlob(book, { language: 'zh-CN' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(firstZipEntry(bytes)).toEqual({ name: 'mimetype', method: 0 })

    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
    expect(names).toEqual(expect.arrayContaining([
      'mimetype',
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/toc.ncx',
      'OEBPS/styles.css',
      'OEBPS/chapter-001.xhtml',
      'OEBPS/chapter-002.xhtml',
    ]))
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')

    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>测试作品</dc:title>')
    expect(opf).toContain('<dc:language>zh-CN</dc:language>')
    expect(opf).toMatch(/<dc:identifier id="book-id">urn:uuid:[0-9a-f-]+<\/dc:identifier>/)
    expect(opf).toContain('<dc:creator>作者</dc:creator>')
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((match) => match[1])
    expect(spine).toEqual(['chap-1', 'chap-2'])
    expect(opf.indexOf('chapter-001.xhtml')).toBeLessThan(opf.indexOf('chapter-002.xhtml'))

    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav.indexOf('第二章')).toBeLessThan(nav.indexOf('第十章'))
    const ncx = await zip.file('OEBPS/toc.ncx')!.async('string')
    expect(ncx).toContain('dtb:uid')
    expect(ncx.indexOf('第二章')).toBeLessThan(ncx.indexOf('第十章'))
  })

  it('escapes <, & and quotes so a chapter XHTML stays well-formed', async () => {
    const book = buildBook([{
      path: '正文/001.md',
      text: '# 标题 "引"\n\n他说: "a < b & c".\n',
    }], '书名 & 副标')
    const blob = await buildEpubBlob(book)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xhtml = await zip.file('OEBPS/chapter-001.xhtml')!.async('string')
    expect(xhtml).toContain('<h1>标题 &quot;引&quot;</h1>')
    expect(xhtml).toContain('<p>他说: &quot;a &lt; b &amp; c&quot;.</p>')
    expect(xhtml).not.toContain('a < b')
    expect(xhtml).not.toContain('b & c')
    expect(xhtml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xhtml).toContain('</html>')
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>书名 &amp; 副标</dc:title>')
  })
})
