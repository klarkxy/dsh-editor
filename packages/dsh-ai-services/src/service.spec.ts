import { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter, LlmRuntime, createUserMessage, isAgentLoopRequest, markAgentLoopRequest,
  type GenerateOptions, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_INVALID_ROUTE, AI_ROLE_UNSET, AI_UNKNOWN_ROLE } from './errors.ts'
import { AiServicesRuntime } from './service.ts'
import { defaultPolicy } from './storage.ts'
import type { AiPolicy, AuxiliaryRequest, ModelRoute, PurposeSpec } from './contracts.ts'

class StubAdapter extends LlmAdapter {
  streams = 0
  lastOptions: GenerateOptions | undefined
  inputs: string[] = []
  failTimes = 0
  failCode = 'RATE_LIMIT'
  text = 'ok'
  efforts = [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]
  gate: Promise<void> = Promise.resolve()
  unlock = () => {}
  hold(): void {
    this.gate = new Promise(resolve => { this.unlock = resolve })
  }
  async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, reasoning: { efforts: this.efforts } }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streams += 1
    this.lastOptions = options
    const block = options.messages[0]?.content[0]
    if (block && block.type === 'text') this.inputs.push(block.text)
    await this.gate
    if (options.signal?.aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
      return
    }
    if (this.failTimes > 0) {
      this.failTimes -= 1
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'transient', code: this.failCode } } }
      return
    }
    yield { type: 'text-delta', index: 0, text: this.text }
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function wait(): Promise<void> { return new Promise(resolve => setTimeout(resolve, 0)) }

function purpose(id = 'title'): PurposeSpec {
  return { id, label: '标题', defaultTarget: { kind: 'model', provider: 'stub', model: 'chat' } }
}

function request(patch: Partial<AuxiliaryRequest> = {}): AuxiliaryRequest {
  return { purpose: 'title', input: '章节', system: '系统', sourceVersion: 'v1', ...patch }
}

function harness(policy?: Partial<AiPolicy>, sessionModels?: (sessionId: string, signal?: AbortSignal) => Promise<ModelRoute>) {
  const ctx = new Context()
  const llm = new LlmRuntime(ctx)
  const adapter = new StubAdapter()
  llm.registerAdapter(['stub'], adapter)
  let failPolicy = false
  let failReceipts = false
  let receiptsHold: Promise<void> | undefined
  let releaseReceipts = () => {}
  const saved: { policy?: AiPolicy; receipts: unknown[]; writes: number } = { receipts: [], writes: 0 }
  const service = new AiServicesRuntime({
    llm,
    initialPolicy: { ...defaultPolicy(), ...policy, limits: { ...defaultPolicy().limits, ...policy?.limits } },
    store: {
      async savePolicy(next) {
        if (failPolicy) throw new Error('disk')
        saved.policy = next
      },
      async saveReceipts(items) {
        saved.writes += 1
        if (receiptsHold) await receiptsHold
        if (failReceipts) throw new Error('disk')
        saved.receipts = items
      },
    },
    sessionModels,
  })
  return {
    ctx, llm, adapter, service, saved,
    failNextPolicy() { failPolicy = true },
    failNextReceipts() { failReceipts = true },
    holdReceipts() {
      receiptsHold = new Promise(resolve => { releaseReceipts = resolve })
      return () => releaseReceipts()
    },
  }
}

const fixtures: AiServicesRuntime[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(item => item.dispose()))
})

function started(h: ReturnType<typeof harness>) {
  fixtures.push(h.service)
  return h
}

describe('AiServices contracts', () => {
  it('does not call the model until a feature runs a purpose', async () => {
    const { adapter, service } = started(harness())
    service.activate('mood')
    expect(adapter.streams).toBe(0)
    expect(service.usage()).toEqual([])
  })

  it('captures the route snapshot before the queue, ignoring later policy changes', async () => {
    const { adapter, service } = started(harness({
      roles: { normal: { provider: 'stub', model: 'chat' } },
      limits: { ...defaultPolicy().limits, concurrency: 1 },
    }))
    const scope = service.activate('mood')
    scope.registerPurpose({ id: 'title', label: '标题', defaultTarget: { kind: 'role', role: 'normal' } })
    adapter.hold()
    const first = scope.run(request({ priority: 'background' }))
    await vi.waitFor(() => expect(adapter.streams).toBe(1))
    const { revision, ...rest } = service.getPolicy()
    await service.updatePolicy({
      ...rest,
      roles: { normal: { provider: 'stub', model: 'other' } },
    }, revision)
    adapter.unlock()
    const second = scope.run(request({ priority: 'background' }))
    const firstResult = await first
    adapter.unlock()
    const secondResult = await second
    expect(firstResult.receipt.route?.model).toBe('chat')
    expect(secondResult.receipt.route?.model).toBe('other')
    expect(firstResult.receipt.route?.policyRevision).toBe(0)
  })

  it('rejects an unknown role without falling back', async () => {
    const { adapter, service } = started(harness({ roles: { normal: { provider: 'stub', model: 'chat' } } }))
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    const result = await scope.run(request({
      override: { kind: 'role', role: 'expert' as 'normal' },
    }))
    expect(result.receipt.status).toBe('failed')
    expect(result.receipt.error).toBe('未知模型角色。')
    expect(adapter.streams).toBe(0)
    await expect(service.resolve('title', undefined, { kind: 'role', role: 'expert' as 'normal' }))
      .rejects.toMatchObject({ code: AI_UNKNOWN_ROLE })
  })

  it('inherits unset weak/strong from configured normal and errors when normal is unset', async () => {
    const { service } = started(harness({ roles: { normal: { provider: 'stub', model: 'chat', reasoningEffort: 'low' } } }))
    const scope = service.activate('mood')
    scope.registerPurpose({ id: 'title', label: '标题', defaultTarget: { kind: 'role', role: 'weak' } })
    const weak = await service.resolve('title')
    expect(weak).toMatchObject({ provider: 'stub', model: 'chat', inheritedRole: 'normal', reasoningEffort: 'low' })
    const empty = started(harness())
    empty.service.activate('mood').registerPurpose({ id: 'title', label: '标题', defaultTarget: { kind: 'role', role: 'normal' } })
    await expect(empty.service.resolve('title')).rejects.toMatchObject({ code: AI_ROLE_UNSET })
  })

  it('does not fall back from an explicit invalid route', async () => {
    const { adapter, service } = started(harness({ roles: { normal: { provider: 'stub', model: 'chat' } } }))
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    const missing = await scope.run(request({ override: { kind: 'model', provider: 'missing', model: 'x' } }))
    expect(missing.receipt.status).toBe('failed')
    expect(adapter.streams).toBe(0)
    await expect(service.resolve('title', undefined, { kind: 'model', provider: 'stub', model: 'chat', reasoningEffort: 'ultra' }))
      .rejects.toMatchObject({ code: AI_INVALID_ROUTE })
    expect(adapter.streams).toBe(0)
  })

  it('reads the current session picker, not a last request header', async () => {
    const requestHeader = vi.fn(() => ({ provider: 'stale', model: 'old' }))
    const models = vi.fn(async (sessionId: string) => {
      expect(sessionId).toBe('session-1')
      expect(requestHeader).not.toHaveBeenCalled()
      return { provider: 'stub', model: 'chat', reasoningEffort: 'high' }
    })
    const { service } = started(harness(undefined, models))
    service.activate('mood').registerPurpose({ id: 'title', label: '标题', defaultTarget: { kind: 'session' } })
    const route = await service.resolve('title', 'session-1')
    expect(route).toMatchObject({ provider: 'stub', model: 'chat', reasoningEffort: 'high', target: { kind: 'session' } })
    expect(models).toHaveBeenCalledOnce()
  })

  it('cancels independently when one owner unloads', async () => {
    const { adapter, service } = started(harness({ limits: { ...defaultPolicy().limits, concurrency: 1 } }))
    const mood = service.activate('mood')
    const recap = service.activate('recap')
    mood.registerPurpose(purpose('title'))
    recap.registerPurpose(purpose('digest'))
    adapter.hold()
    const hung = mood.run(request({ purpose: 'title' }))
    await vi.waitFor(() => expect(adapter.streams).toBe(1))
    mood.dispose()
    const cancelled = await hung
    expect(cancelled.receipt.status).toBe('cancelled')
    expect(service.purposes().map(item => item.plugin)).toEqual(['recap'])
    adapter.unlock()
    const other = await recap.run(request({ purpose: 'digest' }))
    expect(other.receipt.status).toBe('success')
    expect(other.text).toBe('ok')
  })

  it('rejects a stale policy update and keeps the previous record when storage fails', async () => {
    const { service, saved, failNextPolicy } = started(harness())
    const { revision, ...rest } = service.getPolicy()
    await expect(service.updatePolicy(rest, revision + 1)).rejects.toMatchObject({ code: 'AI_POLICY_CONFLICT' })
    failNextPolicy()
    await expect(service.updatePolicy({
      ...rest,
      roles: { normal: { provider: 'stub', model: 'chat' } },
    }, revision)).rejects.toMatchObject({ code: 'AI_POLICY_SAVE_FAILED' })
    expect(service.getPolicy().roles.normal).toBeUndefined()
    expect(saved.policy).toBeUndefined()
    expect(service.storageFailedFlag).toBe(true)
  })

  it('bounds attempts to the policy cap and does not multiply adapter retries', async () => {
    const { adapter, service } = started(harness({
      limits: { ...defaultPolicy().limits, maxAttempts: 2 },
    }))
    adapter.failTimes = 10
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    const result = await scope.run(request())
    expect(result.receipt.status).toBe('failed')
    expect(result.receipt.attempts).toBe(2)
    expect(adapter.streams).toBe(2)
  })

  it('gives interactive work the next slot before background', async () => {
    const { adapter, service } = started(harness({ limits: { ...defaultPolicy().limits, concurrency: 1 } }))
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    adapter.hold()
    const background = scope.run(request({ priority: 'background', input: 'bg' }))
    await vi.waitFor(() => expect(adapter.streams).toBe(1))
    const interactive = scope.run(request({ priority: 'interactive', input: 'ui' }))
    const trailing = scope.run(request({ priority: 'background', input: 'later' }))
    await new Promise(resolve => setTimeout(resolve, 30))
    adapter.unlock()
    await Promise.all([background, interactive, trailing])
    expect(adapter.inputs).toEqual(['bg', 'ui', 'later'])
    expect(adapter.streams).toBe(3)
  })

  it('lets background work wait for an in-flight agent-loop request on the same provider', async () => {
    const { ctx, llm, adapter, service } = started(harness({ limits: { ...defaultPolicy().limits, concurrency: 2 } }))
    const on = ctx.on as unknown as (name: string, listener: (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>) => void
    on('llm/stream', (options, next) => {
      if (!isAgentLoopRequest(options)) return next()
      service.noteAgent(options.provider, 1)
      const stream = next()
      return (async function* () {
        try { yield* stream } finally { service.noteAgent(options.provider, -1) }
      })()
    }, { global: true, prepend: true } as never)
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    adapter.hold()
    const agentOptions = markAgentLoopRequest({
      provider: 'stub',
      model: 'chat',
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'agent' }] })],
    })
    const agent = llm.stream(agentOptions)
    const agentTask = (async () => { for await (const _chunk of agent) { /* drain */ } })()
    await vi.waitFor(() => expect(adapter.streams).toBe(1))
    const background = scope.run(request({ priority: 'background' }))
    await wait()
    expect(adapter.streams).toBe(1)
    adapter.unlock()
    await agentTask
    adapter.unlock()
    const result = await background
    expect(result.receipt.status).toBe('success')
    expect(adapter.streams).toBe(2)
  })

  it('rejects late completion after cancellation and does not publish text', async () => {
    const { adapter, service } = started(harness())
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    adapter.hold()
    const controller = new AbortController()
    const pending = scope.run(request({ signal: controller.signal }))
    await vi.waitFor(() => expect(adapter.streams).toBe(1))
    controller.abort()
    const result = await pending
    expect(result.receipt.status).toBe('cancelled')
    expect(result.text).toBe('')
    adapter.text = 'late-secret'
    adapter.unlock()
    await wait()
    expect(result.text).toBe('')
    expect(JSON.stringify(service.usage())).not.toContain('late-secret')
    expect(JSON.stringify(service.usage())).not.toContain('章节')
  })

  it('treats a stale isCurrent after await as superseded', async () => {
    const { adapter, service } = started(harness())
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    let current = true
    adapter.hold()
    const pending = scope.run(request({ isCurrent: () => current }))
    await vi.waitFor(() => expect(adapter.streams).toBe(1))
    current = false
    adapter.unlock()
    const result = await pending
    expect(result.receipt.status).toBe('superseded')
    expect(result.text).toBe('')
  })

  it('keeps auxiliary calls plain text without tools and records unknown cost as null', async () => {
    const { adapter, service } = started(harness())
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    const result = await scope.run(request())
    expect(result.receipt.status).toBe('success')
    expect(result.receipt.cost).toBeNull()
    expect(result.receipt.inputTokens).toBe(3)
    expect(adapter.lastOptions?.tools).toBeUndefined()
    expect(adapter.lastOptions?.messages).toHaveLength(1)
  })

  it('accepts scoped npm plugin identities and keeps name bounds', async () => {
    const { adapter, service } = started(harness())
    expect(() => service.activate('')).toThrow()
    expect(() => service.activate('   ')).toThrow()
    expect(() => service.activate('a'.repeat(81))).toThrow()
    const recap = service.activate('@klarkxy/dsh-recap')
    recap.registerPurpose(purpose())
    const result = await recap.run(request())
    expect(result.receipt.status).toBe('success')
    expect(result.receipt.plugin).toBe('@klarkxy/dsh-recap')
    expect(adapter.streams).toBe(1)
    const unscoped = service.activate('dsh-recap')
    unscoped.registerPurpose(purpose('digest'))
    const other = await unscoped.run(request({ purpose: 'digest' }))
    expect(other.receipt.status).toBe('success')
    expect(other.receipt.plugin).toBe('dsh-recap')
  })

  it('reclassifies a delayed receipt write and updates the same id', async () => {
    const { adapter, service, saved, holdReceipts } = started(harness())
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    let current = true
    const release = holdReceipts()
    const pending = scope.run(request({ isCurrent: () => current }))
    await vi.waitFor(() => expect(saved.writes).toBe(1))
    expect(adapter.streams).toBe(1)
    current = false
    release()
    const result = await pending
    expect(result.receipt.status).toBe('superseded')
    expect(result.text).toBe('')
    expect(service.usage().filter(item => item.id === result.receipt.id)).toHaveLength(1)
    expect(service.usage()[0]?.status).toBe('superseded')
  })

  it('emits cancelled with blank text when the owner disables during receipt write', async () => {
    const { service, saved, holdReceipts } = started(harness())
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    const release = holdReceipts()
    const pending = scope.run(request())
    await vi.waitFor(() => expect(saved.writes).toBe(1))
    scope.dispose()
    release()
    const result = await pending
    expect(result.receipt.status).toBe('cancelled')
    expect(result.text).toBe('')
    expect(service.usage().filter(item => item.id === result.receipt.id)).toHaveLength(1)
  })

  it('surfaces receipt storage failure without failing the task', async () => {
    const { service, failNextReceipts } = started(harness())
    const scope = service.activate('mood')
    scope.registerPurpose(purpose())
    failNextReceipts()
    const result = await scope.run(request())
    expect(result.receipt.status).toBe('success')
    expect(result.text).toBe('ok')
    expect(service.storageFailedFlag).toBe(true)
    expect(service.usage()).toHaveLength(1)
  })

  it('times out uncooperative route resolution before the queue starts', async () => {
    const hung = started(harness(
      { limits: { ...defaultPolicy().limits, timeoutMs: 1000 } },
      () => new Promise(() => {}),
    ))
    const scope = hung.service.activate('mood')
    scope.registerPurpose({ id: 'title', label: '标题', defaultTarget: { kind: 'session' } })
    const result = await scope.run(request({ sessionId: 's1' }))
    expect(result.receipt.status).toBe('cancelled')
    expect(result.receipt.error).toBe('调用超时。')
    expect(result.text).toBe('')
    expect(hung.adapter.streams).toBe(0)
  })

  it('cancels hung route resolution as soon as the owner disposes', async () => {
    const hung = started(harness(undefined, () => new Promise(() => {})))
    const scope = hung.service.activate('mood')
    scope.registerPurpose({ id: 'title', label: '标题', defaultTarget: { kind: 'session' } })
    const pending = scope.run(request({ sessionId: 's1' }))
    await wait()
    scope.dispose()
    const result = await pending
    expect(result.receipt.status).toBe('cancelled')
    expect(result.text).toBe('')
    expect(hung.adapter.streams).toBe(0)
  })

  it('runs only a purpose registered on the calling lease', async () => {
    const { adapter, service } = started(harness({
      purposes: { title: { kind: 'model', provider: 'stub', model: 'chat' } },
    }))
    const mood = service.activate('mood')
    const recap = service.activate('@klarkxy/dsh-recap')
    mood.registerPurpose(purpose())
    const borrowed = await recap.run(request())
    expect(borrowed.receipt.status).toBe('failed')
    expect(borrowed.receipt.error).toBe('用途未注册。')
    expect(adapter.streams).toBe(0)
    const unregistered = await recap.run(request({
      override: { kind: 'model', provider: 'stub', model: 'chat' },
    }))
    expect(unregistered.receipt.status).toBe('failed')
    expect(unregistered.receipt.error).toBe('用途未注册。')
    expect(adapter.streams).toBe(0)
    const stop = mood.registerPurpose(purpose('extra'))
    stop()
    const disabled = await mood.run(request({ purpose: 'extra' }))
    expect(disabled.receipt.status).toBe('failed')
    expect(disabled.receipt.error).toBe('用途未注册。')
    expect(adapter.streams).toBe(0)
    const owned = await mood.run(request())
    expect(owned.receipt.status).toBe('success')
    expect(adapter.streams).toBe(1)
  })
})
