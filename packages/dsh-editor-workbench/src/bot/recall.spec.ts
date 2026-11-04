import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createConversationReadTool, createConversationSearchTool, createConversationWrapUpTool, type BotToolDeps } from './recall.ts'
import { loadBotState, saveBotState, emptyBotState } from './state.ts'
import type { SessionEventLike } from './transcript.ts'

const ctx = {} as Context

function user(seq: number, text: string): SessionEventLike {
  return { seq, type: 'user/message', time: seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bot-recall-'))
  const state = emptyBotState()
  state.segments.push({ sessionId: 'old', startedAt: 0, reason: 'first' }, { sessionId: 'cur', startedAt: 1, reason: 'idle-expired' })
  state.current = 'cur'
  await saveBotState(root, state)
  const events = new Map<string, SessionEventLike[]>([
    ['old', [user(0, '旧段里提到荷花的事'), user(1, '别的内容')]],
    ['cur', [user(0, '当前问题')]],
  ])
  const deps: BotToolDeps = {
    readEvents: async (id) => events.get(id) ?? [],
    workRoot: async (id) => (id === 'cur' || id === 'old' ? root : undefined),
  }
  return { root, deps }
}

const exec = { agent: { session: { id: 'cur' } } }

describe('conversation_search', () => {
  it('finds literal matches in past segments', async () => {
    const { root, deps } = await setup()
    const tool = createConversationSearchTool(ctx, deps)
    const value = await tool.execute({ query: '荷花' }, exec) as { text: string }
    const result = tool.output.render({}, value)[0]! as { text: string }
    expect(result.text).toContain('荷花')
    expect(result.text).toContain('old')
    await rm(root, { recursive: true })
  })

  it('reports no matches plainly', async () => {
    const { root, deps } = await setup()
    const tool = createConversationSearchTool(ctx, deps)
    const value = await tool.execute({ query: '不存在的词' }, exec) as { text: string }
    const result = tool.output.render({}, value)[0]! as { text: string }
    expect(result.text).toContain('没有找到')
    await rm(root, { recursive: true })
  })
})

describe('conversation_read', () => {
  it('refuses a session outside this work\'s segments', async () => {
    const { root, deps } = await setup()
    const tool = createConversationReadTool(ctx, deps)
    const value = await tool.execute({ sessionId: 'foreign', seq: 0 }, exec) as { text: string }
    const result = tool.output.render({}, value)[0]! as { text: string }
    expect(result.text).toContain('不在本作品的对话段里')
    await rm(root, { recursive: true })
  })

  it('returns rows around seq within a segment', async () => {
    const { root, deps } = await setup()
    const tool = createConversationReadTool(ctx, deps)
    const value = await tool.execute({ sessionId: 'old', seq: 0 }, exec) as { text: string }
    const result = tool.output.render({}, value)[0]! as { text: string }
    expect(result.text).toContain('荷花')
    await rm(root, { recursive: true })
  })
})

describe('conversation_wrap_up', () => {
  it('records the caller session id in bot.json', async () => {
    const { root, deps } = await setup()
    const tool = createConversationWrapUpTool(ctx, deps)
    const value = await tool.execute({}, exec) as { text: string }
    const result = tool.output.render({}, value)[0]! as { text: string }
    expect(result.text).toBe('已记下：本轮结束后会整理对话。')
    const state = await loadBotState(root)
    expect(state.wrapUpRequested).toBe('cur')
    await rm(root, { recursive: true })
  })
})
