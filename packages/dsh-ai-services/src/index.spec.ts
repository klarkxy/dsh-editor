import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { apply } from './index.ts'
import { AI_RPC_CHANNEL } from './contracts.ts'
import type { MemoryService, TaskContract } from './index.ts'
import type { AiServicesRuntime } from './service.ts'

function context() {
  const policy = new Map()
  const receipts = new Map()
  const table = (map: Map<string, unknown>) => ({
    get: (key: string) => map.get(key),
    put: async (key: string, value: unknown) => { map.set(key, value) },
  })
  const effects: Array<unknown> = []
  let provided: AiServicesRuntime | undefined
  const stream = vi.fn()
  const prepareCall = vi.fn()
  const resolveCallConfig = vi.fn()
  const on = vi.fn(function (this: Context) {
    if (this !== ctx) throw new Error('event listener lost its context')
    return () => true
  })
  const ctx = {
    llm: { stream, prepareCall, resolveCallConfig },
    storageDomain: {
      open: async () => ({
        table: (name: string) => name === 'policy' ? table(policy) : table(receipts),
        close: async () => {},
      }),
    },
    connection: { requestRejection: () => undefined },
    webServer: { register: vi.fn(() => () => {}) },
    get: () => undefined,
    on,
    provide: vi.fn((_name: string, value: AiServicesRuntime) => { provided = value }),
    effect: (fn: () => unknown) => { effects.push(fn()) },
  } as unknown as Context
  return { ctx, stream, prepareCall, on, get provided() { return provided } }
}

describe('plugin apply is inert', () => {
  it('provides aiServices and registers RPC without calling the model', async () => {
    const { ctx, stream, prepareCall } = context()
    await apply(ctx)
    expect(stream).not.toHaveBeenCalled()
    expect(prepareCall).not.toHaveBeenCalled()
    expect(ctx.provide).toHaveBeenCalledWith('aiServices', expect.anything())
    expect((ctx as unknown as { webServer: { register: ReturnType<typeof vi.fn> } }).webServer.register)
      .toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: AI_RPC_CHANNEL }))
  })

  it('re-exports public contract types from the package root', () => {
    type _Root = TaskContract | MemoryService
    const names: Array<keyof TaskContract | keyof MemoryService> = ['goal', 'recall']
    expect(names).toEqual(['goal', 'recall'])
  })

  it('decrements agent occupancy when next() throws synchronously', async () => {
    const host = context()
    await apply(host.ctx)
    const listener = host.on.mock.calls.find(call => call[0] === 'llm/stream')?.[1] as (
      options: unknown,
      next: () => AsyncIterable<unknown>,
    ) => AsyncIterable<unknown>
    const spy = vi.spyOn(host.provided!, 'noteAgent')
    const gen = listener(
      markAgentLoopRequest({
        provider: 'stub',
        model: 'chat',
        messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'agent' }] })],
      }),
      () => { throw new Error('sync-next') },
    )
    await expect((async () => { for await (const _chunk of gen) { /* drain */ } })()).rejects.toThrow('sync-next')
    expect(spy.mock.calls).toEqual([['stub', 1], ['stub', -1]])
  })
})
