import { collectInsertText, sanitizeInsert } from './completion.ts'
import {
  extractFimText,
  isOfficialDeepSeekProvider,
  officialFimUrl,
  shouldFallbackBeta,
} from './fim-route.ts'

export type FimRoute = 'deepseek-fim' | 'chat'

export type FimStreamChunk = { type: string; text?: string }

export type FimContext = {
  get?: (name: string) => unknown
}

type CredentialBag = {
  resolve?: (ref: string) => Promise<{ value?: string } | undefined>
}

type LlmBag = {
  stream?: (options: Record<string, unknown>) => AsyncIterable<FimStreamChunk>
}

const CHAT_SYSTEM =
  '你是小说行内补全引擎。只输出应插入光标位置的短正文，不解释、不复述前后文，并自然衔接后文。不要用Markdown围栏。'

export async function resolveCredential(ctx: FimContext, ref: string): Promise<string> {
  const credentials = ctx.get?.('credentials') as CredentialBag | undefined
  const hit = await credentials?.resolve?.(ref)
  const fromStore = hit?.value?.trim() ?? ''
  if (fromStore) return fromStore
  return (process.env[ref] ?? '').trim()
}

async function officialFim(input: {
  apiKey: string
  model: string
  prefix: string
  suffix: string
  signal: AbortSignal
  baseURL?: string
  fetchImpl: typeof fetch
}): Promise<string> {
  const response = await input.fetchImpl(officialFimUrl(input.baseURL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prefix.slice(-5000),
      suffix: input.suffix.slice(0, 1500),
      max_tokens: 96,
      temperature: 0.7,
    }),
    signal: input.signal,
  })
  const raw = await response.text()
  if (!response.ok) {
    const error = new Error(`FIM HTTP ${response.status}: ${raw.slice(0, 180)}`)
    ;(error as Error & { status?: number }).status = response.status
    throw error
  }
  try {
    return extractFimText(JSON.parse(raw) as unknown)
  } catch {
    return ''
  }
}

async function chatFim(input: {
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
  baseURL?: string
  fetchImpl?: typeof fetch
}): Promise<{ text: string; route: FimRoute }> {
  const llm = (input.ctx.get?.('llm') ?? {}) as LlmBag
  const official = isOfficialDeepSeekProvider(input.provider, input.baseURL)
  if (official) {
    const apiKey = await resolveCredential(input.ctx, 'DEEPSEEK_API_KEY')
    if (apiKey) {
      try {
        const text = sanitizeInsert(
          await officialFim({
            apiKey,
            model: input.model,
            prefix: input.prefix,
            suffix: input.suffix,
            signal: input.signal,
            baseURL: input.baseURL || process.env.DEEPSEEK_BASE_URL,
            fetchImpl: input.fetchImpl ?? fetch,
          }),
        ).slice(0, 240)
        return { text, route: 'deepseek-fim' }
      } catch (error) {
        const status = (error as { status?: number }).status
        const message = error instanceof Error ? error.message : String(error)
        if (!shouldFallbackBeta(status, message)) {
          return { text: '', route: 'deepseek-fim' }
        }
      }
    }
  }
  const text = await chatFim({
    llm,
    provider: input.provider,
    model: input.model,
    prefix: input.prefix,
    suffix: input.suffix,
    signal: input.signal,
  })
  return { text, route: 'chat' }
}
