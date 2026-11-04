import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'

export const BOT_SUMMARY_INSTRUCTION = '请暂停当前工作，整理到目前为止的对话。不要调用任何工具，只输出下面两段：\n'
  + '<recap>\n给作者看的回顾，三到六行：做了什么、当前进度、等作者处理的事、建议的下一步。\n</recap>\n'
  + '<handoff>\n给接手的写作搭档看的交接：作品与当前任务的背景；已经定下的决定和作者的明确要求，作者原话照录；当前进度与未完成事项；涉及的文件路径。不要复述正文全文。\n</handoff>'

export type BotSummaryResult = { recap: string; handoff: string; provider: string; model: string }

type LlmHost = {
  llm: {
    stream(options: {
      provider: string
      model: string
      messages: unknown[]
      tools?: unknown
      toolHistory?: unknown
      sessionId?: string
      purpose?: 'compaction' | 'session-title'
    }): AsyncIterable<unknown>
  }
}

export function parseSummaryBlocks(text: string): { recap: string; handoff: string } | undefined {
  const recaps = [...text.matchAll(/<recap>([\s\S]*?)<\/recap>/g)]
  const handoffs = [...text.matchAll(/<handoff>([\s\S]*?)<\/handoff>/g)]
  const recap = recaps.at(-1)?.[1]?.trim() ?? ''
  const handoff = handoffs.at(-1)?.[1]?.trim() ?? ''
  if (!handoff) return undefined
  return { recap, handoff }
}

/**
 * Same-prefix side request (dsh-compaction-basic pattern): replay the session's
 * exact derived prefix plus one user instruction. Nothing is appended to the log.
 * Any tool call, error, abort, or missing/empty <handoff> block means failure.
 */
export async function summarizeSession(ctx: Context, session: Session, signal?: AbortSignal): Promise<BotSummaryResult | undefined> {
  const host = ctx as Context & LlmHost
  const header = session.requestHeader()
  const config = (header?.config ?? {}) as { provider?: string; model?: string }
  const provider = config.provider ?? ''
  const model = config.model ?? ''
  if (!provider || !model || signal?.aborted) return undefined
  let messages: unknown[]
  try {
    messages = session.deriveMessages()
  } catch {
    return undefined
  }
  if (!Array.isArray(messages) || !messages.length) return undefined
  try {
    const stream = host.llm.stream({
      provider,
      model,
      messages: [...messages, { role: 'user', content: [{ type: 'text', text: BOT_SUMMARY_INSTRUCTION }] }],
      tools: header?.tools,
      toolHistory: typeof session.toolHistory === 'function' ? session.toolHistory() : undefined,
      sessionId: session.id,
      purpose: 'compaction',
    })
    let text = ''
    let sawToolCall = false
    for await (const chunk of stream) {
      if (signal?.aborted) return undefined
      const block = chunk as { type?: string; delta?: string; text?: string; toolCall?: unknown }
      if (block.type === 'tool-call' || block.toolCall) { sawToolCall = true; break }
      if (block.type === 'error' || block.type === 'aborted') return undefined
      if (typeof block.delta === 'string') text += block.delta
      else if (typeof block.text === 'string') text += block.text
    }
    if (sawToolCall) return undefined
    const parsed = parseSummaryBlocks(text)
    if (!parsed) return undefined
    return { ...parsed, provider, model }
  } catch {
    return undefined
  }
}
