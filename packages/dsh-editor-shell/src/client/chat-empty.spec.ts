import { afterEach, describe, expect, it } from 'vitest'
import { resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { chatEmptyPrompt, chatPromptVoice, partnerSuggestions, partnerSuggestionTitle } from './chat-empty.ts'

afterEach(() => {
  resetLocaleForTests()
})

describe('empty conversation prompt', () => {
  it('keeps general writing off the novel voice', () => {
    expect(chatPromptVoice('dsh-editor-writing')).toBe('writing')
    expect(chatPromptVoice(undefined)).toBe('writing')
    expect(chatEmptyPrompt('dsh-editor-writing')).toBe('问问这篇稿、审一段、提议一处修改……')
    expect(chatEmptyPrompt('dsh-editor-writing')).not.toContain('剧情')
  })

  it('keeps plot language for fiction and legacy sessions', () => {
    expect(chatPromptVoice('dsh-editor-novel')).toBe('novel')
    expect(chatEmptyPrompt('dsh-editor-novel')).toContain('剧情')
    expect(chatEmptyPrompt('dsh-editor')).toContain('对质人物')
    expect(chatEmptyPrompt('dsh-editor-article')).toContain('结构')
    expect(chatEmptyPrompt('dsh-editor-technical')).toContain('文档')
  })

  it('follows the UI locale', () => {
    setLocale('en')
    expect(chatEmptyPrompt('dsh-editor-writing')).toBe('Ask about this draft, review a passage, or request a revision…')
    expect(chatEmptyPrompt('dsh-editor-novel')).toContain('plot')
  })
})

describe('partner empty-state suggestions', () => {
  it('uses the document title without its extension', () => {
    expect(partnerSuggestionTitle('正文/第一章.md', '未名作品')).toBe('第一章')
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
})
