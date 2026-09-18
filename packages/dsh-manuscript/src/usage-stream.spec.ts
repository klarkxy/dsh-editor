import { describe, expect, it } from 'vitest'
import { trackUsageStream } from './usage-stream.ts'

async function* chunks(
  items: Array<{ type: string; usage?: Record<string, number> }>,
  onClose: () => void,
) {
  try {
    for (const item of items) yield item
  } finally {
    onClose()
  }
}

async function* failing(onClose: () => void) {
  try {
    yield { type: 'usage', usage: { inputTokens: 1 } }
    throw new Error('upstream failed')
  } finally {
    onClose()
  }
}

describe('trackUsageStream close propagation', () => {
  it('closes the underlying iterator when the consumer exits early', async () => {
    let closed = false
    const recorded: Array<{ completed: boolean }> = []
    const stream = trackUsageStream(
      chunks([{ type: 'text-delta' }, { type: 'text-delta' }, { type: 'usage', usage: { inputTokens: 1 } }], () => {
        closed = true
      }),
      async (_usage, completed) => {
        recorded.push({ completed })
      },
    )
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.()
    expect(closed).toBe(true)
    expect(recorded).toEqual([])
  })

  it('closes the underlying iterator when the consumer cancels after seeing usage', async () => {
    let closed = false
    const recorded: Array<{ completed: boolean; usage: Record<string, number> }> = []
    const stream = trackUsageStream(
      chunks([
        { type: 'text-delta' },
        { type: 'usage', usage: { inputTokens: 3 } },
        { type: 'text-delta' },
      ], () => {
        closed = true
      }),
      async (usage, completed) => {
        recorded.push({ completed, usage })
      },
    )
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    await iterator.return?.()
    expect(closed).toBe(true)
    expect(recorded).toEqual([{ completed: false, usage: { inputTokens: 3 } }])
  })

  it('keeps the upstream error when the recorder also fails', async () => {
    let closed = false
    let recordError: unknown
    const stream = trackUsageStream(
      failing(() => {
        closed = true
      }),
      async () => {
        throw new Error('recorder failed')
      },
      (error) => {
        recordError = error
      },
    )
    await expect(async () => {
      for await (const _chunk of stream) {
        void _chunk
      }
    }).rejects.toThrow('upstream failed')
    expect(closed).toBe(true)
    expect(recordError).toEqual(expect.objectContaining({ message: 'recorder failed' }))
  })

  it('does not let a recorder failure fail a completed stream', async () => {
    let closed = false
    let recordError: unknown
    const seen: string[] = []
    const stream = trackUsageStream(
      chunks([{ type: 'text-delta' }, { type: 'usage', usage: { outputTokens: 2 } }], () => {
        closed = true
      }),
      async () => {
        throw new Error('recorder failed')
      },
      (error) => {
        recordError = error
      },
    )
    for await (const chunk of stream) seen.push(chunk.type)
    expect(seen).toEqual(['text-delta', 'usage'])
    expect(closed).toBe(true)
    expect(recordError).toEqual(expect.objectContaining({ message: 'recorder failed' }))
  })
})
