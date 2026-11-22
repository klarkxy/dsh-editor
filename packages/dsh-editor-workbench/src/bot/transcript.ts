import { BOT_INIT_SENTINEL } from '../contracts/channel.ts'
import { parseWritingChangeReceipt, WRITING_CHANGE_TOOL_NAME, type WritingChangeReceipt } from '../writing/change-contracts.ts'

/** Structural check mirroring dsh-compaction's COMPACT_CHECKPOINT_MARKER — avoids a runtime package dep. */
function isCompactCheckpointSource(source: unknown): boolean {
  return Boolean(source) && typeof source === 'object' && (source as { kind?: string }).kind === 'compact-checkpoint'
}

export { BOT_INIT_SENTINEL }

export type BotHistoryRow = {
  seq: number
  role: 'user' | 'assistant' | 'tool'
  text: string
  time: number
  writingChange?: WritingChangeReceipt
}

/** Shared CJK-aware estimator used by the handoff pipeline and tail budgets. */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0
    if ((cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3)
      || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFF00 && cp <= 0xFF60) || (cp >= 0x20000)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

export type SessionEventLike = {
  seq: number
  type: string
  data: unknown
  time?: number
}

function eventTime(event: SessionEventLike): number {
  const raw = (event as { time?: unknown }).time ?? (event as { at?: unknown }).at
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

function textBlocks(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const content = (data as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && typeof block === 'object' && (block as { type?: string }).type === 'text')
    .map((block) => String((block as { text?: string }).text ?? ''))
    .join('')
}

/** Original user/assistant text rows across all surfaces: shadowed included;
 *  compaction checkpoints, tool calls/results, reasoning and the init sentinel excluded. */
export function transcriptRows(events: readonly SessionEventLike[]): BotHistoryRow[] {
  const rows: BotHistoryRow[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      const data = event.data as { source?: unknown; content?: unknown } | undefined
      if (!data || isCompactCheckpointSource(data.source)) continue
      const text = textBlocks(data)
      if (!text || text.startsWith(BOT_INIT_SENTINEL)) continue
      rows.push({ seq: event.seq, role: 'user', text, time: eventTime(event) })
    } else if (event.type === 'assistant/message') {
      const data = event.data as { toolCalls?: unknown[]; content?: unknown } | undefined
      if (!data || (Array.isArray(data.toolCalls) && data.toolCalls.length > 0)) continue
      const text = textBlocks(data)
      if (!text) continue
      rows.push({ seq: event.seq, role: 'assistant', text, time: eventTime(event) })
    }
  }
  return rows
}

function writingChangeFromEvent(event: SessionEventLike): WritingChangeReceipt | undefined {
  const data = event.data
  if (!data || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  const name = typeof record['name'] === 'string' ? record['name']
    : typeof record['toolName'] === 'string' ? record['toolName']
      : (record['call'] && typeof record['call'] === 'object' && typeof (record['call'] as { name?: unknown }).name === 'string'
        ? (record['call'] as { name: string }).name : undefined)
  if (name !== undefined && name !== WRITING_CHANGE_TOOL_NAME) return undefined
  const text = typeof record['content'] === 'string' ? record['content'] : textBlocks(data)
  return parseWritingChangeReceipt(text)
}

/** Author-facing history: transcript rows plus verified writing_change receipts.
 *  Handoff/recall keep using transcriptRows so summaries stay text-only. */
export function transcriptDisplayRows(events: readonly SessionEventLike[]): BotHistoryRow[] {
  const rows = transcriptRows(events)
  const extras: BotHistoryRow[] = []
  for (const event of events) {
    if (event.type !== 'tool/result' && event.type !== 'tool-result') continue
    const receipt = writingChangeFromEvent(event)
    if (!receipt) continue
    extras.push({ seq: event.seq, role: 'tool', text: receipt.summary, time: eventTime(event), writingChange: receipt })
  }
  if (extras.length === 0) return rows
  return [...rows, ...extras].sort((a, b) => a.seq - b.seq)
}

/** Whole exchanges: an author message and everything until the next author message, newest first. */
export function transcriptExchanges(rows: readonly BotHistoryRow[]): BotHistoryRow[][] {
  const exchanges: BotHistoryRow[][] = []
  let current: BotHistoryRow[] = []
  for (const row of rows) {
    if (row.role === 'user' && current.length) {
      exchanges.unshift(current)
      current = []
    }
    current.push(row)
  }
  if (current.length) exchanges.unshift(current)
  return exchanges
}

export function formatExchangeRows(rows: readonly BotHistoryRow[]): string {
  return rows.map((row) => `${row.role === 'user' ? '作者' : '搭档'}：${row.text}`).join('\n\n')
}
