import { describe, expect, it } from 'vitest'
import {
  CHAPTER_STATE_MAX_TOTAL_CHARS,
  applyChapterMeta,
  formatChapterContextText,
  parseChapterMeta,
  stripChapterFrontmatter,
  validateChapterMeta,
} from './chapter-meta.ts'

const SAMPLE = `---
beats:
  - 阿秀在码头等船
  - 林见发现海关暗记
state:
  now: 第三日黄昏
  where: 阿秀在码头，林见在关署
  knows: 阿秀不知道林见已被盯上
  ended: 林见抹去暗记
  open: 海关铜牌的来历
---
# 第三章
正文……
`

describe('parseChapterMeta', () => {
  it('parses block beats and nested state', () => {
    expect(parseChapterMeta(SAMPLE)).toEqual({
      beats: ['阿秀在码头等船', '林见发现海关暗记'],
      state: {
        now: '第三日黄昏',
        where: '阿秀在码头，林见在关署',
        knows: '阿秀不知道林见已被盯上',
        ended: '林见抹去暗记',
        open: '海关铜牌的来历',
      },
    })
  })

  it('parses inline beats and returns {} when frontmatter is absent', () => {
    expect(parseChapterMeta('---\nbeats: [码头, 海关]\n---\n# 章\n')).toEqual({ beats: ['码头', '海关'] })
    expect(parseChapterMeta('# 第三章\n正文\n')).toEqual({})
    expect(parseChapterMeta('')).toEqual({})
  })

  it('returns undefined for broken or unclosed frontmatter', () => {
    expect(parseChapterMeta('---\nbeats: [码头]\n正文')).toBeUndefined()
    expect(parseChapterMeta('---\n: not a field\n---\n正文')).toBeUndefined()
  })

  it('fail-opens oversize state instead of refusing to parse', () => {
    const now = '甲'.repeat(CHAPTER_STATE_MAX_TOTAL_CHARS + 1)
    const parsed = parseChapterMeta(`---\nstate:\n  now: ${now}\n---\n# 章\n`)
    expect(parsed).toEqual({ state: { now } })
    expect(validateChapterMeta(parsed!)).toContain('章末状态合计不能超过 300 字')
  })
})

describe('validateChapterMeta', () => {
  it('accepts the sample and rejects oversize beats or state', () => {
    expect(validateChapterMeta(parseChapterMeta(SAMPLE)!)).toEqual([])
    expect(validateChapterMeta({ beats: Array.from({ length: 13 }, (_, index) => `节拍${index}`) })).toContain('节拍最多 12 条')
    expect(validateChapterMeta({ beats: ['x'.repeat(121)] })).toContain('单条节拍不能超过 120 字')
    expect(validateChapterMeta({ state: { now: '甲'.repeat(200), where: '乙'.repeat(200) } })).toContain('章末状态合计不能超过 300 字')
  })
})

describe('applyChapterMeta', () => {
  it('round-trips a sanitized patch and writes a nested state map', () => {
    const patch = { beats: ['码头'], state: { now: '黄昏', open: '铜牌' } }
    const next = applyChapterMeta('# 第三章\n正文\n', patch)
    expect(parseChapterMeta(next)).toEqual(patch)
    expect(next).toContain('state:\n  now: 黄昏\n  open: 铜牌\n')
  })

  it('preserves BOM, CRLF, comments, and unknown keys', () => {
    const original = '\uFEFF---\r\n# 作者注\r\ncustom: keep-me\r\nbeats: [旧]\r\n---\r\n# 章\r\n'
    const next = applyChapterMeta(original, { beats: ['新'], state: { now: '此刻' } })
    expect(next.startsWith('\uFEFF')).toBe(true)
    expect(next).toContain('\r\n')
    expect(next).toContain('# 作者注')
    expect(next).toContain('custom: keep-me')
    expect(parseChapterMeta(next)).toEqual({ beats: ['新'], state: { now: '此刻' } })
  })

  it('removes beats/state and drops an empty header', () => {
    const next = applyChapterMeta(SAMPLE, { beats: [], state: {} })
    expect(next.startsWith('# 第三章')).toBe(true)
    expect(next).not.toContain('---')
    expect(parseChapterMeta(next)).toEqual({})
  })

  it('keeps unknown keys when only beats and state are cleared', () => {
    const next = applyChapterMeta('---\ncustom: keep-me\nbeats: [码头]\n---\n正文\n', { beats: [] })
    expect(next).toBe('---\ncustom: keep-me\n---\n正文\n')
    expect(parseChapterMeta(next)).toEqual({})
  })

  it('rejects a 300-char overflow with a clear error', () => {
    expect(() => applyChapterMeta('# 章\n', { state: { now: '甲'.repeat(200), where: '乙'.repeat(200) } }))
      .toThrow('章末状态合计不能超过 300 字')
  })
})

describe('stripChapterFrontmatter', () => {
  it('returns the body without a closed header, and the original text otherwise', () => {
    expect(stripChapterFrontmatter(SAMPLE)).toBe('# 第三章\n正文……\n')
    expect(stripChapterFrontmatter('# 第三章\n正文\n')).toBe('# 第三章\n正文\n')
    expect(stripChapterFrontmatter('---\nbeats: [码头]\n正文')).toBe('---\nbeats: [码头]\n正文')
  })
})

describe('formatChapterContextText', () => {
  it('formats beats and previous state, and returns empty when nothing to show', () => {
    expect(formatChapterContextText({
      beats: ['阿秀在码头等船'],
      previousPath: '正文/第二章.md',
      previousState: { now: '第三日黄昏', open: '海关铜牌的来历' },
    })).toBe([
      '【本章节拍】',
      '- 阿秀在码头等船',
      '【上一章状态】（正文/第二章.md）',
      '此刻：第三日黄昏',
      '未收伏笔：海关铜牌的来历',
    ].join('\n'))
    expect(formatChapterContextText({})).toBe('')
    expect(formatChapterContextText({ beats: ['甲'.repeat(2_000)] }).length).toBeLessThanOrEqual(1_200)
  })
})
