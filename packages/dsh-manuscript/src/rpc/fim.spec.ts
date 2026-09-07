import { describe, expect, it, vi } from 'vitest'
import { CHAPTER_CONTEXT_GUIDANCE, CHAPTER_CONTEXT_LIMIT } from './author-preferences.ts'
import { completeFim } from './fim.ts'

function captured(request: ReturnType<typeof vi.fn>): { system: string; user: string; maxTokens: number } {
  const options = request.mock.calls[0]?.[0] as { system: string; maxTokens: number; messages: Array<{ content: Array<{ text: string }> }> }
  return { system: options.system, user: options.messages[0].content[0].text, maxTokens: options.maxTokens }
}

describe('completeFim', () => {
  it('always uses the DSH LLM service, including official providers', async () => {
    async function* stream() {
      yield { type: 'text-delta', text: '便利店的灯' }
    }
    const result = await completeFim({
      ctx: {
        get(name: string) {
          if (name === 'llm') return { stream: () => stream() }
          return undefined
        },
      },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      prefix: '他走进',
      suffix: '。',
      signal: new AbortController().signal,
    })
    expect(result.route).toBe('dsh-llm')
    expect(result.text).toBe('便利店的灯')
  })

  it('returns an empty completion when the DSH LLM service is unavailable', async () => {
    const result = await completeFim({
      ctx: {},
      provider: 'new-api',
      model: 'deepseek-v4-flash',
      prefix: '前',
      suffix: '后',
      signal: new AbortController().signal,
    })
    expect(result.route).toBe('dsh-llm')
    expect(result.text).toBe('')
  })

  it('adds bounded author preferences to the system guidance', async () => {
    async function* stream() { yield { type: 'text-delta', text: '续句' } }
    const request = vi.fn(() => stream())
    await completeFim({
      ctx: { get: () => ({ stream: request }) },
      provider: 'provider', model: 'model', prefix: '足够长的前文', suffix: '', authorPreferences: '少用感叹号',
      signal: new AbortController().signal,
    })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('【作者跨作品约定】\n少用感叹号') }))
  })

  it('places bounded chapterContext in the user prompt and only then guides the system prompt', async () => {
    async function* stream() { yield { type: 'text-delta', text: '续句' } }
    const request = vi.fn(() => stream())
    await completeFim({
      ctx: { get: () => ({ stream: request }) },
      provider: 'provider',
      model: 'model',
      prefix: '前文',
      suffix: '后文',
      chapterContext: `  节拍：雨夜对峙\u0007\r\n上一章：她已离开  ${'x'.repeat(1_300)}`,
      signal: new AbortController().signal,
    })
    const { system, user, maxTokens } = captured(request)
    expect(maxTokens).toBe(96)
    expect(user.startsWith('【本章工作笔记】\n节拍：雨夜对峙\n上一章：她已离开')).toBe(true)
    expect(user).toContain('\n\n【光标前】\n前文')
    expect(user.indexOf('【本章工作笔记】')).toBeLessThan(user.indexOf('【光标前】'))
    expect(system).toContain(CHAPTER_CONTEXT_GUIDANCE)
    const note = user.slice('【本章工作笔记】\n'.length, user.indexOf('\n\n【光标前】'))
    expect(note.length).toBe(CHAPTER_CONTEXT_LIMIT)
    expect(note).not.toContain('\u0007')
  })

  it('omits chapter notes and system guidance when chapterContext is empty', async () => {
    async function* stream() { yield { type: 'text-delta', text: '续句' } }
    const request = vi.fn(() => stream())
    await completeFim({
      ctx: { get: () => ({ stream: request }) },
      provider: 'provider',
      model: 'model',
      prefix: '前文',
      suffix: '后文',
      chapterContext: ' \n\t  ',
      signal: new AbortController().signal,
    })
    const { system, user } = captured(request)
    expect(user.startsWith('【光标前】')).toBe(true)
    expect(user).not.toContain('【本章工作笔记】')
    expect(system).not.toContain(CHAPTER_CONTEXT_GUIDANCE)
  })
})
