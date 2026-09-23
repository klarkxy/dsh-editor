import {
  CONTRACT_SECTION, MOOD_PLUGIN, MOOD_SOURCE_KIND, excerptOf, type EvidenceRef,
} from './contracts.ts'

export interface ContentBlockLike { type?: string; text?: string }
export interface MessageSourceLike { kind?: string; plugin?: string; form?: string; sections?: Array<{ name?: string }> }
export interface UserMessageLike {
  id?: unknown
  role?: string
  content?: ContentBlockLike[]
  source?: MessageSourceLike
}
export interface SessionEventLike {
  seq: number
  type: string
  data?: unknown
}

export function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const row = block as ContentBlockLike
    if (row.type === 'text' && typeof row.text === 'string') parts.push(row.text)
  }
  return parts.join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function messageSource(value: unknown): MessageSourceLike | undefined {
  const row = asRecord(value)
  const source = asRecord(row?.source) ?? asRecord(asRecord(row?.message)?.source)
  return source as MessageSourceLike | undefined
}

export function isHumanUserMessage(message: UserMessageLike | undefined): boolean {
  return message?.source?.kind === 'user'
}

export function isMoodMessage(message: UserMessageLike | undefined): boolean {
  if (message?.source?.kind !== MOOD_SOURCE_KIND || message.source.plugin !== MOOD_PLUGIN) return false
  if (message.source.form === 'snapshot') {
    return Boolean(message.source.sections?.some(section => section.name === CONTRACT_SECTION))
  }
  return true
}

export function incomingAreAuxiliaryOnly(messages: readonly UserMessageLike[]): boolean {
  if (messages.length === 0) return true
  return messages.every(message => !isHumanUserMessage(message))
}

export interface HumanTurn {
  id: string
  seq?: number
  text: string
}

export function humanTextOf(message: UserMessageLike): string {
  return textFromContent(message.content)
}

function messageIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  return undefined
}

export function collectLogHumans(sessionId: string, events: readonly SessionEventLike[]): Array<HumanTurn & { evidence: EvidenceRef }> {
  const humans: Array<HumanTurn & { evidence: EvidenceRef }> = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const source = messageSource(event.data)
    if (source?.kind !== 'user') continue
    const data = asRecord(event.data)
    const text = textFromContent(data?.content)
    const excerpt = excerptOf(text)
    if (!excerpt) continue
    const id = messageIdOf(data?.id) ?? `log:${event.seq}`
    humans.push({
      id,
      seq: event.seq,
      text,
      evidence: excerpt ? { sessionId, seq: event.seq, kind: 'user', excerpt } : { sessionId, seq: event.seq, kind: 'user' },
    })
  }
  return humans
}

export function collectClaimedHumans(messages: readonly UserMessageLike[]): HumanTurn[] {
  const humans: HumanTurn[] = []
  for (const message of messages) {
    if (!isHumanUserMessage(message)) continue
    const id = messageIdOf(message.id)
    if (!id) continue
    const text = humanTextOf(message)
    if (!text.trim()) continue
    humans.push({ id, text })
  }
  return humans
}

export function latestUserSeq(events: readonly SessionEventLike[]): number {
  let seq = 0
  for (const event of events) {
    if (event.type === 'user/message' && messageSource(event.data)?.kind === 'user') seq = event.seq
  }
  return seq
}

/** Immutable claimed user-message ids only. Previous turn seq is not this request. */
export function sourceVersionOf(humans: readonly HumanTurn[]): string {
  return humans.map(item => item.id).filter(Boolean).join('|')
}

export function evidenceForRequest(
  sessionId: string,
  events: readonly SessionEventLike[],
  claimed: readonly HumanTurn[],
): EvidenceRef[] {
  const ids = new Set(claimed.map(item => item.id))
  if (ids.size === 0) return []
  const refs: EvidenceRef[] = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const data = asRecord(event.data)
    const id = messageIdOf(data?.id)
    if (!id || !ids.has(id)) continue
    if (messageSource(event.data)?.kind !== 'user') continue
    const excerpt = excerptOf(textFromContent(data?.content))
    refs.push(excerpt ? { sessionId, seq: event.seq, kind: 'user', excerpt } : { sessionId, seq: event.seq, kind: 'user' })
  }
  return refs
}

export function latestHumanText(events: readonly SessionEventLike[], messages: readonly UserMessageLike[]): string {
  const claimed = collectClaimedHumans(messages)
  if (claimed.length) return claimed.at(-1)!.text
  return collectLogHumans('', events).at(-1)?.text ?? ''
}
