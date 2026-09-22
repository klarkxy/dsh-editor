import { describe, expect, it } from 'vitest'
import { CHAT_EVENTS_SLOT } from './contracts.ts'
import { CHAT_EVENTS_SLOT as SHARED } from '@klarkxy/dsh-ai-services/contracts'
import { classifyRequest, shouldAnalyze, shouldWriteClearContract } from './trigger.ts'

describe('frozen contracts and conservative trigger', () => {
  it('keeps the shared chat-events seat', () => {
    expect(CHAT_EVENTS_SLOT).toBe('dsh-editor.chat.events')
    expect(CHAT_EVENTS_SLOT).toBe(SHARED)
  })

  it('treats a bounded, specific request as clear with zero analysis in auto', () => {
    const kind = classifyRequest('把第一章.md里林晚的对白改短，不超过200字，保持原语气。')
    expect(kind).toBe('clear')
    expect(shouldAnalyze(kind, 'auto', false)).toBe(false)
    expect(shouldAnalyze(kind, 'strict', false)).toBe(true)
    expect(shouldAnalyze(kind, 'manual', true)).toBe(true)
    expect(shouldWriteClearContract(kind, false, 'auto')).toBe(true)
    expect(shouldWriteClearContract(kind, false, 'strict')).toBe(false)
  })

  it('does not treat concrete explain or translate requests as material', () => {
    expect(classifyRequest('解释什么是光合作用')).toBe('clear')
    expect(shouldAnalyze('clear', 'auto', false)).toBe(false)
    expect(classifyRequest('把你好翻译成英语')).toBe('clear')
    expect(classifyRequest('今天中午吃什么比较好呢')).toBe('clear')
    expect(shouldAnalyze(classifyRequest('今天中午吃什么比较好呢'), 'auto', false)).toBe(false)
  })

  it('triggers auto mode only for material ambiguity or risk', () => {
    expect(classifyRequest('帮我改一下')).toBe('material')
    expect(shouldAnalyze('material', 'auto', false)).toBe(true)
    expect(classifyRequest('把所有章节覆盖成新稿并发布')).toBe('risk')
    expect(shouldAnalyze('risk', 'auto', false)).toBe(true)
    expect(classifyRequest('请润色第三章的对话。')).toBe('mild')
    expect(shouldAnalyze('mild', 'auto', false)).toBe(false)
    expect(shouldAnalyze('mild', 'strict', false)).toBe(true)
  })

  it('runs manual and strict analysis even when the classifier says clear', () => {
    expect(shouldAnalyze('clear', 'manual', true)).toBe(true)
    expect(shouldAnalyze('clear', 'strict', false)).toBe(true)
    expect(shouldAnalyze('clear', 'manual', false)).toBe(false)
  })

  it('skips acknowledgements and continues a confirmed contract', () => {
    expect(classifyRequest('好')).toBe('skip')
    expect(classifyRequest('继续', { hasConfirmedContract: true })).toBe('skip')
    expect(classifyRequest('继续', { hasConfirmedContract: false })).toBe('material')
    expect(shouldAnalyze('skip', 'strict', true)).toBe(false)
  })
})
