import { describe, expect, it } from 'vitest'
import { collectDocuments } from './client/export-dialog.ts'
import { buildExport, prepareExport } from './export.ts'
import type { ShellContext } from './client/shared.ts'

describe('document export', () => {
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
    expect(() => buildExport([], '空书', 'markdown')).toThrow('没有可导出的文档')
  })

  it('previews nested Markdown and TXT in natural order and keeps 正文 exports compatible', () => {
    const prepared = prepareExport([
      { path: '正文/第一卷/010.txt', text: '第十章\n\n结尾。' },
      { path: '正文/第一卷/002.md', text: '# 第二章\n\n' },
    ], '混合稿', 'text')
    expect(prepared.chapters.map((item) => item.path)).toEqual(['正文/第一卷/002.md', '正文/第一卷/010.txt'])
    expect(prepared.chapters[0]).toMatchObject({ empty: true, chars: 4 })
    expect(prepared.totalChars).toBe(prepared.chapters.reduce((sum, item) => sum + item.chars, 0))
    expect(prepared.content.indexOf('第二章')).toBeLessThan(prepared.content.indexOf('第十章'))
  })

  it('exports every visible document from a root collection and drops hidden paths', () => {
    const prepared = prepareExport([
      { path: '笔记/010.md', text: '# 后\n\n后。\n' },
      { path: '资料/说明.txt', text: '说明。' },
      { path: '笔记/002.md', text: '# 前\n\n前。\n' },
      { path: '.dsh-editor/作品索引.md', text: '隐藏' },
      { path: '笔记/.archive/旧.md', text: '隐藏' },
    ], '根目录稿', 'markdown')
    expect(prepared.chapters.map((item) => item.path)).toEqual(['笔记/002.md', '笔记/010.md', '资料/说明.txt'])
    expect(prepared.content).toContain('前。')
    expect(prepared.content).toContain('说明。')
    expect(prepared.content).not.toContain('隐藏')
  })

  it('strips chapter frontmatter before counting and exporting Markdown, and leaves TXT intact', () => {
    const prepared = prepareExport([
      {
        path: '正文/003.md',
        text: '---\nbeats: [码头]\nstate:\n  now: 黄昏\n---\n# 第三章\n\n正文。\n',
      },
      {
        path: '笔记/备忘.txt',
        text: '---\nkeep: true\n---\n原文。\n',
      },
    ], '有封面', 'markdown')
    expect(prepared.chapters.find((item) => item.path === '正文/003.md')).toMatchObject({ empty: false, chars: 7 })
    expect(prepared.chapters.map((item) => item.path)).toEqual(['笔记/备忘.txt', '正文/003.md'])
    expect(prepared.content).toContain('# 第三章')
    expect(prepared.content).toContain('正文。')
    expect(prepared.content).not.toContain('beats:')
    expect(prepared.content).not.toContain('now: 黄昏')
    expect(prepared.content).toContain('---\nkeep: true\n---\n原文。')
  })
})

describe('collectDocuments', () => {
  function mockCtx(tree: Record<string, { name: string; type: 'file' | 'directory' }[]>, texts: Record<string, string>): ShellContext {
    return {
      connection: {
        rpc: {
          call: async (_channel: string, method: string, body: { path?: string }) => {
            if (method === 'tree.list') {
              const path = !body.path || body.path === '.' ? '' : body.path
              return { ok: true, value: { entries: tree[path] ?? [] } }
            }
            if (method === 'file.read') {
              return { ok: true, value: { text: texts[body.path ?? ''] ?? '' } }
            }
            return { ok: false, error: { code: 'internal', message: method, details: {} } }
          },
        },
      },
    } as never
  }

  it('recursively collects a nested author folder in natural order and skips hidden segments', async () => {
    const ctx = mockCtx({
      笔记: [
        { name: '卷一', type: 'directory' },
        { name: '.cache', type: 'directory' },
        { name: '.secret.md', type: 'file' },
      ],
      '笔记/卷一': [
        { name: '010.md', type: 'file' },
        { name: '002.md', type: 'file' },
        { name: '封面.jpg', type: 'file' },
      ],
      '笔记/.cache': [{ name: '旧.md', type: 'file' }],
    }, {
      '笔记/卷一/010.md': '后',
      '笔记/卷一/002.md': '前',
    })
    const collected = await collectDocuments(ctx, 's1', '笔记')
    expect(collected.map((item) => item.path)).toEqual(['笔记/卷一/002.md', '笔记/卷一/010.md'])
    expect(collected.map((item) => item.text)).toEqual(['前', '后'])
  })

  it('collects the project root and still exports a 正文 folder as the old novel manuscript', async () => {
    const ctx = mockCtx({
      '': [
        { name: '正文', type: 'directory' },
        { name: '人物卡', type: 'directory' },
        { name: '.dsh-editor', type: 'directory' },
        { name: 'AGENTS.md', type: 'file' },
      ],
      正文: [{ name: '010.md', type: 'file' }, { name: '002.md', type: 'file' }],
      人物卡: [{ name: '主角.md', type: 'file' }],
      '.dsh-editor': [{ name: '作品索引.md', type: 'file' }],
    }, {
      '正文/010.md': '后',
      '正文/002.md': '前',
      '人物卡/主角.md': '卡',
      'AGENTS.md': '规则',
    })
    const root = await collectDocuments(ctx, 's1', '')
    expect(root.map((item) => item.path)).toEqual(['人物卡/主角.md', '正文/002.md', '正文/010.md', 'AGENTS.md'])
    const manuscript = await collectDocuments(ctx, 's1', '正文')
    expect(manuscript.map((item) => item.path)).toEqual(['正文/002.md', '正文/010.md'])
  })
})
