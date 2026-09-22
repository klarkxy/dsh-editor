import type { EvidenceRef, TaskContract } from './contracts.ts'
import { DEFAULT_QUESTION, MAX_QUESTIONS } from './contracts.ts'
import type { TriggerKind } from './trigger.ts'

export interface AnalysisDraft {
  goal: string
  deliverables: string[]
  inScope: string[]
  outOfScope: string[]
  constraints: string[]
  acceptance: string[]
  assumptions: string[]
  questions: string[]
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asList(value: unknown, max = 16): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const entry of value) {
    const text = asString(entry)
    if (!text) continue
    items.push(text.slice(0, 400))
    if (items.length >= max) break
  }
  return items
}

export function parseAnalysis(text: string): AnalysisDraft | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fence?.[1]?.trim() ?? trimmed
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const row = parsed as Record<string, unknown>
    const goal = asString(row.goal).slice(0, 2000)
    const questions = asList(row.questions, MAX_QUESTIONS)
    return {
      goal,
      deliverables: asList(row.deliverables),
      inScope: asList(row.inScope),
      outOfScope: asList(row.outOfScope),
      constraints: asList(row.constraints),
      acceptance: asList(row.acceptance),
      assumptions: asList(row.assumptions),
      questions,
    }
  } catch {
    return undefined
  }
}

export function boundQuestions(questions: readonly string[], kind: TriggerKind): string[] {
  const unique: string[] = []
  for (const question of questions) {
    const text = question.trim()
    if (!text) continue
    if (unique.includes(text)) continue
    unique.push(text.slice(0, 400))
    if (unique.length === MAX_QUESTIONS) return unique
  }
  if (unique.length === 0 && (kind === 'material' || kind === 'risk')) return [DEFAULT_QUESTION]
  return unique
}

export const ANALYZE_SYSTEM = [
  '你在确认写作任务需求。只根据给定的真实用户原文归纳。',
  '不要编造未给出的文件、人物、字数或验收条件。',
  '不要把需求确认写成文件修改或发布授权。',
  '返回一个 JSON 对象，不要 Markdown。',
  '键：goal, deliverables, inScope, outOfScope, constraints, acceptance, assumptions, questions。',
  `questions 最多 ${MAX_QUESTIONS} 条，仅在存在实质含糊或风险时提出；原文已经可执行则 questions 为空数组。`,
].join('\n')

export function thinContract(input: {
  id: string
  sessionId: string
  sourceVersion: string
  revision: number
  goal: string
  evidence: EvidenceRef[]
  readiness: TaskContract['readiness']
  now: number
  extra?: Partial<Pick<TaskContract, 'deliverables' | 'inScope' | 'outOfScope' | 'constraints' | 'acceptance' | 'assumptions' | 'questions'>>
}): TaskContract {
  return {
    id: input.id,
    sessionId: input.sessionId,
    sourceVersion: input.sourceVersion,
    revision: input.revision,
    goal: input.goal.slice(0, 2000),
    deliverables: input.extra?.deliverables ?? [],
    inScope: input.extra?.inScope ?? [],
    outOfScope: input.extra?.outOfScope ?? [],
    constraints: input.extra?.constraints ?? [],
    acceptance: input.extra?.acceptance ?? [],
    assumptions: input.extra?.assumptions ?? [],
    questions: input.extra?.questions ?? [],
    evidence: input.evidence,
    readiness: input.readiness,
    updatedAt: input.now,
  }
}

export function contractFromDraft(input: {
  id: string
  sessionId: string
  sourceVersion: string
  revision: number
  goalFallback: string
  evidence: EvidenceRef[]
  draft: AnalysisDraft | undefined
  questions: string[]
  readiness: TaskContract['readiness']
  now: number
}): TaskContract {
  const draft = input.draft
  return thinContract({
    id: input.id,
    sessionId: input.sessionId,
    sourceVersion: input.sourceVersion,
    revision: input.revision,
    goal: draft?.goal || input.goalFallback,
    evidence: input.evidence,
    readiness: input.readiness,
    now: input.now,
    extra: {
      deliverables: draft?.deliverables ?? [],
      inScope: draft?.inScope ?? [],
      outOfScope: draft?.outOfScope ?? [],
      constraints: draft?.constraints ?? [],
      acceptance: draft?.acceptance ?? [],
      assumptions: draft?.assumptions ?? [],
      questions: input.questions,
    },
  })
}

export const analyzePurpose = {
  id: 'mood.analyze',
  label: '需求澄清',
  defaultTarget: { kind: 'role' as const, role: 'normal' as const },
  maxOutputTokens: 1024,
  timeoutMs: 60_000,
}
