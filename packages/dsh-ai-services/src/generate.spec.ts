import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { generateAuxiliary } from './generate.ts'
import type { ResolvedRoute } from './contracts.ts'

class StubAdapter extends LlmAdapter {
  streams = 0
  last?: GenerateOptions
  mode: 'ok' | 'error' | 'tools' | 'hang' | 'late' | 'max-tokens' | 'no-finish' | 'tools-stop' = 'ok'
  finishLate?: () => void
  async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streams += 1
    this.last = options
    if (this.mode === 'hang') await new Promise(() => {})
    if (this.mode === 'late') await new Promise<void>(resolve => { this.finishLate = resolve })
    if (this.mode === 'error') {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'RATE_LIMIT' } } }
      return
    }
    if (this.mode === 'tools') {
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.mode === 'max-tokens') {
      yield { type: 'text-delta', index: 0, text: '{"title":' }
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
      return
    }
    if (this.mode === 'no-finish') {
      yield { type: 'text-delta', index: 0, text: '{"title":"x"}' }
      return
    }
    if (this.mode === 'tools-stop') {
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('c1'), name: 'search', argumentsDelta: '{}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    yield { type: 'text-delta', index: 0, text: 'hello' }
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const route: ResolvedRoute = {
  provider: 'stub', model: 'chat', source: 'default', target: { kind: 'model', provider: 'stub', model: 'chat' }, policyRevision: 0,
}

describe('pinned llm generate path', () => {
  it('assembles plain text with BlockAssembler and omits tools', async () => {
    const llm = new LlmRuntime(new Context())
    const adapter = new StubAdapter()
    llm.registerAdapter(['stub'], adapter)
    const result = await generateAuxiliary({
      llm, plugin: 'mood', route, system: 'sys', text: 'user', maxTokens: 16, maxAttempts: 1,
      signal: new AbortController().signal, live: () => true,
    })
    expect(result).toMatchObject({ status: 'success', text: 'hello', attempts: 1, inputTokens: 2 })
    expect(adapter.last?.tools).toBeUndefined()
    expect(adapter.last?.system).toBe('sys')
    expect(adapter.last?.messages[0]?.source).toMatchObject({ kind: 'plugin:mood', plugin: 'mood' })
  })

  it('maps finish errors and does not retry past maxAttempts', async () => {
    const llm = new LlmRuntime(new Context())
    const adapter = new StubAdapter()
    adapter.mode = 'error'
    llm.registerAdapter(['stub'], adapter)
    const result = await generateAuxiliary({
      llm, plugin: 'mood', route, system: 's', text: 't', maxTokens: 8, maxAttempts: 2,
      signal: new AbortController().signal, live: () => true,
    })
    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(2)
    expect(adapter.streams).toBe(2)
  })

  it('rejects tool-call finishes without retrying', async () => {
    const llm = new LlmRuntime(new Context())
    const adapter = new StubAdapter()
    adapter.mode = 'tools'
    llm.registerAdapter(['stub'], adapter)
    const result = await generateAuxiliary({
      llm, plugin: 'mood', route, system: 's', text: 't', maxTokens: 8, maxAttempts: 3,
      signal: new AbortController().signal, live: () => true,
    })
    expect(result.status).toBe('failed')
    expect(adapter.streams).toBe(1)
  })

  it('treats max-tokens as a truncated failure and does not return JSON', async () => {
    const llm = new LlmRuntime(new Context())
    const adapter = new StubAdapter()
    adapter.mode = 'max-tokens'
    llm.registerAdapter(['stub'], adapter)
    const result = await generateAuxiliary({
      llm, plugin: 'mood', route, system: 's', text: 't', maxTokens: 8, maxAttempts: 3,
      signal: new AbortController().signal, live: () => true,
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('输出被截断。')
    expect(result.text).toBe('')
    expect(adapter.streams).toBe(1)
  })

  it('fails when the stream ends without a finish chunk', async () => {
    const llm = new LlmRuntime(new Context())
    const adapter = new StubAdapter()
    adapter.mode = 'no-finish'
    llm.registerAdapter(['stub'], adapter)
    const result = await generateAuxiliary({
      llm, plugin: 'mood', route, system: 's', text: 't', maxTokens: 8, maxAttempts: 2,
      signal: new AbortController().signal, live: () => true,
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('模型调用未完成。')
    expect(result.text).toBe('')
    expect(adapter.streams).toBe(1)
  })

  it('fails tool-call blocks even when the terminal kind is stop', async () => {
    const llm = new LlmRuntime(new Context())
    const adapter = new StubAdapter()
    adapter.mode = 'tools-stop'
    llm.registerAdapter(['stub'], adapter)
    const result = await generateAuxiliary({
      llm, plugin: 'mood', route, system: 's', text: 't', maxTokens: 8, maxAttempts: 3,
      signal: new AbortController().signal, live: () => true,
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('辅助调用不使用工具。')
    expect(result.text).toBe('')
    expect(adapter.streams).toBe(1)
  })

  it('wins cancellation against a late producer completion', async () => {
    const llm = new LlmRuntime(new Context())
    const adapter = new StubAdapter()
    adapter.mode = 'late'
    llm.registerAdapter(['stub'], adapter)
    const controller = new AbortController()
    const pending = generateAuxiliary({
      llm, plugin: 'mood', route, system: 's', text: 'secret-prompt', maxTokens: 8, maxAttempts: 1,
      signal: controller.signal, live: () => !controller.signal.aborted,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort()
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(result.text).toBe('')
    adapter.finishLate?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(result.text).toBe('')
  })
})


describe('bounded writing candidate stream', () => {
  it('stops at visible characters before a later truncation or hang, and closes its producer', async () => {
    const llm = new LlmRuntime(new Context())
    let closed = false; let continued = false; let signal: AbortSignal | undefined
    class WritingAdapter extends StubAdapter {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        signal = options.signal
        try {
          yield { type: 'text-delta', index: 0, text: '<thi' }
          yield { type: 'text-delta', index: 0, text: 'nk>' + '推理'.repeat(500) + '</th' }
          yield { type: 'text-delta', index: 0, text: 'ink>' + '雨'.repeat(300) }
          continued = true
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
          await new Promise(() => {})
        } finally { closed = true }
      }
    }
    llm.registerAdapter(['stub'], new WritingAdapter())
    const result = await generateAuxiliary({ llm, plugin: 'writing', route, system: 's', text: 't', maxTokens: 2048,
      maxAttempts: 2, insert: { maxChars: 240 }, signal: new AbortController().signal, live: () => true })
    expect(result).toMatchObject({ status: 'success', text: '雨'.repeat(240), attempts: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(continued).toBe(false); expect(closed).toBe(true); expect(signal?.aborted).toBe(true)
  })
  it('does not treat a short truncated candidate as successful', async () => {
    const llm = new LlmRuntime(new Context()); const adapter = new StubAdapter(); adapter.mode = 'max-tokens'
    llm.registerAdapter(['stub'], adapter)
    const result = await generateAuxiliary({ llm, plugin: 'writing', route, system: 's', text: 't', maxTokens: 16,
      maxAttempts: 1, insert: { maxChars: 1200 }, signal: new AbortController().signal, live: () => true })
    expect(result).toMatchObject({ status: 'failed', text: '', error: '输出被截断。' })
  })
  it('keeps caller cancellation authoritative even when the candidate reaches its limit', async () => {
    const llm = new LlmRuntime(new Context()); const controller = new AbortController()
    class CancelAdapter extends StubAdapter {
      async *stream(): AsyncIterable<StreamChunk> { controller.abort(); yield { type: 'text-delta', index: 0, text: '雨'.repeat(300) } }
    }
    llm.registerAdapter(['stub'], new CancelAdapter())
    const result = await generateAuxiliary({ llm, plugin: 'writing', route, system: 's', text: 't', maxTokens: 2048,
      maxAttempts: 1, insert: { maxChars: 240 }, signal: controller.signal, live: () => !controller.signal.aborted })
    expect(result).toMatchObject({ status: 'cancelled', text: '' })
  })
})
