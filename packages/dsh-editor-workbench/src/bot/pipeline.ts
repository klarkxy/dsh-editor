import { estimateTokens, formatExchangeRows, transcriptExchanges, type BotHistoryRow } from './transcript.ts'
import type { BotHandoffMode, BotState } from './state.ts'

export const VERBATIM_TEMPLATE = '以下是本作品之前对话的原文，不是作者的新消息。\n\n{transcript}'
export const SUMMARY_TEMPLATE = '以下是本作品之前对话的交接，不是作者的新消息。\n\n<handoff>\n{summary}\n</handoff>\n\n最近几轮对话原文：\n\n{tail}\n\n更早的对话可以用 conversation_search 和 conversation_read 查原文。'
export const TAIL_TEMPLATE = '以下是本作品之前对话最近几轮的原文，不是作者的新消息。更早的对话没有整理成摘要，需要时用 conversation_search 和 conversation_read 查原文。\n\n{tail}'

const VERBATIM_TOKEN_BUDGET = 16384
const SUMMARY_TAIL_EXCHANGES = 3
const SUMMARY_TAIL_TOKENS = 6000
const TAIL_DEFAULT_TOKENS = 16384
const TAIL_WINDOW_RATIO = 0.3

/** Truncate a single oversized exchange from its start so it fits the budget. */
function clipExchangeToBudget(lines: string, budget: number): string {
  if (estimateTokens(lines) <= budget) return lines
  const parts = lines.split('\n\n')
  while (parts.length > 1 && estimateTokens(parts.join('\n\n')) > budget) parts.shift()
  let text = parts.join('\n\n')
  while (text.length > 4 && estimateTokens(text) > budget) text = text.slice(Math.ceil(text.length / 8))
  return text
}

function formatExchange(exchange: BotHistoryRow[]): string {
  return formatExchangeRows(exchange)
}

/** Take whole exchanges newest-first while the joined text fits the token budget.
 *  Always include at least the last exchange, truncated from its start if it alone overflows. */
export function selectTailText(exchanges: BotHistoryRow[][], budget: number, maxCount?: number): string {
  const newest = exchanges[0]
  if (!newest) return ''
  const first = formatExchange(newest)
  if (estimateTokens(first) > budget) return clipExchangeToBudget(first, budget)
  const chosen: BotHistoryRow[][] = [newest]
  let used = estimateTokens(first)
  for (const exchange of exchanges.slice(1)) {
    if (maxCount !== undefined && chosen.length >= maxCount) break
    const formatted = formatExchange(exchange)
    const cost = estimateTokens(formatted)
    if (used + cost + 2 > budget) break
    chosen.unshift(exchange)
    used += cost + 2
  }
  return chosen.map(formatExchange).join('\n\n')
}

export type HandoffBuildInput = {
  transcript: BotHistoryRow[]
  storedHandoff?: { sessionId: string; coversThroughSeq: number; summary: string }
  /** Runs the section-3 side request; returns the summary text or undefined on failure. */
  summarize(): Promise<string | undefined>
  /** Usable context window for the new session when known (window − output cap). */
  targetUsableWindow?: number
  sourceSessionId: string
  state: BotState
}

export type HandoffBuildResult = { mode: BotHandoffMode; text?: string }

/** Fixed pipeline order for every rollover reason. */
export async function buildHandoff(input: HandoffBuildInput): Promise<HandoffBuildResult> {
  const rows = input.transcript
  if (!rows.length) return { mode: 'verbatim' }
  const lastSeq = rows.at(-1)!.seq
  const full = formatExchangeRows(rows)

  // 1. whole transcript fits → verbatim
  if (estimateTokens(full) <= VERBATIM_TOKEN_BUDGET) {
    return { mode: 'verbatim', text: VERBATIM_TEMPLATE.replace('{transcript}', full) }
  }

  const exchanges = transcriptExchanges(rows)
  const summaryTail = () => selectTailText(exchanges, SUMMARY_TAIL_TOKENS, SUMMARY_TAIL_EXCHANGES)
  const fullTail = () => {
    const window = input.targetUsableWindow
    const budget = window && window > 0 ? Math.min(TAIL_DEFAULT_TOKENS, Math.floor(window * TAIL_WINDOW_RATIO)) : TAIL_DEFAULT_TOKENS
    return selectTailText(exchanges, budget)
  }
  const summaryTemplate = (summary: string) =>
    SUMMARY_TEMPLATE.replace('{summary}', summary).replace('{tail}', summaryTail())

  // 2. stored summary already covers the transcript tail
  const stored = input.storedHandoff
  if (stored && stored.sessionId === input.sourceSessionId && stored.coversThroughSeq >= lastSeq && stored.summary) {
    return { mode: 'stored', text: summaryTemplate(stored.summary) }
  }

  // 3. fresh same-prefix summary
  const summary = await input.summarize()
  if (summary) return { mode: 'summarized', text: summaryTemplate(summary) }

  // 4. tail fallback
  return { mode: 'tail', text: TAIL_TEMPLATE.replace('{tail}', fullTail()) }
}
