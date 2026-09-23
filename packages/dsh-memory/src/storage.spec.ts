import { describe, expect, it } from 'vitest'
import { defaultSettings, type DreamPlan, type MemoryRecord } from './contracts.ts'
import {
  createRpcSchema, MAX_MEMORY_DREAMS, MAX_MEMORY_RECORDS, MAX_MEMORY_TOMBSTONES, memoryStateSchema, newMemoryRecordSchema,
  storedSettings, tombstoneSchema,
} from './storage.ts'

function record(id: string): MemoryRecord {
  return {
    id, revision: 1, scope: { kind: 'global' }, kind: 'preference', status: 'active',
    title: 't', content: 'c', tags: [], evidence: [], exceptions: [], source: 'user', createdAt: 1, updatedAt: 1,
  }
}

function dream(id: string): DreamPlan {
  return {
    id, revision: 1, sessionId: 's', status: 'applied', sourceVersion: 'v', snapshot: [], proposals: [],
    generation: 0, createdAt: 1, updatedAt: 1,
  }
}

describe('memory aggregate schema bounds', () => {
  it('keeps 4096/4096/256 bounds and accepts a full valid snapshot', () => {
    expect(MAX_MEMORY_RECORDS).toBe(4096)
    expect(MAX_MEMORY_TOMBSTONES).toBe(4096)
    expect(MAX_MEMORY_DREAMS).toBe(256)
    const full = {
      settings: defaultSettings(),
      records: Array.from({ length: MAX_MEMORY_RECORDS }, (_, index) => record(`r${index}`)),
      tombstones: Array.from({ length: MAX_MEMORY_TOMBSTONES }, (_, index) => ({
        id: `t${index}`, deletedAt: index, lastRevision: 1,
      })),
      dreams: Array.from({ length: MAX_MEMORY_DREAMS }, (_, index) => dream(`d${index}`)),
    }
    expect(memoryStateSchema.safeParse(full).success).toBe(true)
    expect(memoryStateSchema.safeParse({ ...full, records: [...full.records, record('overflow')] }).success).toBe(false)
    expect(memoryStateSchema.safeParse({
      ...full, tombstones: [...full.tombstones, { id: 'overflow', deletedAt: 1, lastRevision: 1 }],
    }).success).toBe(false)
    expect(memoryStateSchema.safeParse({ ...full, dreams: [...full.dreams, dream('overflow')] }).success).toBe(false)
    expect(tombstoneSchema.safeParse({ id: 'x', deletedAt: 1, lastRevision: 0 }).success).toBe(true)
  })

  it('accepts production create payloads without an id and rejects a client-supplied id', () => {
    const body = {
      sessionId: 'live', title: '语气', content: '克制', kind: 'preference' as const,
    }
    expect(createRpcSchema.safeParse(body).success).toBe(true)
    expect(createRpcSchema.safeParse({ ...body, id: 'forged' }).success).toBe(false)
    expect(newMemoryRecordSchema.safeParse({
      scope: { kind: 'global' }, kind: 'preference', status: 'active', title: '语气', content: '克制',
      tags: [], evidence: [], exceptions: [], source: 'user',
    }).success).toBe(true)
    expect(newMemoryRecordSchema.safeParse({
      id: 'forged',
      scope: { kind: 'global' }, kind: 'preference', status: 'active', title: '语气', content: '克制',
      tags: [], evidence: [], exceptions: [], source: 'user',
    }).success).toBe(false)
  })

  it('accepts lastAttemptAt and noop dreams, and backfills legacy settings with the new default', () => {
    expect(defaultSettings().dreamIdleEnabled).toBe(true)
    const minimal = {
      settings: defaultSettings(),
      records: [],
      tombstones: [],
      dreams: [{ ...dream('d0'), status: 'noop' as const }],
      lastAttemptAt: 123,
    }
    expect(memoryStateSchema.safeParse(minimal).success).toBe(true)
    expect(memoryStateSchema.safeParse({ ...minimal, lastAttemptAt: -1 }).success).toBe(false)
    expect(memoryStateSchema.safeParse({ ...minimal, lastAttemptAt: 1.5 }).success).toBe(false)
    const legacy = { revision: 3, injectEnabled: true, idleMs: 60_000 } as unknown as Parameters<typeof storedSettings>[0]
    expect(storedSettings(legacy)).toEqual({ revision: 3, injectEnabled: true, dreamIdleEnabled: true, idleMs: 60_000 })
    expect(storedSettings(undefined).dreamIdleEnabled).toBe(true)
  })
})
