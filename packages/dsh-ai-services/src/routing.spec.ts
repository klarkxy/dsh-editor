import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { sessionModelsFromApi, streamReasoningEffort, validateRoute } from './routing.ts'
import { AI_INVALID_ROUTE, AI_SESSION_INVALID, AI_SESSION_UNAVAILABLE } from './errors.ts'

class StubAdapter extends LlmAdapter {
  async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }
  }
  async *stream() { yield { type: 'finish' as const, reason: { kind: 'stop' as const } } }
}

class OffAdapter extends LlmAdapter {
  async resolveModel(provider: string, model: string) {
    return {
      provider, id: model, name: model,
      reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'none', name: 'None' }, { id: 'low', name: 'Low' }] },
    }
  }
  async *stream() { yield { type: 'finish' as const, reason: { kind: 'stop' as const } } }
}

describe('session.models routing', () => {
  it('preserves explicit off/none reasoning and never reads requestHeader', async () => {
    expect(streamReasoningEffort('off')).toBe('off')
    expect(streamReasoningEffort('none')).toBe('none')
    expect(streamReasoningEffort('')).toBeUndefined()
    expect(streamReasoningEffort('  ')).toBeUndefined()
    const requestHeader = vi.fn()
    const models = vi.fn(async () => ({
      result: { ok: true, value: { current: { provider: 'stub', model: 'chat', reasoningEffort: 'off' }, routable: true } },
    }))
    const read = sessionModelsFromApi(() => ({ sessions: { models }, requestHeader }))
    await expect(read('sid')).resolves.toEqual({ provider: 'stub', model: 'chat', reasoningEffort: 'off' })
    expect(requestHeader).not.toHaveBeenCalled()
    expect(models).toHaveBeenCalledWith(expect.objectContaining({
      method: 'session.models',
      payload: { sessionId: 'sid' },
    }))
  })

  it('fails when the picker is unroutable or the proxy is missing', async () => {
    await expect(sessionModelsFromApi(() => undefined)('sid')).rejects.toMatchObject({ code: AI_SESSION_UNAVAILABLE })
    const read = sessionModelsFromApi(() => ({
      sessions: { models: async () => ({ result: { ok: true, value: { current: { provider: 'stub', model: 'chat' }, routable: false } } }) },
    }))
    await expect(read('sid')).rejects.toMatchObject({ code: AI_SESSION_INVALID })
  })

  it('validates model and reasoning through the pinned llm APIs', async () => {
    const llm = new LlmRuntime(new Context())
    llm.registerAdapter(['stub'], new StubAdapter())
    await expect(validateRoute(llm, { provider: 'stub', model: 'chat', reasoningEffort: 'low' })).resolves.toBeUndefined()
    await expect(validateRoute(llm, { provider: 'stub', model: 'chat', reasoningEffort: 'ultra' }))
      .rejects.toMatchObject({ code: AI_INVALID_ROUTE })
    await expect(validateRoute(llm, { provider: 'missing', model: 'chat' }))
      .rejects.toMatchObject({ code: AI_INVALID_ROUTE })
    await expect(validateRoute(llm, { provider: 'stub', model: 'chat', reasoningEffort: 'off' }))
      .rejects.toMatchObject({ code: AI_INVALID_ROUTE })
    const withOff = new LlmRuntime(new Context())
    withOff.registerAdapter(['stub'], new OffAdapter())
    await expect(validateRoute(withOff, { provider: 'stub', model: 'chat', reasoningEffort: 'off' })).resolves.toBeUndefined()
    await expect(validateRoute(withOff, { provider: 'stub', model: 'chat', reasoningEffort: 'none' })).resolves.toBeUndefined()
    await expect(validateRoute(withOff, { provider: 'stub', model: 'chat' })).resolves.toBeUndefined()
  })
})
