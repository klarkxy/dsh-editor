import {
  MEMORY_INJECTION_SECTION, MEMORY_PLUGIN, MEMORY_SOURCE_KIND,
  type InjectedMemoryMessage, type MemoryRecord, type PreStepDecision,
} from './contracts.ts'
import { estimateTokens, formatMemorySnapshot } from './recall.ts'

export function isMemoryInjectMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false
  const row = message as { source?: { kind?: string; plugin?: string; form?: string; sections?: Array<{ name?: string }> } }
  if (row.source?.kind !== MEMORY_SOURCE_KIND || row.source.plugin !== MEMORY_PLUGIN) return false
  return row.source.form === 'snapshot'
    && Boolean(row.source.sections?.some(section => section.name === MEMORY_INJECTION_SECTION))
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  const parts: string[] = []
  for (const block of content) {
    const row = asRecord(block)
    if (!row) continue
    if (row.type === 'text' && typeof row.text === 'string') parts.push(row.text)
  }
  return parts.join('\n')
}

/** Latest real human user text. Plugin snapshots are not human context. */
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

export function memoryInjectPayload(records: readonly MemoryRecord[]): InjectedMemoryMessage {
  const text = formatMemorySnapshot(records)
  return {
    content: [{ type: 'text', text }],
    source: {
      kind: MEMORY_SOURCE_KIND,
      plugin: MEMORY_PLUGIN,
      form: 'snapshot',
      sections: [{ name: MEMORY_INJECTION_SECTION, text }],
    },
  }
}

export function applyMemoryInjection(
  decision: PreStepDecision,
  records: readonly MemoryRecord[],
  createMessage: (payload: InjectedMemoryMessage) => unknown,
): PreStepDecision {
  if (decision.kind !== 'enter') return decision
  const without = decision.messages.filter(message => !isMemoryInjectMessage(message))
  if (records.length === 0) return { ...decision, messages: without }
  return { ...decision, messages: [createMessage(memoryInjectPayload(records)), ...without] }
}

export function stripMemoryInjection(decision: PreStepDecision): PreStepDecision {
  if (decision.kind !== 'enter') return decision
  return { ...decision, messages: decision.messages.filter(message => !isMemoryInjectMessage(message)) }
}

export { estimateTokens, formatMemorySnapshot }
