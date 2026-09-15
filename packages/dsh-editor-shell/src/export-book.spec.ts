import { describe, expect, it } from 'vitest'
import { buildBook, chapterToBookChapter, stripInlineMarkdown, stripYamlFrontmatter } from './export-book.ts'

describe('export book model', () => {
  it('orders every collected visible document and uses the first # heading as title', () => {
    const book = buildBook([
      { path: '正文/010.md', text: '# 第十章\n\n后。\n' },
      { path: '正文/002.md', text: '# 第二章\n\n前。\n' },
      { path: '人物卡/主角.md', text: '# 忽略\n' },
    ], ' 测试作品 ')
    expect(book.title).toBe('测试作品')
    expect(book.chapters.map((item) => item.title)).toEqual(['忽略', '第二章', '第十章'])
    expect(book.chapters.map((item) => item.paragraphs.map((paragraph) => paragraph.text))).toEqual([[], ['前。'], ['后。']])
  })

  it('falls back to the filename when a chapter has no # heading', () => {
    expect(chapterToBookChapter('正文/第一卷/003.txt', '只有正文。\n').title).toBe('003')
  })

  it('strips YAML frontmatter, inline markers, and keeps inner headings as bold paragraphs', () => {
    const chapter = chapterToBookChapter('正文/004.md', [
      '---',
      'title: ignored',
      '---',
      '# 第四章',
      '',
      '他**走**进*雨*里，说 _好_。',
      '## 节内标题',
      '见[港口](https://example.com)与`灯塔`。',
      '',
    ].join('\n'))
    expect(chapter.title).toBe('第四章')
    expect(chapter.paragraphs).toEqual([
      { text: '他走进雨里，说 好。' },
      { text: '节内标题', heading: true },
      { text: '见港口与灯塔。' },
    ])
  })

  it('keeps an optional author, includes ordinary documents, and refuses a truly empty collection', () => {
    const book = buildBook([{ path: '正文/001.md', text: '# 一\n\n字。' }], '书', '作者')
    expect(book.author).toBe('作者')
    const notes = buildBook([{ path: '人物卡/主角.md', text: '忽略' }], '空书')
    expect(notes.chapters).toEqual([{ title: '主角', paragraphs: [{ text: '忽略' }] }])
    expect(() => buildBook([], '空书')).toThrow('没有可导出的文档')
    expect(() => buildBook([{ path: '.dsh-editor/作品索引.md', text: '隐藏' }], '空书')).toThrow('没有可导出的文档')
  })

  it('strips a leading YAML block and common inline markdown', () => {
    expect(stripYamlFrontmatter('---\na: 1\n---\n# 标题\n')).toBe('# 标题\n')
    expect(stripInlineMarkdown('**粗** *斜* _线_ `码` [链](http://x)')).toBe('粗 斜 线 码 链')
  })
})
