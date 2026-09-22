import { describe, expect, it } from 'vitest'
import { compactMemoryState, memoryStateOverCapacity, protectedTombstoneIds } from './capacity.ts'
import { defaultSettings, type DreamPlan, type MemoryPersistedState, type MemoryRecord, type MemoryTombstone } from './contracts.ts'
import { MAX_MEMORY_DREAMS, MAX_MEMORY_RECORDS, MAX_MEMORY_TOMBSTONES } from './storage.ts'

function record(id: string, patch: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id, revision: 1, scope: { kind: 'project', projectId: '/w' }, kind: 'preference', status: 'active',
    title: 't', content: 'c', tags: [], evidence: [], exceptions: [], source: 'user', createdAt: 1, updatedAt: 1,
    ...patch,
  }
}

function dream(id: string, patch: Partial<DreamPlan> = {}): DreamPlan {
  return {
    id, revision: 1, sessionId: 's1', status: 'applied', sourceVersion: 'v', snapshot: [], proposals: [],
    generation: 0, createdAt: 1, updatedAt: 1, ...patch,
  }
}

function tombstone(id: string, deletedAt = 1): MemoryTombstone {
  return { id, deletedAt, lastRevision: 1 }
}

function state(patch: Partial<MemoryPersistedState> = {}): MemoryPersistedState {
  return { settings: defaultSettings(), records: [], tombstones: [], dreams: [], ...patch }
}

describe('compactMemoryState', () => {
  it('drops only the oldest terminal dreams and keeps preview, running, and newer history', () => {
    const next = state({
      dreams: [
        dream('old-applied', { status: 'applied', createdAt: 1, updatedAt: 1 }),
        dream('old-cancelled', { status: 'cancelled', createdAt: 2, updatedAt: 2 }),
        dream('preview', { status: 'preview', createdAt: 3, updatedAt: 3 }),
        dream('running-stale', { status: 'stale', createdAt: 4, updatedAt: 4 }),
        ...Array.from({ length: MAX_MEMORY_DREAMS - 1 }, (_, index) => dream(`kept-${index}`, {
          status: 'failed', createdAt: 10 + index, updatedAt: 10 + index,
        })),
      ],
    })
    compactMemoryState(next, new Set(['running-stale']))
    expect(next.dreams).toHaveLength(MAX_MEMORY_DREAMS)
    expect(next.dreams.map(plan => plan.id)).toEqual([
      'preview',
      'running-stale',
      ...Array.from({ length: MAX_MEMORY_DREAMS - 2 }, (_, index) => `kept-${index + 1}`),
    ])
    expect(memoryStateOverCapacity(next)).toBe(false)
  })

  it('evicts only oldest unreferenced tombstones and protects basis, supersedes, dream refs, and jobs', () => {
    const next = state({
      records: [
        record('candidate', {
          status: 'candidate',
          basis: [{ id: 'basis-src', revision: 1 }],
          supersedes: ['super-src'],
        }),
      ],
      dreams: [
        dream('preview', {
          status: 'preview',
          snapshot: [{ id: 'snap-src', revision: 1, status: 'active', scope: { kind: 'global' } }],
          proposals: [{
            title: '合并', content: 'x', kind: 'preference', tags: [], exceptions: [], evidence: [],
            sourceIds: ['proposal-src'], scope: { kind: 'global' },
          }],
        }),
      ],
      tombstones: [
        tombstone('old-free', 1),
        tombstone('basis-src', 2),
        tombstone('super-src', 3),
        tombstone('snap-src', 4),
        tombstone('proposal-src', 5),
        tombstone('job-ref', 6),
        ...Array.from({ length: MAX_MEMORY_TOMBSTONES - 5 }, (_, index) => tombstone(`pad-${index}`, 10 + index)),
      ],
    })
    compactMemoryState(next, new Set(['job-ref']))
    const ids = next.tombstones.map(row => row.id)
    expect(next.tombstones).toHaveLength(MAX_MEMORY_TOMBSTONES)
    expect(ids).not.toContain('old-free')
    expect(ids).toEqual(expect.arrayContaining(['basis-src', 'super-src', 'snap-src', 'proposal-src', 'job-ref']))
  })

  it('does not drop authored records or shrink arrays that already fit', () => {
    const records = Array.from({ length: MAX_MEMORY_RECORDS }, (_, index) => record(`r${index}`))
    const next = state({
      records,
      dreams: [dream('applied'), dream('preview', { status: 'preview' })],
      tombstones: [tombstone('gone')],
    })
    compactMemoryState(next)
    expect(next.records).toHaveLength(MAX_MEMORY_RECORDS)
    expect(next.dreams.map(plan => plan.id)).toEqual(['applied', 'preview'])
    expect(next.tombstones).toEqual([tombstone('gone')])
    expect(memoryStateOverCapacity(next)).toBe(false)
    expect(memoryStateOverCapacity(state({ records: [...records, record('overflow')] }))).toBe(true)
  })

  it('collects protected refs from surviving records and retained dreams', () => {
    const ids = protectedTombstoneIds(state({
      records: [record('live', { basis: [{ id: 'b1', revision: 2 }], supersedes: ['s1'] })],
      dreams: [dream('d1', {
        snapshot: [{ id: 'snap', revision: 1, status: 'active', scope: { kind: 'global' } }],
        proposals: [{
          title: 'p', content: 'c', kind: 'decision', tags: [], exceptions: [], evidence: [],
          sourceIds: ['src'], scope: { kind: 'global' },
        }],
      })],
    }), new Set(['job']))
    expect([...ids].sort()).toEqual(['b1', 'job', 's1', 'snap', 'src'])
  })
})
