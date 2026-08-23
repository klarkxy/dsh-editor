import { describe, expect, it } from 'vitest'
import { collectInsertText, sanitizeInsert, type StreamChunkLike } from './completion.ts'

async function* chunks(items: StreamChunkLike[]): AsyncIterable<StreamChunkLike> {
  for (const item of items) yield item
}

describe('collectInsertText', () => {
  it('keeps only text-delta fragments and strips fences', async () => {
    const text = await collectInsertText(chunks([
      { type: 'block-start', text: 'ignore' },
      { type: 'reasoning-delta', text: 'thought' },
      { type: 'text-delta', text: '```md\n窗上的雾' },
      { type: 'text-delta', text: '还没散。\n```' },
      { type: 'finish' },
    ]))
    expect(text).toBe('窗上的雾还没散。')
  })

  it('discards output after abort', async () => {
    const signal = AbortSignal.abort()
    await expect(collectInsertText(chunks([{ type: 'text-delta', text: 'nope' }]), { signal })).resolves.toBe('')
  })

  it('discards output after a stream error', async () => {
    async function* boom(): AsyncIterable<StreamChunkLike> {
      yield { type: 'text-delta', text: 'partial' }
      throw new Error('provider')
    }
    await expect(collectInsertText(boom())).resolves.toBe('')
  })

  it('caps insert length', async () => {
    const text = await collectInsertText(chunks([{ type: 'text-delta', text: 'abcdefghij' }]), { maxChars: 4 })
    expect(text).toBe('abcd')
  })
})

describe('sanitizeInsert', () => {
  it('drops leading labels', () => {
    expect(sanitizeInsert('插入内容：下一句')).toBe('下一句')
  })
})
