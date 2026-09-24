import { createHash } from 'node:crypto'
import type { FusionBrief, FusionState, FusionTarget, Json, ModelRoute } from './contracts.ts'

export class FusionError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'FusionError'; this.code = code }
}
export function requireFusion(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new FusionError(code, message)
}
export function text(value: unknown, label: string, max: number, empty = false): string {
  requireFusion(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0), 'INVALID_INPUT', `${label} must be ${empty ? '0' : '1'}–${max} characters.`)
  return value
}
export function integer(value: unknown, label: string): number {
  requireFusion(Number.isSafeInteger(value) && Number(value) >= 1, 'INVALID_INPUT', `${label} must be a positive integer.`)
  return value as number
}
export function object(value: unknown): Record<string, unknown> {
  requireFusion(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Expected an object.')
  return value as Record<string, unknown>
}
export function stringList(value: unknown, label: string, limit = 32): string[] {
  requireFusion(Array.isArray(value) && value.length <= limit, 'INVALID_INPUT', `${label} must have at most ${limit} items.`)
  return value.map(item => text(item, label, 2000))
}
export function brief(value: unknown): FusionBrief {
  const row = object(value)
  return { title: text(row.title, 'title', 120), goal: text(row.goal, 'goal', 8000), context: text(row.context ?? '', 'context', 48_000, true),
    constraints: stringList(row.constraints ?? [], 'constraints'), acceptance: stringList(row.acceptance ?? [], 'acceptance') }
}
export function route(value: unknown): ModelRoute {
  const row = object(value)
  return { provider: text(row.provider, 'provider', 300), model: text(row.model, 'model', 300),
    ...(row.reasoningEffort === undefined ? {} : { reasoningEffort: text(row.reasoningEffort, 'reasoningEffort', 100) }) }
}
function json(value: unknown, depth = 0): asserts value is Json {
  requireFusion(depth <= 12, 'INVALID_INPUT', 'Target is nested too deeply.')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') { requireFusion(Number.isFinite(value), 'INVALID_INPUT', 'Non-finite target value.'); return }
  if (Array.isArray(value)) { requireFusion(value.length <= 128, 'INVALID_INPUT', 'Target array too large.'); value.forEach(item => json(item, depth + 1)); return }
  const row = object(value)
  requireFusion(Object.keys(row).length <= 128, 'INVALID_INPUT', 'Target object too large.')
  for (const [key, item] of Object.entries(row)) {
    requireFusion(!['__proto__', 'constructor', 'prototype'].includes(key), 'INVALID_INPUT', 'Unsafe target key.')
    json(item, depth + 1)
  }
}
export function target(value: unknown): FusionTarget | undefined {
  if (value === undefined) return undefined
  const row = object(value)
  const domain = text(row.domain, 'target domain', 100)
  const data = object(row.data)
  json(data)
  requireFusion(JSON.stringify(data).length <= 200_000, 'INVALID_INPUT', 'Target exceeds storage limit.')
  return { domain, data: structuredClone(data) as { [key: string]: Json } }
}
/** Validate persisted control records before allowing any native work to resume. */
export function validateState(value: unknown): FusionState {
  const row = object(value)
  requireFusion(row.version === 1 && Number.isSafeInteger(row.revision) && Number(row.revision) >= 0, 'INVALID_STATE', 'Unsupported Fusion storage version.')
  requireFusion(Array.isArray(row.pairs) && row.pairs.length <= 512, 'INVALID_STATE', 'Invalid Fusion pair table.')
  const leads = new Set<string>(), children = new Set<string>(), tasks = new Set<string>()
  for (const value of row.pairs) {
    const pair = object(value)
    text(pair.id, 'pair id', 200); text(pair.project, 'project identity', 8192)
    const lead = text(pair.leadSessionId, 'lead id', 200), child = text(pair.childSessionId, 'child id', 200)
    requireFusion(!leads.has(lead) && !children.has(child) && lead !== child, 'INVALID_STATE', 'Duplicate Fusion identity.')
    leads.add(lead); children.add(child)
    requireFusion(pair.profile === 'generic' || pair.profile === 'writing', 'INVALID_STATE', 'Unknown Fusion profile.')
    requireFusion(typeof pair.established === 'boolean', 'INVALID_STATE', 'Missing admission state.')
    route(pair.route)
    requireFusion(Array.isArray(pair.tasks) && pair.tasks.length <= 128, 'INVALID_STATE', 'Invalid task table.')
    for (const value of pair.tasks) {
      const task = object(value), id = text(task.id, 'task id', 200)
      requireFusion(!tasks.has(id), 'INVALID_STATE', 'Duplicate task identity.'); tasks.add(id)
      integer(task.revision, 'task revision'); brief(task.brief); target(task.target)
      requireFusion(['dispatching','working','decision','review','accepted','cancelled','failed','interrupted'].includes(String(task.state)), 'INVALID_STATE', 'Unknown task state.')
      requireFusion(['pending','accepted','uncertain'].includes(String(task.delivery)), 'INVALID_STATE', 'Unknown delivery state.')
      text(task.dispatchId, 'dispatch id', 200)
      stringList(task.messageIds, 'message ids', 64); const reportIds = stringList(task.reportIds, 'report ids', 64)
      if (task.notifiedReportId !== undefined) requireFusion(reportIds.includes(text(task.notifiedReportId, 'notified report id', 256)), 'INVALID_STATE', 'Notification references an unknown report.')
      requireFusion(Array.isArray(task.candidates) && task.candidates.length <= 16 && Array.isArray(task.reviews) && task.reviews.length <= 32, 'INVALID_STATE', 'Invalid candidate history.')
      const candidates = new Map<string, string>()
      for (const [index, item] of task.candidates.entries()) {
        const candidate = object(item)
        const candidateId = text(candidate.id, 'candidate id', 200)
        requireFusion(!candidates.has(candidateId), 'INVALID_STATE', 'Duplicate candidate identity.')
        requireFusion(integer(candidate.revision, 'candidate revision') === index + 1, 'INVALID_STATE', 'Invalid candidate order.')
        requireFusion(integer(candidate.taskRevision, 'candidate task revision') <= Number(task.revision), 'INVALID_STATE', 'Candidate belongs to a future task revision.')
        const candidateText = text(candidate.text, 'candidate', 200_000); text(candidate.report, 'report', 16_000, true)
        requireFusion(typeof candidate.hash === 'string' && /^[a-f0-9]{64}$/.test(candidate.hash), 'INVALID_STATE', 'Invalid candidate hash.')
        requireFusion(createHash('sha256').update(candidateText, 'utf8').digest('hex') === candidate.hash, 'INVALID_STATE', 'Candidate content does not match its stored hash.')
        candidates.set(candidateId, candidate.hash)
      }
      for (const item of task.reviews) {
        const review = object(item)
        const candidateId = text(review.candidateId, 'review candidate', 200)
        const hash = text(review.candidateHash, 'review hash', 64)
        requireFusion(candidates.get(candidateId) === hash, 'INVALID_STATE', 'Review references an unknown candidate revision.')
        requireFusion(['accept','revise','reject'].includes(String(review.verdict)), 'INVALID_STATE', 'Invalid review verdict.')
        text(review.feedback, 'feedback', 16_000, true)
      }
    }
  }
  requireFusion([...children].every(id => !leads.has(id)), 'INVALID_STATE', 'Recursive Fusion identity.')
  requireFusion(JSON.stringify(row).length <= 16_000_000, 'CAPACITY', 'Fusion history capacity reached. Existing records were preserved.')
  return structuredClone(row) as unknown as FusionState
}
