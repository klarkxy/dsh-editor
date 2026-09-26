import { afterEach, describe, expect, it } from 'vitest'
import { resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { chatEmptyPrompt, chatPromptVoice, manuscriptDisplayTitle } from './chat-empty.ts'

afterEach(() => {
  resetLocaleForTests()
})

describe('empty conversation prompt', () => {
  it('names the open manuscript and keeps general writing off the novel voice', () => {
    expect(manuscriptDisplayTitle('笔记/如何评价阶跃最新的 Step 5 Preview.md')).toBe('如何评价阶跃最新的 Step 5 Preview')
    expect(manuscriptDisplayTitle(undefined)).toBe('')
    expect(chatPromptVoice('dsh-editor-writing')).toBe('writing')
    expect(chatPromptVoice(undefined)).toBe('writing')
    const prompt = chatEmptyPrompt('dsh-editor-writing', '如何评价阶跃最新的 Step 5 Preview.md')
    expect(prompt.empty).toContain('如何评价阶跃最新的 Step 5 Preview')
    expect(prompt.empty).not.toContain('剧情')
    expect(prompt.placeholder).not.toContain('对质人物')
  })

  it('keeps plot language for fiction and legacy sessions', () => {
    expect(chatEmptyPrompt('dsh-editor-novel', '正文/001.md').empty).toContain('剧情')
    expect(chatEmptyPrompt('dsh-editor', '正文/001.txt').placeholder).toContain('对质人物')
    expect(chatEmptyPrompt('dsh-editor-article', '稿.md').empty).toContain('结构')
    expect(chatEmptyPrompt('dsh-editor-technical', '说明.md').placeholder).toContain('文档')
  })

  it('follows the UI locale', () => {
    setLocale('en')
    const prompt = chatEmptyPrompt('dsh-editor-writing', 'notes/draft.md')
    expect(prompt.empty).toContain('draft')
    expect(prompt.empty).not.toContain('plot')
    expect(chatEmptyPrompt('dsh-editor-novel', undefined).placeholder).toContain('plot')
  })
})
