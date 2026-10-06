import { resolveFeatureModel, type FeatureModelRoute } from '@klarkxy/dsh-plugin-kit/llm-call'
import type { GenerateOptions, LlmCallConfig, PreparedLlmCall, ReasoningEffortId, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId as brandReasoningEffort } from '@deepseek-ai/dsh-llm'
import { createInsertCollector, sanitizeInsert } from './insert-output.ts'

export { createInsertCollector, sanitizeInsert }

export type StreamChunkLike = {
  type: string
  text?: string
  block?: { type?: string }
  reason?: {
    kind?: string
    failure?: {
      message?: string
    }
  }
}

/** Retired global AiPolicy defaults. Not a live policy service. */
export const WRITING_LIMITS = {
  concurrency: 1,
  timeoutMs: 60_000,
  maxInputChars: 32_000,
  maxOutputTokens: 2048,
} as const

const DEFAULT_MAX_CHARS = 240

const PURPOSE_PREF = {
  'manuscript.completion': 'completionModel',
  'manuscript.rewrite': 'rewriteModel',
} as const

/**
 * Race `work` with `signal`. Aborting does not settle a promise that ignores the signal.
 * The loser keeps running; only this wait returns.
 */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.then(() => undefined, () => undefined)
    return Promise.reject(abortError(signal))
  }
  return new Promise<T>((resolve, reject) => {
    const fail = () => {
      signal.removeEventListener('abort', fail)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', fail, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', fail)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', fail)
        reject(error)
      },
    )
  })
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

/** True only for the signal's own abort, not for a producer error observed while it is aborted. */
function isSignalAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false
  if (error === signal.reason) return true
  return !(signal.reason instanceof Error) && error instanceof Error && error.name === 'AbortError'
}

async function waitFor<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  return signal ? abortable(work, signal) : work
}

/** Invoke `return`, but do not wait past caller, timeout, disposal, or supersession. */
async function closeIterator(iterator: AsyncIterator<unknown>, signal: AbortSignal | undefined): Promise<unknown> {
  if (!iterator.return) return undefined
  let closing: Promise<void>
  try {
    closing = Promise.resolve(iterator.return()).then(() => undefined)
  } catch (error) {
    return error
  }
  if (signal?.aborted) {
    void closing.catch(() => undefined)
    return undefined
  }
  try {
    await waitFor(closing, signal)
    return undefined
  } catch (error) {
    if (signal?.aborted) {
      void closing.catch(() => undefined)
      return undefined
    }
    return error
  }
}

export async function collectInsertText(
  stream: AsyncIterable<StreamChunkLike>,
  options?: {
    maxChars?: number
    signal?: AbortSignal
    /** Stop the producer once visible text reaches the cap. Must not be the discard signal. */
    onCap?: () => void
  },
): Promise<string> {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS
  const signal = options?.signal
  const iterator = stream[Symbol.asyncIterator]()
  const collector = createInsertCollector(maxChars)
  let discard = false
  let primary: unknown
  try {
    if (signal?.aborted) {
      discard = true
    } else {
      while (!signal?.aborted) {
        const item = await waitFor(iterator.next(), signal)
        if (signal?.aborted) {
          discard = true
          break
        }
        if (item.done) break
        const chunk = item.value
        if (chunk.type === 'tool-call-delta' || chunk.type === 'tool-call' || (chunk.type === 'block-end' && chunk.block?.type === 'tool-call')) {
          throw new Error('辅助调用不使用工具。')
        }
        if (chunk.type === 'finish') {
          const kind = chunk.reason?.kind
          if (kind === 'aborted') {
            discard = true
            break
          }
          if (kind === 'error') throw new Error(chunk.reason?.failure?.message || '模型请求失败')
          if (kind === 'tool-calls') throw new Error('辅助调用不使用工具。')
          if (kind === 'max-tokens') {
            if (!collector.full) throw new Error('输出被截断。')
            break
          }
          // A missing kind is the historical stop chunk emitted before finish reasons.
          if (!kind || kind === 'stop') break
          throw new Error('模型调用失败。')
        }
        if (chunk.type !== 'text-delta' || typeof chunk.text !== 'string') continue
        collector.append(chunk.text)
        if (collector.full) {
          options?.onCap?.()
          break
        }
      }
    }
  } catch (error) {
    if (isSignalAbort(error, signal)) discard = true
    else primary = error
  }
  const cleanup = await closeIterator(iterator, signal)
  if (primary) throw primary
  if (cleanup) throw cleanup
  if (discard || signal?.aborted) return ''
  return collector.text()
}

export type WritingPurpose = {
  id: string
  label: string
}

export const WRITING_PURPOSES: WritingPurpose[] = [
  { id: 'manuscript.completion', label: '正文补全' },
  { id: 'manuscript.rewrite', label: '选区改写' },
]

type PreparedWritingCall = Pick<PreparedLlmCall, 'config' | 'stream'>

export type WritingContext = {
  llm?: {
    stream?(options: GenerateOptions): AsyncIterable<StreamChunk>
    prepareCall?(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedWritingCall>
  }
  get?(name: string, optional?: boolean): unknown
}

export type RunWritingAiInput = {
  ctx: WritingContext
  purpose: string
  sessionId?: string
  system: string
  text: string
  signal: AbortSignal
  maxChars: number
  provider?: string
  model?: string
  reasoningEffort?: string
  timeoutMs?: number
  maxInputChars?: number
}

type WritingScope = {
  readonly signal: AbortSignal
  readonly active: boolean
}

type Flight = AbortController

type CapacityWaiter = {
  readonly signal: AbortSignal
  grant: () => void
}

type ProviderLane = {
  active: number
  waiters: CapacityWaiter[]
}

type WritingState = {
  flights: Map<string, Flight>
  lanes: Map<string, ProviderLane>
  /** Current policy concurrency. Queue admission must not keep an older call's cap. */
  readConcurrency: () => number
}

const writingStates = new WeakMap<object, WritingState>()

function sessionKey(sessionId: string | undefined): string {
  const id = sessionId?.trim()
  return id ? id : ''
}

function stateFor(key: object): WritingState {
  let state = writingStates.get(key)
  if (!state) {
    state = { flights: new Map(), lanes: new Map(), readConcurrency: () => capacityOf(WRITING_LIMITS.concurrency) }
    writingStates.set(key, state)
  }
  return state
}

/** Latest same-activation, same-session, same-purpose attempt aborts the previous producer. */
function trackFlight(state: WritingState, purpose: string, sessionId: string | undefined): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController()
  const key = sessionKey(sessionId)
  if (!key) return { signal: controller.signal, release() {} }
  const flightKey = `${purpose}\0${key}`
  state.flights.get(flightKey)?.abort()
  state.flights.set(flightKey, controller)
  return {
    signal: controller.signal,
    release() {
      if (state.flights.get(flightKey) === controller) state.flights.delete(flightKey)
    },
  }
}

function capacityOf(limit: number): number {
  return Number.isSafeInteger(limit) && limit >= 1 ? limit : 1
}

function pump(state: WritingState, lane: ProviderLane): void {
  while (lane.waiters.length > 0) {
    const waiter = lane.waiters[0]!
    if (waiter.signal.aborted) {
      lane.waiters.shift()
      continue
    }
    if (lane.active >= state.readConcurrency()) return
    lane.waiters.shift()
    lane.active += 1
    waiter.grant()
  }
}

/** FIFO permit for one provider. Abort removes a waiter and does not hold a slot. */
function acquireProvider(state: WritingState, provider: string, signal: AbortSignal): Promise<() => void> {
  let lane = state.lanes.get(provider)
  if (!lane) {
    lane = { active: 0, waiters: [] }
    state.lanes.set(provider, lane)
  }
  const owned = lane
  const releaseSlot = (): void => {
    owned.active -= 1
    pump(state, owned)
  }
  const admit = (): (() => void) => {
    owned.active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      releaseSlot()
    }
  }
  // A raised limit admits the queue before this caller. A lowered limit leaves in-flight work running.
  pump(state, owned)
  if (signal.aborted) return Promise.reject(abortError(signal))
  if (owned.waiters.length === 0 && owned.active < state.readConcurrency()) return Promise.resolve(admit())
  let granted = false
  const permit = abortable(new Promise<void>((resolve, reject) => {
    const waiter: CapacityWaiter = {
      signal,
      grant() {
        granted = true
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
    }
    const onAbort = () => {
      const index = owned.waiters.indexOf(waiter)
      if (index >= 0) owned.waiters.splice(index, 1)
      reject(abortError(signal))
    }
    owned.waiters.push(waiter)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }), signal)
  return permit.then(() => {
    if (signal.aborted) {
      if (granted) releaseSlot()
      throw abortError(signal)
    }
    let released = false
    return () => {
      if (released) return
      released = true
      releaseSlot()
    }
  }, (error) => {
    if (granted) releaseSlot()
    throw error
  })
}

function requireLlm(ctx: WritingContext): NonNullable<WritingContext['llm']> {
  const llm = ctx.llm
  if (!llm?.stream && typeof llm?.prepareCall !== 'function') throw new Error('写作模型服务未启用')
  return llm
}

function scopeOf(ctx: WritingContext): WritingScope | undefined {
  const scope = ctx.get?.('manuscriptAiScope') as WritingScope | undefined
  if (!scope?.signal) return undefined
  return scope
}

function scopeClosed(scope: WritingScope | undefined): boolean {
  return Boolean(scope && (!scope.active || scope.signal.aborted))
}

/** Keep the resolved id, including explicit `off` / `none`. Blank is not an effort. */
function brandEffort(value: string | undefined): ReasoningEffortId | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  if (!id) return undefined
  return brandReasoningEffort(id)
}

function hostFace(ctx: WritingContext): {
  agents?: unknown
  sessionProjections?: unknown
  agentDefaultModel?: unknown
} {
  return {
    agents: ctx.get?.('agents', true),
    sessionProjections: ctx.get?.('sessionProjections', true),
    agentDefaultModel: ctx.get?.('agentDefaultModel', true),
  }
}

function purposeSaved(ctx: WritingContext, purpose: string): FeatureModelRoute | undefined {
  const field = purpose === 'manuscript.completion' || purpose === 'manuscript.rewrite' ? PURPOSE_PREF[purpose] : undefined
  if (!field) return undefined
  const snapshot = (ctx.get?.('editorWritingPreferences', true) as { read?: () => unknown } | undefined)?.read?.()
  if (snapshot == null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined
  const value = (snapshot as Record<string, unknown>)[field]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as FeatureModelRoute
}

function callOverride(input: RunWritingAiInput): FeatureModelRoute | undefined {
  if (typeof input.provider !== 'string' && typeof input.model !== 'string' && typeof input.reasoningEffort !== 'string') return undefined
  return {
    provider: typeof input.provider === 'string' ? input.provider : '',
    model: typeof input.model === 'string' ? input.model : '',
    ...(typeof input.reasoningEffort === 'string' ? { reasoningEffort: input.reasoningEffort } : {}),
  }
}

function resolveWritingRoute(input: RunWritingAiInput): FeatureModelRoute {
  const saved = purposeSaved(input.ctx, input.purpose) ?? callOverride(input)
  const route = resolveFeatureModel(hostFace(input.ctx), saved, sessionKey(input.sessionId) || undefined)
  if (!route) throw new Error('请先设置默认对话模型。')
  return route
}

function generateOptions(
  config: { provider: string; model: string; reasoningEffort?: ReasoningEffortId; maxTokens?: number; temperature?: number; stop?: string[] },
  input: { system: string; text: string; maxTokens: number; signal: AbortSignal },
): GenerateOptions {
  return {
    provider: config.provider,
    model: config.model,
    ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
    maxTokens: config.maxTokens !== undefined ? Math.min(input.maxTokens, config.maxTokens) : input.maxTokens,
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.stop ? { stop: [...config.stop] } : {}),
    system: input.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: input.text }] }],
    signal: input.signal,
  }
}

async function openWritingStream(
  ctx: WritingContext,
  route: FeatureModelRoute,
  input: { system: string; text: string; maxTokens: number; signal: AbortSignal },
  discard: AbortSignal,
): Promise<AsyncIterable<StreamChunkLike>> {
  const llm = requireLlm(ctx)
  const effort = brandEffort(route.reasoningEffort)
  const requested: LlmCallConfig = {
    provider: route.provider,
    model: route.model,
    ...(effort ? { reasoningEffort: effort } : {}),
    maxTokens: input.maxTokens,
  }
  if (typeof llm.prepareCall === 'function') {
    const prepared = await abortable(Promise.resolve(llm.prepareCall(requested, input.signal)), discard)
    return prepared.stream(generateOptions(prepared.config, input))
  }
  return llm.stream!(generateOptions(requested, input))
}

export async function runWritingAi(input: RunWritingAiInput): Promise<string> {
  if (input.signal.aborted) return ''
  requireLlm(input.ctx)
  const scope = scopeOf(input.ctx)
  if (scopeClosed(scope)) return ''
  const maxInputChars = input.maxInputChars ?? WRITING_LIMITS.maxInputChars
  const timeoutMs = input.timeoutMs ?? WRITING_LIMITS.timeoutMs
  const maxTokens = WRITING_LIMITS.maxOutputTokens
  if (input.system.length + input.text.length > maxInputChars) throw new Error('输入超出上限。')

  const state = stateFor(scope ?? input.ctx)
  state.readConcurrency = () => capacityOf(WRITING_LIMITS.concurrency)
  const flight = trackFlight(state, input.purpose, input.sessionId)
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const discard = AbortSignal.any([
    input.signal,
    flight.signal,
    timeoutSignal,
    ...(scope ? [scope.signal] : []),
  ])
  const producer = new AbortController()
  const stopProducer = (): void => {
    if (!producer.signal.aborted) producer.abort()
  }
  const suppressed = (): boolean => input.signal.aborted || flight.signal.aborted || scopeClosed(scope)
  const finish = (text = ''): string => {
    if (suppressed()) return ''
    if (timeoutSignal.aborted) throw new Error('调用超时。')
    return text
  }
  if (discard.aborted) stopProducer()
  else discard.addEventListener('abort', stopProducer, { once: true })

  let permit: (() => void) | undefined
  try {
    // Hosts may import older choices after the native Loader settles. Wait
    // within the same cancellation/timeout lifetime before reading a model.
    const preferences = input.ctx.get?.('editorWritingPreferences', true) as { modelsReady?: () => Promise<void> } | undefined
    if (typeof preferences?.modelsReady === 'function') {
      await abortable(Promise.resolve(preferences.modelsReady()), discard)
    }
    let route: FeatureModelRoute
    try {
      route = await abortable(Promise.resolve(resolveWritingRoute(input)), discard)
    } catch (error) {
      if (discard.aborted || scopeClosed(scope)) return finish()
      throw error
    }
    if (discard.aborted || scopeClosed(scope)) return finish()
    permit = await acquireProvider(state, route.provider, discard)
    if (discard.aborted || scopeClosed(scope)) return finish()
    const stream = await openWritingStream(input.ctx, route, {
      system: input.system,
      text: input.text,
      maxTokens,
      signal: producer.signal,
    }, discard)
    if (discard.aborted || scopeClosed(scope)) return finish()
    const text = await collectInsertText(stream, {
      maxChars: input.maxChars,
      signal: discard,
      onCap: stopProducer,
    })
    return finish(text)
  } catch (error) {
    // Timeout during iterator cleanup must not replace a failure next() or finish already reported.
    if (suppressed() || isSignalAbort(error, discard)) return finish()
    stopProducer()
    throw error
  } finally {
    discard.removeEventListener('abort', stopProducer)
    if (discard.aborted) stopProducer()
    permit?.()
    flight.release()
  }
}
