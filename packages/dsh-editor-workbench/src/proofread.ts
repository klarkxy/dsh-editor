import {
  FileOpError,
  listDirStrict,
  normalizeWorkspaceRelative,
  readTextFileLimited,
  type WorkspaceFileContext,
} from 'dsh-manuscript/host-api'
import type { OverviewAccess } from './overview.ts'
import { METADATA_DIRECTORY, readMetadataText } from './metadata-io.ts'
import { isGeneratedPath, isHiddenPath, MAX_FILES } from 'dsh-editor-workspace-kit'
import {
  type ProofreadFinding,
  type ProofreadKind,
  type ProofreadScanResponse,
} from './contracts.ts'
import { PROOFREAD_MAX_FINDINGS, TEXT_PROOFREAD_KINDS } from 'dsh-proofread/contracts'
import {
  HABIT_MAX_OCCURRENCES,
  HABIT_PER_THOUSAND_THRESHOLD,
  analyzedChars,
  bundledSensitiveTerms,
  collectHabitHits,
  emitHabitFindings,
  habitStatsFrom,
  maskForAnalysis,
  parseTermList,
  pathCompare,
  proofreadText,
  type HabitHit,
} from 'dsh-proofread/engine'
import { HABIT_TERMS } from 'dsh-proofread/defaults'

export { HABIT_MAX_OCCURRENCES, HABIT_PER_THOUSAND_THRESHOLD, HABIT_STATS_LIMIT } from 'dsh-proofread/engine'
export { PROOFREAD_MAX_FINDINGS } from 'dsh-proofread/contracts'
export { parseTermList, bundledSensitiveTerms, proofreadText } from 'dsh-proofread/engine'
export type { HabitHit, ProofreadTextOptions, ProofreadTextResult } from 'dsh-proofread/engine'

export const SENSITIVE_LIST_PATH = `${METADATA_DIRECTORY}/敏感词.txt`
export const SENSITIVE_ALLOW_PATH = `${METADATA_DIRECTORY}/敏感词-忽略.txt`

const MAX_TOTAL_BYTES = 100_000_000
const MAX_TEXT_BYTES = 2_000_000
const MAX_DIRECTORIES = 2_000
const MAX_DIRECTORY_ENTRIES = 10_000
const MAX_DEPTH = 12

export class ProofreadError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'BLOCKED' | 'INVALID_PATH' | 'INVALID' | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ProofreadError'
  }
}

function byteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function generated(relative: string): boolean {
  return isGeneratedPath(relative)
}

export function authorDocumentPath(relative: string): string {
  let normalized: string
  try {
    normalized = normalizeWorkspaceRelative(relative)
  } catch (error) {
    throw new ProofreadError('document path is invalid', 'INVALID_PATH', { cause: error })
  }
  if (normalized !== relative.replace(/\\/g, '/') || normalized === '.' || !/\.(md|txt)$/i.test(normalized)) {
    throw new ProofreadError('document path is invalid', 'INVALID_PATH')
  }
  if (isHiddenPath(normalized) || isGeneratedPath(normalized)) {
    throw new ProofreadError('document path is not author content', 'INVALID_PATH')
  }
  return normalized
}

function parseScope(value: unknown): 'document' | 'manuscript' {
  if (value === 'document' || value === 'manuscript') return value
  throw new ProofreadError('scope must be document or manuscript', 'INVALID')
}

function parseKinds(value: unknown): ProofreadKind[] {
  if (value === undefined) return [...TEXT_PROOFREAD_KINDS]
  if (!Array.isArray(value) || value.length === 0) throw new ProofreadError('kinds must be a non-empty array', 'INVALID')
  const kinds: ProofreadKind[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (item === 'card') throw new ProofreadError('card checks are not available', 'INVALID')
    if (!(TEXT_PROOFREAD_KINDS as readonly string[]).includes(item as string)) {
      throw new ProofreadError('kinds contains an unknown check', 'INVALID')
    }
    if (seen.has(item as string)) continue
    seen.add(item as string)
    kinds.push(item as ProofreadKind)
  }
  return kinds
}

type LoadedDocument = { path: string; text: string; version: string }

async function readDocument(files: WorkspaceFileContext, relative: string, remainingBytes: number): Promise<LoadedDocument> {
  try {
    const loaded = await readTextFileLimited(files, relative, Math.min(MAX_TEXT_BYTES, Math.max(0, remainingBytes)))
    return { path: relative, text: loaded.text, version: loaded.version }
  } catch (error) {
    if (error instanceof FileOpError && (error.code === 'NOT_FOUND' || error.code === 'NOT_TEXT')) {
      throw new ProofreadError('document path was not found', 'INVALID_PATH', { cause: error })
    }
    if (error instanceof FileOpError && error.code === 'TOO_LARGE') {
      throw new ProofreadError('document is too large to scan', 'INVALID', { cause: error })
    }
    throw error
  }
}

async function walkVisibleDocuments(access: OverviewAccess): Promise<{ files: LoadedDocument[]; skipped: number; truncated: boolean }> {
  const files: LoadedDocument[] = []
  const queue = ['']
  let truncated = false
  let skipped = 0
  let scannedFiles = 0
  let scannedBytes = 0
  let directories = 0
  let entriesSeen = 0
  while (queue.length && !truncated) {
    access.files.signal?.throwIfAborted()
    const directory = queue.shift()!
    if (++directories > MAX_DIRECTORIES) { truncated = true; skipped++; break }
    let entries
    try {
      entries = await listDirStrict(access.files, directory || '.')
    } catch (error) {
      if (directory === '' && error instanceof FileOpError && error.code === 'NOT_FOUND') break
      skipped++
      continue
    }
    for (const entry of entries) {
      if (++entriesSeen > MAX_DIRECTORY_ENTRIES) { truncated = true; skipped++; break }
      const relative = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.name.startsWith('.') || isHiddenPath(relative) || generated(relative)) { skipped++; continue }
      if (entry.type === 'directory') {
        if (relative.split('/').length > MAX_DEPTH) { skipped++; continue }
        queue.push(relative)
        continue
      }
      if (entry.type !== 'file' || !/\.(md|txt)$/i.test(entry.name)) { skipped++; continue }
      if (scannedFiles >= MAX_FILES || scannedBytes >= MAX_TOTAL_BYTES) { truncated = true; break }
      try {
        const loaded = await readTextFileLimited(access.files, relative, Math.min(MAX_TEXT_BYTES, MAX_TOTAL_BYTES - scannedBytes))
        const bytes = byteSize(loaded.text)
        if (scannedBytes + bytes > MAX_TOTAL_BYTES) { truncated = true; skipped++; break }
        scannedFiles++
        scannedBytes += bytes
        files.push({ path: relative, text: loaded.text, version: loaded.version })
      } catch (error) {
        skipped++
        if (error instanceof FileOpError && error.code === 'TOO_LARGE' && MAX_TOTAL_BYTES - scannedBytes <= MAX_TEXT_BYTES) {
          truncated = true
          break
        }
      }
    }
  }
  files.sort((left, right) => pathCompare(left.path, right.path))
  return { files, skipped, truncated }
}

function mergeSensitiveTerms(bundled: string[], user: string[], allow: string[]): string[] {
  const blocked = new Set(allow)
  const terms: string[] = []
  const seen = new Set<string>()
  for (const term of [...bundled, ...user]) {
    if (!term || blocked.has(term) || seen.has(term)) continue
    seen.add(term)
    terms.push(term)
  }
  return terms
}

function enabled(kinds: readonly ProofreadKind[], kind: ProofreadKind): boolean {
  return kinds.includes(kind)
}

export async function scanProofread(input: {
  access: OverviewAccess
  scope: unknown
  path?: unknown
  kinds?: unknown
}): Promise<ProofreadScanResponse> {
  const scope = parseScope(input.scope)
  const kinds = parseKinds(input.kinds)
  const userList = parseTermList(await readMetadataText(input.access.path, SENSITIVE_LIST_PATH) ?? '')
  const allowList = parseTermList(await readMetadataText(input.access.path, SENSITIVE_ALLOW_PATH) ?? '')
  const sensitiveTerms = mergeSensitiveTerms(bundledSensitiveTerms(), userList, allowList)
  let files: LoadedDocument[]
  let skipped = 0
  let truncated = false
  if (scope === 'document') {
    if (typeof input.path !== 'string' || !input.path) throw new ProofreadError('document path is required', 'INVALID_PATH')
    const relative = authorDocumentPath(input.path)
    files = [await readDocument(input.access.files, relative, MAX_TOTAL_BYTES)]
  } else {
    const walked = await walkVisibleDocuments(input.access)
    files = walked.files
    skipped = walked.skipped
    truncated = walked.truncated
  }

  const findings: ProofreadFinding[] = []
  const counts = new Map<string, number>()
  const habitHits: HabitHit[] = []
  let habitChars = 0
  for (const file of files) {
    const result = proofreadText(file.text, {
      path: file.path,
      version: file.version,
      kinds: kinds.filter((kind) => kind !== 'habit'),
      sensitiveTerms,
      maxFindings: Number.MAX_SAFE_INTEGER,
    })
    findings.push(...result.findings)
    if (enabled(kinds, 'habit')) {
      const masked = maskForAnalysis(file.text)
      habitChars += analyzedChars(masked)
      habitHits.push(...collectHabitHits(masked, file.text, file.path, file.version, HABIT_TERMS, counts))
    }
  }
  if (enabled(kinds, 'habit')) {
    emitHabitFindings(habitHits, counts, habitChars, HABIT_PER_THOUSAND_THRESHOLD, HABIT_MAX_OCCURRENCES, findings)
  }
  findings.sort((left, right) => pathCompare(left.path, right.path) || left.start - right.start || left.kind.localeCompare(right.kind))
  const capped = findings.length > PROOFREAD_MAX_FINDINGS
  return {
    findings: capped ? findings.slice(0, PROOFREAD_MAX_FINDINGS) : findings,
    scannedFiles: files.length,
    skipped,
    truncated: truncated || capped,
    habitStats: enabled(kinds, 'habit') ? habitStatsFrom(counts, habitChars) : [],
  }
}
