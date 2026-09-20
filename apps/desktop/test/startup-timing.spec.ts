import { describe, expect, it } from 'vitest'
import { StartupTiming } from '../src/startup-timing.ts'

describe('startup timing', () => {
  it('records phase durations without URLs', async () => {
    const lines: string[] = []
    const timing = new StartupTiming()
    await timing.measure('runtime', async () => 'ok')
    await timing.measure('profile', async () => ({ reused: true }), (result) => result.reused ? 'hit' : 'deploy')
    timing.flush((line) => { lines.push(line) })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^desktop startup: runtime \d+ms, profile hit \d+ms$/)
    expect(lines[0]).not.toContain('http://')
    expect(lines[0]).not.toContain('token')
  })
})
