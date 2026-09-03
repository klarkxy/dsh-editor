import { describe, expect, it } from 'vitest'
import { normalizeNovelSearchArguments, renderNovelSearch, runNovelSearch, type SearchFs } from './search-tool.ts'

function memoryFs(tree: Record<string, string | Record<string, string>>): SearchFs {
  const walk = (scope: string): Array<{ name: string; type: 'file' | 'directory' }> => {
    const prefix = scope ? `${scope}/` : ''
    const seen = new Map<string, 'file' | 'directory'>()
    for (const key of Object.keys(tree)) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const [head, ...tail] = rest.split('/')
      if (!head || seen.has(head)) continue
      seen.set(head, tail.length ? 'directory' : 'file')
    }
    return [...seen.entries()].map(([name, type]) => ({ name, type }))
  }
  return {
    resolve: async (path) => ({ targetKey: path, displayPath: path }),
    readText: async (target) => {
      const value = tree[target.targetKey]
      if (typeof value !== 'string') throw new Error('not found')
      return value
    },
    listDir: async (target) => walk(target.targetKey === '.' ? '' : target.targetKey),
  }
}

const fs = memoryFs({
  '正文/001.md': '第一章\n她提着灯走过长街。',
  '正文/002.md': '第二章\n长街尽头是码头。',
  '大纲/总纲.md': '# 总纲\n长街意象贯穿全书。',
  '封面.md~skip': '',
  '.dsh-editor/作品索引.md': '隐藏文件不应被扫描',
  'notes.txt': '非 Markdown 不扫描',
})

describe('novel_search', () => {
  it('validates arguments', () => {
    expect(normalizeNovelSearchArguments({ query: '长街' })).toEqual({ query: '长街', path: undefined })
    expect(normalizeNovelSearchArguments({ query: '长街', path: '正文' })).toEqual({ query: '长街', path: '正文' })
    expect(() => normalizeNovelSearchArguments({ query: ' ' })).toThrow('query')
    expect(() => normalizeNovelSearchArguments({ query: 'x', path: '../out' })).toThrow('相对路径')
  })
  it('finds matches across project Markdown with line numbers and context, skipping hidden and non-md files', async () => {
    const result = await runNovelSearch({ query: '长街' }, fs, { signal: new AbortController().signal, cwd: '/project' })
    expect(result.matches.map((match) => `${match.path}:${match.line}`)).toEqual(['正文/001.md:2', '正文/002.md:2', '大纲/总纲.md:2'])
    expect(result.matches.find((match) => match.path === '大纲/总纲.md')?.excerpt).toContain('长街意象贯穿全书')
    expect(result.truncated).toBe(false)
    expect(JSON.stringify(result)).not.toContain('隐藏文件')
  })
  it('scopes to a subdirectory or single file when path is given', async () => {
    const scoped = await runNovelSearch({ query: '长街', path: '正文' }, fs, { signal: new AbortController().signal, cwd: '/project' })
    expect(scoped.matches.map((match) => match.path)).toEqual(['正文/001.md', '正文/002.md'])
    const single = await runNovelSearch({ query: '长街', path: '正文/002.md' }, fs, { signal: new AbortController().signal, cwd: '/project' })
    expect(single.matches.map((match) => match.path)).toEqual(['正文/002.md'])
  })
  it('reports an empty result readably', async () => {
    const result = await runNovelSearch({ query: '不存在词' }, fs, { signal: new AbortController().signal, cwd: '/project' })
    expect(result.matches).toEqual([])
    expect(renderNovelSearch(result)).toContain('没有找到')
  })
})
