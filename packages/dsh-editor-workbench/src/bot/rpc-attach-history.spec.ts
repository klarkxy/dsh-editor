import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { botHandlers, type BotRpcDeps } from './rpc.ts'
import { loadBotState, saveBotState, type BotState } from './state.ts'

const ctx = {} as Context

function depsWith(events: Record<string, { ok: SessionEventLike[] } | { err: string }>): BotRpcDeps {
  return {
    readEvents: async (id) => {
      const entry = events[id]
      if (!entry || 'err' in entry) throw new Error(entry?.err ?? `session ${id} not found`)
      return entry.ok
    },
    liveSession: async () => undefined,
    sessionRunning: async () => false,
    promptFingerprint: () => ({ current: 'x' }),
    hasTurns: async () => false,
  }
}
import type { SessionEventLike } from './transcript.ts'

const MSG = (seq: number): SessionEventLike => ({ seq, type: 'user/message', time: seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text: `m${seq}` }] } })

function stateAt(root: string): Promise<BotState> { return loadBotState(root) }

async function setup(segments: { sessionId: string; reason?: string }[], current?: string) {
  const root = await mkdtemp(join(tmpdir(), 'bot-attach-'))
  const state: BotState = { schema: 1, initialized: true, current, segments: segments.map((s) => ({ sessionId: s.sessionId, startedAt: 1, reason: (s.reason ?? 'first') as never })), recaps: [] }
  await saveBotState(root, state)
  return { root, access: { workspace: { path: root } } as never }
}

describe('bot.attach first', () => {
  it('prunes a missing prior segment before pushing the new one', async () => {
    const { root, access } = await setup([{ sessionId: 'dead' }], 'dead')
    const handlers = botHandlers(ctx, depsWith({}))
    await handlers['bot.attach'].run({ body: { sessionId: 'fresh', reason: 'first' }, access } as never)
    const state = await stateAt(root)
    expect(state.segments.map((s) => s.sessionId)).toEqual(['fresh'])
    expect(state.current).toBe('fresh')
    await rm(root, { recursive: true })
  })
  it('prunes a readable but empty prior segment', async () => {
    const { root, access } = await setup([{ sessionId: 'blank' }], 'blank')
    const handlers = botHandlers(ctx, depsWith({ blank: { ok: [] } }))
    await handlers['bot.attach'].run({ body: { sessionId: 'fresh', reason: 'first' }, access } as never)
    const state = await stateAt(root)
    expect(state.segments.map((s) => s.sessionId)).toEqual(['fresh'])
    await rm(root, { recursive: true })
  })
  it('keeps a prior segment that has transcript rows', async () => {
    const { root, access } = await setup([{ sessionId: 'old' }], 'old')
    const handlers = botHandlers(ctx, depsWith({ old: { ok: [MSG(1)] } }))
    await handlers['bot.attach'].run({ body: { sessionId: 'fresh', reason: 'first' }, access } as never)
    const state = await stateAt(root)
    expect(state.segments.map((s) => s.sessionId)).toEqual(['old', 'fresh'])
    await rm(root, { recursive: true })
  })
})

describe('bot.history', () => {
  it('returns missing:true when the segment session log is gone', async () => {
    const { root, access } = await setup([{ sessionId: 'gone' }], 'gone')
    const handlers = botHandlers(ctx, depsWith({}))
    const out = await handlers['bot.history'].run({ body: { segmentSessionId: 'gone' }, access } as never)
    expect(out).toEqual({ rows: [], missing: true })
    await rm(root, { recursive: true })
  })
  it('still fails on other read errors', async () => {
    const { root, access } = await setup([{ sessionId: 'broken' }], 'broken')
    const handlers = botHandlers(ctx, depsWith({ broken: { err: 'disk io exploded' } }))
    await expect(handlers['bot.history'].run({ body: { segmentSessionId: 'broken' }, access } as never)).rejects.toThrow('disk io')
    await rm(root, { recursive: true })
  })
})
