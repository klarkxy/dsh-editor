import { isAuxiliaryAuthorFile } from '../auxiliary-files.ts'
import { documentDirectory, searchPathInDirectory } from '../project-files.ts'
import { prepareReplaceWrite, type ReplacePlan } from '../search-replace.ts'
import {
  isStaleFailure,
  worldbookPaperProjection,
  type RevealRequest,
  type RpcResult,
} from '../client/shared.ts'

export type SearchScope = 'project' | 'directory'

export type SearchHit = {
  path: string
  line: number
  column: number
  start: number
  end: number
  excerpt: string
  version: string
}

export type SearchResponse = {
  results: SearchHit[]
  scannedFiles: number
  scannedBytes: number
  skipped: number
  truncated: boolean
}

export type GroupedSearchHits = { path: string; hits: SearchHit[] }[]

export type ReplaceOutcome = {
  files: number
  occurrences: number
  stale: string[]
  changed: string[]
  failed: string[]
}

export type SearchReplaceReport = { identity: string; outcome: ReplaceOutcome }

export function replaceOutcomeForIdentity(report: SearchReplaceReport | null, identity: string): ReplaceOutcome | null {
  return report?.identity === identity ? report.outcome : null
}

/** Sidebar owns the live query; a blank field must drop the current hit list. */
export function searchQueryClearsResults(query: string): boolean {
  return !query.trim()
}

/** Drop assistant/config files before grouping, counting, or planning replace. */
export function acceptSearchResults(response: SearchResponse): SearchResponse {
  return {
    ...response,
    results: response.results.filter((hit) => !isAuxiliaryAuthorFile(hit.path)),
  }
}

export type SearchTextRequest = {
  sessionId: string
  query: string
  scope: 'project'
  directory?: string
}

/** Host payload: project walk by default; directory scope sends the active document folder. */
export function searchTextRequest(input: {
  sessionId: string
  query: string
  scope: SearchScope
  activePath: string
}): SearchTextRequest {
  const directory = input.scope === 'directory' ? documentDirectory(input.activePath) : ''
  return directory
    ? { sessionId: input.sessionId, query: input.query, scope: 'project', directory }
    : { sessionId: input.sessionId, query: input.query, scope: 'project' }
}

/** Defense-in-depth folder filter after Host results. Never lock the RPC to 正文/. */
export function scopeSearchResults(response: SearchResponse, scope: SearchScope, activePath: string): SearchResponse {
  if (scope !== 'directory') return response
  const directory = documentDirectory(activePath)
  if (!directory) return response
  return {
    ...response,
    results: response.results.filter((hit) => searchPathInDirectory(hit.path, directory)),
  }
}

export function groupSearchHits(hits: readonly SearchHit[]): GroupedSearchHits {
  const groups = new Map<string, SearchHit[]>()
  for (const hit of hits) {
    const list = groups.get(hit.path)
    if (list) list.push(hit)
    else groups.set(hit.path, [hit])
  }
  return [...groups.entries()].map(([path, groupHits]) => ({ path, hits: groupHits }))
}

export type SearchLineHit = { hit: SearchHit; count: number }

/** One result row per line: several matches on the same line share one excerpt. */
export function mergeSearchLineHits(hits: readonly SearchHit[]): SearchLineHit[] {
  const seen = new Map<string, SearchLineHit>()
  const order: SearchLineHit[] = []
  for (const hit of hits) {
    const key = `${hit.path}${hit.line}`
    const existing = seen.get(key)
    if (existing) existing.count += 1
    else {
      const merged = { hit, count: 1 }
      seen.set(key, merged)
      order.push(merged)
    }
  }
  return order
}

export type ExcerptSegment = { text: string; match: boolean }

/** Splits an excerpt into highlighted and plain segments (case-insensitive). */
export function highlightExcerpt(excerpt: string, query: string): ExcerptSegment[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [{ text: excerpt, match: false }]
  const haystack = excerpt.toLowerCase()
  const segments: ExcerptSegment[] = []
  let cursor = 0
  for (;;) {
    const at = haystack.indexOf(needle, cursor)
    if (at < 0) break
    if (at > cursor) segments.push({ text: excerpt.slice(cursor, at), match: false })
    segments.push({ text: excerpt.slice(at, at + needle.length), match: true })
    cursor = at + needle.length
  }
  if (cursor < excerpt.length) segments.push({ text: excerpt.slice(cursor), match: false })
  return segments
}

export function paperRevealRange(path: string, text: string, hit: Pick<SearchHit, 'start' | 'end'>): { from: number; to: number } {
  const offset = worldbookPaperProjection(path, text).offset
  const from = Math.max(0, hit.start - offset)
  const to = Math.max(from, hit.end - offset)
  return { from, to }
}

export function toRevealRequest(hit: SearchHit, nonce = Date.now()): RevealRequest {
  return { ...hit, nonce }
}

export function canReplaceAll(input: { query: string; replacement: string; hits: number }): boolean {
  return input.hits > 0 && input.replacement !== input.query
}

export function replaceBlockedByDirty(input: { activePath: string; activeDirty: boolean; paths: readonly string[] }): boolean {
  return input.activeDirty && Boolean(input.activePath) && input.paths.includes(input.activePath)
}

/** Results and confirmation belong to one exact search context, including the active folder. */
export function searchIdentity(input: { sessionId: string; revision: number; query: string; scope: SearchScope; activePath: string }): string {
  return JSON.stringify([input.sessionId, input.revision, input.query, input.scope,
    input.scope === 'directory' ? documentDirectory(input.activePath) : ''])
}

/** Once confirmed, completed writes are accounted for independently of search reads. */
export async function executeReplacePlan(input: {
  plan: ReplacePlan
  query: string
  read(path: string): Promise<RpcResult<{ text: string; version: string }>>
  write(path: string, text: string, version: string): Promise<RpcResult<{ version: string }>>
}): Promise<{ outcome: ReplaceOutcome; written: string[] }> {
  const stale = [...input.plan.stale]
  const changed: string[] = []
  const failed: string[] = []
  const written: string[] = []
  let occurrences = 0
  for (const file of input.plan.files) {
    const read = await input.read(file.path)
    if (!read.ok) { failed.push(file.path); continue }
    const prepared = prepareReplaceWrite(file, read.value, input.query, input.plan.replacement)
    if (!prepared.ok) {
      if (prepared.reason === 'stale') stale.push(file.path)
      else changed.push(file.path)
      continue
    }
    const result = await input.write(file.path, prepared.text, read.value.version)
    if (!result.ok) {
      if (isStaleFailure(result)) stale.push(file.path)
      else failed.push(file.path)
      continue
    }
    written.push(file.path)
    occurrences += file.spans.length
  }
  return { outcome: { files: written.length, occurrences, stale, changed, failed }, written }
}
