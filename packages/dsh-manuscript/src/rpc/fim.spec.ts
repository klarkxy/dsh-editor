import { describe, expect, it, vi } from 'vitest'
import { completeFim } from './fim.ts'

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
})
