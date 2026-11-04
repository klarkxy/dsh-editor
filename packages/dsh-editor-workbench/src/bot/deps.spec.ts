import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createBotRpcDeps } from './deps.ts'
import type { SessionEventLike } from './transcript.ts'

function user(seq: number, text: string): SessionEventLike {
  return { seq, type: 'user/message', time: seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } }
}

describe('bot runtime deps', () => {
  it('reads raw events from sessionQuery.readSession (SessionLogSnapshot.events)', async () => {
    const ctx = {
      sessionQuery: {
        readSession: async (id: string) => ({ session: { id }, inheritedEventCount: 0, events: [user(0, '原文'), { seq: 1, type: 'turn/end', time: 1, data: {} }] }),
      },
    } as unknown as Context
    const deps = createBotRpcDeps(ctx)
    const events = await deps.readEvents('s1')
    expect(events.map((event) => event.seq)).toEqual([0, 1])
  })

  it('fails loudly when sessionQuery is absent', async () => {
    const deps = createBotRpcDeps({} as Context)
    await expect(deps.readEvents('s1')).rejects.toThrow('sessionQuery')
  })

  it('detects running via ctx.agents.get(sessionId).status', async () => {
    const agents = { get: (id: string) => (id === 'busy' ? { status: 'running' as const } : { status: 'idle' as const }) }
    const deps = createBotRpcDeps({ agents } as unknown as Context)
    expect(await deps.sessionRunning('busy')).toBe(true)
    expect(await deps.sessionRunning('calm')).toBe(false)
    const none = createBotRpcDeps({} as Context)
    expect(await none.sessionRunning('busy')).toBe(false)
  })

  it('hasTurns means a turn/start or user/message event, not any event', async () => {
    const ctx = {
      sessionQuery: { readSession: async () => ({ events: [{ seq: 0, type: 'session/created', data: {} }] }) },
    } as unknown as Context
    const deps = createBotRpcDeps(ctx)
    expect(await deps.hasTurns('s1')).toBe(false)
    const withTurn = {
      sessionQuery: { readSession: async () => ({ events: [{ seq: 0, type: 'turn/start', data: {} }] }) },
    } as unknown as Context
    expect(await createBotRpcDeps(withTurn).hasTurns('s1')).toBe(true)
    const withMsg = {
      sessionQuery: { readSession: async () => ({ events: [user(0, 'hi')] }) },
    } as unknown as Context
    expect(await createBotRpcDeps(withMsg).hasTurns('s1')).toBe(true)
  })

  it('keeps the retained session held until release() after use', async () => {
    let released = false
    const fake = { id: 's1' }
    const ctx = {
      sessions: { retain: () => ({ ready: Promise.resolve({ session: fake }), release: () => { released = true } }) },
    } as unknown as Context
    const held = await createBotRpcDeps(ctx).liveSession('s1')
    expect(held?.session).toBe(fake)
    expect(released).toBe(false)
    held?.release()
    expect(released).toBe(true)
  })
})
