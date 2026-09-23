import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CHAT_EVENTS_SLOT, MOOD_AI_PLUGIN, MOOD_PLUGIN, projectIdFromCwd } from './contracts.ts'
import { projectIdFromCwd as sharedProjectIdFromCwd } from '@klarkxy/dsh-ai-services/contracts'
import { inject, resumeHeldOnHost, type AgentsRegistry, type LiveAgent } from './index.ts'
import { ASK_DETAIL_OPTION, toAskItems, pendingClarifications } from './questions.ts'

describe('host wiring and shared SDK helpers', () => {
  it('requires Host aiServices, storageDomain, sessions, userQuestions, and agents', () => {
    expect([...inject]).toEqual(['aiServices', 'storageDomain', 'sessions', 'userQuestions', 'agents', 'connection', 'webServer'])
  })

  it('activates the scoped package name after the SDK pluginName fix', () => {
    expect(MOOD_AI_PLUGIN).toBe(MOOD_PLUGIN)
    expect(MOOD_AI_PLUGIN).toBe('@klarkxy/dsh-mood')
  })

  it('reexports SDK projectIdFromCwd without 256-char truncation', () => {
    expect(projectIdFromCwd).toBe(sharedProjectIdFromCwd)
    expect(projectIdFromCwd('D:\\work\\Novel\\')).toBe('D:/work/Novel')
    const left = `/${'a'.repeat(200)}/one`
    const right = `/${'a'.repeat(200)}/two`
    expect(left.length).toBeGreaterThan(200)
    expect(projectIdFromCwd(left)).toBe(left)
    expect(projectIdFromCwd(right)).toBe(right)
    expect(projectIdFromCwd(left)).not.toBe(projectIdFromCwd(right))
  })

  it('matches the native AskUserQuestionItem option shape from the pinned runtime', () => {
    const item = toAskItems(pendingClarifications(['范围？']))[0]
    expect(item?.options?.[0]).toEqual({
      label: ASK_DETAIL_OPTION,
      description: '在自定义输入中写明范围、约束或验收标准',
    })
  })

  it('keeps the frozen chat-events seat', () => {
    expect(CHAT_EVENTS_SLOT).toBe('dsh-editor.chat.events')
  })
})

/** Native agent-loop shape: steer/followup call this.send (index.js 789-794). */
class NativeShapedAgent implements LiveAgent {
  readonly inbox: Array<{ message: unknown; target: string; wakeup: boolean }> = []
  constructor(readonly id: string) {}
  send(message: unknown, target: string, wakeup: boolean): void {
    this.inbox.push({ message, target, wakeup })
  }
  followup(input: unknown): void {
    this.send(input, 'next-turn', true)
  }
  steer(input: unknown): void {
    this.send(input, 'next-step', true)
  }
}

class NativeShapedAgents implements AgentsRegistry {
  constructor(private readonly agent: NativeShapedAgent) {}
  get(id: unknown): LiveAgent | undefined {
    return id === this.agent.id ? this.agent : undefined
  }
}

describe('native-shaped retry adapter', () => {
  it('invokes bound steer on the Agents.get instance so this.send receives the original human', () => {
    const agent = new NativeShapedAgent('sess-1')
    const agents = new NativeShapedAgents(agent)
    const human = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '帮我改一下' }],
    })
    const extracted = agent.steer
    expect(() => extracted(human)).toThrow()
    resumeHeldOnHost(agents, 'sess-1', [human])
    expect(agent.inbox).toEqual([{ message: human, target: 'next-step', wakeup: true }])
    expect(human.source).toMatchObject({ kind: 'user' })
  })

  it('does not invent a human prompt when the live agent is missing', () => {
    const agents = new NativeShapedAgents(new NativeShapedAgent('other'))
    expect(() => resumeHeldOnHost(agents, 'sess-1', [{ source: { kind: 'user' }, content: [] }])).toThrow(/没有可恢复的会话/)
  })
})
