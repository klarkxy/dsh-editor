import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { sessionModelsFromHost, streamReasoningEffort, validateRoute } from './routing.ts'
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

describe('host session routing', () => {
  it('uses the pending picker before request history', async () => {
    const requestHeader = vi.fn(() => ({ config: { provider: 'recorded', model: 'chat' } }))
    const session = { requestHeader }
    const stateOf = vi.fn(() => ({ pending: { provider: 'picked', model: 'next', reasoningEffort: 'off' } }))
    const read = sessionModelsFromHost(() => ({
      agents: { get: (id: string) => id === 'sid' ? { session } : undefined },
      sessionProjections: { stateOf },
      agentDefaultModel: { currentSelection: () => ({ provider: 'default', model: 'chat' }) },
    }))
    await expect(read('sid')).resolves.toEqual({ provider: 'picked', model: 'next', reasoningEffort: 'off' })
    expect(stateOf).toHaveBeenCalledWith(session, 'modelSelection')
    expect(requestHeader).not.toHaveBeenCalled()
  })

  it('uses the recorded request and then the host default when no picker is pending', async () => {
    const recorded = sessionModelsFromHost(() => ({
      agents: { get: () => ({ session: { requestHeader: () => ({ config: { provider: 'recorded', model: 'chat', reasoningEffort: 'none' } }) } }) },
      sessionProjections: { stateOf: () => ({ pending: null }) },
      agentDefaultModel: { currentSelection: () => ({ provider: 'default', model: 'fallback' }) },
    }))
    await expect(recorded('sid')).resolves.toEqual({ provider: 'recorded', model: 'chat', reasoningEffort: 'none' })
    const adapterDefaulted = sessionModelsFromHost(() => ({
      agents: { get: () => ({ session: { requestHeader: () => ({
        config: { provider: 'recorded', model: 'chat', reasoningEffort: 'high' },
        adapterDefaults: { reasoningEffort: true },
      }) } }) },
      sessionProjections: { stateOf: () => ({ pending: null }) },
      agentDefaultModel: { currentSelection: () => ({ provider: 'default', model: 'fallback' }) },
    }))
    await expect(adapterDefaulted('sid')).resolves.toEqual({ provider: 'recorded', model: 'chat' })
    const defaulted = sessionModelsFromHost(() => ({
      agents: { get: () => ({ session: { requestHeader: () => undefined } }) },
      sessionProjections: { stateOf: () => ({ pending: null }) },
      agentDefaultModel: { currentSelection: () => ({ provider: 'default', model: 'fallback' }) },
    }))
    await expect(defaulted('sid')).resolves.toEqual({ provider: 'default', model: 'fallback' })
  })

  it('fails when the Host cannot provide a live agent, projection, or valid selection', async () => {
    await expect(sessionModelsFromHost(() => undefined)('sid')).rejects.toMatchObject({ code: AI_SESSION_UNAVAILABLE })
    await expect(sessionModelsFromHost(() => ({ agents: { get: () => undefined }, sessionProjections: { stateOf: () => ({ pending: null }) } }))('sid'))
      .rejects.toMatchObject({ code: AI_SESSION_UNAVAILABLE })
    await expect(sessionModelsFromHost(() => ({
      agents: { get: () => ({ session: { requestHeader: () => undefined } }) },
      sessionProjections: { stateOf: () => undefined },
    }))('sid')).rejects.toMatchObject({ code: AI_SESSION_UNAVAILABLE })
    await expect(sessionModelsFromHost(() => ({
      agents: { get: () => ({ session: { requestHeader: () => undefined } }) },
      sessionProjections: { stateOf: () => ({ pending: { provider: 'stub' } }) },
    }))('sid')).rejects.toMatchObject({ code: AI_SESSION_INVALID })
  })

  it('preserves explicit off/none reasoning values', () => {
    expect(streamReasoningEffort('off')).toBe('off')
    expect(streamReasoningEffort('none')).toBe('none')
    expect(streamReasoningEffort('')).toBeUndefined()
    expect(streamReasoningEffort('  ')).toBeUndefined()
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
