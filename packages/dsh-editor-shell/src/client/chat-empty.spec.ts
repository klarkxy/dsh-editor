import { afterEach, describe, expect, it } from 'vitest'
import { resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { chatEmptyPrompt, partnerSuggestionKind, partnerSuggestions, partnerSuggestionTitle } from './chat-empty.ts'

afterEach(() => {
  resetLocaleForTests()
})

describe('empty conversation prompt', () => {
  it('uses the single writing voice', () => {
    expect(chatEmptyPrompt()).toBe('问问这篇稿、审一段、提议一处修改……')
    expect(chatEmptyPrompt()).not.toContain('剧情')
  })

  it('follows the UI locale', () => {
    setLocale('en')
    expect(chatEmptyPrompt()).toBe('Ask about this draft, review a passage, or request a revision…')
  })
})

describe('partner empty-state suggestions', () => {
  it('prefers the display title, then file name, then work name', () => {
    expect(partnerSuggestionTitle('大纲.md', '未名作品', '全书大纲')).toBe('全书大纲')
    expect(partnerSuggestionTitle('正文/第一章.md', '未名作品')).toBe('第一章')
    expect(partnerSuggestionTitle('正文\\第一章.md', '未名作品')).toBe('第一章')
    expect(partnerSuggestionTitle('大纲.md', '未名作品', '  ')).toBe('大纲')
    expect(partnerSuggestionTitle(undefined, '未名作品')).toBe('未名作品')
    expect(partnerSuggestionTitle(undefined, undefined)).toBe('稿件')
  })

  it('produces the three spec suggestions against 《X》', () => {
    expect(partnerSuggestions('青石镇')).toEqual([
      '审读《青石镇》的节奏',
      '检查《青石镇》里的人物称呼是否前后一致',
      '为《青石镇》之后的情节列一份提纲',
    ])
  })

  it('follows the UI locale', () => {
    setLocale('en')
    expect(partnerSuggestions('First Chapter')[0]).toContain('First Chapter')
    expect(partnerSuggestionTitle(undefined, undefined)).toBe('the draft')
  })

  it('narrows nested book-title marks inside an outer 《》 for zh', () => {
    expect(partnerSuggestions('《越共》常见问题与自检清单', 'document')[0])
      .toBe('审读《〈越共〉常见问题与自检清单》，指出含糊或重复的地方')
  })

  it('leaves 《》 untouched in en', () => {
    setLocale('en')
    expect(partnerSuggestions('《越共》常见问题与自检清单', 'document')[0])
      .toContain('"《越共》常见问题与自检清单"')
  })

  it('gives document-kind suggestions for non-chapter docs', () => {
    expect(partnerSuggestions('设定集', 'document')).toEqual([
      '审读《设定集》，指出含糊或重复的地方',
      '概括《设定集》的要点',
      '列出《设定集》里需要核实的说法',
    ])
  })
})

describe('partner suggestion kind', () => {
  it('stays chapter only for manuscript chapter files', () => {
    expect(partnerSuggestionKind('正文/第一章.md')).toBe('chapter')
    expect(partnerSuggestionKind(undefined)).toBe('document')
    expect(partnerSuggestionKind('资料/x.md')).toBe('document')
  })
})
