import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  LESSON_INJECTION_SECTION, SELF_IMPROVEMENT_PLUGIN, SELF_IMPROVEMENT_SOURCE_KIND,
  type LessonInjectPayload, type MemoryRecord, type PreStepDecision,
} from './contracts.ts'
import { formatLessonSnapshot, lessonSnapshotPrefix } from './recall.ts'

export function isSelfImprovementLessonMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false
  const row = message as { source?: { kind?: string; plugin?: string; form?: string; sections?: Array<{ name?: string }> } }
  if (row.source?.kind !== SELF_IMPROVEMENT_SOURCE_KIND || row.source.plugin !== SELF_IMPROVEMENT_PLUGIN) return false
  return row.source.form === 'snapshot'
    && Boolean(row.source.sections?.some(section => section.name === LESSON_INJECTION_SECTION))
}

export function lessonInjectPayload(lessons: readonly MemoryRecord[]): LessonInjectPayload {
  const text = formatLessonSnapshot(lessons)
  return {
    source: {
      kind: SELF_IMPROVEMENT_SOURCE_KIND,
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
