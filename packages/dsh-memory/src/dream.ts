import { createHash } from 'node:crypto'
import {
  scopeKey, scopesEqual,
  type DreamPlan, type DreamProposal, type DreamSnapshotEntry, type KnowledgeScope, type MemoryPersistedState,
  type MemoryRecord,
} from './contracts.ts'
import { fail, MEMORY_INVALID, MEMORY_STALE, MEMORY_TOMBSTONE } from './errors.ts'
import { isExpired } from './recall.ts'

export const DREAM_SYSTEM = [
  'Consolidate the supplied memory records into merge or dedup candidate previews.',
  'Keep each proposal in the same scope as its sources. Never expand a project record to global.',
  'Do not rewrite active records in place. Do not invent preferences without quoted evidence.',
  'Do not treat novel canon or worldbook text as Memory.',
  'Expiry is a retention bound. Do not infer that a planned event completed merely because a date has elapsed.',
  'A derived candidate must not outlive its sources. Do not drop or extend expiry to make knowledge perpetual.',
  'Reply with JSON {"proposals":[{"title":string,"content":string,"kind":"preference"|"project-fact"|"decision","sourceIds":string[],"exceptions":string[]}]} or {"proposals":[]}.',
].join(' ')

export function isDreamSource(record: MemoryRecord, now: number): boolean {
  if (record.kind === 'lesson') return false
  if (record.status !== 'active' && record.status !== 'candidate') return false
  if (isExpired(record, now)) return false
  return true
}

export function snapshotRecords(records: readonly MemoryRecord[]): DreamSnapshotEntry[] {
  return records.map(record => ({
    id: record.id,
    revision: record.revision,
    status: record.status,
    scope: structuredClone(record.scope),
    expiresAt: record.expiresAt,
  })).sort((a, b) => a.id.localeCompare(b.id))
}

/** Bounded CAS token. Exact revisions still live on snapshot/basis, not in this hash. */
export function dreamSourceVersion(snapshot: readonly DreamSnapshotEntry[]): string {
  const canonical = snapshot
    .map(entry => `${entry.id}@${entry.revision}:${entry.status}:${scopeKey(entry.scope)}:${entry.expiresAt ?? ''}`)
    .sort()
    .join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

export function earliestExpiry(records: readonly Pick<MemoryRecord, 'expiresAt'>[]): number | undefined {
  let min: number | undefined
  for (const record of records) {
    if (typeof record.expiresAt !== 'number') continue
    min = min === undefined ? record.expiresAt : Math.min(min, record.expiresAt)
  }
  return min
}

export function parseDreamText(text: string, snapshot: readonly DreamSnapshotEntry[], fallbackScope: KnowledgeScope): DreamProposal[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? trimmed).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try { parsed = JSON.parse(body.slice(start, end + 1)) } catch { return [] }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const raw = (parsed as { proposals?: unknown }).proposals
  if (!Array.isArray(raw)) return []
  const byId = new Map(snapshot.map(entry => [entry.id, entry]))
  const proposals: DreamProposal[] = []
  for (const item of raw.slice(0, 16)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    if (typeof row.title !== 'string' || typeof row.content !== 'string') continue
    const kind = row.kind === 'preference' || row.kind === 'project-fact' || row.kind === 'decision' ? row.kind : undefined
    if (!kind) continue
    const sourceIds = Array.isArray(row.sourceIds)
      ? [...new Set(row.sourceIds.filter((id): id is string => typeof id === 'string' && byId.has(id)))].slice(0, 16)
      : []
    if (sourceIds.length === 0) continue
    const sources = sourceIds.map(id => byId.get(id)!).filter(entry => entry.status === 'active' || entry.status === 'candidate')
    if (sources.length === 0) continue
    const scope = sources[0]!.scope
    if (sources.some(entry => !scopesEqual(entry.scope, scope))) continue
    if (scope.kind === 'project' && fallbackScope.kind === 'global') continue
    if (fallbackScope.kind === 'project' && scope.kind === 'global') continue
    const exceptions = Array.isArray(row.exceptions)
      ? row.exceptions.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean).slice(0, 8)
      : []
    proposals.push({
      title: row.title.trim().slice(0, 160),
      content: row.content.trim().slice(0, 4000),
      kind,
      tags: ['dream'],
      exceptions,
      evidence: [],
      sourceIds,
      scope: structuredClone(scope),
    })
  }
  return proposals.filter(proposal => proposal.title && proposal.content)
}

export function recordMap(state: MemoryPersistedState): Map<string, MemoryRecord> {
  return new Map(state.records.map(record => [record.id, record]))
}

export function tombstoneSet(state: MemoryPersistedState): Set<string> {
  return new Set(state.tombstones.map(row => row.id))
}

function assertLiveUnexpired(
  record: MemoryRecord | undefined,
  tombstoned: ReadonlySet<string>,
  id: string,
  now: number,
  missing: string,
): MemoryRecord {
  if (tombstoned.has(id)) fail(MEMORY_TOMBSTONE, '记录已删除，不能由梦境恢复。')
  if (!record) fail(MEMORY_STALE, missing)
  if (record.status === 'deleted') fail(MEMORY_TOMBSTONE, '记录已删除，不能由梦境恢复。')
  if (isExpired(record, now)) fail(MEMORY_STALE, '依据记录已过期，梦境预览作废。')
  return record
}

export function assertDreamApply(
  plan: DreamPlan,
  current: ReadonlyMap<string, MemoryRecord>,
  tombstoned: ReadonlySet<string>,
  now: number,
): void {
  if (plan.status !== 'preview') fail(MEMORY_INVALID, '只能应用未处理的梦境预览。')
  if (dreamSourceVersion(plan.snapshot) !== plan.sourceVersion) fail(MEMORY_STALE, '梦境快照已失效。')
  for (const entry of plan.snapshot) {
    const record = assertLiveUnexpired(current.get(entry.id), tombstoned, entry.id, now, '梦境所依据的记录已不存在。')
    if (record.revision !== entry.revision) fail(MEMORY_STALE, '记录已被修改或删除，梦境预览作废。')
    if (!scopesEqual(record.scope, entry.scope)) fail(MEMORY_STALE, '记录范围已变化，未扩大或覆盖。')
    if ((record.expiresAt ?? undefined) !== (entry.expiresAt ?? undefined)) fail(MEMORY_STALE, '记录有效期已变化，梦境预览作废。')
  }
  for (const proposal of plan.proposals) {
    if (proposal.scope.kind === 'global' && plan.snapshot.some(entry => proposal.sourceIds.includes(entry.id) && entry.scope.kind === 'project')) {
      fail(MEMORY_INVALID, '梦境不能把项目记忆扩大为全局。')
    }
    for (const sourceId of proposal.sourceIds) {
      assertLiveUnexpired(current.get(sourceId), tombstoned, sourceId, now, '合并来源已不存在。')
    }
  }
}

/** Exact source revisions behind a derived candidate. Missing basis skips (manual adds). */
export function assertBasisCurrent(
  record: Pick<MemoryRecord, 'basis' | 'expiresAt'>,
  current: ReadonlyMap<string, MemoryRecord>,
  tombstoned: ReadonlySet<string>,
  now: number,
): void {
  if (isExpired(record, now)) fail(MEMORY_STALE, '候选已过期，不能采纳。')
  if (!record.basis?.length) return
  for (const ref of record.basis) {
    if (tombstoned.has(ref.id)) fail(MEMORY_TOMBSTONE, '依据记录已删除，不能采纳。')
    const live = current.get(ref.id)
    if (!live) fail(MEMORY_STALE, '依据记录已不存在，候选作废。')
    if (live.revision !== ref.revision) fail(MEMORY_STALE, '依据记录已修改，须按当前版本重新整理。')
    if (live.status === 'deleted') fail(MEMORY_TOMBSTONE, '依据记录已删除，不能采纳。')
    if (isExpired(live, now)) fail(MEMORY_STALE, '依据记录已过期，不能采纳。')
  }
}

export function stampInheritedExpiry<T extends { expiresAt?: number }>(
  record: T,
  sources: readonly Pick<MemoryRecord, 'expiresAt'>[],
): T {
  const inherited = earliestExpiry(sources)
  if (inherited === undefined) return record
  const current = record.expiresAt
  record.expiresAt = current === undefined ? inherited : Math.min(current, inherited)
  return record
}

export function basisFromSnapshot(snapshot: readonly DreamSnapshotEntry[], sourceIds: readonly string[]): Array<{ id: string; revision: number }> {
  const byId = new Map(snapshot.map(entry => [entry.id, entry]))
  const basis: Array<{ id: string; revision: number }> = []
  for (const id of sourceIds) {
    const entry = byId.get(id)
    if (!entry) continue
    basis.push({ id: entry.id, revision: entry.revision })
  }
  return basis
}

export function inheritEvidence(records: readonly MemoryRecord[], sourceIds: readonly string[]): DreamProposal['evidence'] {
  const seen = new Set<string>()
  const evidence: DreamProposal['evidence'] = []
  for (const id of sourceIds) {
    const record = records.find(item => item.id === id)
    if (!record) continue
    for (const ref of record.evidence) {
      const key = `${ref.sessionId}:${ref.seq}:${ref.kind}`
      if (seen.has(key)) continue
      seen.add(key)
      evidence.push({ ...ref })
    }
  }
  return evidence.slice(0, 16)
}
