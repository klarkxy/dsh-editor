import { FileOpError, normalizeWorkspaceRelative, readTextFile, type WorkspaceFileContext } from 'dsh-manuscript/host-api'
import type { ChapterStatus } from './contracts.ts'
import {
  assertWritableMetadata,
  readMetadataText,
  writeMetadataTextAtomic,
  type MetadataAccess,
} from './metadata-io.ts'

export const CHAPTER_STATUS_PATH = '.dsh-editor/chapter-status.json'
export const CHAPTER_STATUSES = ['draft', 'revising', 'final'] as const

const MANUSCRIPT_ROOT = '正文'
const MAX_STATUS_ENTRIES = 2_000

export type ChapterStatusAccess = MetadataAccess & { files: WorkspaceFileContext }
type StoredStatus = Exclude<ChapterStatus, 'draft'>

export class ChapterStatusError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'BLOCKED' | 'INVALID_PATH' | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ChapterStatusError'
  }
}

function pathCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

export function isChapterStatus(value: unknown): value is ChapterStatus {
  return value === 'draft' || value === 'revising' || value === 'final'
}

export function manuscriptChapterPath(relative: string): string {
  let normalized: string
  try {
    normalized = normalizeWorkspaceRelative(relative)
  } catch (error) {
    throw new ChapterStatusError('chapter path is invalid', 'INVALID_PATH', { cause: error })
  }
  if (normalized !== relative.replace(/\\/g, '/') || normalized === '.' || !/\.(md|txt)$/i.test(normalized)) {
    throw new ChapterStatusError('chapter path is invalid', 'INVALID_PATH')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => part.startsWith('.'))) throw new ChapterStatusError('chapter path is invalid', 'INVALID_PATH')
  if (parts[0] !== MANUSCRIPT_ROOT || parts.length < 2) {
    throw new ChapterStatusError('chapter status path must be in 正文', 'INVALID_PATH')
  }
  return normalized
}

function tryChapterPath(relative: string): string | undefined {
  try {
    return manuscriptChapterPath(relative)
  } catch {
    return undefined
  }
}

function serializedStatuses(statuses: ReadonlyMap<string, StoredStatus>): string {
  const ordered = [...statuses.entries()].sort(([left], [right]) => pathCompare(left, right))
  return `${JSON.stringify({ version: 1, statuses: Object.fromEntries(ordered) }, null, 2)}\n`
}

function parseStoredStatuses(text: string): Map<string, StoredStatus> {
  const statuses = new Map<string, StoredStatus>()
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return statuses
  }
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  const raw = record?.statuses && typeof record.statuses === 'object' && !Array.isArray(record.statuses)
    ? record.statuses as Record<string, unknown>
    : record?.version === undefined && record
      ? record
      : undefined
  if (!raw) return statuses
  for (const [relative, status] of Object.entries(raw)) {
    if (statuses.size >= MAX_STATUS_ENTRIES) break
    if (status !== 'revising' && status !== 'final') continue
    const path = tryChapterPath(relative)
    if (path) statuses.set(path, status)
  }
  return statuses
}

export async function loadChapterStatuses(access: MetadataAccess): Promise<Map<string, StoredStatus>> {
  const text = await readMetadataText(access.path, CHAPTER_STATUS_PATH)
  if (text === null) return new Map()
  return parseStoredStatuses(text)
}

async function writeChapterStatuses(access: MetadataAccess, statuses: ReadonlyMap<string, StoredStatus>): Promise<void> {
  assertWritableMetadata(access)
  if (statuses.size > MAX_STATUS_ENTRIES) throw new ChapterStatusError('chapter status limit exceeded', 'BLOCKED')
  await writeMetadataTextAtomic(access.path, CHAPTER_STATUS_PATH, serializedStatuses(statuses))
}

export async function setChapterStatus(input: {
  access: ChapterStatusAccess
  path: string
  status: unknown
}): Promise<{ path: string; status: ChapterStatus }> {
  if (!isChapterStatus(input.status)) throw new ChapterStatusError('chapter status is invalid', 'INVALID_PATH')
  const relative = manuscriptChapterPath(input.path)
  assertWritableMetadata(input.access)
  try {
    await readTextFile(input.access.files, relative)
  } catch (error) {
    if (error instanceof FileOpError && (error.code === 'NOT_FOUND' || error.code === 'NOT_TEXT')) {
      throw new ChapterStatusError('chapter path was not found', 'INVALID_PATH', { cause: error })
    }
    throw error
  }
  const stored = await loadChapterStatuses(input.access)
  const next = new Map(stored)
  if (input.status === 'draft') next.delete(relative)
  else next.set(relative, input.status)
  if (serializedStatuses(next) !== serializedStatuses(stored)) {
    await writeChapterStatuses(input.access, next)
  }
  return { path: relative, status: input.status }
}

function remapStatusKeys(
  statuses: ReadonlyMap<string, StoredStatus>,
  from: string,
  to: string | null,
): Map<string, StoredStatus> {
  const next = new Map(statuses)
  const prefix = `${from}/`
  for (const [key, status] of statuses) {
    if (key !== from && !key.startsWith(prefix)) continue
    next.delete(key)
    if (to === null) continue
    const destination = key === from ? to : `${to}${key.slice(from.length)}`
    const chapter = tryChapterPath(destination)
    if (chapter) next.set(chapter, status)
  }
  return next
}

/** Best-effort remap after rename/move/delete. Missing or corrupt files stay fail-open. */
export async function syncChapterStatusPaths(
  access: MetadataAccess,
  from: string,
  to: string | null,
): Promise<void> {
  let source: string
  try {
    source = normalizeWorkspaceRelative(from)
  } catch {
    return
  }
  let target: string | null = null
  if (to !== null) {
    try {
      target = normalizeWorkspaceRelative(to)
    } catch {
      target = null
    }
  }
  const stored = await loadChapterStatuses(access)
  if (stored.size === 0) return
  const next = remapStatusKeys(stored, source, target)
  if (serializedStatuses(next) === serializedStatuses(stored)) return
  await writeChapterStatuses(access, next)
}
