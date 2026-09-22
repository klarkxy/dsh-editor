import type { AiFeatureScope } from '@klarkxy/dsh-ai-services/contracts'
import type { GenerateConfig, TitleMessage } from './contracts.ts'
import { CONTRACT_VERSION, DEFAULT_MAX_OUTPUT_TOKENS, PROMPT_VERSION, PURPOSE_ID, SCHEMA_VERSION } from './contracts.ts'
import { frameMessages, selectRecentMessages } from './input.ts'
import { formatTitle, normalizeSessionTitle, parseModelTitle, resolveTitleLocale, type TitleLocaleMode } from './output.ts'
import { sourceVersionOf } from './messages.ts'

export interface GeneratedTitle {
  readonly title: string
  readonly messageSeqs: readonly number[]
  readonly model?: { readonly provider: string; readonly model: string }
  readonly sourceVersion: string
}

export function systemPrompt(config: GenerateConfig): string {
  return [
    'Name the current task in an AI coding-assistant session.',
    'Prioritize the newest human messages. Older messages are context only and must not keep a completed task in the title.',
    'Allowed type values: feature, fix, optimize, refactor, test, docs, release, config, explore, discuss.',
    'Return exactly one JSON object: {"type":"<type>","summary":"<summary>"}.',
    'Return no Markdown, code fence, explanation, date, or extra key.',
    'Keep the summary in the language of the recent messages.',
    `Aim for at most ${config.targetWords} non-CJK words or ${config.targetCjkCharacters} CJK characters.`,
  ].join('\n')
}

export function registerTitlePurpose(scope: AiFeatureScope): () => void {
  return scope.registerPurpose({
    id: PURPOSE_ID,
    label: '当前标题',
    defaultTarget: { kind: 'role', role: 'weak' },
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  })
}

export async function generateCurrentTitle(options: {
  scope: AiFeatureScope
  config: GenerateConfig
  sessionId: string
  messages: readonly TitleMessage[]
  localePreference?: string
  localeMode?: TitleLocaleMode
  signal: AbortSignal
  isCurrent: () => boolean
  now?: Date
}): Promise<GeneratedTitle> {
  options.signal.throwIfAborted()
  if (!options.scope.active || !options.isCurrent()) {
    throw Object.assign(new Error('dsh-current-title: generation is no longer current'), { code: 'superseded' })
  }
  const selected = selectRecentMessages(
    options.messages,
    options.config.maxRecentMessages,
    options.config.maxInputBytes,
  )
  if (selected.length === 0) throw new Error('dsh-current-title: at least one source message is required')

  const framedInput = frameMessages(selected)
  const locale = resolveTitleLocale(
    options.localeMode ?? options.config.locale,
    selected.map(message => message.text),
    options.localePreference,
  )
  const sourceVersion = sourceVersionOf(options.sessionId, selected)
  let settled = false
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => {
      if (settled) return
      reject(options.signal.reason ?? new Error('dsh-current-title: generation cancelled'))
    }
    if (options.signal.aborted) { fail(); return }
    options.signal.addEventListener('abort', fail, { once: true })
  })
  let result: Awaited<ReturnType<AiFeatureScope['run']>>
  try {
    result = await Promise.race([
      options.scope.run({
        purpose: PURPOSE_ID,
        sessionId: options.sessionId,
        input: framedInput,
        system: systemPrompt(options.config),
        sourceVersion,
        contractVersion: CONTRACT_VERSION,
        promptVersion: PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        signal: options.signal,
        isCurrent: () => options.scope.active && options.isCurrent(),
        priority: 'background',
      }),
      aborted,
    ])
  } finally {
    settled = true
  }
  options.signal.throwIfAborted()
  if (!options.scope.active || !options.isCurrent()) {
    throw Object.assign(new Error('dsh-current-title: generation is no longer current'), { code: 'superseded' })
  }
  if (result.receipt.status === 'cancelled' || result.receipt.status === 'superseded') {
    throw Object.assign(new Error('dsh-current-title: generation did not complete'), { code: result.receipt.status })
  }
  const parsed = parseModelTitle(result.text, options.config.targetWords, options.config.targetCjkCharacters)
  const title = normalizeSessionTitle(formatTitle(parsed, locale, options.now ?? new Date()), options.config.maxTitleBytes)
  if (!title) throw new Error('dsh-current-title: title model returned an empty summary')
  const route = result.receipt.route
  return {
    title,
    messageSeqs: selected.map(message => message.seq),
    ...(route?.provider && route.model ? { model: { provider: route.provider, model: route.model } } : {}),
    sourceVersion,
  }
}
