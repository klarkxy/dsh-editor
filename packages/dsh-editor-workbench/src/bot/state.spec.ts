import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyBotState, loadBotState, parseBotState, saveBotState, segmentOf } from './state.ts'

async function work(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dsh-bot-state-'))
}

describe('bot state', () => {
  it('returns empty state when the file is missing', async () => {
    const root = await work()
    const state = await loadBotState(root)
    expect(state).toEqual(emptyBotState())
    await rm(root, { recursive: true })
  })

  it('round-trips a valid state', async () => {
    const root = await work()
    const state = emptyBotState()
    state.initialized = true
    state.current = 's2'
    state.segments.push({ sessionId: 's1', startedAt: 1, reason: 'first' }, { sessionId: 's2', startedAt: 2, reason: 'idle-expired', handoffMode: 'verbatim', handoffText: '交接' })
    state.handoff = { sessionId: 's1', coversThroughSeq: 5, summary: '摘要', createdAt: 3, provider: 'p', model: 'm' }
    state.recaps.push({ sessionId: 's1', afterSeq: 5, text: '回顾', createdAt: 4 })
    await saveBotState(root, state)
    expect(await loadBotState(root)).toEqual(state)
    await rm(root, { recursive: true })
  })

  it('renames a corrupt file aside and starts empty', async () => {
    const root = await work()
    await saveBotState(root, emptyBotState())
    await writeFile(join(root, '.dsh-editor', 'bot.json'), 'not-json{{{')
    const state = await loadBotState(root)
    expect(state).toEqual(emptyBotState())
    const files = await readdir(join(root, '.dsh-editor'))
    expect(files.some((name) => name.startsWith('bot.json.corrupt-'))).toBe(true)
    await rm(root, { recursive: true })
  })

  it('caps segments at 200 and recaps at 50', async () => {
    const root = await work()
    const state = emptyBotState()
    for (let index = 0; index < 230; index++) state.segments.push({ sessionId: `s${index}`, startedAt: index, reason: 'first' })
    for (let index = 0; index < 70; index++) state.recaps.push({ sessionId: 's1', afterSeq: index, text: 'r', createdAt: index })
    await saveBotState(root, state)
    const loaded = await loadBotState(root)
    expect(loaded.segments.length).toBe(200)
    expect(loaded.segments[0]!.sessionId).toBe('s30')
    expect(loaded.recaps.length).toBe(50)
    await rm(root, { recursive: true })
  })

  it('rejects invalid documents', () => {
    expect(() => parseBotState('{"schema":2,"initialized":false,"segments":[],"recaps":[]}')).toThrow()
    expect(() => parseBotState('"text"')).toThrow()
  })

  it('finds a segment by session id', () => {
    const state = emptyBotState()
    state.segments.push({ sessionId: 's1', startedAt: 0, reason: 'first' })
    expect(segmentOf(state, 's1')?.reason).toBe('first')
    expect(segmentOf(state, 'other')).toBeUndefined()
  })
})

describe('updateBotState', () => {
  it('serializes read-modify-write without interleaving', async () => {
    const root = await work()
    const { updateBotState } = await import('./state.ts')
    const order: string[] = []
    await Promise.all([
      updateBotState(root, async (state) => { order.push('a-start'); await new Promise((r) => setTimeout(r, 20)); state.segments.push({ sessionId: 'a', startedAt: 1, reason: 'first' }); order.push('a-end') }),
      updateBotState(root, async (state) => { order.push('b-start'); state.segments.push({ sessionId: 'b', startedAt: 2, reason: 'first' }); order.push('b-end') }),
    ])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
    const state = await loadBotState(root)
    expect(state.segments.map((s) => s.sessionId)).toEqual(['a', 'b'])
    await rm(root, { recursive: true })
  })
})
