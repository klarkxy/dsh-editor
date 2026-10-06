import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { StreamChunkLike } from './completion.ts'
import type { WritingContext } from '../llm-bridge.ts'

/** Direct `ctx.llm.stream` stand-in. Routing comes from host prefs, then explicit fields, then native session/default. */
export function testAiScope(
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunkLike>,
  route: { provider?: string; model?: string; reasoningEffort?: string } = {},
  prefs: { completionModel?: { provider: string; model: string; reasoningEffort?: string }; rewriteModel?: { provider: string; model: string; reasoningEffort?: string } } = {},
): WritingContext {
  const resolved = {
    provider: route.provider ?? 'provider',
    model: route.model ?? 'model',
    ...route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {},
  }
  const scope = { active: true, signal: new AbortController().signal, dispose() {} }
  return {
    llm: {
      stream(options) {
        return stream(options) as AsyncIterable<StreamChunk>
      },
    },
    get(name: string) {
      if (name === 'editorWritingPreferences') return { read: () => prefs }
      if (name === 'agentDefaultModel') return { currentSelection: () => resolved }
      if (name === 'agents') return { get: () => undefined }
      if (name === 'sessionProjections') return { stateOf: () => undefined }
      if (name === 'manuscriptAiScope') return scope
      return undefined
    },
  }
}
