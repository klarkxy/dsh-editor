import { describe, expect, it, vi } from 'vitest'
import { completeFim } from './fim.ts'

describe('completeFim', () => {
  it('uses official beta completions for deepseek-official', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: '高速公路。' }] }), { status: 200 }),
    ) as unknown as typeof fetch
    const result = await completeFim({
      ctx: {
        get(name: string) {
          if (name === 'credentials') {
            return { resolve: async () => ({ value: 'sk-test' }) }
          }
          return undefined
        },
      },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      prefix: '山门雾散后，他看见',
      suffix: '一辆汽车驶过。',
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(result.route).toBe('deepseek-fim')
    expect(result.text).toBe('高速公路。')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { prompt: string; suffix: string }
    expect(body.prompt).toContain('山门雾散后')
    expect(body.suffix).toContain('汽车')
  })

  it('uses chat adapter for non-official providers', async () => {
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
      provider: 'new-api',
      model: 'deepseek-v4-flash',
      prefix: '他走进',
      suffix: '。',
      signal: new AbortController().signal,
    })
    expect(result.route).toBe('chat')
    expect(result.text).toBe('便利店的灯')
  })

  it('falls back to chat on FIM 404', async () => {
    const fetchImpl = vi.fn(async () => new Response('missing', { status: 404 })) as unknown as typeof fetch
    async function* stream() {
      yield { type: 'text-delta', text: '降级插入' }
    }
    const result = await completeFim({
      ctx: {
        get(name: string) {
          if (name === 'credentials') return { resolve: async () => ({ value: 'sk-test' }) }
          if (name === 'llm') return { stream: () => stream() }
          return undefined
        },
      },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      prefix: '前',
      suffix: '后',
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(result.route).toBe('chat')
    expect(result.text).toBe('降级插入')
  })
})
