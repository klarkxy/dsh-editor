import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { isReferencePath, lookupReferences, normalizeReferenceQuery } from './reference-lookup.ts'
import type { SearchHit, SearchResponse } from './search-panel.tsx'

const hit = (path: string, start = 0): SearchHit => ({ path, start, end: start + 2, line: 1, column: start + 1, excerpt: '娜娜在城里', version: 'v1' })
const response = (results: SearchHit[] = [], overrides: Partial<SearchResponse> = {}): SearchResponse => ({ results, scannedFiles: 1, scannedBytes: 20, skipped: 0, truncated: false, ...overrides })

describe('on-demand reference lookup', () => {
  it.each(['', '  ', '甲\n乙', '甲\t乙', 'x'.repeat(121), '甲\0乙'])('rejects invalid/oversized query %j', (query) => {
    expect(normalizeReferenceQuery(query)).toBeNull()
  })
  it('trims edges but treats punctuation as literal text', () => {
    expect(normalizeReferenceQuery('  娜娜.*  ')).toBe('娜娜.*')
  })
  it.each(['正文/娜娜.md', '人物卡/../密钥.md', '/人物卡/娜娜.md', '人物卡/.隐藏.md', '人物卡//娜娜.md', '人物卡\\娜娜.md', '世界书/娜娜.json', '人物卡/x:y.md'])('rejects non-reference paths: %s', (path) => {
    expect(isReferencePath(path)).toBe(false)
  })
  it('accepts ordinary nested Markdown and TXT references', () => {
    expect(isReferencePath('人物卡/第一卷/娜娜.MD')).toBe(true)
    expect(isReferencePath('世界书/设定.txt')).toBe(true)
  })
  it('does not call search for absent optional folders', async () => {
    const search = vi.fn()
    expect((await lookupReferences({ query: '娜娜', files: ['正文/第一章.md'], search })).candidates).toEqual([])
    expect(search).not.toHaveBeenCalled()
  })
  it('searches only existing reference folders and preserves homonyms as separate files', async () => {
    const files = ['人物卡/卷一/娜娜.md', '人物卡/卷二/娜娜.md', '世界书/王城.md', '正文/娜娜.md']
    const search = vi.fn(async (directory: string) => directory === '世界书' ? response([hit('世界书/王城.md')]) : response())
    const result = await lookupReferences({ query: '娜娜', files, search })
    expect(search.mock.calls.map(([directory]) => directory)).toEqual(['人物卡', '世界书'])
    expect(result.candidates.map((candidate) => candidate.path)).toEqual(files.slice(0, 3))
    expect(result.candidates[2]!.hit!.version).toBe('v1')
  })
  it('deduplicates repeated matches in a file and rejects out-of-scope host hits', async () => {
    const result = await lookupReferences({ query: '娜娜', files: ['人物卡/娜娜.md'], search: async () => response([
      hit('人物卡/娜娜.md'), hit('人物卡/娜娜.md', 10), hit('正文/娜娜.md'), hit('世界书/娜娜.md'), hit('人物卡/../秘密.md'),
    ]) })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]!.hit!.start).toBe(0)
    expect(result.skipped).toBe(3)
  })
  it('reports partial failure rather than claiming that no reference exists', async () => {
    const result = await lookupReferences({ query: '娜娜', files: ['人物卡/娜娜.md', '世界书/城.md'], search: async (directory) => {
      if (directory === '人物卡') throw new Error('Denied')
      return response([hit('世界书/城.md')], { truncated: true, skipped: 2 })
    } })
    expect(result.failures).toEqual([{ directory: '人物卡', message: 'Denied' }])
    expect(result.candidates).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(result.skipped).toBe(2)
  })
  it('bounds candidate rendering while retaining filename-only matches', async () => {
    const files = Array.from({ length: 70 }, (_, index) => `人物卡/娜娜${index}.md`)
    const result = await lookupReferences({ query: '娜娜', files, search: async () => response() })
    expect(result.candidates).toHaveLength(50)
    expect(result.truncated).toBe(true)
  })
  it('forwards cancellation and discards replies after a dialog closes', async () => {
    const controller = new AbortController()
    let finish!: (value: SearchResponse) => void
    const search = vi.fn((_directory: string, _query: string, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal)
      return new Promise<SearchResponse>((resolve) => { finish = resolve })
    })
    const pending = lookupReferences({ query: '娜娜', files: ['人物卡/娜娜.md'], search, signal: controller.signal })
    controller.abort()
    finish(response([hit('人物卡/娜娜.md')]))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects invalid input before any RPC', async () => {
    const search = vi.fn()
    await expect(lookupReferences({ query: 'a\nb', files: ['人物卡/a.md'], search })).rejects.toThrow()
    expect(search).not.toHaveBeenCalled()
  })
  it('keeps lookup read-only and routes navigation through existing host controls', () => {
    const dialog = readFileSync(new URL('./reference-lookup-dialog.tsx', import.meta.url), 'utf8')
    const root = readFileSync(new URL('./root.tsx', import.meta.url), 'utf8')
    const editor = readFileSync(new URL('./editor.tsx', import.meta.url), 'utf8')
    expect(dialog).toContain("'search.text'")
    expect(dialog).not.toMatch(/'file\.(write|create)'|'patch\.complete'|'fim\.complete'/)
    expect(dialog).toContain('active = false; controller.abort()')
    expect(root).toContain('onOpenReference={openDocument}')
    expect(root).toContain('onPinReference={setPinnedPath}')
    expect(editor).toContain('handleRef.current?.selectParagraph?.(target ?? undefined)')
    expect(editor).toContain('handleRef.current?.isTargetCurrent(target)')
  })
})
