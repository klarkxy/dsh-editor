import { describe, expect, it } from 'vitest'
import type { TaskCheckpoint, TaskContract } from '@klarkxy/dsh-ai-services/contracts'
import {
  buildCheckpoint, checkpointInjectPayload, isCheckpointLineageStale,
  isMeaningfulCheckpointBoundary, shouldRunSemanticCheckpoint,
} from './checkpoints.ts'
import { collectFacts } from './log.ts'
import { RECAP_PLUGIN, type RecapLogEvent } from './contracts.ts'

function nativeCall(seq: number, name: string, callId: string): RecapLogEvent {
  return { seq, type: 'tool/call', time: seq, data: { turn: 1, step: 1, callId, name, arguments: '{}' } }
}

function nativeResult(seq: number, callId: string, text: string): RecapLogEvent {
  return {
    seq, type: 'tool/result', time: seq,
    data: {
      turn: 1, step: 1,
      message: {
        role: 'user', source: { kind: 'tool', callId },
        content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text }] }],
      },
    },
  }
}

function events(): RecapLogEvent[] {
  return [
    { seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } },
    nativeCall(1, 'read', 'r1'),
    nativeResult(2, 'r1', 'ok'),
    nativeCall(3, 'writing_propose', 'p'),
    nativeResult(4, 'p', '{"marker":"dsh-editor.proposal"}'),
    nativeCall(5, 'read', 'r2'),
    nativeResult(6, 'r2', 'ok'),
  ]
}

function interleaved(): RecapLogEvent[] {
  return [
    { seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } },
    nativeCall(1, 'writing_propose', 'p'),
    nativeCall(2, 'read', 'r'),
    nativeResult(3, 'p', '{"marker":"dsh-editor.proposal","kind":"edit"}'),
    nativeResult(4, 'r', 'verified contents'),
  ]
}

describe('checkpoint lineage', () => {
  it('treats a newer contract revision as stale even on the same source range', () => {
    const checkpoint: Pick<TaskCheckpoint, 'sessionId' | 'sourceVersion' | 'contractVersion' | 'toSeq'> = {
      sessionId: 's1', sourceVersion: 's1#6', contractVersion: 1, toSeq: 6,
    }
    expect(isCheckpointLineageStale(checkpoint, { sessionId: 's1', sourceVersion: 's1#6', contractVersion: 1, toSeq: 6 })).toBe(false)
    expect(isCheckpointLineageStale(checkpoint, { sessionId: 's1', sourceVersion: 's1#6', contractVersion: 2, toSeq: 6 })).toBe(true)
    expect(isCheckpointLineageStale(checkpoint, { sessionId: 's2', sourceVersion: 's1#6', contractVersion: 1, toSeq: 6 })).toBe(true)
    expect(isCheckpointLineageStale(checkpoint, { sessionId: 's1', sourceVersion: 's1#9', contractVersion: 1, toSeq: 9 })).toBe(true)
    const withoutContract = { ...checkpoint, contractVersion: undefined }
    expect(isCheckpointLineageStale(withoutContract, { sessionId: 's1', sourceVersion: 's1#6', toSeq: 6 })).toBe(false)
    expect(isCheckpointLineageStale(withoutContract, { sessionId: 's1', sourceVersion: 's1#6', contractVersion: 2, toSeq: 6 })).toBe(true)
    expect(isCheckpointLineageStale(checkpoint, { sessionId: 's1', sourceVersion: 's1#6', toSeq: 6 })).toBe(true)
  })

  it('does not inject on every tool call or on recap auxiliary messages', () => {
    const previous = buildCheckpoint(collectFacts('s1', events().slice(0, 5)), { id: 'c0', now: 1, revision: 1 })
    expect(isMeaningfulCheckpointBoundary({
      facts: collectFacts('s1', events(), 5),
      previous,
      incoming: [{ source: { kind: 'user' } }],
      step: 2,
    })).toBe(false)
    expect(isMeaningfulCheckpointBoundary({
      facts: collectFacts('s1', events()),
      previous: buildCheckpoint(collectFacts('s1', events().slice(0, 1)), { id: 'c0', now: 1, revision: 1 }),
      incoming: [{ source: { kind: 'plugin', plugin: RECAP_PLUGIN } }],
      step: 3,
    })).toBe(false)
    expect(isMeaningfulCheckpointBoundary({
      facts: collectFacts('s1', events()),
      previous: buildCheckpoint(collectFacts('s1', events().slice(0, 1)), { id: 'c0', now: 1, revision: 1 }),
      incoming: [{ source: { kind: 'user' } }],
      step: 3,
    })).toBe(true)
    const sameSource = buildCheckpoint(collectFacts('s1', events()), { id: 'c0', now: 1, revision: 1 })
    expect(isMeaningfulCheckpointBoundary({
      facts: collectFacts('s1', events()),
      previous: sameSource,
      incoming: [{ source: { kind: 'user' } }],
      step: 2,
    })).toBe(false)
    expect(isMeaningfulCheckpointBoundary({
      facts: collectFacts('s1', events()),
      previous: { ...sameSource, contractVersion: 1 },
      incoming: [{ source: { kind: 'user' } }],
      step: 2,
      contractVersion: 2,
    })).toBe(true)
    expect(isMeaningfulCheckpointBoundary({
      facts: collectFacts('s1', events()),
      previous: sameSource,
      incoming: [{ source: { kind: 'user' } }],
      step: 2,
      contractVersion: 2,
    })).toBe(true)
  })

  it('keeps deterministic constraints first and does not put recap display into the inject payload', () => {
    const facts = collectFacts('s1', events())
    const contract: TaskContract = {
      id: 't1', sessionId: 's1', sourceVersion: 's1#0', revision: 2, goal: '改章',
      deliverables: [], inScope: [], outOfScope: [], constraints: ['不要改名'],
      acceptance: [], assumptions: [], questions: [], evidence: [],
      readiness: 'user-confirmed', updatedAt: 1,
    }
    const checkpoint = buildCheckpoint(facts, { id: 'c1', now: 2, revision: 2, contract })
    expect(checkpoint.constraints[0]).toBe('不要改名')
    expect(checkpoint.constraints).toContain('工具提出的修改未确认已写入')
    expect(shouldRunSemanticCheckpoint(true, facts, contract)).toBe(true)
    expect(shouldRunSemanticCheckpoint(false, facts, contract)).toBe(false)
    const payload = checkpointInjectPayload(checkpoint)
    expect(payload.source.kind).toBe('plugin')
    expect(payload.source.plugin).toBe(RECAP_PLUGIN)
    expect(payload.content[0]?.text).toContain('未确认已写入')
    expect(payload.content[0]?.text).not.toContain('回顾 ·')
  })

  it('pairs interleaved native propose/read results and never marks a proposal as written', () => {
    const facts = collectFacts('s1', interleaved())
    expect(facts.proposals).toBe(1)
    expect(facts.tools).toEqual([
      expect.objectContaining({ name: 'writing_propose', callId: 'p', proposedChange: true, outcome: 'unverified' }),
      expect.objectContaining({ name: 'read', callId: 'r', proposedChange: false, outcome: 'verified' }),
    ])
    const checkpoint = buildCheckpoint(facts, { id: 'c1', now: 2, revision: 1 })
    expect(checkpoint.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'writing_propose：提出修改（未确认已写入）', state: 'pending' }),
      expect.objectContaining({ label: 'read', state: 'verified' }),
    ]))
    expect(checkpoint.items.some(item => item.state === 'verified' && item.label.includes('writing_propose'))).toBe(false)
    expect(checkpoint.nextAction).toBe('等待作者确认修改，不要假定已写入')
    expect(checkpointInjectPayload(checkpoint).content[0]?.text).toContain('未确认已写入')
    expect(JSON.stringify(checkpoint)).not.toContain('已经写入')
  })
})
