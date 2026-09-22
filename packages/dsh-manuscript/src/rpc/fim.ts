import type { AiFeatureScope } from '@klarkxy/dsh-ai-services/contracts'
import { runWritingAi } from '../ai-purposes.ts'
import {
  chapterContextUserPrefix,
  parseChapterContext,
  withAuthorPreferences,
  withChapterContextGuidance,
} from './author-preferences.ts'
import { composeProjectRules } from './project-rules.ts'

export type FimRoute = 'dsh-llm'

export type FimStreamChunk = { type: string; text?: string }

export type FimContext = {
  get?: (name: string) => unknown
}

const CHAT_SYSTEM =
  '你是文稿行内补全引擎。只输出应插入光标位置的短插入文本，不解释、不复述前后文，并自然衔接后文。不要用Markdown围栏。'

function fimSystem(input: { chapterContext: string; authorPreferences: string; projectRules?: string }): string {
  const system = withAuthorPreferences(
    withChapterContextGuidance(CHAT_SYSTEM, input.chapterContext),
    input.authorPreferences,
  )
  return input.projectRules != null ? composeProjectRules(system, input.projectRules) : system
}

async function streamCompletion(input: {
  scope?: AiFeatureScope
  sessionId?: string
  provider: string
  model: string
  reasoningEffort?: string
  prefix: string
  suffix: string
  authorPreferences: string
  chapterContext: string
  projectRules?: string
  signal: AbortSignal
}): Promise<string> {
  return runWritingAi({ scope: input.scope, purpose: 'manuscript.completion', sessionId: input.sessionId,
    system: fimSystem(input), text: `${chapterContextUserPrefix(input.chapterContext)}【光标前】\n${input.prefix.slice(-5000)}\n\n【光标后】\n${input.suffix.slice(0, 1500)}\n\n只输出插入内容：`, signal: input.signal, maxChars: 240 })
}

export async function completeFim(input: {
  sessionId?: string
  ctx: FimContext
  provider: string
  model: string
  reasoningEffort?: string
  prefix: string
  suffix: string
  authorPreferences?: string
  chapterContext?: string
  projectRules?: string
  signal: AbortSignal
}): Promise<{ text: string; route: FimRoute }> {
  const scope = input.ctx.get?.('manuscriptAiScope') as AiFeatureScope | undefined
  const text = await streamCompletion({
    scope,
    sessionId: input.sessionId,
    provider: input.provider,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prefix: input.prefix,
    suffix: input.suffix,
    authorPreferences: input.authorPreferences ?? '',
    chapterContext: parseChapterContext(input.chapterContext),
    projectRules: input.projectRules,
    signal: input.signal,
  })
  return { text, route: 'dsh-llm' }
}
