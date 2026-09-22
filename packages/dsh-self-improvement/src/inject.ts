import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  LESSON_INJECTION_SECTION, SELF_IMPROVEMENT_PLUGIN,
  type LessonInjectPayload, type MemoryRecord, type PreStepDecision,
} from './contracts.ts'
import { formatLessonSnapshot, lessonSnapshotPrefix } from './recall.ts'

type CreateUserMessage = (input: LessonInjectPayload & { readonly id?: never; readonly role?: never }) => unknown

function loadCreateUserMessage(): CreateUserMessage {
  const require = createRequire(import.meta.url)
  const candidates = [
    '@deepseek-ai/dsh-llm',
    fileURLToPath(new URL('../../dsh-ai-services/node_modules/@deepseek-ai/dsh-llm', import.meta.url)),
    fileURLToPath(new URL('../../dsh-memory/node_modules/@deepseek-ai/dsh-llm', import.meta.url)),
  ]
  for (const id of candidates) {
    try {
      const mod = require(id) as { createUserMessage?: CreateUserMessage }
      if (typeof mod.createUserMessage === 'function') return mod.createUserMessage
    } catch { /* try the next resolve path */ }
  }
  throw new Error('@deepseek-ai/dsh-llm createUserMessage is required')
}

const createUserMessage = loadCreateUserMessage()

export function isSelfImprovementLessonMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false
  const row = message as { source?: { kind?: string; plugin?: string; form?: string; sections?: Array<{ name?: string }> } }
  if (row.source?.kind !== 'plugin' || row.source.plugin !== SELF_IMPROVEMENT_PLUGIN) return false
  return row.source.form === 'snapshot'
    && Boolean(row.source.sections?.some(section => section.name === LESSON_INJECTION_SECTION))
}

export function lessonInjectPayload(lessons: readonly MemoryRecord[]): LessonInjectPayload {
  const text = formatLessonSnapshot(lessons)
  return {
    source: {
      kind: 'plugin',
      plugin: SELF_IMPROVEMENT_PLUGIN,
      form: 'snapshot',
      sections: [{ name: LESSON_INJECTION_SECTION, text }],
    },
    content: [{ type: 'text', text }],
  }
}

export function createLessonInjectionMessage(lessons: readonly MemoryRecord[]): unknown {
  return createUserMessage(lessonInjectPayload(lessons))
}

export function injectLessonMessages(decision: PreStepDecision, lessons: readonly MemoryRecord[]): PreStepDecision {
  if (decision.kind !== 'enter') return decision
  const without = decision.messages.filter(message => !isSelfImprovementLessonMessage(message))
  if (lessons.length === 0) return { ...decision, messages: without }
  return { ...decision, messages: [createLessonInjectionMessage(lessons), ...without] }
}

export { formatLessonSnapshot, lessonSnapshotPrefix }
