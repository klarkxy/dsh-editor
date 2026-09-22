import { describe, expect, it } from 'vitest'
import { shouldRunIdleDream } from './idle.ts'

describe('idle dream', () => {
  it('runs once after idle, never while a job is already running', () => {
    const base = {
      dreamIdleEnabled: true, pluginActive: true, agentIdle: true, dreamRunning: false,
      lastActivityAt: 0, now: 15 * 60_000, idleMs: 15 * 60_000,
    }
    expect(shouldRunIdleDream(base)).toBe(true)
    expect(shouldRunIdleDream({ ...base, dreamIdleEnabled: false })).toBe(false)
    expect(shouldRunIdleDream({ ...base, dreamRunning: true })).toBe(false)
    expect(shouldRunIdleDream({ ...base, now: 14 * 60_000 })).toBe(false)
  })
})
