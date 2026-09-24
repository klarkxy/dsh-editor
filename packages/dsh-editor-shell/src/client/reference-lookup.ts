import type { SearchHit, SearchResponse } from './search-panel.tsx'

export const REFERENCE_QUERY_MAX = 120
const REFERENCE_DIRECTORIES = ['人物卡', '世界书'] as const
const MAX_CANDIDATES = 50

export type ReferenceCandidate = { path: string; filenameMatch: boolean; hit?: SearchHit }
export type ReferenceLookupResult = {
  candidates: ReferenceCandidate[]
  skipped: number
  truncated: boolean
  failures: { directory: string; message: string }[]
}

export function normalizeReferenceQuery(raw: string): string | null {
  const value = raw.trim()
  return value && value.length <= REFERENCE_QUERY_MAX && !/[\u0000-\u001f\u007f]/.test(value) ? value : null
}

/** Only ordinary author-owned reference files, never hidden/config/traversal paths. */
export function isReferencePath(path: string): boolean {
  if (/[\\:\u0000-\u001f\u007f]/.test(path)) return false
  const parts = path.split('/')
  return parts.length > 1
    && REFERENCE_DIRECTORIES.some((directory) => parts[0] === directory)
    && parts.every((part) => Boolean(part) && !part.startsWith('.'))
    && /\.(md|txt)$/i.test(parts[parts.length - 1]!)
}

function title(path: string): string {
  return path.split('/').at(-1)!.replace(/\.(md|txt)$/i, '')
}

/** One explicit lookup, using the existing file list and bounded literal search RPC. */
export async function lookupReferences(input: {
  query: string
  files: readonly string[]
  search(directory: string, query: string, signal?: AbortSignal): Promise<SearchResponse>
  signal?: AbortSignal
}): Promise<ReferenceLookupResult> {
  const query = normalizeReferenceQuery(input.query)
  if (!query) throw new Error('Invalid reference query')
  input.signal?.throwIfAborted()
  const files = input.files.filter(isReferencePath)
  const needle = query.toLowerCase()
  const candidates = new Map<string, ReferenceCandidate>()
  for (const path of files) {
    if (title(path).toLowerCase().includes(needle)) candidates.set(path, { path, filenameMatch: true })
  }
  // Missing optional folders require neither creation nor a failing search request.
  const directories = REFERENCE_DIRECTORIES.filter((directory) => files.some((path) => path.startsWith(`${directory}/`)))
  const results = await Promise.allSettled(directories.map((directory) => input.search(directory, query, input.signal)))
  input.signal?.throwIfAborted()
  const failures: ReferenceLookupResult['failures'] = []
  let skipped = 0
  let truncated = false
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]!
    const directory = directories[index]!
    if (result.status === 'rejected') {
      failures.push({ directory, message: result.reason instanceof Error ? result.reason.message : String(result.reason) })
      continue
    }
    skipped += result.value.skipped
    truncated ||= result.value.truncated
    for (const hit of result.value.results) {
      if (!isReferencePath(hit.path) || !hit.path.startsWith(`${directory}/`)) { skipped += 1; continue }
      const existing = candidates.get(hit.path)
      // Keep distinct files even when they have the same name. No entity merging.
      if (!existing?.hit) candidates.set(hit.path, { path: hit.path, filenameMatch: existing?.filenameMatch ?? false, hit })
    }
  }
  const ordered = [...candidates.values()].sort((left, right) => {
    const exact = Number(title(right.path).toLowerCase() === needle) - Number(title(left.path).toLowerCase() === needle)
    return exact || Number(right.filenameMatch) - Number(left.filenameMatch)
      || left.path.localeCompare(right.path, 'zh-CN', { numeric: true })
  })
  return { candidates: ordered.slice(0, MAX_CANDIDATES), skipped, truncated: truncated || ordered.length > MAX_CANDIDATES, failures }
}
