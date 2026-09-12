import { collectInsertText } from './completion.ts'
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

type LlmBag = {
  stream?: (options: Record<string, unknown>) => AsyncIterable<FimStreamChunk>
}

const CHAT_SYSTEM =
  '你是小说行内补全引擎。只输出应插入光标位置的短正文，不解释、不复述前后文，并自然衔接后文。不要用Markdown围栏。'

function fimSystem(input: { chapterContext: string; authorPreferences: string; projectRules?: string }): string {
  const system = withAuthorPreferences(
    withChapterContextGuidance(CHAT_SYSTEM, input.chapterContext),
    input.authorPreferences,
  )
  return input.projectRules != null ? composeProjectRules(system, input.projectRules) : system
}

async function streamCompletion(input: {
  llm: LlmBag
  provider: string
  model: string
  prefix: string
  suffix: string
  authorPreferences: string
  chapterContext: string
  projectRules?: string
  signal: AbortSignal
}): Promise<string> {
  if (input.signal.aborted) return ''
  if (!input.llm.stream) throw new Error('写作模型服务未启用')
  const stream = input.llm.stream({
    provider: input.provider,
    model: input.model,
    signal: input.signal,
    system: fimSystem(input),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${chapterContextUserPrefix(input.chapterContext)}【光标前】\n${input.prefix.slice(-5000)}\n\n【光标后】\n${input.suffix.slice(0, 1500)}\n\n只输出插入内容：`,
          },
        ],
      },
    ],
  })
  return collectInsertText(stream, { signal: input.signal, maxChars: 240 })
}

export async function completeFim(input: {
  ctx: FimContext
  provider: string
  model: string
  prefix: string
  suffix: string
  authorPreferences?: string
  chapterContext?: string
  projectRules?: string
  signal: AbortSignal
}): Promise<{ text: string; route: FimRoute }> {
  const llm = (input.ctx.get?.('llm') ?? {}) as LlmBag
  const text = await streamCompletion({
    llm,
    provider: input.provider,
    model: input.model,
    prefix: input.prefix,
    suffix: input.suffix,
    authorPreferences: input.authorPreferences ?? '',
    chapterContext: parseChapterContext(input.chapterContext),
    projectRules: input.projectRules,
    signal: input.signal,
  })
  return { text, route: 'dsh-llm' }
}
