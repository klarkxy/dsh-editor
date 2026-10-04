import { afterEach, describe, expect, it } from 'vitest'
import { resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { chatEmptyPrompt, chatPromptVoice } from './chat-empty.ts'

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
