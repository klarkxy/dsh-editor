import { describe, expect, it } from 'vitest'
import { collectClaimedHumans, evidenceForRequest, incomingAreAuxiliaryOnly, isMoodMessage, sourceVersionOf } from './evidence.ts'
import { createMoodContextMessage } from './inject.ts'

describe('evidence and auxiliary filtering', () => {
  it('does not treat plugin context as a human revision', () => {
    const mood = createMoodContextMessage('约定') as { source?: { kind?: string } }
    expect(isMoodMessage(mood)).toBe(true)
    expect(incomingAreAuxiliaryOnly([mood])).toBe(true)
    expect(collectClaimedHumans([mood])).toEqual([])
  })

  it('versions claimed humans by immutable message id, not previous turn seq', () => {
    const first = { id: 'u1', source: { kind: 'user' as const }, content: [{ type: 'text', text: '改一章' }] }
    const second = { id: 'u2', source: { kind: 'user' as const }, content: [{ type: 'text', text: '改两章' }] }
    expect(sourceVersionOf(collectClaimedHumans([first]))).toBe('u1')
    expect(sourceVersionOf(collectClaimedHumans([second]))).toBe('u2')
    expect(sourceVersionOf(collectClaimedHumans([first]))).not.toBe(sourceVersionOf(collectClaimedHumans([second])))
  })

  it('does not attribute a previous logged user seq as this request evidence', () => {
    const claimed = collectClaimedHumans([{ id: 'u-new', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我改一下' }] }])
    const refs = evidenceForRequest('s1', [
      { seq: 5, type: 'user/message', data: { id: 'u-old', source: { kind: 'user' }, content: [{ type: 'text', text: '上一轮' }] } },
    ], claimed)
    expect(refs).toEqual([])
    expect(sourceVersionOf(claimed)).toBe('u-new')
    expect(sourceVersionOf(claimed)).not.toContain('5')
  })

  it('binds evidence only to the matching logged message id', () => {
    const claimed = collectClaimedHumans([{ id: 'u-new', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我改一下' }] }])
    const refs = evidenceForRequest('s1', [
      { seq: 5, type: 'user/message', data: { id: 'u-old', source: { kind: 'user' }, content: [{ type: 'text', text: '上一轮' }] } },
      { seq: 9, type: 'user/message', data: { id: 'u-new', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我改一下' }] } },
    ], claimed)
    expect(refs).toEqual([{ sessionId: 's1', seq: 9, kind: 'user', excerpt: '帮我改一下' }])
  })
})
