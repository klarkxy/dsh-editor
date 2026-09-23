import { createInsertCollector } from './insert-output.ts'
import {
  BlockAssembler, LlmError, ReasoningEffortId, createUserMessage,
  type GenerateOptions, type LlmRuntime, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { producerMessageSource, type ResolvedRoute } from './contracts.ts'
import { abortable, isAbortError, publicCallError } from './errors.ts'

export type LlmGenerate = Pick<LlmRuntime, 'prepareCall'>

export type GenerateOutcome = {
  text: string
  attempts: number
  inputTokens?: number
  outputTokens?: number
  error?: string
  status: 'success' | 'failed' | 'cancelled'
}

const PERMANENT_CODES = new Set([
  'NO_ADAPTER', 'UNSUPPORTED_REASONING_EFFORT', 'INVALID_PREPARED_CALL',
  'INVALID_CREDENTIAL', 'AUTH', 'MISSING_CREDENTIAL', 'QUOTA', 'CONTEXT_WINDOW_EXCEEDED',
])

function joinText(assembler: BlockAssembler): string {
  return assembler.blocks()
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('')
}

async function consume(
  stream: AsyncIterable<StreamChunk>,
  signal: AbortSignal,
  live: () => boolean,
  insert?: { maxChars: number; stop(): void },
): Promise<{ assembler: BlockAssembler; sawFinish: boolean; boundedText?: string; visibleText?: string }> {
  const assembler = new BlockAssembler()
  let sawFinish = false
  const collector = insert ? createInsertCollector(insert.maxChars) : undefined
  let boundedText: string | undefined
  const iterator = stream[Symbol.asyncIterator]()
  try {
    while (live()) {
      const item = await abortable(() => iterator.next(), signal)
      if (item.done) break
      if (item.value.type === 'finish') sawFinish = true
      assembler.push(item.value)
      if (collector && item.value.type === 'text-delta') {
        collector.append(item.value.text)
        if (collector.full && !sawFinish && !assembler.blocks().some(block => block.type === 'tool-call')) {
          boundedText = collector.text()
          insert!.stop()
          break
        }
      }
    }
  } finally {
    try { const closing = iterator.return?.(); if (closing) void closing.catch(() => {}) } catch { /* ignore a producer that does not honor abort */ }
  }
  return { assembler, sawFinish, boundedText, visibleText: collector?.text() }
}

function outcomeFromAssembler(
  assembler: BlockAssembler,
  signal: AbortSignal,
  sawFinish: boolean,
): Omit<GenerateOutcome, 'attempts'> {
  if (signal.aborted) return { text: '', status: 'cancelled', error: '调用已取消。' }
  const finish = assembler.finish
  const usage = assembler.usage
  const tokens = usage
    ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
    : {}
  if (finish.kind === 'aborted') return { text: '', status: 'cancelled', error: '调用已取消。', ...tokens }
  if (finish.kind === 'error') {
    return { text: '', status: 'failed', error: publicCallError(finish.failure.code), ...tokens }
  }
  if (!sawFinish) return { text: '', status: 'failed', error: '模型调用未完成。', ...tokens }
  if (finish.kind === 'max-tokens') return { text: '', status: 'failed', error: '输出被截断。', ...tokens }
  if (finish.kind === 'tool-calls' || assembler.blocks().some(block => block.type === 'tool-call')) {
    return { text: '', status: 'failed', error: '辅助调用不使用工具。', ...tokens }
  }
  if (finish.kind !== 'stop') return { text: '', status: 'failed', error: '模型调用失败。', ...tokens }
  return { text: joinText(assembler), status: 'success', ...tokens }
}

export async function generateAuxiliary(input: {
  llm: LlmGenerate
  plugin: string
  route: ResolvedRoute
  system: string
  text: string
  maxTokens: number
  maxAttempts: number
  insert?: { maxChars: number }
  signal: AbortSignal
  sessionId?: string
  live: () => boolean
}): Promise<GenerateOutcome> {
  const { llm, plugin, route, system, text, maxTokens, maxAttempts, signal, sessionId, live } = input
  let last: GenerateOutcome = { text: '', attempts: 0, status: 'failed', error: '模型调用失败。' }
  const boundAttempts = Math.max(1, Math.min(5, maxAttempts))
  for (let attempt = 1; attempt <= boundAttempts; attempt += 1) {
    if (signal.aborted) return { text: '', attempts: attempt - 1, status: 'cancelled', error: '调用已取消。' }
    if (!live()) return { ...last, attempts: attempt - 1 }
    try {
      const effort = route.reasoningEffort ? ReasoningEffortId(route.reasoningEffort) : undefined
      const prepared = await llm.prepareCall({
        provider: route.provider,
        model: route.model,
        ...(effort ? { reasoningEffort: effort } : {}),
        maxTokens,
      }, signal)
      if (signal.aborted) return { text: '', attempts: attempt - 1, status: 'cancelled', error: '调用已取消。' }
      if (!live()) return { ...last, attempts: attempt - 1 }
      const outputStop = new AbortController()
      const outputSignal = AbortSignal.any([signal, outputStop.signal])
      const options: GenerateOptions = {
        provider: prepared.config.provider,
        model: prepared.config.model,
        ...(prepared.config.reasoningEffort ? { reasoningEffort: prepared.config.reasoningEffort } : {}),
        ...(prepared.config.maxTokens !== undefined ? { maxTokens: Math.min(maxTokens, prepared.config.maxTokens) } : { maxTokens }),
        ...(prepared.config.temperature !== undefined ? { temperature: prepared.config.temperature } : {}),
        ...(prepared.config.stop ? { stop: [...prepared.config.stop] } : {}),
        system,
        messages: [createUserMessage({
          source: producerMessageSource(plugin),
          content: [{ type: 'text', text }],
        })],
        signal: outputSignal,
        ...(sessionId ? { sessionId: sessionId as GenerateOptions['sessionId'] } : {}),
      }
      const { assembler, sawFinish, boundedText, visibleText } = await consume(prepared.stream(options), signal, live,
        input.insert ? { ...input.insert, stop: () => outputStop.abort() } : undefined)
      if (boundedText !== undefined && !signal.aborted && live()) return { text: boundedText, status: 'success', attempts: attempt,
        ...(assembler.usage ? { inputTokens: assembler.usage.inputTokens, outputTokens: assembler.usage.outputTokens } : {}) }
      last = { ...outcomeFromAssembler(assembler, signal, sawFinish), attempts: attempt }
      if (last.status === 'success' && visibleText !== undefined) last.text = visibleText
      if (last.status !== 'failed') return last
      if (assembler.finish.kind !== 'error') return last
      const code = assembler.finish.failure.code
      if (PERMANENT_CODES.has(code)) return last
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return { text: '', attempts: attempt, status: 'cancelled', error: '调用已取消。' }
      }
      if (error instanceof LlmError) {
        last = { text: '', attempts: attempt, status: 'failed', error: publicCallError(error.code) }
        if (PERMANENT_CODES.has(error.code)) return last
      } else {
        last = { text: '', attempts: attempt, status: 'failed', error: '模型调用失败。' }
      }
    }
  }
  return last
}
