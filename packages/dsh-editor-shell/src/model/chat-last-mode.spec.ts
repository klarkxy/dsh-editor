import { describe, expect, it } from 'vitest'
import { LAST_CHAT_MODE_KEY, readLastChatMode, resolveNewChatMode, writeLastChatMode } from './chat-last-mode.ts'
import type { ConversationPresetChoice } from '../conversation-presets.ts'

const PRESETS: ConversationPresetChoice[] = [
  { id: 'dsh-editor-writing', name: '通用写作', description: '', available: true },
  { id: 'dsh-editor-novel', name: '小说创作', description: '', available: true },
  { id: 'dsh-editor-article', name: '文章', description: '', available: false, reason: 'missing' },
]

function memoryStorage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } {
  const data = { ...seed }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value },
  }
}

describe('last chat mode', () => {
  it('persists the chosen mode under the dsh-editor.chat.last-mode key', () => {
    const storage = memoryStorage()
    writeLastChatMode(storage, 'dsh-editor-novel')
    expect(storage.data[LAST_CHAT_MODE_KEY]).toBe('dsh-editor-novel')
    expect(readLastChatMode(storage)).toBe('dsh-editor-novel')
  })

  it('resolves the remembered mode when it is still available', () => {
    const storage = memoryStorage({ [LAST_CHAT_MODE_KEY]: 'dsh-editor-novel' })
    expect(resolveNewChatMode(storage, PRESETS)).toBe('dsh-editor-novel')
  })

  it('falls back to the first available preset without a record', () => {
    expect(resolveNewChatMode(memoryStorage(), PRESETS)).toBe('dsh-editor-writing')
    expect(resolveNewChatMode(null, PRESETS)).toBe('dsh-editor-writing')
  })

  it('falls back when the remembered mode is gone or unavailable', () => {
    const gone = memoryStorage({ [LAST_CHAT_MODE_KEY]: 'dsh-editor-retired' })
    expect(resolveNewChatMode(gone, PRESETS)).toBe('dsh-editor-writing')
    const unavailable = memoryStorage({ [LAST_CHAT_MODE_KEY]: 'dsh-editor-article' })
    expect(resolveNewChatMode(unavailable, PRESETS)).toBe('dsh-editor-writing')
  })

  it('returns undefined when no preset is available', () => {
    expect(resolveNewChatMode(memoryStorage(), PRESETS.map((p) => ({ ...p, available: false })))).toBeUndefined()
  })

  it('survives a throwing storage', () => {
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readLastChatMode(throwing)).toBeUndefined()
    expect(() => writeLastChatMode(throwing, 'x')).not.toThrow()
    expect(resolveNewChatMode(throwing, PRESETS)).toBe('dsh-editor-writing')
  })
})
