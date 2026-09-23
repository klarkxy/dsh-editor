import { describe, expect, it } from 'vitest'
import { DREAM_MIN_INTERVAL_MS, DREAM_MIN_MATERIAL } from './contracts.ts'
import { countDreamMaterial, shouldRunIdleDream } from './idle.ts'

describe('idle dream', () => {
  const base = {
    dreamIdleEnabled: true, pluginActive: true, agentIdle: true, dreamRunning: false,
    lastActivityAt: 0, now: 15 * 60_000, idleMs: 15 * 60_000,
    lastAttemptAt: undefined as number | undefined,
    materialCount: DREAM_MIN_MATERIAL,
  }

  it('runs once after idle with enough material, never while a job is already running', () => {
    expect(shouldRunIdleDream(base)).toBe(true)
    expect(shouldRunIdleDream({ ...base, dreamIdleEnabled: false })).toBe(false)
    expect(shouldRunIdleDream({ ...base, pluginActive: false })).toBe(false)
    expect(shouldRunIdleDream({ ...base, agentIdle: false })).toBe(false)
    expect(shouldRunIdleDream({ ...base, dreamRunning: true })).toBe(false)
    expect(shouldRunIdleDream({ ...base, now: 14 * 60_000 })).toBe(false)
  })

  it('backs off for 24 hours after the last attempt, including failures', () => {
    const lastAttemptAt = 15 * 60_000
    expect(shouldRunIdleDream({
      ...base, lastAttemptAt,
      now: lastAttemptAt + DREAM_MIN_INTERVAL_MS - 1,
    })).toBe(false)
    expect(shouldRunIdleDream({
      ...base, lastAttemptAt,
      now: lastAttemptAt + DREAM_MIN_INTERVAL_MS,
    })).toBe(true)
  })

  it('skips without enough new material and makes zero model calls', () => {
    expect(shouldRunIdleDream({ ...base, materialCount: DREAM_MIN_MATERIAL - 1 })).toBe(false)
    expect(shouldRunIdleDream({ ...base, materialCount: 0 })).toBe(false)
    expect(shouldRunIdleDream({ ...base, materialCount: DREAM_MIN_MATERIAL + 5 })).toBe(true)
  })

  it('counts records created or changed since the last attempt, plus tombstones', () => {
    const state = {
      records: [
        { createdAt: 10, updatedAt: 10 },
        { createdAt: 10, updatedAt: 50 },
        { createdAt: 60, updatedAt: 60 },
        { createdAt: 5, updatedAt: 5 },
      ],
      tombstones: [{ deletedAt: 70, id: 'gone', lastRevision: 1 }],
    }
    expect(countDreamMaterial(state, undefined)).toBe(4)
    expect(countDreamMaterial(state, 40)).toBe(3)
    expect(countDreamMaterial(state, 100)).toBe(0)
    expect(countDreamMaterial({ records: [], tombstones: state.tombstones }, undefined)).toBe(0)
  })
})
