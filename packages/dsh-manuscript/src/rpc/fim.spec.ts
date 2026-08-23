import { describe, expect, it } from 'vitest'
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
})
