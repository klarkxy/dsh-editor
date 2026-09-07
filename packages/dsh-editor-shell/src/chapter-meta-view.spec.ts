import { describe, expect, it } from 'vitest'
import {
  applyChapterMeta,
  formatChapterContextText,
  parseChapterMeta,
} from 'dsh-editor-workbench/contracts'
import { applyChapterMetaSettings } from './client/chapter-meta-settings.ts'
import {
  beatsFromTextarea,
  beatsToTextarea,
  chapterContextFor,
  chapterMetaPatch,
  isChapterMetaPath,
  previousChapterPath,
  previousChapterState,
  stateTotalChars,
} from './chapter-meta-view.ts'

describe('chapter meta view helpers', () => {
  it('accepts only markdown manuscript chapters', () => {
    expect(isChapterMetaPath('正文/001.md')).toBe(true)
    expect(isChapterMetaPath('正文/第二卷/003.md')).toBe(true)
    expect(isChapterMetaPath('正文/003.txt')).toBe(false)
    expect(isChapterMetaPath('世界书/港口规则.md')).toBe(false)
    expect(isChapterMetaPath('大纲/总纲.md')).toBe(false)
  })

  it('round-trips beats through the textarea and ignores blank lines', () => {
    expect(beatsFromTextarea('码头\n海关\n\n  暗记  \n')).toEqual(['码头', '海关', '暗记'])
    expect(beatsToTextarea(['码头', '海关'])).toBe('码头\n海关')
    expect(beatsToTextarea(undefined)).toBe('')
    expect(beatsFromTextarea('')).toEqual([])
  })

  it('counts trimmed chapter-end state characters', () => {
    expect(stateTotalChars(undefined)).toBe(0)
    expect(stateTotalChars({ now: '黄昏', where: '  码头  ' })).toBe(4)
    expect(stateTotalChars({ now: '', open: '铜牌' })).toBe(2)
  })

  it('patches only changed keys and uses empty values for removal', () => {
    const current = { beats: ['码头'], state: { now: '黄昏', open: '铜牌' } }
    expect(chapterMetaPatch(current, { beats: ['码头'], state: { now: '黄昏', open: '铜牌' } })).toEqual({})
    expect(chapterMetaPatch(current, { beats: ['码头', '海关'], state: { now: '黄昏', open: '铜牌' } }))
      .toEqual({ beats: ['码头', '海关'] })
    expect(chapterMetaPatch(current, { beats: ['码头'], state: { now: '黄昏' } }))
      .toEqual({ state: { now: '黄昏' } })
    expect(chapterMetaPatch(current, { beats: [], state: {} })).toEqual({ beats: [], state: {} })
    expect(chapterMetaPatch(undefined, { beats: ['码头'], state: { now: '黄昏' } }))
      .toEqual({ beats: ['码头'], state: { now: '黄昏' } })
    expect(chapterMetaPatch({ beats: ['码头'] }, { beats: ['码头'], state: {} })).toEqual({})
  })

  it('formats current-chapter beats for FIM and ignores the current chapter state', () => {
    expect(chapterContextFor('# 第三章\n正文\n')).toBeUndefined()
    expect(chapterContextFor('---\nbeats: [码头]\n正文')).toBeUndefined()
    expect(chapterContextFor('---\nbeats: [码头]\n---\n# 章\n')).toBe(formatChapterContextText({ beats: ['码头'] }))
    expect(chapterContextFor('---\nstate:\n  now: 黄昏\n---\n# 章\n')).toBeUndefined()
  })

  it('finds the previous chapter in natural order', () => {
    const files = ['大纲/总纲.md', '正文/第10章.md', '正文/第2章.md', '正文/第1章.txt', '人物卡/林见.md']
    expect(previousChapterPath('正文/第1章.txt', files)).toBeUndefined()
    expect(previousChapterPath('正文/第2章.md', files)).toBe('正文/第1章.txt')
    expect(previousChapterPath('正文/第10章.md', files)).toBe('正文/第2章.md')
    expect(previousChapterPath('正文/第3章.md', files)).toBe('正文/第2章.md')
    expect(previousChapterPath('大纲/总纲.md', files)).toBeUndefined()
  })

  it('carries only the previous chapter end state into the FIM context', () => {
    expect(previousChapterState('正文/第1章.md', '---\nbeats: [码头]\n---\n')).toBeUndefined()
    expect(previousChapterState('正文/第1章.md', '---\nstate:\n  now: "  "\n---\n')).toBeUndefined()
    const previous = previousChapterState('正文/第1章.md', '---\nbeats: [码头]\nstate:\n  now: 黄昏\n  open: 船没靠岸\n---\n')
    expect(previous).toEqual({ path: '正文/第1章.md', state: { now: '黄昏', open: '船没靠岸' } })
    const text = chapterContextFor('---\nbeats: [海关]\n---\n# 第二章\n', previous)
    expect(text).toBe(formatChapterContextText({ beats: ['海关'], previousState: previous!.state, previousPath: '正文/第1章.md' }))
    expect(text).toContain('黄昏')
    expect(text).not.toContain('码头')
    expect(chapterContextFor('# 第二章\n', previous)).toBe(formatChapterContextText({ previousState: previous!.state, previousPath: '正文/第1章.md' }))
  })
})

describe('applyChapterMetaSettings', () => {
  it('writes a changed state field without rewriting unchanged beats', () => {
    const source = '---\ncustom: keep-me\nbeats: [码头]\n---\n# 章\n'
    const result = applyChapterMetaSettings(source, {
      beats: '码头',
      state: { now: '黄昏' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain('custom: keep-me')
    expect(parseChapterMeta(result.text)).toEqual({ beats: ['码头'], state: { now: '黄昏' } })
  })

  it('leaves the document bytes alone when the form matches the header', () => {
    const source = '---\nbeats: [码头]\n---\n# 章\n'
    const result = applyChapterMetaSettings(source, { beats: '码头', state: {} })
    expect(result).toEqual({ ok: true, text: source, note: '章纲没有改动。' })
  })

  it('removes emptied beats and state the same way applyChapterMeta does', () => {
    const source = applyChapterMeta('# 章\n', { beats: ['码头'], state: { now: '黄昏' } })
    const result = applyChapterMetaSettings(source, { beats: '', state: {} })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toBe(applyChapterMeta(source, { beats: [], state: {} }))
    expect(parseChapterMeta(result.text)).toEqual({})
  })

  it('refuses unclosed frontmatter and oversize state', () => {
    expect(applyChapterMetaSettings('---\nbeats: [码头]\n正文', { beats: '码头', state: {} }).ok).toBe(false)
    const overflow = applyChapterMetaSettings('# 章\n', {
      beats: '',
      state: { now: '甲'.repeat(200), where: '乙'.repeat(200) },
    })
    expect(overflow.ok).toBe(false)
    if (overflow.ok) return
    expect(overflow.note).toContain('章末状态合计不能超过 300 字')
  })
})
