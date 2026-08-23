import { collectInsertText } from './completion.ts'

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

async function streamCompletion(input: {
  llm: LlmBag
  provider: string
  model: string
  prefix: string
  suffix: string
  signal: AbortSignal
}): Promise<string> {
  if (!input.llm.stream) return ''
  const stream = input.llm.stream({
    provider: input.provider,
    model: input.model,
    maxTokens: 96,
    signal: input.signal,
    system: CHAT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `【光标前】\n${input.prefix.slice(-5000)}\n\n【光标后】\n${input.suffix.slice(0, 1500)}\n\n只输出插入内容：`,
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
  signal: AbortSignal
}): Promise<{ text: string; route: FimRoute }> {
  const llm = (input.ctx.get?.('llm') ?? {}) as LlmBag
  const text = await streamCompletion({
    llm,
    provider: input.provider,
    model: input.model,
    prefix: input.prefix,
    suffix: input.suffix,
    signal: input.signal,
  })
  return { text, route: 'dsh-llm' }
}
