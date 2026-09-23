import { describe, expect, it } from 'vitest'
import { collectFacts, deterministicBody, incomingMessagesAreRecapOnly, isRecapAuxiliary, textOf, turnEndStatus } from './log.ts'
import { RECAP_PLUGIN, type RecapLogEvent } from './contracts.ts'

function event(partial: RecapLogEvent): RecapLogEvent {
  return partial
}

/** Pinned native agent-loop shape: tool/call data.callId/name; tool/result has no data.name. */
function nativeCall(seq: number, name: string, callId: string, time = seq): RecapLogEvent {
  return event({ seq, type: 'tool/call', time, data: { turn: 1, step: 1, callId, name, arguments: '{}' } })
}

function nativeResult(
  seq: number,
  callId: string | undefined,
  text: string,
  extra?: { isError?: boolean; error?: { name?: string; code?: string } },
  time = seq,
): RecapLogEvent {
  const call = callId ?? ''
  const isError = extra?.isError === true || Boolean(extra?.error)
  return event({
    seq,
    type: 'tool/result',
    time,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'user',
        source: callId ? { kind: 'tool', callId } : { kind: 'tool' },
        content: [{
          type: 'tool-result',
          ...(callId ? { toolCallId: call } : {}),
          isError,
          content: [{ type: 'text', text }],
        }],
      },
      error: extra?.error ?? (isError ? { name: 'ToolError', code: 'failed' } : undefined),
    },
  })
}

describe('session log facts', () => {
  it('maps turn/end aborted to cancelled and error to failed, never completed', () => {
    expect(turnEndStatus({ kind: 'completed' })).toBe('completed')
    expect(turnEndStatus({ kind: 'aborted', reason: { kind: 'user' } })).toBe('cancelled')
    expect(turnEndStatus({ kind: 'error', error: { message: 'x', code: 'UNKNOWN' } })).toBe('failed')
    expect(turnEndStatus({ kind: 'interrupted' })).toBe('failed')
    expect(turnEndStatus({ kind: 'completed' })).not.toBe('cancelled')
    expect(turnEndStatus({ kind: 'aborted', reason: { kind: 'user' } })).not.toBe('completed')
  })

  it('skips recap plugin auxiliary events and does not treat proposals as applied writes', () => {
    expect(isRecapAuxiliary(event({
      seq: 4, type: 'user/message', time: 4,
      data: { source: { kind: 'plugin:@klarkxy/dsh-recap', plugin: RECAP_PLUGIN }, content: [{ type: 'text', text: '检查点' }] },
    }))).toBe(true)
    expect(incomingMessagesAreRecapOnly([{ source: { kind: 'plugin:@klarkxy/dsh-recap', plugin: RECAP_PLUGIN } }])).toBe(true)
    expect(incomingMessagesAreRecapOnly([{ source: { kind: 'plugin', plugin: RECAP_PLUGIN } }])).toBe(false)
    const facts = collectFacts('s1', [
      event({ seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } }),
      event({
        seq: 1, type: 'user/message', time: 1,
        data: { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '改这一章' }] },
      }),
      nativeCall(2, 'writing_propose', 'p'),
      nativeResult(3, 'p', '{"marker":"dsh-editor.proposal","kind":"edit"}'),
      event({
        seq: 4, type: 'user/message', time: 4,
        data: { source: { kind: 'plugin:@klarkxy/dsh-recap', plugin: RECAP_PLUGIN }, content: [{ type: 'text', text: '不应进入回顾事实' }] },
      }),
      event({ seq: 5, type: 'turn/end', time: 5, data: { turn: 1, reason: { kind: 'completed' } } }),
    ])
    expect(facts.sourceStatus).toBe('completed')
    expect(facts.proposals).toBe(1)
    expect(facts.tools).toEqual([expect.objectContaining({
      name: 'writing_propose', callId: 'p', proposedChange: true, outcome: 'unverified',
    })])
    expect(facts.constraints).toContain('工具提出的修改未确认已写入')
    expect(deterministicBody(facts)).toContain('未确认是否已写入')
    expect(deterministicBody(facts)).not.toContain('已经写入')
    expect(deterministicBody(facts)).not.toContain('已应用')
    expect(JSON.stringify(facts)).not.toContain('不应进入回顾事实')
  })

  it('pairs interleaved native tool/result by callId, recurses tool-result content, and keeps unmatched/error explicit', () => {
    const nested = { type: 'tool-result', toolCallId: 'p', isError: false, content: [{ type: 'text', text: '{"marker":"dsh-editor.proposal"}' }] }
    expect(textOf({ message: { content: [nested] } })).toContain('dsh-editor.proposal')

    const facts = collectFacts('s1', [
      event({ seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } }),
      nativeCall(1, 'writing_propose', 'p'),
      nativeCall(2, 'read', 'r'),
      nativeResult(3, 'p', '{"marker":"dsh-editor.proposal","kind":"edit"}'),
      nativeResult(4, 'r', 'file contents verified'),
      nativeCall(5, 'search', 'missing'),
      nativeResult(6, 'err', 'EACCES', { isError: true, error: { name: 'ToolError', code: 'failed' } }),
      nativeResult(7, undefined, 'orphan text'),
      nativeCall(8, 'write', 'aborted'),
      nativeResult(9, 'aborted', 'stopped', { isError: true, error: { name: 'AbortError', code: 'ABORTED' } }),
      event({ seq: 10, type: 'turn/end', time: 10, data: { turn: 1, reason: { kind: 'completed' } } }),
    ])

    expect(facts.toolCalls).toBe(4)
    expect(facts.toolResults).toBe(5)
    expect(facts.proposals).toBe(1)
    expect(facts.tools).toEqual([
      expect.objectContaining({ name: 'writing_propose', callId: 'p', proposedChange: true, outcome: 'unverified' }),
      expect.objectContaining({ name: 'read', callId: 'r', proposedChange: false, outcome: 'verified', error: false }),
      expect.objectContaining({ name: 'search', callId: 'missing', outcome: 'missing', proposedChange: false }),
      expect.objectContaining({ name: 'unknown', callId: 'err', outcome: 'failed', error: true }),
      expect.objectContaining({ name: 'unknown', outcome: 'unknown' }),
      expect.objectContaining({ name: 'write', callId: 'aborted', outcome: 'cancelled' }),
    ])
    expect(facts.tools.filter(tool => tool.name === 'read' && tool.outcome === 'verified')).toHaveLength(1)
    expect(facts.tools.some(tool => tool.name === 'writing_propose' && tool.outcome === 'verified')).toBe(false)
    expect(facts.constraints).toContain('工具提出的修改未确认已写入')
    expect(deterministicBody(facts)).toContain('writing_propose：提出修改（未确认已写入）')
    expect(deterministicBody(facts)).toContain('read：已调用')
    expect(deterministicBody(facts)).toContain('unknown：调用失败')
    expect(deterministicBody(facts)).toContain('unknown：未知')
    expect(deterministicBody(facts)).toContain('write：已取消')
    expect(deterministicBody(facts)).toContain('search：结果缺失')
    expect(deterministicBody(facts)).not.toContain('已经写入')
  })

  it('marks leftover calls cancelled on aborted turns and never claims a proposal was written', () => {
    const facts = collectFacts('s1', [
      nativeCall(0, 'writing_propose', 'p'),
      nativeCall(1, 'read', 'r'),
      event({ seq: 2, type: 'turn/end', time: 2, data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } }),
    ])
    expect(facts.sourceStatus).toBe('cancelled')
    expect(facts.proposals).toBe(1)
    expect(facts.tools).toEqual([
      expect.objectContaining({ name: 'writing_propose', callId: 'p', proposedChange: true, outcome: 'cancelled' }),
      expect.objectContaining({ name: 'read', callId: 'r', proposedChange: false, outcome: 'cancelled' }),
    ])
    expect(deterministicBody(facts)).toContain('未确认是否已写入')
    expect(deterministicBody(facts)).not.toContain('已经写入')
  })
})
