import { describe, expect, it } from 'vitest'
import { BOT_INIT_SENTINEL, estimateTokens, formatExchangeRows, transcriptExchanges, transcriptRows, type SessionEventLike } from './transcript.ts'

function user(seq: number, text: string, extra?: Partial<SessionEventLike>): SessionEventLike {
  return { seq, type: 'user/message', time: seq * 10, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] }, ...extra }
}

function assistant(seq: number, text: string, extra?: { toolCalls?: unknown[] }): SessionEventLike {
  return { seq, type: 'assistant/message', time: seq * 10, data: { content: [{ type: 'text', text }], ...extra } }
}

describe('estimateTokens', () => {
  it('counts CJK runes whole and other chars by four', () => {
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abc')).toBe(1)
    expect(estimateTokens('你abc')).toBe(2)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('transcriptRows', () => {
  it('keeps user and assistant text rows across shadowed events', () => {
    const events: SessionEventLike[] = [
      user(0, '第一句'),
      assistant(1, '回复'),
      { seq: 2, type: 'user/message', time: 20, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '被压掉的旧消息' }] }, shadowed: true } as SessionEventLike,
    ]
    const rows = transcriptRows(events)
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2])
    expect(rows[0]).toMatchObject({ role: 'user', text: '第一句', time: 0 })
  })

  it('excludes compaction checkpoints, tool calls and the init sentinel', () => {
    const events: SessionEventLike[] = [
      user(0, '正常消息'),
      { seq: 1, type: 'user/message', data: { source: { kind: 'compact-checkpoint', compactionId: 'c1' }, content: [{ type: 'text', text: 'checkpoint' }] } } as SessionEventLike,
      assistant(2, '有工具的回复', { toolCalls: [{ name: 'read' }] }),
      assistant(3, '纯文本回复'),
      user(4, `${BOT_INIT_SENTINEL}\n初始化提示`),
      { seq: 5, type: 'tool/result', data: { content: 'x' } } as SessionEventLike,
    ]
    const rows = transcriptRows(events)
    expect(rows.map((row) => row.seq)).toEqual([0, 3])
  })
})

describe('exchanges and formatting', () => {
  it('groups whole exchanges newest first', () => {
    const rows = transcriptRows([user(0, 'a'), assistant(1, 'b'), user(2, 'c'), assistant(3, 'd'), assistant(4, 'e')])
    const exchanges = transcriptExchanges(rows)
    expect(exchanges.length).toBe(2)
    expect(exchanges[0]![0]!.text).toBe('c')
    expect(exchanges[1]![0]!.text).toBe('a')
  })

  it('formats lines with role labels', () => {
    const text = formatExchangeRows([
      { seq: 0, role: 'user', text: '问', time: 0 },
      { seq: 1, role: 'assistant', text: '答', time: 1 },
    ])
    expect(text).toBe('作者：问\n\n搭档：答')
  })
})
