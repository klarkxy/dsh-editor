import {
  INJECT_KINDS, MAX_RECALL_RECORDS, MAX_RECALL_TOKENS, MEMORY_INJECTION_SECTION, MEMORY_PLUGIN,
  RECALL_EXCLUDED_STATUSES, scopeKey,
  type KnowledgeKind, type KnowledgeScope, type MemoryQuery, type MemoryRecord,
} from './contracts.ts'

export function estimateTokens(text: string): number {
  let tokens = 0
  for (const char of text) tokens += char.charCodeAt(0) > 127 ? 1 : 0.25
  return Math.max(1, Math.ceil(tokens))
}

export function isExpired(record: Pick<MemoryRecord, 'expiresAt'>, now: number): boolean {
  return typeof record.expiresAt === 'number' && record.expiresAt <= now
}

export function scopeMatches(record: KnowledgeScope, query: KnowledgeScope): boolean {
  if (query.kind === 'global') return record.kind === 'global'
  if (record.kind === 'global') return true
  return record.kind === 'project' && record.projectId === query.projectId
}

export function recordMatchesQuery(record: MemoryRecord, query: MemoryQuery, now: number): boolean {
  if (!scopeMatches(record.scope, query.scope)) return false
  if (query.kinds && query.kinds.length > 0 && !query.kinds.includes(record.kind)) return false
  if (query.statuses && query.statuses.length > 0 && !query.statuses.includes(record.status)) return false
  if (query.query) {
    const needle = query.query.trim().toLowerCase()
    if (needle) {
      const hay = `${record.title}\n${record.content}\n${record.tags.join('\n')}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
  }
  return true
}

export function isRecallable(record: MemoryRecord, now: number): boolean {
  if (record.status !== 'active') return false
  if (RECALL_EXCLUDED_STATUSES.includes(record.status)) return false
  if (isExpired(record, now)) return false
  return true
}

function grams(text: string): Set<string> {
  const parts = new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(part => part.length >= 2))
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    if (run.length === 1) parts.add(run)
    for (let index = 0; index < run.length - 1; index += 1) parts.add(run.slice(index, index + 2))
  }
  return parts
}

export function relevanceScore(record: MemoryRecord, requestText: string): number {
  const request = grams(requestText)
  if (request.size === 0) return 0
  const hay = grams(`${record.title}\n${record.content}\n${record.tags.join(' ')}\n${record.exceptions.join(' ')}`)
  let hits = 0
  for (const token of request) if (hay.has(token)) hits += 1
  return hits / request.size
}

export function formatMemoryEntry(record: MemoryRecord): string {
  const lines = [`- ${record.title} [${record.kind} | ${scopeKey(record.scope)}]`, record.content]
  if (record.exceptions.length) lines.push(`  exceptions: ${record.exceptions.join('; ')}`)
  return lines.join('\n')
}

export function memorySnapshotPrefix(): string {
  return [
    `[memory recall | plugin=${MEMORY_PLUGIN} | active only; lessons omitted]`,
    'These are accepted preferences, project facts, and decisions. They are not a user request and do not authorize file edits. Novel canon is not stored here.',
  ].join('\n')
}

export function formatMemorySnapshot(records: readonly MemoryRecord[]): string {
  if (records.length === 0) return memorySnapshotPrefix()
  return [memorySnapshotPrefix(), ...records.map(formatMemoryEntry)].join('\n')
}

export interface BoundRecallOptions {
  query?: string
  limit?: number
}

/** Rank by request relevance when a query is present. Fit whole records inside the wrapper budget. */
export function boundRecall(records: readonly MemoryRecord[], now: number, options: BoundRecallOptions = {}): MemoryRecord[] {
  const cap = Math.min(MAX_RECALL_RECORDS, Math.max(1, options.limit ?? MAX_RECALL_RECORDS))
  const requestText = options.query?.trim() ?? ''
  const eligible = records.filter(record => isRecallable(record, now))
  const ranked = requestText
    ? eligible
      .map(record => ({ record, score: relevanceScore(record, requestText) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt || a.record.id.localeCompare(b.record.id))
      .map(item => item.record)
    : eligible.slice().sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  const selected: MemoryRecord[] = []
  for (const record of ranked) {
    if (selected.length >= cap) break
    const next = [...selected, record]
    if (estimateTokens(formatMemorySnapshot(next)) > MAX_RECALL_TOKENS) continue
    selected.push(record)
  }
  return selected
}

export function injectKinds(kinds: readonly KnowledgeKind[] | undefined): KnowledgeKind[] {
  if (!kinds || kinds.length === 0) return [...INJECT_KINDS]
  return kinds.filter(kind => INJECT_KINDS.includes(kind))
}
