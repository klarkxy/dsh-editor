import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { transcriptRows, type BotHistoryRow, type SessionEventLike } from './transcript.ts'
import { loadBotState, saveBotState, segmentOf } from './state.ts'

export type BotToolDeps = {
  /** Cold-read all events of a session (all surfaces, shadowed included). */
  readEvents(sessionId: string): Promise<SessionEventLike[]>
  /** Resolve the work root for a session; undefined when the session is not in a work. */
  workRoot(sessionId: string): Promise<string | undefined>
  /** Current event ceiling for the caller's session (exclude the in-flight turn). */
  currentSeqCeiling?(sessionId: string): number
}

function snippet(text: string, needle: string, around = 120): string {
  const index = text.indexOf(needle)
  if (index < 0) return text.slice(0, around)
  const start = Math.max(0, index - Math.floor(around / 2))
  const end = Math.min(text.length, start + around)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function formatRow(index: number, sessionId: string, row: BotHistoryRow, text: string): string {
  const when = row.time ? new Date(row.time).toISOString() : ''
  return `[${index}] ${sessionId} seq=${row.seq} ${when} ${row.role === 'user' ? '作者' : '搭档'}：${text}`
}

const textOutput = {
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: { text: { type: 'string' as const, required: true as const } },
  },
  render(_args: unknown, value: { text: string }) {
    return [{ type: 'text' as const, text: value.text }]
  },
}

export function createConversationSearchTool(ctx: Context, deps: BotToolDeps) {
  return defineTool({
    name: 'conversation_search',
    description: '在本作品之前的对话段里按字面文本查找原文片段（用户消息与搭档回复）。',
    parameters: {
      query: { type: 'string', required: true, description: '要查找的原文片段' },
      limit: { type: 'number', description: '最多返回条数（≤20）' },
    },
    output: textOutput,
    isConcurrencySafe() { return true },
    async execute(args: { query?: string; limit?: number }, exec: { agent?: { session: { id: string } } }) {
      const caller = exec.agent?.session.id
      const query = typeof args.query === 'string' ? args.query : ''
      const limit = Math.min(Math.max(Math.trunc(args.limit ?? 8) || 8, 1), 20)
      if (!caller || !query) return { text: '没有可查的内容。' }
      const root = await deps.workRoot(caller)
      if (!root) return { text: '当前会话不属于任何作品。' }
      const state = await loadBotState(root)
      const segments = [...state.segments].reverse()
      const out: string[] = []
      outer: for (let index = 0; index < segments.length; index++) {
        const segment = segments[index]!
        const rows = transcriptRows(await deps.readEvents(segment.sessionId))
        const ceiling = segment.sessionId === caller ? deps.currentSeqCeiling?.(caller) : undefined
        for (const row of [...rows].reverse()) {
          if (ceiling !== undefined && row.seq >= ceiling) continue
          if (!row.text.includes(query)) continue
          out.push(formatRow(index + 1, segment.sessionId, row, snippet(row.text, query)))
          if (out.length >= limit) break outer
        }
      }
      return { text: out.length ? out.join('\n') : `没有找到「${query}」。` }
    },
  })
}

export function createConversationReadTool(ctx: Context, deps: BotToolDeps) {
  return defineTool({
    name: 'conversation_read',
    description: '按 seq 读取本作品某个对话段里前后的对话原文。',
    parameters: {
      sessionId: { type: 'string', required: true, description: '对话段的 sessionId' },
      seq: { type: 'number', required: true, description: '目标消息序号' },
      before: { type: 'number', description: '向前条数（≤10）' },
      after: { type: 'number', description: '向后条数（≤10）' },
    },
    output: textOutput,
    isConcurrencySafe() { return true },
    async execute(args: { sessionId?: string; seq?: number; before?: number; after?: number }, exec: { agent?: { session: { id: string } } }) {
      const caller = exec.agent?.session.id
      const target = typeof args.sessionId === 'string' ? args.sessionId : ''
      const seq = typeof args.seq === 'number' ? Math.trunc(args.seq) : NaN
      const before = Math.min(Math.max(Math.trunc(args.before ?? 3) || 3, 0), 10)
      const after = Math.min(Math.max(Math.trunc(args.after ?? 3) || 3, 0), 10)
      if (!caller || !target || !Number.isFinite(seq)) return { text: '参数不完整。' }
      const root = await deps.workRoot(caller)
      if (!root) return { text: '当前会话不属于任何作品。' }
      const state = await loadBotState(root)
      if (!segmentOf(state, target) && target !== caller) {
        return { text: '该会话不在本作品的对话段里。' }
      }
      const rows = transcriptRows(await deps.readEvents(target))
      const at = rows.findIndex((row) => row.seq === seq)
      if (at < 0) return { text: `seq ${seq} 没有对应的消息。` }
      const slice = rows.slice(Math.max(0, at - before), Math.min(rows.length, at + after + 1))
      return { text: slice.map((row) => `seq=${row.seq} ${row.role === 'user' ? '作者' : '搭档'}：${row.text}`).join('\n\n') }
    },
  })
}

export function createConversationWrapUpTool(ctx: Context, deps: BotToolDeps) {
  return defineTool({
    name: 'conversation_wrap_up',
    description: '一个任务或话题告一段落时调用，本轮结束后产品会整理当前对话。',
    parameters: {
      reason: { type: 'string', description: '一句话说明（可选）' },
    },
    output: textOutput,
    isConcurrencySafe() { return false },
    async execute(_args: { reason?: string }, exec: { agent?: { session: { id: string } } }) {
      const caller = exec.agent?.session.id
      if (!caller) return { text: '当前会话无法记录。' }
      const root = await deps.workRoot(caller)
      if (!root) return { text: '当前会话不属于任何作品。' }
      const state = await loadBotState(root)
      state.wrapUpRequested = caller
      await saveBotState(root, state)
      return { text: '已记下：本轮结束后会整理对话。' }
    },
  })
}
