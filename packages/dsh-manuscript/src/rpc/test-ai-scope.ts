import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { StreamChunkLike } from './completion.ts'
import type { WritingContext } from '../llm-bridge.ts'

const LIMITS = {
  concurrency: 1,
  timeoutMs: 60_000,
  maxInputChars: 32_000,
  maxOutputTokens: 2048,
  maxAttempts: 1,
}

/** Direct `ctx.llm.stream` stand-in. Routing comes from `aiServices.resolve`, not `scope.run`. */
export function testAiScope(
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunkLike>,
  route: { provider?: string; model?: string; reasoningEffort?: string } = {},
): WritingContext {
  const resolved = {
    provider: route.provider ?? 'provider',
    model: route.model ?? 'model',
    ...route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {},
    source: 'purpose' as const,
    target: { kind: 'role' as const, role: 'weak' as const },
    policyRevision: 0,
  }
  const scope = { active: true, signal: new AbortController().signal, dispose() {} }
  return {
    llm: {
      stream(options) {
        return stream(options) as AsyncIterable<StreamChunk>
      },
    },
    get(name: string) {
      if (name === 'aiServices') {
        return {
          async resolve() { return resolved },
          getPolicy() {
            return { revision: 0, roles: {}, purposes: {}, limits: { ...LIMITS } }
          },
          purposes() { return [] },
          usage() { return [] },
        }
      }
      if (name === 'manuscriptAiScope') return scope
      return undefined
    },
  }
}
