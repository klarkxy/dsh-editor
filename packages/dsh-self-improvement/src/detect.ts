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

/** Conservative fallback for explicit method instructions; semantic classification still runs when AI is available. */
export function isExplicitMethodInstruction(text: string): boolean {
  if (/```|[“”「」]|(?:角色|人物)(?:说|台词)|例如|假如|假设|这一次|仅这次|本次先|hypothetical|for example|only this time/i.test(text)) return false
  const durable = /以后|今后|每次|始终|总是|不要再|别再|\b(?:always|never)\b|from now on/i.test(text)
  const correction = HUMAN_CORRECTION.test(text) && /应该|不要|必须|\b(?:should|must)\b|don't|do not/i.test(text)
  const conditional = /(?:改稿|修改|写入|提交|调用|运行|执行|测试)(?:前|时).*(?:先|检查|核对|验证)|\b(?:when|before)\b.{1,80}\b(?:check|verify|read|test)\b/i.test(text)
  return (durable || correction || conditional)
    && /使用|读取|检查|核对|验证|搜索|修改|写入|保留|删除|运行|执行|测试|调用|确认|比较|重试|提交|保存|拆分|用(?:相对|绝对)路径|\b(?:use|read|check|verify|test|keep|preserve|avoid|write|retry)\b/i.test(text)
}

function callInfo(event: SessionEventLike): { callId: string; name: string; target: string; arguments: string } | undefined {
  if (event.type !== 'tool/call') return undefined
  const row = asRecord(event.data)
  if (!row || typeof row.callId !== 'string' || typeof row.name !== 'string') return undefined
  let args: unknown = row.arguments
  if (typeof args === 'string') { try { args = JSON.parse(args) } catch { return undefined } }
  const values = asRecord(args)
  if (!values) return undefined
  const targetKeys = ['path', 'filePath', 'file', 'uri', 'url', 'resourceId', 'documentId', 'id', 'query', 'target']
  const targets = targetKeys.flatMap(key => typeof values[key] === 'string' && (values[key] as string).trim() ? [[key, values[key]]] : [])
  if (!targets.length) return undefined
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))))
  return { callId: row.callId, name: row.name, target: JSON.stringify([row.name, targets]), arguments: canonical }
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
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  const calls = new Map<string, NonNullable<ReturnType<typeof callInfo>>>()
  const failures = new Map<string, { event: SessionEventLike; text: string; call: NonNullable<ReturnType<typeof callInfo>> }>()
  let priorActivity = false
  for (const event of ordered) {
    if (isHumanUserMessage(event)) {
      // A new human request is a task boundary; never pair unrelated requests.
      failures.clear()
      calls.clear()
      const text = textFromContent(asRecord(event.data)?.content).trim()
      if (event.seq > afterSeq && text) {
        const kind = priorActivity && HUMAN_CORRECTION.test(text) ? 'human-correction'
          : isExplicitMethodInstruction(text) ? 'human-instruction'
          : priorActivity && /^(?:这个|这种|刚才的)(?:方法|做法|流程).*(?:有效|很好|成功)|^this (?:approach|method|workflow) (?:worked|was effective)/i.test(text) ? 'human-feedback' : undefined
        if (kind && !seen.has(`user:${event.seq}`)) {
          seen.add(`user:${event.seq}`)
          triggers.push({ kind, evidence: [{ sessionId, seq: event.seq, kind: 'user', excerpt: excerptOf(text) }],
            titleHint: excerptOf(text.split(/[。.!?\n]/, 1)[0] ?? text), contentHint: text })
        }
      }
      continue
    }
    if (event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result') priorActivity = true
    const call = callInfo(event)
    if (call) { calls.set(call.callId, call); continue }
    const result = toolResultInfo(event)
    if (!result) continue
    const called = calls.get(result.callId)
    if (!called) continue
    calls.delete(result.callId)
    if (result.isError) { failures.set(called.target, { event, text: result.text, call: called }); continue }
    const failure = failures.get(called.target)
    failures.delete(called.target)
    if (!failure || event.seq <= afterSeq || called.arguments === failure.call.arguments) continue
    const key = `${failure.event.seq}:${event.seq}`
    if (seen.has(key)) continue
    seen.add(key)
    const evidence: EvidenceRef[] = [
      { sessionId, seq: failure.event.seq, kind: 'tool', excerpt: excerptOf(failure.text) },
      { sessionId, seq: event.seq, kind: 'tool', excerpt: excerptOf(result.text) },
    ]
    triggers.push({
      kind: 'tool-recovery', evidence, toolName: called.name,
      titleHint: `工具 ${called.name} 的同目标恢复观察`,
      contentHint: `Same request and target, changed arguments. This is an observation, NOT verified task success. Before: ${failure.call.arguments.slice(0, 1500)}; after: ${called.arguments.slice(0, 1500)}. Results: ${JSON.stringify(evidence)}`,
    })
  }
  return triggers
}

export function assistantSelfReportIsNotEvidence(text: string): boolean {
  return /我已经记住|我学会了|i(?:['’]ll| will) remember|i have learned|as i(?: have)? (?:fixed|learned)/i.test(text)
}
