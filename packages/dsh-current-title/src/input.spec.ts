import { describe, expect, it } from 'vitest'
import { frameMessages, selectRecentMessages, utf8Bytes } from './input.ts'
import type { TitleMessage } from './contracts.ts'

function messages(count: number): TitleMessage[] {
  return Array.from({ length: count }, (_, index) => ({ seq: index, text: `message-${index}` }))
}

describe('selectRecentMessages', () => {
  it('returns an empty list for no eligible messages', () => {
    expect(selectRecentMessages([], 8, 4096)).toEqual([])
  })

  it('keeps the newest count in chronological order', () => {
    expect(selectRecentMessages(messages(12), 8, 4096).map(message => message.text)).toEqual(
      messages(12).slice(4).map(message => message.text),
    )
  })

  it('drops oldest messages until the complete frame fits', () => {
    const input = messages(3).map(message => ({ ...message, text: message.text.repeat(20) }))
    const selected = selectRecentMessages(input, 8, 240)
    expect(selected.at(-1)?.seq).toBe(input.at(-1)?.seq)
    expect(selected.length).toBeLessThan(input.length)
    expect(utf8Bytes(frameMessages(selected))).toBeLessThanOrEqual(240)
  })

  it('keeps valid head and tail Unicode when the newest message alone is too large', () => {
    const source = { seq: 7, text: `任务开头${'界'.repeat(200)}最终约束` }
    const [selected] = selectRecentMessages([source], 8, 180)
    expect(selected?.text).toContain('…')
    expect(selected?.text.startsWith('任务')).toBe(true)
    expect(selected?.text.endsWith('约束')).toBe(true)
    expect(selected?.text).not.toContain('�')
    expect(utf8Bytes(frameMessages([selected!]))).toBeLessThanOrEqual(180)
  })

  it('fails clearly when even the empty envelope cannot fit', () => {
    expect(() => selectRecentMessages(messages(1), 8, 1)).toThrow(/too small/)
  })
})
