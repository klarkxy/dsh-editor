import { describe, expect, it } from 'vitest'
import { applyMemoryInjection, isMemoryInjectMessage, memoryInjectPayload, requestTextFromMessages, stripMemoryInjection } from './inject.ts'
import type { MemoryRecord } from './contracts.ts'

const active: MemoryRecord = {
  id: 'p1', revision: 1, scope: { kind: 'project', projectId: '/w' }, kind: 'preference', status: 'active',
  title: '语气', content: '克制', tags: [], evidence: [], exceptions: [], source: 'user', createdAt: 1, updatedAt: 1,
}

describe('pre-step injection', () => {
  it('uses plugin snapshot source, not a fake human message', () => {
    const payload = memoryInjectPayload([active])
    expect(payload.source.kind).toBe('plugin')
    expect(payload.source.plugin).toBe('@klarkxy/dsh-memory')
    expect(payload.source.form).toBe('snapshot')
    expect(payload.content[0]?.text).toContain('lessons omitted')
    expect(payload.content[0]?.text).not.toContain('[lesson')
  })

  it('preserves reject decisions and prepends after next() enter', () => {
    expect(applyMemoryInjection({ kind: 'reject' }, [active], payload => payload)).toEqual({ kind: 'reject' })
    const extra = { source: { kind: 'user' } }
    const entered = applyMemoryInjection({ kind: 'enter', messages: [extra], startsRequestSeries: true }, [active], payload => ({ injected: payload }))
    expect(entered).toEqual({
      kind: 'enter',
      startsRequestSeries: true,
      messages: [{ injected: memoryInjectPayload([active]) }, extra],
    })
  })

  it('strips prior memory snapshots when injection is off', () => {
    const snapshot = memoryInjectPayload([active])
    const other = { source: { kind: 'user' } }
    expect(isMemoryInjectMessage(snapshot)).toBe(true)
    expect(stripMemoryInjection({ kind: 'enter', messages: [snapshot, other] })).toEqual({ kind: 'enter', messages: [other] })
  })

  it('reads the latest real human request and ignores plugin snapshots', () => {
    expect(requestTextFromMessages([
      memoryInjectPayload([active]),
      { source: { kind: 'user' }, content: [{ type: 'text', text: '第一句' }] },
      { source: { kind: 'user' }, content: [{ type: 'text', text: '语气克制' }] },
    ])).toBe('语气克制')
    expect(requestTextFromMessages([memoryInjectPayload([active])])).toBe('')
  })
})
