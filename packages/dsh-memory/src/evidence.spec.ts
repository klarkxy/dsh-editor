import { describe, expect, it } from 'vitest'
import { assertCreatable, assertNoSilentGlobal } from './evidence.ts'
import { MemoryError } from './errors.ts'
import type { NewMemoryRecord } from './contracts.ts'

function base(patch: Partial<NewMemoryRecord> = {}): NewMemoryRecord {
  return {
    scope: { kind: 'project', projectId: '/work/novel' },
    kind: 'preference',
    status: 'candidate',
    title: '语气',
    content: '少用感叹号',
    tags: [],
    evidence: [],
    exceptions: [],
    source: 'memory',
    ...patch,
  }
}

describe('candidate policy', () => {
  it('allows explicit manual user adds without evidence', () => {
    expect(() => assertCreatable(base({ source: 'user' }))).not.toThrow()
  })

  it('rejects silent preference inference without evidence', () => {
    expect(() => assertCreatable(base({ source: 'memory' }))).toThrow(MemoryError)
  })

  it('allows evidence-grounded dream candidates and forbids silent global', () => {
    expect(() => assertCreatable(base({
      source: 'dream',
      evidence: [{ sessionId: 's', seq: 3, kind: 'user', excerpt: '少用感叹号' }],
    }))).not.toThrow()
    expect(() => assertNoSilentGlobal(false, undefined)).toThrow(/全局/)
    expect(() => assertNoSilentGlobal(true, undefined)).not.toThrow()
  })
})
