import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, ReasoningEffortId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { runWritingAi, WRITING_LIMITS, type WritingContext } from './ai-purposes.ts'
import type { StreamChunkLike } from './rpc/completion.ts'

type Route = { provider: string; model: string; reasoningEffort?: string }

function host(input: {
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunkLike>
  prepareCall?: (config: unknown, signal?: AbortSignal) => Promise<{ config: unknown; stream: (options: GenerateOptions) => AsyncIterable<StreamChunkLike> }>
  prefs?: { completionModel?: Route; rewriteModel?: Route; chatModel?: Route }
  defaultRoute?: Route | undefined
  sessionRoute?: (sessionId: string) => Route
  scope?: { active: boolean; signal: AbortSignal }
}): WritingContext {
  const defaultRoute = input.defaultRoute === undefined && !('defaultRoute' in input)
    ? { provider: 'provider', model: 'model' }
    : input.defaultRoute
  const scope = input.scope ?? { active: true, signal: new AbortController().signal }
  return {
    llm: {
      stream: input.stream,
      ...(input.prepareCall ? { prepareCall: input.prepareCall } : {}),
    },
    get(name) {
      if (name === 'editorWritingPreferences') return { read: () => input.prefs ?? {} }
      if (name === 'agentDefaultModel') return { currentSelection: () => defaultRoute }
      if (name === 'agents') {
        return {
          get: (sessionId: string) => {
            if (!sessionId) return undefined
            const route = input.sessionRoute?.(sessionId)
            return { session: { requestHeader: () => route ? { config: route } : undefined } }
          },
        }
      }
      if (name === 'sessionProjections') return { stateOf: () => ({ pending: undefined }) }
      if (name === 'manuscriptAiScope') return scope
      return undefined
    },
  }
}

async function* text(value: string): AsyncIterable<StreamChunkLike> {
  yield { type: 'text-delta', text: value }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

describe('direct writing model calls', () => {
  it('streams the host preference route, branded effort, fixed token cap, and an identity-free user message', async () => {
    const stream = vi.fn((options: GenerateOptions) => text('下一句'))
    const ctx = host({
      stream,
      prefs: { rewriteModel: { provider: 'edit', model: 'large', reasoningEffort: 'high' } },
    })
    await expect(runWritingAi({
      ctx, purpose: 'manuscript.rewrite', sessionId: 'session-1', system: '系统', text: '用户', signal: new AbortController().signal, maxChars: 20,
    })).resolves.toBe('下一句')
    const options = stream.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      provider: 'edit',
      model: 'large',
      reasoningEffort: 'high',
      maxTokens: WRITING_LIMITS.maxOutputTokens,
      system: '系统',
    })
    expect(options?.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '用户' }] }])
    expect(options?.messages[0]).not.toHaveProperty('id')
    expect(options?.messages[0]).not.toHaveProperty('source')
    expect(options?.tools).toBeUndefined()
  })

  it('prefers host per-purpose prefs over explicit FIM fields, then explicit fields over the native default', async () => {
    const stream = vi.fn((options: GenerateOptions) => text('ok'))
    const ctx = host({
      stream,
      prefs: { completionModel: { provider: 'pref', model: 'host' } },
      defaultRoute: { provider: 'native', model: 'default' },
    })
    await runWritingAi({
      ctx, purpose: 'manuscript.completion', sessionId: 'order', system: 's', text: 't', signal: new AbortController().signal, maxChars: 10,
      provider: 'explicit', model: 'standalone',
    })
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ provider: 'pref', model: 'host' })

    const fallback = host({ stream, defaultRoute: { provider: 'native', model: 'default' } })
    await runWritingAi({
      ctx: fallback, purpose: 'manuscript.completion', sessionId: 'order-2', system: 's', text: 't', signal: new AbortController().signal, maxChars: 10,
      provider: 'explicit', model: 'standalone', reasoningEffort: 'low',
    })
    expect(stream.mock.calls[1]?.[0]).toMatchObject({ provider: 'explicit', model: 'standalone', reasoningEffort: 'low' })

    await runWritingAi({
      ctx: fallback, purpose: 'manuscript.completion', sessionId: 'order-3', system: 's', text: 't', signal: new AbortController().signal, maxChars: 10,
    })
    expect(stream.mock.calls[2]?.[0]).toMatchObject({ provider: 'native', model: 'default' })
  })

  it('passes resolved off and none through as branded effort', async () => {
    for (const reasoningEffort of ['off', 'none', ' OFF ']) {
      const stream = vi.fn((options: GenerateOptions) => text('ok'))
      const ctx = host({ stream, prefs: { completionModel: { provider: 'p', model: 'm', reasoningEffort } } })
      await runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: `effort-${reasoningEffort}`, system: 's', text: 't', signal: new AbortController().signal, maxChars: 10 })
      expect(stream.mock.calls[0]?.[0].reasoningEffort).toBe(reasoningEffort.trim())
    }
  })

  it('discards partial text on a terminal error, abort, or premature max-tokens finish', async () => {
    const errorHost = host({
      stream: () => (async function* () {
        yield { type: 'text-delta', text: 'partial' }
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'model not available' } } }
      })(),
    })
    await expect(runWritingAi({
      ctx: errorHost, purpose: 'manuscript.completion', sessionId: 'err', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
    })).rejects.toThrow('model not available')

    const aborted = host({
      stream: () => (async function* () {
        yield { type: 'text-delta', text: 'partial' }
        yield { type: 'finish', reason: { kind: 'aborted' } }
      })(),
    })
    await expect(runWritingAi({
      ctx: aborted, purpose: 'manuscript.completion', sessionId: 'aborted', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
    })).resolves.toBe('')

    const truncated = host({
      stream: () => (async function* () {
        yield { type: 'text-delta', text: 'partial' }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      })(),
    })
    await expect(runWritingAi({
      ctx: truncated, purpose: 'manuscript.completion', sessionId: 'trunc', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
    })).rejects.toThrow('输出被截断。')
  })

  it('accepts max-tokens only after the visible cap is already satisfied', async () => {
    const stream = vi.fn(() => (async function* () {
      yield { type: 'text-delta', text: 'abcdefghij' }
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
    })())
    await expect(runWritingAi({
      ctx: host({ stream }), purpose: 'manuscript.completion', sessionId: 'cap-stop', system: 's', text: 't', signal: new AbortController().signal, maxChars: 4,
    })).resolves.toBe('abcd')
  })

  it('drops split reasoning and keeps only the visible cap', async () => {
    const stream = vi.fn(() => (async function* () {
      yield { type: 'reasoning-delta', text: 'hidden' }
      yield { type: 'text-delta', text: '<thi' }
      yield { type: 'text-delta', text: `nk>${'hidden '.repeat(50)}` }
      yield { type: 'text-delta', text: '</th' }
      yield { type: 'text-delta', text: 'ink>雨落在窗台上。' }
    })())
    await expect(runWritingAi({
      ctx: host({ stream }), purpose: 'manuscript.completion', sessionId: 'think', system: 's', text: 't', signal: new AbortController().signal, maxChars: 4,
    })).resolves.toBe('雨落在窗')
  })

  it('rejects tool output instead of inserting it', async () => {
    const stream = vi.fn(() => (async function* () {
      yield { type: 'text-delta', text: 'partial' }
      yield { type: 'tool-call-delta', text: '{"a":1}' }
    })())
    await expect(runWritingAi({
      ctx: host({ stream }), purpose: 'manuscript.rewrite', sessionId: 'tool', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
    })).rejects.toThrow('辅助调用不使用工具。')
  })

  it('does not call the model when the caller already aborted', async () => {
    const stream = vi.fn(() => text('nope'))
    await expect(runWritingAi({
      ctx: host({ stream }), purpose: 'manuscript.completion', sessionId: 'pre', system: 's', text: 't', signal: AbortSignal.abort(), maxChars: 20,
    })).resolves.toBe('')
    expect(stream).not.toHaveBeenCalled()
  })

  it('aborts the producer and drops partial text when the caller cancels', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const stream = vi.fn((options: GenerateOptions) => (async function* () {
      seen = options.signal
      yield { type: 'text-delta', text: 'partial' }
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve()
        else options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      yield { type: 'text-delta', text: 'TAIL' }
    })())
    const pending = runWritingAi({
      ctx: host({ stream }), purpose: 'manuscript.completion', sessionId: 'cancel', system: 's', text: 't', signal: controller.signal, maxChars: 50,
    })
    await vi.waitFor(() => { if (!seen) throw new Error('stream has not started') })
    controller.abort()
    await expect(pending).resolves.toBe('')
    expect(seen?.aborted).toBe(true)
  })

  it('lets the newest same-session same-purpose request suppress the older result', async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let turn = 0
    const stream = vi.fn((options: GenerateOptions) => {
      const current = ++turn
      return (async function* () {
        yield { type: 'text-delta', text: current === 1 ? 'OLD' : 'NEW' }
        if (current === 1) {
          started()
          await new Promise<void>((resolve) => {
            if (options.signal?.aborted) resolve()
            else options.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
        }
      })()
    })
    const ctx = host({ stream })
    const first = runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: 'same', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await ready
    const second = runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: 'same', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await expect(first).resolves.toBe('')
    await expect(second).resolves.toBe('NEW')
    expect(stream.mock.calls[0]?.[0].signal?.aborted).toBe(true)
    expect(stream.mock.calls[1]?.[0].signal?.aborted).toBe(false)
  })

  it('does not suppress a different purpose in the same session', async () => {
    let release!: () => void
    const stream = vi.fn((options: GenerateOptions) => (async function* () {
      yield { type: 'text-delta', text: options.model }
      if (options.model === 'completion-model') {
        await new Promise<void>((resolve) => {
          release = resolve
          options.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    })())
    const ctx = host({
      stream,
      prefs: {
        completionModel: { provider: 'p', model: 'completion-model' },
        rewriteModel: { provider: 'p', model: 'rewrite-model' },
      },
    })
    const completion = runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: 'mix', system: 's', text: 't', signal: new AbortController().signal, maxChars: 40 })
    await vi.waitFor(() => { if (!release) throw new Error('completion has not blocked') })
    const rewrite = runWritingAi({ ctx, purpose: 'manuscript.rewrite', sessionId: 'mix', system: 's', text: 't', signal: new AbortController().signal, maxChars: 40 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(stream).toHaveBeenCalledTimes(1)
    expect(stream.mock.calls[0]?.[0].signal?.aborted).toBe(false)
    release()
    await expect(completion).resolves.toBe('completion-model')
    await expect(rewrite).resolves.toBe('rewrite-model')
  })

  it('drops the result and aborts the producer when the feature scope is disposed', async () => {
    const scope = new AbortController()
    let release!: () => void
    const stream = vi.fn((options: GenerateOptions) => (async function* () {
      yield { type: 'text-delta', text: 'partial' }
      await new Promise<void>((resolve) => {
        release = resolve
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
    })())
    const ctx = host({ stream, scope: { active: true, signal: scope.signal } })
    const pending = runWritingAi({ ctx, purpose: 'manuscript.rewrite', sessionId: 'dispose', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await vi.waitFor(() => { if (!release) throw new Error('rewrite has not blocked') })
    scope.abort()
    await expect(pending).resolves.toBe('')
    expect(stream.mock.calls[0]?.[0].signal?.aborted).toBe(true)
  })

  it('aborts the producer as soon as visible text reaches the cap', async () => {
    let closed = false
    const stream = vi.fn((options: GenerateOptions) => (async function* () {
      try {
        options.signal?.addEventListener('abort', () => undefined)
        yield { type: 'text-delta', text: 'x'.repeat(400) }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('producer kept running')), 500)
          const finish = () => { clearTimeout(timer); resolve() }
          if (options.signal?.aborted) finish()
          else options.signal?.addEventListener('abort', finish, { once: true })
        })
        yield { type: 'text-delta', text: 'TAIL' }
      } finally {
        closed = true
      }
    })())
    const textResult = await runWritingAi({
      ctx: host({ stream }), purpose: 'manuscript.completion', sessionId: 'producer', system: 's', text: 't', signal: new AbortController().signal, maxChars: 240,
    })
    expect(textResult).toHaveLength(240)
    expect(textResult).not.toContain('TAIL')
    expect(stream.mock.calls[0]?.[0].signal?.aborted).toBe(true)
    expect(closed).toBe(true)
  })

  it('rejects oversized input and a caller timeout without publishing partial text', async () => {
    const oversized = vi.fn(() => text('nope'))
    await expect(runWritingAi({
      ctx: host({ stream: oversized }),
      purpose: 'manuscript.completion', sessionId: 'big', system: 'a'.repeat(WRITING_LIMITS.maxInputChars), text: 'e', signal: new AbortController().signal, maxChars: 20,
    })).rejects.toThrow('输入超出上限。')
    expect(oversized).not.toHaveBeenCalled()

    const stream = vi.fn((options: GenerateOptions) => (async function* () {
      yield { type: 'text-delta', text: 'partial' }
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
    })())
    await expect(runWritingAi({
      ctx: host({ stream }),
      purpose: 'manuscript.completion', sessionId: 'timeout', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
      timeoutMs: 40,
    })).rejects.toThrow('调用超时。')
    expect(stream.mock.calls[0]?.[0].signal?.aborted).toBe(true)
  })

  async function settles(work: Promise<unknown>, ms = 60): Promise<boolean> {
    let settled = false
    void work.then(() => { settled = true }, () => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, ms))
    return settled
  }

  it('stops waiting when prepareCall ignores abort', async () => {
    const stream = vi.fn(() => text('nope'))
    const pending = runWritingAi({
      ctx: host({
        stream,
        prepareCall: () => new Promise(() => {}),
      }),
      purpose: 'manuscript.completion', sessionId: 'resolve-hang', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
      timeoutMs: 5,
    })
    expect(await settles(pending)).toBe(true)
    await expect(pending).rejects.toThrow('调用超时。')
    expect(stream).not.toHaveBeenCalled()
  })

  it('stops waiting when the next chunk and iterator close ignore abort', async () => {
    let returned = false
    const stream = vi.fn(() => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<StreamChunkLike>>(() => {}),
          async return() {
            returned = true
            return new Promise<IteratorResult<StreamChunkLike>>(() => {})
          },
        }
      },
    }))
    const controller = new AbortController()
    const pending = runWritingAi({
      ctx: host({ stream }),
      purpose: 'manuscript.completion', sessionId: 'next-hang', system: 's', text: 't', signal: controller.signal, maxChars: 20,
    })
    await vi.waitFor(() => { if (!stream.mock.calls.length) throw new Error('stream has not started') })
    controller.abort()
    expect(await settles(pending)).toBe(true)
    await expect(pending).resolves.toBe('')
    expect(returned).toBe(true)
    expect(stream.mock.calls[0]?.[0].signal?.aborted).toBe(true)
  })

  it('reports cleanup failure after success and keeps an earlier terminal error', async () => {
    const iterable = (chunks: StreamChunkLike[]) => ({
      [Symbol.asyncIterator]() {
        let index = 0
        return {
          async next(): Promise<IteratorResult<StreamChunkLike>> {
            if (index >= chunks.length) return { done: true, value: undefined }
            return { done: false, value: chunks[index++]! }
          },
          async return(): Promise<IteratorResult<StreamChunkLike>> {
            throw new Error('cleanup failed')
          },
        }
      },
    })
    await expect(runWritingAi({
      ctx: host({ stream: () => iterable([{ type: 'text-delta', text: 'ok' }, { type: 'finish', reason: { kind: 'stop' } }]) }),
      purpose: 'manuscript.completion', sessionId: 'cleanup-ok', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
    })).rejects.toThrow('cleanup failed')
    await expect(runWritingAi({
      ctx: host({
        stream: () => iterable([
          { type: 'text-delta', text: 'partial' },
          { type: 'finish', reason: { kind: 'error', failure: { message: 'model not available' } } },
        ]),
      }),
      purpose: 'manuscript.completion', sessionId: 'cleanup-error', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
    })).rejects.toThrow('model not available')
  })

  it('keeps a known producer failure when cleanup never settles and the call times out', async () => {
    const hanging = (next: () => Promise<IteratorResult<StreamChunkLike>>) => {
      let returned = false
      const stream = {
        [Symbol.asyncIterator]() {
          return {
            next,
            return() {
              returned = true
              return new Promise<IteratorResult<StreamChunkLike>>(() => {})
            },
          }
        },
      }
      return { stream, returned: () => returned }
    }
    const finishHang = hanging(async () => ({
      done: false,
      value: { type: 'finish', reason: { kind: 'error', failure: { message: 'model not available' } } },
    }))
    const finishPending = runWritingAi({
      ctx: host({ stream: () => finishHang.stream }),
      purpose: 'manuscript.completion', sessionId: 'known-finish-timeout', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
      timeoutMs: 15,
    })
    expect(await settles(finishPending)).toBe(true)
    await expect(finishPending).rejects.toThrow('model not available')
    expect(finishHang.returned()).toBe(true)

    const nextHang = hanging(async () => { throw new Error('stream rejected') })
    const nextPending = runWritingAi({
      ctx: host({ stream: () => nextHang.stream }),
      purpose: 'manuscript.completion', sessionId: 'known-next-timeout', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
      timeoutMs: 15,
    })
    expect(await settles(nextPending)).toBe(true)
    await expect(nextPending).rejects.toThrow('stream rejected')
    expect(nextHang.returned()).toBe(true)
  })

  it('shares one provider slot across sessions and purposes and lets another provider run', async () => {
    let active = 0
    let peak = 0
    let releaseFirst!: () => void
    const stream = vi.fn((options: GenerateOptions) => (async function* () {
      active += 1
      peak = Math.max(peak, active)
      try {
        if (options.model === 'first') await new Promise<void>((resolve) => { releaseFirst = resolve })
        yield { type: 'text-delta', text: String(options.model) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } finally {
        active -= 1
      }
    })())
    const ctx = host({
      stream,
      sessionRoute: (sessionId) => ({
        provider: sessionId === 'other-provider' ? 'beta' : 'alpha',
        model: sessionId === 'hold' ? 'first' : sessionId,
      }),
    })
    const first = runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: 'hold', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await vi.waitFor(() => { if (!releaseFirst) throw new Error('holder has not started') })
    let secondDone = false
    const second = runWritingAi({ ctx, purpose: 'manuscript.rewrite', sessionId: 'queued', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
      .then((value) => { secondDone = true; return value })
    const parallel = runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: 'other-provider', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await expect(parallel).resolves.toBe('other-provider')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(secondDone).toBe(false)
    expect(peak).toBe(2)
    expect(stream.mock.calls.filter(([options]) => options.provider === 'alpha')).toHaveLength(1)
    releaseFirst()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('queued')
    expect(peak).toBe(2)
    expect(active).toBe(0)
  })

  function holdingStream() {
    let releaseHolder!: () => void
    const stream = vi.fn((options: GenerateOptions) => (async function* () {
      if (options.model === 'holder') await new Promise<void>((resolve) => { releaseHolder = resolve })
      yield { type: 'text-delta', text: String(options.model) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })())
    return {
      stream,
      hold() { return releaseHolder },
    }
  }

  it('removes a queued call when the caller cancels and then releases the holder', async () => {
    const held = holdingStream()
    const ctx = host({
      stream: held.stream,
      sessionRoute: (sessionId) => ({ provider: 'alpha', model: sessionId }),
    })
    const holder = runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: 'holder', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await vi.waitFor(() => { if (!held.hold()) throw new Error('holder has not started') })
    const cancelled = new AbortController()
    const queued = runWritingAi({ ctx, purpose: 'manuscript.rewrite', sessionId: 'cancel-wait', system: 's', text: 't', signal: cancelled.signal, maxChars: 20 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(held.stream).toHaveBeenCalledTimes(1)
    cancelled.abort()
    await expect(queued).resolves.toBe('')
    expect(held.stream).toHaveBeenCalledTimes(1)
    held.hold()()
    await expect(holder).resolves.toBe('holder')
  })

  it('removes a queued call when the feature scope is disposed', async () => {
    const held = holdingStream()
    const scope = new AbortController()
    const ctx = host({
      stream: held.stream,
      scope: { active: true, signal: scope.signal },
      sessionRoute: (sessionId) => ({ provider: 'alpha', model: sessionId }),
    })
    const holder = runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: 'holder', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await vi.waitFor(() => { if (!held.hold()) throw new Error('holder has not started') })
    const queued = runWritingAi({ ctx, purpose: 'manuscript.rewrite', sessionId: 'dispose-wait', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(held.stream).toHaveBeenCalledTimes(1)
    scope.abort()
    await expect(queued).resolves.toBe('')
    await expect(holder).resolves.toBe('')
    expect(held.stream).toHaveBeenCalledTimes(1)
    held.hold()()
  })

  it('removes a queued call when its own timeout fires', async () => {
    const held = holdingStream()
    const ctx = host({
      stream: held.stream,
      sessionRoute: (sessionId) => ({ provider: 'alpha', model: sessionId }),
    })
    const holder = runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: 'holder', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await vi.waitFor(() => { if (!held.hold()) throw new Error('holder has not started') })
    const queued = runWritingAi({
      ctx, purpose: 'manuscript.rewrite', sessionId: 'timeout-wait', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
      timeoutMs: 5,
    })
    expect(await settles(queued)).toBe(true)
    await expect(queued).rejects.toThrow('调用超时。')
    expect(held.stream).toHaveBeenCalledTimes(1)
    held.hold()()
    await expect(holder).resolves.toBe('holder')
  })

  it('does not let one writing context supersede another context with the same session and purpose', async () => {
    let releaseA!: () => void
    let signalA: AbortSignal | undefined
    const streamA = vi.fn((options: GenerateOptions) => (async function* () {
      signalA = options.signal
      yield { type: 'text-delta', text: 'A' }
      await new Promise<void>((resolve) => { releaseA = resolve })
      yield { type: 'finish', reason: { kind: 'stop' } }
    })())
    const streamB = vi.fn(() => text('B'))
    const hostA = host({ stream: streamA })
    const hostB = host({ stream: streamB })
    const first = runWritingAi({ ctx: hostA, purpose: 'manuscript.completion', sessionId: 'shared', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20 })
    await vi.waitFor(() => { if (!releaseA) throw new Error('host A has not blocked') })
    await expect(runWritingAi({
      ctx: hostB, purpose: 'manuscript.completion', sessionId: 'shared', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
    })).resolves.toBe('B')
    expect(signalA?.aborted).toBe(false)
    releaseA()
    await expect(first).resolves.toBe('A')
  })

  it('keeps an explicit off effort that the installed runtime would otherwise replace with the model default', async () => {
    class EffortAdapter extends LlmAdapter {
      override resolveModel(provider: string, model: string) {
        return Promise.resolve({
          provider,
          id: model,
          name: 'Writer',
          reasoning: {
            efforts: [
              { id: ReasoningEffortId('off'), name: 'Off' },
              { id: ReasoningEffortId('high'), name: 'High' },
            ],
            defaultEffort: ReasoningEffortId('high'),
          },
        })
      }

      override stream(): AsyncIterable<StreamChunk> {
        return (async function* () {
          yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
        })()
      }
    }

    const runtime = new Context()
    const fiber = runtime.plugin(LlmRuntime)
    await fiber
    try {
      runtime.llm.registerAdapter(['demo'], new EffortAdapter())
      const kept = await runtime.llm.resolveCallConfig({
        provider: 'demo',
        model: 'writer',
        reasoningEffort: ReasoningEffortId('off'),
      })
      const omitted = await runtime.llm.resolveCallConfig({ provider: 'demo', model: 'writer' })
      expect(kept.reasoningEffort).toBe('off')
      expect(omitted.reasoningEffort).toBe('high')

      const stream = vi.fn(() => text('kept'))
      await expect(runWritingAi({
        ctx: host({
          stream,
          prefs: { completionModel: { provider: 'demo', model: 'writer', reasoningEffort: 'off' } },
        }),
        purpose: 'manuscript.completion', sessionId: 'effort-off', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
      })).resolves.toBe('kept')
      expect(stream.mock.calls[0]?.[0].reasoningEffort).toBe(kept.reasoningEffort)
    } finally {
      await fiber.dispose()
    }
  })

  it('fails visibly when no host pref, explicit route, or native default is available', async () => {
    const stream = vi.fn(() => text('nope'))
    await expect(runWritingAi({
      ctx: host({ stream, defaultRoute: undefined }),
      purpose: 'manuscript.completion', sessionId: 'missing', system: 's', text: 't', signal: new AbortController().signal, maxChars: 20,
    })).rejects.toThrow('请先设置默认对话模型。')
    expect(stream).not.toHaveBeenCalled()
  })
})


describe('host model readiness', () => {
  function waiting(ready: () => Promise<void>, stream: ReturnType<typeof vi.fn>): WritingContext {
    let route = { provider: 'old', model: 'old' }
    const ctx = host({ stream })
    const get = ctx.get!
    ctx.get = (name, optional) => name === 'editorWritingPreferences' ? { read: () => ({ completionModel: route }), modelsReady: async () => { await ready(); route = { provider: 'new', model: 'new' } } } : get(name, optional)
    return ctx
  }
  const invoke = (ctx: WritingContext, signal = new AbortController().signal) => runWritingAi({ ctx, purpose: 'manuscript.completion', sessionId: 'ready', system: 's', text: 't', maxChars: 20, signal })
  it('reads migrated choices only after the existing host preference becomes ready', async () => {
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    const stream = vi.fn(() => text('ready'))
    const call = invoke(waiting(() => ready, stream))
    await Promise.resolve();expect(stream).not.toHaveBeenCalled()
    release();await expect(call).resolves.toBe('ready')
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ provider: 'new', model: 'new' }))
  })
  it('cancels a wait that ignores abort and never publishes a late model call', async () => {
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    const stream = vi.fn(() => text('late'));const controller = new AbortController()
    const call = invoke(waiting(() => ready, stream), controller.signal)
    controller.abort();await expect(call).resolves.toBe('')
    release();await Promise.resolve();expect(stream).not.toHaveBeenCalled()
  })
  it('reports failed migration without sending the previous preference to a model', async () => {
    const stream = vi.fn(() => text('nope'))
    await expect(invoke(waiting(async () => { throw new Error('migration failed') }, stream))).rejects.toThrow('migration failed')
    expect(stream).not.toHaveBeenCalled()
  })
})
