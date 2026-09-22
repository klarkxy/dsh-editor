import {
  MAX_EXCERPT_CHARS,
  MAX_LOG_EVENTS,
  RECAP_PLUGIN,
  recapSourceVersion,
  type RecapFacts,
  type RecapLogEvent,
  type RecapSourceStatus,
  type RecapToolFact,
} from './contracts.ts'

type TurnEndReason = { kind?: unknown; error?: unknown }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function turnEndStatus(reason: unknown): Exclude<RecapSourceStatus, 'running'> | undefined {
  if (!reason || typeof reason !== 'object' || Array.isArray(reason)) return undefined
  const kind = (reason as TurnEndReason).kind
  if (kind === 'completed') return 'completed'
  if (kind === 'aborted') return 'cancelled'
  if (kind === 'error' || kind === 'blocked' || kind === 'max-tokens' || kind === 'interrupted') return 'failed'
  return undefined
}

export function isRecapAuxiliary(event: RecapLogEvent): boolean {
  if (event.type !== 'user/message' && event.type !== 'system/message') return false
  const source = messageSource(event)
  return source?.kind === 'plugin' && source.plugin === RECAP_PLUGIN
}

function messageSource(event: RecapLogEvent): { kind?: string; plugin?: string } | undefined {
  const record = asRecord(event.data)
  const nested = asRecord(record?.message)
  const source = asRecord(record?.source) ?? asRecord(nested?.source)
  return source as { kind?: string; plugin?: string } | undefined
}

export function textOf(value: unknown, limit = MAX_EXCERPT_CHARS): string {
  if (typeof value === 'string') return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
  if (!value || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) {
      const text = textOf(item, limit)
      if (text) parts.push(text)
    }
    return textOf(parts.join('\n'), limit)
  }
  const record = asRecord(value)
  if (!record) return ''
  if (record.type === 'text' && typeof record.text === 'string') return textOf(record.text, limit)
  if (record.type === 'tool-result') {
    if (Array.isArray(record.content)) return textOf(record.content, limit)
    if (typeof record.text === 'string') return textOf(record.text, limit)
  }
  if (typeof record.text === 'string') return textOf(record.text, limit)
  if (record.content !== undefined) return textOf(record.content, limit)
  if (record.message !== undefined) return textOf(record.message, limit)
  return ''
}

export function looksLikeProposal(name: string, resultText: string): boolean {
  if (/propos/i.test(name)) return true
  return resultText.includes('dsh-editor.proposal')
}

function toolCallName(data: Record<string, unknown> | undefined): string {
  const name = data?.name
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'tool'
}

export function toolCallIdentity(event: RecapLogEvent): { callId: string; name: string } | undefined {
  if (event.type !== 'tool/call') return undefined
  const data = asRecord(event.data)
  const callId = typeof data?.callId === 'string' && data.callId ? data.callId : `seq:${event.seq}`
  return { callId, name: toolCallName(data) }
}

export function toolResultIdentity(event: RecapLogEvent): { callId?: string; error: boolean; cancelled: boolean } | undefined {
  if (event.type !== 'tool/result') return undefined
  const data = asRecord(event.data)
  const message = asRecord(data?.message)
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(data?.content) ? data.content : []
  const block = content.map(asRecord).find(row => row?.type === 'tool-result') ?? asRecord(content[0])
  const source = asRecord(message?.source)
  const raw = block?.toolCallId ?? source?.callId ?? data?.callId
  const callId = typeof raw === 'string' && raw ? raw : undefined
  const error = Boolean(data?.error) || block?.isError === true
  const code = asRecord(data?.error)?.code
  const cancelled = code === 'ABORTED' || code === 'CANCELLED' || code === 'aborted'
  return { callId, error, cancelled }
}

function toolOutcome(input: {
  matched: boolean
  callId?: string
  error: boolean
  cancelled: boolean
  proposedChange: boolean
}): RecapToolFact['outcome'] {
  if (input.cancelled) return 'cancelled'
  if (input.error) return 'failed'
  if (!input.callId) return 'unknown'
  if (!input.matched) return 'unverified'
  if (input.proposedChange) return 'unverified'
  return 'verified'
}

function pendingOutcome(status: RecapSourceStatus, proposedChange: boolean): RecapToolFact['outcome'] {
  if (status === 'cancelled') return 'cancelled'
  if (proposedChange) return 'unverified'
  return 'missing'
}

export function boundedEvents(events: readonly RecapLogEvent[], toSeq?: number): RecapLogEvent[] {
  const end = toSeq ?? Math.max(-1, ...events.map(event => event.seq), -1)
  const filtered = events.filter(event => Number.isFinite(event.seq) && event.seq >= 0 && event.seq <= end)
    .slice()
    .sort((a, b) => a.seq - b.seq)
  return filtered.length > MAX_LOG_EVENTS ? filtered.slice(filtered.length - MAX_LOG_EVENTS) : filtered
}

export function collectFacts(sessionId: string, events: readonly RecapLogEvent[], fromSeq = 0, toSeq?: number): RecapFacts {
  const window = boundedEvents(events, toSeq).filter(event => event.seq >= fromSeq && !isRecapAuxiliary(event))
  const last = window.at(-1)
  const resolvedTo = toSeq ?? last?.seq ?? fromSeq
  let sourceStatus: RecapSourceStatus = 'running'
  let turn: number | undefined
  let stepCount = 0
  let userTurns = 0
  let toolCalls = 0
  let toolResults = 0
  let start = window[0]?.time
  let end = window[0]?.time
  let lastUserExcerpt: string | undefined
  const tools: RecapToolFact[] = []
  const pending = new Map<string, { seq: number; name: string; callId: string }>()

  for (const event of window) {
    start = start === undefined ? event.time : Math.min(start, event.time)
    end = end === undefined ? event.time : Math.max(end, event.time)
    if (event.type === 'turn/start' && event.data && typeof event.data === 'object') {
      const value = (event.data as { turn?: unknown }).turn
      if (typeof value === 'number') turn = value
    }
    if (event.type === 'step/start') stepCount += 1
    if (event.type === 'turn/end') {
      const data = event.data && typeof event.data === 'object' ? event.data as { turn?: unknown; reason?: unknown } : {}
      if (typeof data.turn === 'number') turn = data.turn
      sourceStatus = turnEndStatus(data.reason) ?? 'failed'
    }
    if (event.type === 'user/message') {
      const source = messageSource(event)
      if (source?.kind === 'user') {
        userTurns += 1
        const excerpt = textOf(event.data)
        if (excerpt) lastUserExcerpt = excerpt
      }
    }
    const call = toolCallIdentity(event)
    if (call) {
      toolCalls += 1
      pending.set(call.callId, { seq: event.seq, name: call.name, callId: call.callId })
    }
    const result = toolResultIdentity(event)
    if (result) {
      toolResults += 1
      const matched = result.callId ? pending.get(result.callId) : undefined
      if (matched && result.callId) pending.delete(result.callId)
      const name = matched?.name ?? 'unknown'
      const resultText = textOf(event.data, 2000)
      const proposedChange = looksLikeProposal(name, resultText)
      tools.push({
        name,
        callId: result.callId ?? matched?.callId,
        proposedChange,
        error: result.error,
        seq: event.seq,
        outcome: toolOutcome({
          matched: Boolean(matched),
          callId: result.callId,
          error: result.error,
          cancelled: result.cancelled,
          proposedChange,
        }),
      })
    }
  }

  for (const leftover of pending.values()) {
    const proposedChange = looksLikeProposal(leftover.name, '')
    tools.push({
      name: leftover.name,
      callId: leftover.callId,
      proposedChange,
      seq: leftover.seq,
      outcome: pendingOutcome(sourceStatus, proposedChange),
    })
  }
  tools.sort((a, b) => a.seq - b.seq)

  const proposals = tools.filter(tool => tool.proposedChange).length
  const constraints: string[] = []
  if (proposals > 0) constraints.push('工具提出的修改未确认已写入')
  if (sourceStatus === 'cancelled') constraints.push('本段任务已取消')
  if (sourceStatus === 'failed') constraints.push('本段任务未成功结束')

  return {
    sessionId,
    fromSeq: window[0]?.seq ?? fromSeq,
    toSeq: resolvedTo,
    sourceVersion: recapSourceVersion(sessionId, resolvedTo),
    sourceStatus,
    turn,
    stepCount,
    userTurns,
    toolCalls,
    toolResults,
    proposals,
    durationMs: start === undefined || end === undefined ? 0 : Math.max(0, end - start),
    lastUserExcerpt,
    tools,
    constraints,
  }
}

export function isLongTask(facts: RecapFacts): boolean {
  if (facts.sourceStatus === 'running') return false
  return facts.durationMs >= 60_000 || facts.stepCount >= 2 || facts.toolCalls >= 3
}

function toolLine(tool: RecapToolFact): string {
  if (tool.proposedChange) return `${tool.name}：提出修改（未确认已写入）`
  if (tool.outcome === 'cancelled') return `${tool.name}：已取消`
  if (tool.outcome === 'failed' || tool.error) return `${tool.name}：调用失败`
  if (tool.outcome === 'missing') return `${tool.name}：结果缺失`
  if (tool.outcome === 'unknown') return `${tool.name}：未知`
  if (tool.outcome === 'unverified') return `${tool.name}：未核实`
  return `${tool.name}：已调用`
}

export function deterministicBody(facts: RecapFacts): string {
  const status = facts.sourceStatus === 'completed' ? '已完成' : facts.sourceStatus === 'cancelled' ? '已取消' : facts.sourceStatus === 'failed' ? '未成功结束' : '进行中'
  const lines = [`状态：${status}`]
  if (facts.userTurns) lines.push(`作者消息：${facts.userTurns}`)
  if (facts.toolCalls) lines.push(`工具调用：${facts.toolCalls}`)
  if (facts.proposals) lines.push(`提出修改：${facts.proposals} 项（未确认是否已写入）`)
  for (const tool of facts.tools.slice(-8)) lines.push(toolLine(tool))
  if (facts.lastUserExcerpt) lines.push(`最近作者说明：${facts.lastUserExcerpt}`)
  return lines.join('\n')
}

export function deterministicTitle(facts: RecapFacts): string {
  if (facts.sourceStatus === 'cancelled') return '回顾 · 已取消'
  if (facts.sourceStatus === 'failed') return '回顾 · 未成功'
  if (facts.sourceStatus === 'completed') return '回顾 · 已完成'
  return '回顾'
}

export function deterministicReceiptsSuffice(facts: RecapFacts): boolean {
  return facts.toolCalls === 0 && facts.stepCount <= 1
}

export function incomingMessagesAreRecapOnly(messages: ReadonlyArray<{ source?: { kind?: string; plugin?: string } }>): boolean {
  return messages.length > 0 && messages.every(message => message.source?.kind === 'plugin' && message.source.plugin === RECAP_PLUGIN)
}
