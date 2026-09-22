import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from './contracts.ts'
import { boundRecall, estimateTokens, formatMemorySnapshot, isRecallable, relevanceScore, scopeMatches } from './recall.ts'

function record(patch: Partial<MemoryRecord> & Pick<MemoryRecord, 'id' | 'status' | 'kind'>): MemoryRecord {
  return {
    revision: 1,
    scope: { kind: 'project', projectId: '/work/a' },
    title: patch.title ?? patch.id,
    content: patch.content ?? 'x'.repeat(20),
    tags: [],
    evidence: [],
    exceptions: [],
    source: 'user',
    createdAt: 1,
    updatedAt: patch.updatedAt ?? 1,
    ...patch,
  }
}

describe('recall bounds', () => {
  it('keeps exact project scope plus explicit global, and drops lessons/candidates/expired', () => {
    expect(scopeMatches({ kind: 'global' }, { kind: 'project', projectId: '/a' })).toBe(true)
    expect(scopeMatches({ kind: 'project', projectId: '/b' }, { kind: 'project', projectId: '/a' })).toBe(false)
    expect(isRecallable(record({ id: 'c', status: 'candidate', kind: 'preference' }), 10)).toBe(false)
    expect(isRecallable(record({ id: 'e', status: 'active', kind: 'preference', expiresAt: 5 }), 10)).toBe(false)
  })

  it('caps at 5 records without padding, and ranks by query instead of recency', () => {
    const rows = [1, 2, 3, 4, 5, 6].map(index => record({
      id: `r${index}`, status: 'active', kind: 'preference', updatedAt: index, content: '短',
    }))
    expect(boundRecall(rows, 10).map(item => item.id)).toEqual(['r6', 'r5', 'r4', 'r3', 'r2'])
    const mixed = [
      record({ id: 'new', status: 'active', kind: 'preference', title: 'encoding', content: 'always write UTF-16', updatedAt: 90 }),
      record({ id: 'old', status: 'active', kind: 'preference', title: 'relative paths', content: 'use relative paths', updatedAt: 10 }),
    ]
    expect(boundRecall(mixed, 10, { query: 'please keep relative paths' }).map(item => item.id)).toEqual(['old'])
    expect(relevanceScore(mixed[1]!, 'please keep relative paths')).toBeGreaterThan(relevanceScore(mixed[0]!, 'please keep relative paths'))
  })

  it('skips oversized records instead of slicing, counting the full wrapper', () => {
    const huge = record({ id: 'huge', status: 'active', kind: 'decision', title: 'relative', content: 'path '.repeat(8_000) })
    const small = record({ id: 'small', status: 'active', kind: 'decision', title: 'relative path', content: 'keep relative paths' })
    const selected = boundRecall([huge, small], 10, { query: 'relative path' })
    expect(selected.map(item => item.id)).toEqual(['small'])
    expect(selected[0]?.content).toBe('keep relative paths')
    expect(estimateTokens(formatMemorySnapshot(selected))).toBeLessThanOrEqual(800)
    expect(formatMemorySnapshot(selected)).not.toMatch(/path path path path/)
  })
})
