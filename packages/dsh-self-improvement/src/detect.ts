import type { EvidenceRef, LessonTrigger } from './contracts.ts'

export interface SessionEventLike {
  type: string
  seq: number
  data: unknown
}

const HUMAN_CORRECTION = /^(?:不对(?:[，,：:\s]|$)|不是这样|你搞错了|纠正[：:]|更正[：:]|不要再|以后不要|我说的是|应该改成|that's wrong|that is wrong|you got it wrong|correction:|don't do that again|do not do that again|never do that again|i meant\b|i said\b)/i

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function excerptOf(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length <= 240 ? trimmed : `${trimmed.slice(0, 237)}...`
}

export function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  const parts: string[] = []
  for (const block of content) {
    const row = asRecord(block)
    if (!row) continue
    if (row.type === 'text' && typeof row.text === 'string') parts.push(row.text)
    else if (row.type === 'tool-result' && Array.isArray(row.content)) parts.push(textFromContent(row.content))
  }
  return parts.join('\n')
}

function sourceKind(data: unknown): string | undefined {
  const row = asRecord(data)
  const source = asRecord(row?.source)
  return typeof source?.kind === 'string' ? source.kind : undefined
}

export function isHumanUserMessage(event: SessionEventLike): boolean {
  return event.type === 'user/message' && sourceKind(event.data) === 'user'
}

export function lastHumanRequestText(events: readonly SessionEventLike[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || !isHumanUserMessage(event)) continue
    const text = textFromContent(asRecord(event.data)?.content).trim()
    if (text) return text
  }
  return ''
}

export function requestTextFromMessages(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const row = asRecord(messages[index])
    if (!row) continue
    const source = asRecord(row.source)
    if (source?.kind !== 'user') continue
    const text = textFromContent(row.content).trim()
    if (text) return text
  }
  return ''
}

function toolCallName(events: readonly SessionEventLike[], callId: string): string | undefined {
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const row = asRecord(event.data)
    if (row && String(row.callId) === callId && typeof row.name === 'string') return row.name
  }
  return undefined
}

function toolResultInfo(event: SessionEventLike): { callId: string; isError: boolean; text: string } | undefined {
  if (event.type !== 'tool/result') return undefined
  const row = asRecord(event.data)
  const message = asRecord(row?.message)
  const content = Array.isArray(message?.content) ? message.content : []
  const block = asRecord(content[0])
  const callId = String(block?.toolCallId ?? asRecord(message?.source)?.callId ?? '')
  if (!callId) return undefined
  const flagged = block?.isError === true || Boolean(row?.error)
  return { callId, isError: flagged, text: textFromContent(content) }
}

export function detectLessonTriggers(
  events: readonly SessionEventLike[],
  sessionId: string,
  afterSeq = -1,
): LessonTrigger[] {
  const triggers: LessonTrigger[] = []
  const seen = new Set<string>()
  const range = events.filter(event => event.seq > afterSeq).sort((a, b) => a.seq - b.seq)
  const priorActivity = events.some(event => event.seq <= afterSeq && (event.type === 'assistant/message' || event.type === 'tool/result' || event.type === 'tool/call'))
    || range.some(event => event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result')

  for (const event of range) {
    if (!isHumanUserMessage(event) || !priorActivity) continue
    const text = textFromContent(asRecord(event.data)?.content).trim()
    if (!text || !HUMAN_CORRECTION.test(text)) continue
    const evidence: EvidenceRef[] = [{ sessionId, seq: event.seq, kind: 'user', excerpt: excerptOf(text) }]
    const key = evidence.map(item => `${item.seq}:${item.kind}`).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    triggers.push({
      kind: 'human-correction',
      evidence,
      titleHint: excerptOf(text.split(/[。.!?\n]/, 1)[0] ?? text),
      contentHint: text,
    })
  }

  const results = range.flatMap(event => {
    const info = toolResultInfo(event)
    return info ? [{ event, ...info, name: toolCallName(events, info.callId) }] : []
  })
  const pendingFailure = new Map<string, { seq: number; text: string; name: string }>()
  for (const row of results) {
    const name = row.name ?? row.callId
    if (row.isError) {
      if (!pendingFailure.has(name)) pendingFailure.set(name, { seq: row.event.seq, text: row.text, name })
      continue
    }
    const failure = pendingFailure.get(name)
    if (!failure) continue
    pendingFailure.delete(name)
    const evidence: EvidenceRef[] = [
      { sessionId, seq: failure.seq, kind: 'tool', excerpt: excerptOf(failure.text || `${name} failed`) },
      { sessionId, seq: row.event.seq, kind: 'tool', excerpt: excerptOf(row.text || `${name} succeeded`) },
    ]
    const key = evidence.map(item => `${item.seq}:${item.kind}`).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    triggers.push({
      kind: 'verified-tool-fix',
      evidence,
      toolName: name,
      titleHint: `工具 ${name} 失败后已核实修复`,
      contentHint: `工具 ${name} 曾失败，随后同名调用返回非错误结果。失败摘录：${evidence[0]?.excerpt ?? ''}。成功摘录：${evidence[1]?.excerpt ?? ''}。`,
    })
  }
  return triggers
}

export function assistantSelfReportIsNotEvidence(text: string): boolean {
  return /我已经记住|我学会了|i(?:['’]ll| will) remember|i have learned|as i(?: have)? (?:fixed|learned)/i.test(text)
}
