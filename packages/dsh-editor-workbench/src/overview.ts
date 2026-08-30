import fs from 'node:fs/promises'
import path from 'node:path'
import {
  FileOpError,
  createTextFile,
  listDirStrict,
  normalizeWorkspaceRelative,
  readTextFile,
  readTextFileLimited,
  writeTextFile,
  type WorkspaceFileContext,
} from 'dsh-manuscript/host-api'
import type { ChapterStatus, ChapterSummary, OutlineSummary, ProjectOverview } from './contracts.ts'

export const CHAPTER_STATUS_PATH = '.dsh-editor/chapter-status.json'

const MANUSCRIPT_ROOT = '正文'
const OUTLINE_ROOT = '大纲'
const MAX_FILES = 2_000
const MAX_TOTAL_BYTES = 100_000_000
const MAX_TEXT_BYTES = 2_000_000
const MAX_DIRECTORIES = 2_000
const MAX_DIRECTORY_ENTRIES = 10_000
const MAX_DEPTH = 12
const EXCERPT_MAX_CHARS = 160

export type OverviewAccess = {
  path: string
  rootKey: string
  mode: string
  files: WorkspaceFileContext
}

type StoredStatus = { statuses: Map<string, Exclude<ChapterStatus, 'draft'>>; revision: string | null }
type ScanResult = {
  chapters: Array<Omit<ChapterSummary, 'status'>>
  outlines: OutlineSummary[]
  chapterPaths: Set<string>
  totalChars: number
  truncated: boolean
  skipped: number
}

export class OverviewError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'STALE' | 'BLOCKED' | 'INVALID_PATH' | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'OverviewError'
  }
}

function byteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function pathCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function visibleTextPath(relative: string, root?: typeof MANUSCRIPT_ROOT | typeof OUTLINE_ROOT): string {
  let normalized: string
  try {
    normalized = normalizeWorkspaceRelative(relative)
  } catch (error) {
    throw new OverviewError('chapter path is invalid', 'INVALID_PATH', { cause: error })
  }
  if (normalized !== relative || normalized === '.' || !/\.(md|txt)$/i.test(normalized)) {
    throw new OverviewError('chapter path is invalid', 'INVALID_PATH')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => part.startsWith('.'))) throw new OverviewError('chapter path is invalid', 'INVALID_PATH')
  if (root && (parts[0] !== root || parts.length < 2)) throw new OverviewError('chapter path is outside its project area', 'INVALID_PATH')
  if (!root && parts[0] !== MANUSCRIPT_ROOT) throw new OverviewError('chapter status path must be in 正文', 'INVALID_PATH')
  return normalized
}

function titleAndExcerpt(relative: string, text: string): { title: string; excerpt: string; empty: boolean; chars: number } {
  const filename = path.posix.basename(relative).replace(/\.(md|txt)$/i, '')
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const heading = lines.find((line) => /^\s{0,3}#\s+\S/.test(line))
  const title = heading?.replace(/^\s{0,3}#\s+/, '').replace(/\s+#+\s*$/, '').trim() || filename
  const excerpt = lines.find((line) => line.trim() && !/^\s{0,3}#+(?:\s|$)/.test(line))?.trim().slice(0, EXCERPT_MAX_CHARS) ?? ''
  const withoutLeadingH1 = text.replace(/^\uFEFF?(?:[ \t]*\r?\n)*[ \t]{0,3}#\s+[^\r\n]*(?:\r?\n|$)/, '')
  return {
    title,
    excerpt,
    empty: withoutLeadingH1.replace(/\s/g, '').length === 0,
    chars: text.replace(/\s/g, '').length,
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function safeRoot(root: string): Promise<string> {
  const resolved = path.resolve(root)
  let state: import('node:fs').Stats
  try {
    state = await fs.lstat(resolved)
  } catch (error) {
    throw new OverviewError('workspace root is unavailable', 'IO', { cause: error })
  }
  if (state.isSymbolicLink() || !state.isDirectory()) throw new OverviewError('workspace root is unsafe', 'BLOCKED')
  return await fs.realpath(resolved)
}

async function mtimeReader(root: string): Promise<(relative: string) => Promise<string | null>> {
  const canonicalRoot = await safeRoot(root)
  return async (relative: string): Promise<string | null> => {
    const normalized = normalizeWorkspaceRelative(relative)
    let cursor = path.resolve(root)
    const parts = normalized.split('/')
    for (let index = 0; index < parts.length; index++) {
      cursor = path.join(cursor, parts[index]!)
      let state: import('node:fs').Stats
      try {
        state = await fs.lstat(cursor)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw new OverviewError('failed to inspect project document', 'IO', { cause: error })
      }
      if (state.isSymbolicLink() || (index < parts.length - 1 ? !state.isDirectory() : !state.isFile())) {
        throw new OverviewError('project document path is unsafe', 'BLOCKED')
      }
    }
    let canonicalParent: string
    try {
      canonicalParent = await fs.realpath(path.dirname(cursor))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new OverviewError('failed to inspect project document', 'IO', { cause: error })
    }
    if (!isInside(canonicalRoot, canonicalParent)) throw new OverviewError('project document path escapes workspace', 'BLOCKED')
    const state = await fs.lstat(cursor)
    if (state.isSymbolicLink() || !state.isFile()) throw new OverviewError('project document path is unsafe', 'BLOCKED')
    return new Date(state.mtimeMs).toISOString()
  }
}

function parseStoredStatus(text: string): Map<string, Exclude<ChapterStatus, 'draft'>> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new OverviewError('chapter status file is invalid', 'BLOCKED', { cause: error })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OverviewError('chapter status file is invalid', 'BLOCKED')
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || record.version !== 1 || !record.statuses || typeof record.statuses !== 'object' || Array.isArray(record.statuses)) {
    throw new OverviewError('chapter status file is invalid', 'BLOCKED')
  }
  const statuses = new Map<string, Exclude<ChapterStatus, 'draft'>>()
  for (const [relative, status] of Object.entries(record.statuses as Record<string, unknown>)) {
    if (statuses.size >= MAX_FILES || (status !== 'revising' && status !== 'final')) {
      throw new OverviewError('chapter status file is invalid', 'BLOCKED')
    }
    try {
      statuses.set(visibleTextPath(relative), status)
    } catch (error) {
      throw new OverviewError('chapter status file is invalid', 'BLOCKED', { cause: error })
    }
  }
  return statuses
}

async function loadStoredStatus(access: OverviewAccess): Promise<StoredStatus> {
  try {
    const loaded = await readTextFileLimited(access.files, CHAPTER_STATUS_PATH, MAX_TEXT_BYTES)
    return { statuses: parseStoredStatus(loaded.text), revision: loaded.version }
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') return { statuses: new Map(), revision: null }
    if (error instanceof FileOpError && error.code === 'TOO_LARGE') throw new OverviewError('chapter status file exceeds 2 MB', 'BLOCKED', { cause: error })
    throw error
  }
}

function serializedStatus(statuses: ReadonlyMap<string, Exclude<ChapterStatus, 'draft'>>): string {
  const ordered = [...statuses.entries()].sort(([left], [right]) => pathCompare(left, right))
  return `${JSON.stringify({ version: 1, statuses: Object.fromEntries(ordered) }, null, 2)}\n`
}

function assertWritableStatus(statuses: ReadonlyMap<string, Exclude<ChapterStatus, 'draft'>>): string {
  if (statuses.size > MAX_FILES) throw new OverviewError('chapter status limit exceeded', 'BLOCKED')
  const text = serializedStatus(statuses)
  if (byteSize(text) > MAX_TEXT_BYTES) throw new OverviewError('chapter status file exceeds 2 MB', 'BLOCKED')
  return text
}

async function ensureStatusDirectory(access: OverviewAccess): Promise<void> {
  if (access.mode === 'read-only' || access.files.policy.mode === 'read-only') throw new OverviewError('project folder is read-only', 'READ_ONLY')
  const canonicalRoot = await safeRoot(access.path)
  const target = path.join(access.path, '.dsh-editor')
  try {
    await fs.mkdir(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new OverviewError('failed to create project metadata directory', 'IO', { cause: error })
  }
  const state = await fs.lstat(target)
  if (state.isSymbolicLink() || !state.isDirectory()) throw new OverviewError('project metadata directory is unsafe', 'BLOCKED')
  const canonical = await fs.realpath(target)
  if (!isInside(canonicalRoot, canonical)) throw new OverviewError('project metadata directory escapes workspace', 'BLOCKED')
}

async function writeStoredStatus(
  access: OverviewAccess,
  stored: StoredStatus,
  statuses: ReadonlyMap<string, Exclude<ChapterStatus, 'draft'>>,
): Promise<string | null> {
  if (access.mode === 'read-only' || access.files.policy.mode === 'read-only') throw new OverviewError('project folder is read-only', 'READ_ONLY')
  const text = assertWritableStatus(statuses)
  if (stored.revision === null) {
    await ensureStatusDirectory(access)
    return (await createTextFile(access.files, CHAPTER_STATUS_PATH, text)).version
  }
  return (await writeTextFile(access.files, CHAPTER_STATUS_PATH, text, stored.revision)).version
}

async function scanArea(
  access: OverviewAccess,
  root: typeof MANUSCRIPT_ROOT | typeof OUTLINE_ROOT,
  limit: { files: number; bytes: number; directories: number; entries: number },
  modifiedAt: (relative: string) => Promise<string | null>,
): Promise<{ items: Array<Omit<ChapterSummary, 'status'>>; truncated: boolean; skipped: number }> {
  const items: Array<Omit<ChapterSummary, 'status'>> = []
  const queue: string[] = [root]
  let truncated = false
  let skipped = 0
  while (queue.length && !truncated) {
    const directory = queue.shift()!
    if (++limit.directories > MAX_DIRECTORIES) { truncated = true; skipped++; break }
    let entries
    try {
      entries = await listDirStrict(access.files, directory)
    } catch (error) {
      if (directory === root && error instanceof FileOpError && error.code === 'NOT_FOUND') break
      skipped++
      continue
    }
    for (const entry of entries) {
      if (++limit.entries > MAX_DIRECTORY_ENTRIES) { truncated = true; skipped++; break }
      if (entry.name.startsWith('.')) continue
      const relative = `${directory}/${entry.name}`
      if (entry.type === 'directory') {
        if (relative.split('/').length > MAX_DEPTH) { skipped++; continue }
        queue.push(relative)
        continue
      }
      if (entry.type !== 'file' || !/\.(md|txt)$/i.test(entry.name)) continue
      if (limit.files >= MAX_FILES || limit.bytes >= MAX_TOTAL_BYTES) { truncated = true; break }
      limit.files++
      try {
        const loaded = await readTextFileLimited(access.files, relative, Math.min(MAX_TEXT_BYTES, MAX_TOTAL_BYTES - limit.bytes))
        const bytes = byteSize(loaded.text)
        if (limit.bytes + bytes > MAX_TOTAL_BYTES) { truncated = true; skipped++; break }
        limit.bytes += bytes
        const summary = titleAndExcerpt(relative, loaded.text)
        items.push({ path: relative, ...summary, modifiedAt: await modifiedAt(relative) })
      } catch (error) {
        skipped++
        if (error instanceof FileOpError && error.code === 'TOO_LARGE' && MAX_TOTAL_BYTES - limit.bytes <= MAX_TEXT_BYTES) {
          truncated = true
          break
        }
      }
    }
  }
  items.sort((left, right) => pathCompare(left.path, right.path))
  return { items, truncated, skipped }
}

async function scanProject(access: OverviewAccess): Promise<ScanResult> {
  const modifiedAt = await mtimeReader(access.path)
  const limit = { files: 0, bytes: 0, directories: 0, entries: 0 }
  const chapters = await scanArea(access, MANUSCRIPT_ROOT, limit, modifiedAt)
  const outlines = chapters.truncated ? { items: [] as Array<Omit<ChapterSummary, 'status'>>, truncated: true, skipped: 0 } : await scanArea(access, OUTLINE_ROOT, limit, modifiedAt)
  return {
    chapters: chapters.items,
    outlines: outlines.items.map((item) => ({
      path: item.path,
      title: item.title,
      chars: item.chars,
      excerpt: item.excerpt,
      modifiedAt: item.modifiedAt,
    })),
    chapterPaths: new Set(chapters.items.map((item) => item.path)),
    totalChars: chapters.items.reduce((total, chapter) => total + chapter.chars, 0),
    truncated: chapters.truncated || outlines.truncated,
    skipped: chapters.skipped + outlines.skipped,
  }
}

export async function readProjectOverview(access: OverviewAccess): Promise<ProjectOverview> {
  const [stored, scan] = await Promise.all([loadStoredStatus(access), scanProject(access)])
  const chapters: ChapterSummary[] = scan.chapters.map((chapter) => ({ ...chapter, status: stored.statuses.get(chapter.path) ?? 'draft' }))
  const byStatus: Record<ChapterStatus, number> = { draft: 0, revising: 0, final: 0 }
  for (const chapter of chapters) byStatus[chapter.status]++
  const recent = [...chapters].sort((left, right) => {
    const time = (right.modifiedAt ?? '').localeCompare(left.modifiedAt ?? '')
    return time || pathCompare(left.path, right.path)
  })[0] ?? null
  return {
    statusRevision: stored.revision,
    chapters,
    outlines: scan.outlines,
    totals: { chapters: chapters.length, chars: scan.totalChars, byStatus },
    recent,
    truncated: scan.truncated,
    skipped: scan.skipped,
  }
}

export async function setChapterStatus(input: {
  access: OverviewAccess
  path: string
  status: ChapterStatus
  expectedStatusRevision: string | null
}): Promise<ProjectOverview> {
  const relative = visibleTextPath(input.path)
  if (input.status !== 'draft' && input.status !== 'revising' && input.status !== 'final') throw new OverviewError('chapter status is invalid', 'INVALID_PATH')
  const stored = await loadStoredStatus(input.access)
  if (stored.revision !== input.expectedStatusRevision) throw new OverviewError('chapter status changed', 'STALE')
  await readTextFile(input.access.files, relative)
  const statuses = new Map(stored.statuses)
  if (input.status === 'draft') statuses.delete(relative)
  else statuses.set(relative, input.status)
  assertWritableStatus(statuses)
  const scan = await scanProject(input.access)
  if (!scan.truncated && scan.skipped === 0) {
    for (const key of statuses.keys()) if (!scan.chapterPaths.has(key)) statuses.delete(key)
  }
  const changed = serializedStatus(statuses) !== serializedStatus(stored.statuses)
  if (changed) await writeStoredStatus(input.access, stored, statuses)
  return await readProjectOverview(input.access)
}

/** Read one stored status without scanning the project tree. Used by lifecycle manifests. */
export async function readChapterStatus(access: OverviewAccess, relative: string): Promise<ChapterStatus> {
  const target = visibleTextPath(relative)
  return (await loadStoredStatus(access)).statuses.get(target) ?? 'draft'
}

async function retryMutation(
  access: OverviewAccess,
  mutate: (statuses: Map<string, Exclude<ChapterStatus, 'draft'>>) => boolean,
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const stored = await loadStoredStatus(access)
    const statuses = new Map(stored.statuses)
    if (!mutate(statuses)) return stored.revision
    try {
      return await writeStoredStatus(access, stored, statuses)
    } catch (error) {
      if (!(error instanceof FileOpError && (error.code === 'STALE' || error.code === 'EXISTS')) || attempt === 1) throw error
    }
  }
  throw new OverviewError('chapter status changed', 'STALE')
}

/** Move an existing status after a successful chapter rename or move. Returns the current metadata revision. */
export async function migrateChapterStatus(access: OverviewAccess, from: string, to: string): Promise<string | null> {
  const source = visibleTextPath(from)
  const target = visibleTextPath(to)
  return await retryMutation(access, (statuses) => {
    const status = statuses.get(source)
    if (!status) return false
    statuses.delete(source)
    statuses.set(target, status)
    return true
  })
}

/** Remove the active status after a successful archive. Returns the current metadata revision. */
export async function removeChapterStatus(access: OverviewAccess, relative: string): Promise<string | null> {
  const target = visibleTextPath(relative)
  return await retryMutation(access, (statuses) => statuses.delete(target))
}

/** Restore a previously archived status. Draft is represented by no stored entry. */
export async function restoreChapterStatus(access: OverviewAccess, relative: string, status: ChapterStatus): Promise<string | null> {
  const target = visibleTextPath(relative)
  if (status !== 'draft' && status !== 'revising' && status !== 'final') throw new OverviewError('chapter status is invalid', 'INVALID_PATH')
  return await retryMutation(access, (statuses) => {
    if (status === 'draft') return statuses.delete(target)
    if (statuses.get(target) === status) return false
    statuses.set(target, status)
    return true
  })
}
