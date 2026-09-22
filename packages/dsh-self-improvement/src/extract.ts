import { LESSON_SCHEMA_TAG, LESSON_SCHEMA_VERSION, type EvidenceRef, type LessonTrigger, type MemoryRecord, type NewMemoryRecord } from './contracts.ts'
import { evidenceWatermark } from './contracts.ts'

export interface ParsedLessonDraft {
  title: string
  content: string
  exceptions: string[]
}

/** Matches Memory `newMemoryRecordSchema` field caps so create does not fail as 记忆条目格式无效. */
const TITLE_MAX = 160
const CONTENT_MAX = 4000
const TAG_MAX = 40
const EXCEPTION_MAX = 200
const EXCERPT_MAX = 400
const LIST_MAX = 16

const SKIP = { skip: true as const }

function clip(value: string, max: number): string {
  return value.trim().slice(0, max)
}

function schemaTags(): string[] {
  return [LESSON_SCHEMA_TAG].filter(tag => tag.length > 0 && tag.length <= TAG_MAX).slice(0, LIST_MAX)
}

function schemaEvidence(refs: readonly EvidenceRef[]): EvidenceRef[] {
  return refs.slice(0, LIST_MAX).map(ref => {
    const excerpt = ref.excerpt ? clip(ref.excerpt, EXCERPT_MAX) : undefined
    return excerpt
      ? { sessionId: ref.sessionId, seq: ref.seq, kind: ref.kind, excerpt }
      : { sessionId: ref.sessionId, seq: ref.seq, kind: ref.kind }
  })
}

export function parseExtraction(text: string): ParsedLessonDraft | typeof SKIP | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? trimmed).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(body.slice(start, end + 1)) } catch { return undefined }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const row = parsed as Record<string, unknown>
  if (row.skip === true) return SKIP
  if (typeof row.title !== 'string' || typeof row.content !== 'string') return undefined
  const title = clip(row.title, TITLE_MAX)
  const content = clip(row.content, CONTENT_MAX)
  if (!title || !content) return undefined
  const exceptions = Array.isArray(row.exceptions)
    ? row.exceptions.filter((item): item is string => typeof item === 'string').map(item => clip(item, EXCEPTION_MAX)).filter(Boolean).slice(0, LIST_MAX)
    : []
  return { title, content, exceptions }
}

export function draftFromTrigger(trigger: LessonTrigger): ParsedLessonDraft {
  return {
    title: clip(trigger.titleHint, TITLE_MAX) || '教训',
    content: clip(trigger.contentHint, CONTENT_MAX),
    exceptions: [],
  }
}

export const EXTRACT_SYSTEM = [
  'Extract at most one durable lesson from the supplied original-session evidence.',
  'Use only explicit human corrections or a tool failure later verified by a non-error result for the same tool.',
  'Do not infer success from later silence or from the assistant claiming it learned or fixed anything.',
  'If evidence is insufficient, reply with JSON {"skip":true}.',
  'Otherwise reply with JSON {"title":string,"content":string,"exceptions":string[]} only.',
].join(' ')

export function candidateRecord(
  draft: ParsedLessonDraft,
  trigger: LessonTrigger,
  projectId: string,
): NewMemoryRecord {
  return {
    scope: { kind: 'project', projectId },
    kind: 'lesson',
    status: 'candidate',
    title: clip(draft.title, TITLE_MAX) || '教训',
    content: clip(draft.content, CONTENT_MAX),
    tags: schemaTags(),
    evidence: schemaEvidence(trigger.evidence),
    exceptions: draft.exceptions.map(item => clip(item, EXCEPTION_MAX)).filter(Boolean).slice(0, LIST_MAX),
    source: 'self-improvement',
  }
}

export function hasSameEvidence(existing: readonly MemoryRecord[], trigger: LessonTrigger): boolean {
  const key = evidenceWatermark(trigger.evidence)
  return existing.some(record => record.kind === 'lesson'
    && record.source === 'self-improvement'
    && (evidenceWatermark(record.evidence) === key || record.tags.includes(`evidence:${key}`)))
}

export { LESSON_SCHEMA_VERSION }
