import fs from 'node:fs/promises'
import path from 'node:path'
import {
  FileOpError,
  listDirStrict,
  normalizeWorkspaceRelative,
  readTextFileLimited,
  type WorkspaceFileContext,
} from 'dsh-manuscript/host-api'
import type { ChapterSummary, OutlineSummary, ProjectOverview } from './contracts.ts'

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

type ScanResult = {
  chapters: ChapterSummary[]
  outlines: OutlineSummary[]
  totalChars: number
  truncated: boolean
  skipped: number
}

export class OverviewError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'BLOCKED' | 'INVALID_PATH' | 'IO',
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

async function scanArea(
  access: OverviewAccess,
  root: typeof MANUSCRIPT_ROOT | typeof OUTLINE_ROOT,
  limit: { files: number; bytes: number; directories: number; entries: number },
  modifiedAt: (relative: string) => Promise<string | null>,
): Promise<{ items: ChapterSummary[]; truncated: boolean; skipped: number }> {
  const items: ChapterSummary[] = []
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
  const outlines = chapters.truncated ? { items: [] as ChapterSummary[], truncated: true, skipped: 0 } : await scanArea(access, OUTLINE_ROOT, limit, modifiedAt)
  return {
    chapters: chapters.items,
    outlines: outlines.items.map((item) => ({
      path: item.path,
      title: item.title,
      chars: item.chars,
      excerpt: item.excerpt,
      modifiedAt: item.modifiedAt,
    })),
    totalChars: chapters.items.reduce((total, chapter) => total + chapter.chars, 0),
    truncated: chapters.truncated || outlines.truncated,
    skipped: chapters.skipped + outlines.skipped,
  }
}

export async function readProjectOverview(access: OverviewAccess): Promise<ProjectOverview> {
  const scan = await scanProject(access)
  const recent = [...scan.chapters].sort((left, right) => {
    const time = (right.modifiedAt ?? '').localeCompare(left.modifiedAt ?? '')
    return time || pathCompare(left.path, right.path)
  })[0] ?? null
  return {
    chapters: scan.chapters,
    outlines: scan.outlines,
    totals: { chapters: scan.chapters.length, chars: scan.totalChars },
    recent,
    truncated: scan.truncated,
    skipped: scan.skipped,
  }
}
