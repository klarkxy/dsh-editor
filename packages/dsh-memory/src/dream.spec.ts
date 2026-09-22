import { describe, expect, it } from 'vitest'
import {
  assertDreamApply, DREAM_SYSTEM, dreamSourceVersion, earliestExpiry, isDreamSource, parseDreamText, snapshotRecords,
} from './dream.ts'
import type { MemoryRecord } from './contracts.ts'
import { MemoryError } from './errors.ts'

const active: MemoryRecord = {
  id: 'a', revision: 2, scope: { kind: 'project', projectId: '/w' }, kind: 'preference', status: 'active',
  title: '语气', content: '克制', tags: [], evidence: [{ sessionId: 's', seq: 1, kind: 'user' }], exceptions: [],
  source: 'user', createdAt: 1, updatedAt: 2,
}

describe('dream preview parse', () => {
  it('keeps source scope and drops global expansion', () => {
    const snapshot = snapshotRecords([active])
    const proposals = parseDreamText(JSON.stringify({
      proposals: [{ title: '合并', content: '更克制', kind: 'preference', sourceIds: ['a'] }],
    }), snapshot, { kind: 'project', projectId: '/w' })
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.scope).toEqual({ kind: 'project', projectId: '/w' })
  })

  it('hashes sourceVersion to a bounded digest and treats deletion as a CAS failure', () => {
    const snapshot = snapshotRecords([active])
    const sourceVersion = dreamSourceVersion(snapshot)
    expect(sourceVersion).toHaveLength(64)
    expect(sourceVersion).toBe(dreamSourceVersion(snapshot))
    expect(sourceVersion).not.toBe(dreamSourceVersion([{ ...snapshot[0]!, revision: 3 }]))
    expect(() => assertDreamApply({
      id: 'd1', revision: 1, sessionId: 's', status: 'preview', sourceVersion,
      snapshot, proposals: [], generation: 1, createdAt: 1, updatedAt: 1,
    }, new Map(), new Set(['a']), 1)).toThrow(MemoryError)
  })

  it('excludes expired sources and refuses apply after expiry passes', () => {
    const expired = { ...active, expiresAt: 50 }
    expect(isDreamSource(expired, 10)).toBe(true)
    expect(isDreamSource(expired, 50)).toBe(false)
    expect(isDreamSource({ ...active, kind: 'lesson' }, 10)).toBe(false)
    const snapshot = snapshotRecords([expired])
    expect(() => assertDreamApply({
      id: 'd1', revision: 1, sessionId: 's', status: 'preview', sourceVersion: dreamSourceVersion(snapshot),
      snapshot, proposals: [], generation: 1, createdAt: 1, updatedAt: 1,
    }, new Map([[expired.id, expired]]), new Set(), 100)).toThrow(/过期/)
    expect(earliestExpiry([{ expiresAt: 200 }, { expiresAt: 150 }, {}])).toBe(150)
    expect(DREAM_SYSTEM).toMatch(/Do not infer that a planned event completed merely because a date has elapsed/)
    expect(DREAM_SYSTEM).toMatch(/must not outlive its sources/)
  })
})
