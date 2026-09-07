import { describe, expect, it } from 'vitest'
import { createMemoryContext } from './test-helpers.ts'
import { compileContext } from './context.ts'
import { parseProjectContextEnvelope } from './contracts.ts'

const fixed = {
  '项目总览.md': '项目',
  '大纲/总纲.md': '大纲',
  '人物卡/人物索引.md': '人物',
  '世界书/设定总汇.md': '总汇',
  '.dsh-editor/作品索引.md': '索引',
}

describe('authority-bound context compiler', () => {
  it('keeps fixed order and independent total budget', async () => {
    const context = createMemoryContext({ '项目总览.md': 'a'.repeat(5000), '大纲/总纲.md': 'b'.repeat(5000), '人物卡/人物索引.md': 'c'.repeat(5000), '世界书/设定总汇.md': 'd', '.dsh-editor/作品索引.md': 'e' })
    const compiled = await compileContext(context, '请求')
    expect(compiled.receipt.sources.map((item) => item.path)).toEqual(['项目总览.md', '大纲/总纲.md', '人物卡/人物索引.md', '世界书/设定总汇.md', '.dsh-editor/作品索引.md'])
    expect(compiled.receipt.sources.reduce((sum, item) => sum + item.includedChars, 0)).toBe(12_000)
    expect(JSON.parse(compiled.serialized).version).toBe(2)
  })

  it('normalizes Renderer author preferences into a bounded canonical field', async () => {
    const compiled = await compileContext(createMemoryContext(fixed), '继续', undefined, '  保持克制\r\n少用感叹号\u0000  ')
    expect(compiled.envelope).toMatchObject({ user_request: '继续', author_preferences: '保持克制\n少用感叹号' })
    expect(compiled.receipt.authorPreferencesChars).toBe('保持克制\n少用感叹号'.length)
    expect(parseProjectContextEnvelope(compiled.serialized)).toEqual(compiled.envelope)
  })

  it('matches visible worldbook files through the saved active document', async () => {
    const context = createMemoryContext({
      ...fixed,
      '正文/001.md': '众人抵达海关，等待检查。',
      '世界书/港口.md': '---\ntriggers: [港口, 海关]\nenabled: true\npriority: 8\n---\n港口规则',
      '世界书/.隐藏.md': '海关秘密',
      '世界书/关闭.md': '---\ntriggers: [海关]\nenabled: false\npriority: 10\n---\n关闭',
    })
    const compiled = await compileContext(context, '继续这一段', '正文/001.md')
    const dynamic = compiled.receipt.sources.filter((item) => item.kind === 'worldbook')
    expect(dynamic).toHaveLength(1)
    expect(dynamic[0]).toMatchObject({ path: '世界书/港口.md', matchedBy: 'saved-document', priority: 8 })
    expect(compiled.receipt.scan).toMatchObject({ scanned: 2, disabled: 1, readErrors: 0 })
  })

  it('counts malformed and oversized candidates without blocking the fixed context', async () => {
    const context = createMemoryContext({
      ...fixed,
      '世界书/坏格式.md': '---\npriority: 2\n---\n正文',
      '世界书/过大.md': '港口'.repeat(40_000),
    })
    const compiled = await compileContext(context, '港口')
    expect(compiled.receipt.sources.filter((item) => item.kind === 'fixed')).toHaveLength(5)
    expect(compiled.receipt.sources.filter((item) => item.kind === 'worldbook')).toHaveLength(0)
    expect(compiled.receipt.scan).toMatchObject({ scanned: 2, invalid: 1, limits: 1 })
  })

  it('stops candidate reads when the aggregate 512 KiB scan budget is exhausted', async () => {
    const candidates = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
      `世界书/港口-${String(index).padStart(2, '0')}.md`,
      '港'.repeat(21_845) + 'a',
    ]))
    const context = createMemoryContext({ ...fixed, ...candidates })
    const compiled = await compileContext(context, '港口')
    const readPaths = (context.fs as unknown as { readPaths: string[] }).readPaths
    expect(readPaths.filter((path) => path.includes('/世界书/港口-'))).toHaveLength(8)
    expect(compiled.receipt.scan).toMatchObject({ scanned: 9, limits: 1 })
  })

  it('never treats a case-variant fixed setting summary as dynamic', async () => {
    const context = createMemoryContext({ ...fixed, '世界书/设定总汇.MD': '设定总汇' })
    const compiled = await compileContext(context, '设定总汇')
    expect(compiled.receipt.sources.filter((item) => item.kind === 'worldbook')).toHaveLength(0)
  })

  it('keeps high-directory-limit Host output canonical and parseable', async () => {
    const manyDirectories = Object.fromEntries(Array.from({ length: 1_100 }, (_, index) => [
      `世界书/目录-${String(index).padStart(4, '0')}/ignore.txt`,
      '',
    ]))
    const compiled = await compileContext(createMemoryContext({ ...fixed, ...manyDirectories }), '继续')
    expect(compiled.receipt.scan?.limits).toBe(1_024)
    expect(parseProjectContextEnvelope(compiled.serialized)).toEqual(compiled.envelope)
  })

  it('injects chapter_context from the current beats and the previous chapter state', async () => {
    const context = createMemoryContext({
      ...fixed,
      '正文/1.md': '---\nstate:\n  now: 第一日\n  open: 铜牌\n---\n# 第一章\n前文\n',
      '正文/2.md': '---\nbeats: [码头等船, 海关暗记]\n---\n# 第二章\n后文\n',
    })
    const compiled = await compileContext(context, '继续写', '正文/2.md')
    expect(compiled.envelope).toMatchObject({
      version: 2,
      chapter_context: {
        path: '正文/2.md',
        beats: ['码头等船', '海关暗记'],
        previous: { path: '正文/1.md', state: { now: '第一日', open: '铜牌' } },
      },
    })
    expect(compiled.receipt.chapterContext).toEqual({ path: '正文/2.md', beats: 2, previousPath: '正文/1.md' })
    expect(parseProjectContextEnvelope(compiled.serialized)).toEqual(compiled.envelope)
  })

  it('omits chapter_context for a non-chapter path or when nothing is available', async () => {
    const withWorldbook = createMemoryContext({
      ...fixed,
      '正文/1.md': '---\nstate:\n  now: 第一日\n---\n# 一\n',
      '世界书/港口.md': '---\ntriggers: [港口]\nenabled: true\npriority: 1\n---\n港口',
    })
    const nonChapter = await compileContext(withWorldbook, '港口', '世界书/港口.md')
    expect(nonChapter.envelope).not.toHaveProperty('chapter_context')
    expect(nonChapter.receipt.chapterContext).toBeUndefined()

    const emptyChapter = await compileContext(createMemoryContext({
      ...fixed,
      '正文/001.md': '# 第一章\n\n正文',
    }), '继续', '正文/001.md')
    expect(emptyChapter.envelope).not.toHaveProperty('chapter_context')
    expect(parseProjectContextEnvelope(emptyChapter.serialized)).toEqual(emptyChapter.envelope)
  })

  it('rejects oversized chapter_context through the V2 parser', async () => {
    const compiled = await compileContext(createMemoryContext({
      ...fixed,
      '正文/2.md': '---\nbeats: [码头]\n---\n# 二\n',
    }), '继续', '正文/2.md')
    const forged = JSON.parse(compiled.serialized) as { chapter_context: { beats: string[] } }
    forged.chapter_context.beats = ['x'.repeat(121)]
    expect(parseProjectContextEnvelope(JSON.stringify(forged))).toBeUndefined()
    const tooMany = JSON.parse(compiled.serialized) as { chapter_context: { beats: string[] } }
    tooMany.chapter_context.beats = Array.from({ length: 13 }, (_, index) => `节拍${index}`)
    expect(parseProjectContextEnvelope(JSON.stringify(tooMany))).toBeUndefined()
    expect(parseProjectContextEnvelope(compiled.serialized)).toEqual(compiled.envelope)
  })
})
