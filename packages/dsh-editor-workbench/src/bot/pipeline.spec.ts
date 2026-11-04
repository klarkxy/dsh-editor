import { describe, expect, it } from 'vitest'
import { buildHandoff, SUMMARY_TEMPLATE, TAIL_TEMPLATE, VERBATIM_TEMPLATE, selectTailText } from './pipeline.ts'
import { BOT_INIT_SENTINEL } from '../contracts/channel.ts'
import { estimateTokens, type BotHistoryRow } from './transcript.ts'
import { emptyBotState } from './state.ts'

function rows(count: number, chars = 20): BotHistoryRow[] {
  const out: BotHistoryRow[] = []
  for (let index = 0; index < count; index++) {
    out.push({ seq: index * 2, role: index % 2 === 0 ? 'user' : 'assistant', text: 'x'.repeat(chars) + `${index}`, time: index })
  }
  return out
}

describe('handoff pipeline', () => {
  it('uses verbatim when the whole transcript fits', async () => {
    const result = await buildHandoff({
      transcript: rows(4, 10), storedHandoff: undefined, summarize: async () => '不应调用',
      sourceSessionId: 's1', state: emptyBotState(),
    })
    expect(result.mode).toBe('verbatim')
    expect(result.text).toContain('以下是本作品之前对话的原文')
    expect(result.text).toContain('作者：')
  })

  it('returns no text when the source has no transcript', async () => {
    const result = await buildHandoff({ transcript: [], summarize: async () => 'x', sourceSessionId: 's1', state: emptyBotState() })
    expect(result).toEqual({ mode: 'verbatim', text: undefined })
  })

  it('prefers a stored handoff that covers the transcript', async () => {
    const big = rows(900, 100)
    const lastSeq = big.at(-1)!.seq
    const result = await buildHandoff({
      transcript: big,
      storedHandoff: { sessionId: 's1', coversThroughSeq: lastSeq, summary: '已存摘要' },
      summarize: async () => '不该调用', sourceSessionId: 's1', state: emptyBotState(),
    })
    expect(result.mode).toBe('stored')
    expect(result.text).toContain('<handoff>\n已存摘要\n</handoff>')
    expect(result.text).toContain('conversation_search')
  })

  it('falls back to a fresh summary when the stored one is stale or absent', async () => {
    const big = rows(900, 100)
    const result = await buildHandoff({
      transcript: big, storedHandoff: { sessionId: 's1', coversThroughSeq: 1, summary: '旧' },
      summarize: async () => '新摘要', sourceSessionId: 's1', state: emptyBotState(),
    })
    expect(result.mode).toBe('summarized')
    expect(result.text).toContain('新摘要')
  })

  it('uses tail when summary fails', async () => {
    const big = rows(900, 100)
    const result = await buildHandoff({
      transcript: big, summarize: async () => undefined, sourceSessionId: 's1', state: emptyBotState(),
    })
    expect(result.mode).toBe('tail')
    expect(result.text).toContain('更早的对话没有整理成摘要')
  })

  it('templates match the specified text', () => {
    expect(VERBATIM_TEMPLATE).toBe('以下是本作品之前对话的原文，不是作者的新消息。\n\n{transcript}')
    expect(TAIL_TEMPLATE.startsWith('以下是本作品之前对话最近几轮的原文，不是作者的新消息。更早的对话没有整理成摘要')).toBe(true)
    expect(SUMMARY_TEMPLATE).toContain('{summary}')
    void BOT_INIT_SENTINEL
  })
})

describe('tail selection', () => {
  it('takes newest exchanges within budget', () => {
    const exchanges = [
      [{ seq: 2, role: 'user' as const, text: '新' + 'x'.repeat(50), time: 2 }],
      [{ seq: 1, role: 'user' as const, text: '中' + 'x'.repeat(50), time: 1 }],
      [{ seq: 0, role: 'user' as const, text: '旧' + 'x'.repeat(50), time: 0 }],
    ]
    const text = selectTailText(exchanges, 25)
    expect(text).toContain('新')
    expect(text).not.toContain('旧')
  })

  it('always includes the last exchange, clipped from its start when oversized', () => {
    const huge = '非常长'.repeat(5000)
    const exchanges = [[{ seq: 0, role: 'user' as const, text: huge, time: 0 }]]
    const text = selectTailText(exchanges, 500)
    expect(text.length).toBeGreaterThan(0)
    expect(text.length).toBeLessThan(huge.length)
    expect(estimateTokens(text)).toBeLessThanOrEqual(500)
  })
})
