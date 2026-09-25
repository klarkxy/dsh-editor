import type { LessonTrigger, MemoryRecord } from './contracts.ts'
import { isExplicitMethodInstruction } from './detect.ts'

type Procedure = NonNullable<MemoryRecord['procedure']>

export function parseProcedure(value: unknown): Procedure | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (row.origin !== 'instruction' && row.origin !== 'observation') return undefined
  if (typeof row.goal !== 'string' || !row.goal.trim() || row.goal.length > 400) return undefined
  const list = (key: string, min: number, maxChars: number): string[] | undefined => {
    const items = row[key]
    if (!Array.isArray(items) || items.length < min || items.length > 8) return undefined
    if (items.some(item => typeof item !== 'string' || !item.trim() || item.length > maxChars)) return undefined
    return (items as string[]).map(item => item.trim())
  }
  const when = list('when', 1, 200), steps = list('steps', 0, 400), avoid = list('avoid', 0, 200), verify = list('verify', 1, 200)
  if (!when || !steps || !avoid || !verify || (!steps.length && !avoid.length)) return undefined
  return { origin: row.origin, goal: row.goal.trim(), when, steps, avoid, verify }
}

export function formatProcedure(method: Procedure): string {
  return [
    `目标：${method.goal}`, `适用条件：${method.when.join('；')}`,
    ...(method.steps.length ? [`推荐步骤：${method.steps.join(' → ')}`] : []),
    ...(method.avoid.length ? [`避免：${method.avoid.join('；')}`] : []),
    `检查方式：${method.verify.join('；')}`,
  ].join('\n')
}

export function groundedProcedure(draft: { procedure?: Procedure; evidenceQuotes?: string[] }, trigger: LessonTrigger): boolean {
  if (!draft.procedure || !draft.evidenceQuotes?.length) return false
  if (draft.evidenceQuotes.some(quote => !trigger.evidence.some(ref => ref.excerpt?.includes(quote)))) return false
  if (draft.procedure.origin === 'instruction' && (!trigger.evidence.some(ref => ref.kind === 'user')
    || !draft.evidenceQuotes.some(isExplicitMethodInstruction))) return false
  return true
}

/** Tool recovery and positive outcome observations never auto-promote themselves. */
export function canAutoActivate(draft: { procedure?: Procedure }, trigger: LessonTrigger): boolean {
  return draft.procedure?.origin === 'instruction'
    && (trigger.kind === 'human-correction' || trigger.kind === 'human-instruction' || trigger.kind === 'human-feedback')
    && isExplicitMethodInstruction(trigger.contentHint)
}
