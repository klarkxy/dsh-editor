import { normalizeSessionTitle } from './output.ts'
import type { TitleMessage, TitleSnapshot, TitleSourceKind } from './contracts.ts'

export interface SessionEventLike {
  readonly type: string
  readonly seq: number
  readonly time?: number
  readonly data?: {
    readonly source?: { readonly kind?: string; readonly plugin?: string; readonly provider?: string }
    readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>
    readonly title?: string
    readonly messageSeqs?: readonly number[]
  }
}

export interface SessionLike {
  readonly id: string
  readonly seq?: number
  snapshotEvents(): readonly SessionEventLike[]
  append?(type: string, data: unknown): unknown
}

function textFromContent(content: ReadonlyArray<{ readonly type?: string; readonly text?: string }> | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

/** Eligible human prompts only. Plugin/tool/model user-role rows are excluded. */
export function collectHumanMessages(events: readonly SessionEventLike[], throughSeq?: number): TitleMessage[] {
  const messages: TitleMessage[] = []
  for (const event of events) {
    if (throughSeq !== undefined && event.seq > throughSeq) break
    if (event.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    const text = textFromContent(event.data.content)
    if (normalizeSessionTitle(text, Number.MAX_SAFE_INTEGER).length === 0) continue
    messages.push({ seq: event.seq, text })
  }
  return messages
}

export function foldTitle(events: readonly SessionEventLike[]): TitleSnapshot | undefined {
  let latest: SessionEventLike | undefined
  for (const event of events) {
    if (event.type === 'session/title') latest = event
  }
  if (!latest?.data || typeof latest.data.title !== 'string') return undefined
  const kind = latest.data.source?.kind
  const sourceKind: TitleSourceKind = kind === 'user' || kind === 'fallback' || kind === 'provider' ? kind : 'provider'
  return {
    title: latest.data.title,
    messageSeqs: latest.data.messageSeqs ? [...latest.data.messageSeqs] : [],
    source: { kind: sourceKind, ...(typeof latest.data.source?.provider === 'string' ? { provider: latest.data.source.provider } : {}) },
    eventSeq: latest.seq,
    updatedAt: latest.time ?? 0,
  }
}

export function userRenameNewerThan(events: readonly SessionEventLike[], watermarkSeq: number): boolean {
  const current = foldTitle(events)
  return Boolean(current && current.source.kind === 'user' && current.eventSeq > watermarkSeq)
}

export function sourceVersionOf(sessionId: string, messages: readonly TitleMessage[]): string {
  const last = messages.at(-1)
  return `${sessionId}:${last?.seq ?? -1}:${messages.length}`
}
