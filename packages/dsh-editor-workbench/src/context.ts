import {
  PROJECT_CONTEXT_SOURCE_PATHS,
  compileProjectContextV2,
  type ProjectContextCompilation,
  type ProjectContextReadResult,
  type WorldbookCandidate,
  type WorldbookScanSummary,
} from './contracts.ts'
import { FileOpError, listDirStrict, readTextFile, readTextFileLimited, type WorkspaceFileContext } from 'dsh-manuscript/host-api'

const WORLDBOOK_ROOT = '世界书'
const FIXED_WORLDBOOK_PATH = '世界书/设定总汇.md'
const MAX_FILES = 64
const MAX_DIRECTORIES = 64
const MAX_DEPTH = 8
const MAX_FILE_BYTES = 64 * 1_024
const MAX_SCAN_BYTES = 512 * 1_024

function hiddenPath(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.'))
}

function isCandidatePath(path: string): boolean {
  return path.toLowerCase() !== FIXED_WORLDBOOK_PATH.toLowerCase() && /^世界书\/.+\.md$/i.test(path) && !hiddenPath(path)
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function bump(scan: WorldbookScanSummary, key: 'limits' | 'readErrors'): void {
  scan[key] = Math.min(1_024, scan[key] + 1)
}

async function scanWorldbook(files: WorkspaceFileContext): Promise<{ candidates: WorldbookCandidate[]; scan: WorldbookScanSummary }> {
  const scan: WorldbookScanSummary = { scanned: 0, unmatched: 0, disabled: 0, invalid: 0, limits: 0, readErrors: 0 }
  const candidates: WorldbookCandidate[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: WORLDBOOK_ROOT, depth: 0 }]
  let directories = 0
  let totalBytes = 0

  let fileLimitReached = false
  while (queue.length && !fileLimitReached) {
    const current = queue.shift()!
    if (++directories > MAX_DIRECTORIES) { bump(scan, 'limits'); break }
    let entries
    try {
      entries = await listDirStrict(files, current.path)
    } catch (error) {
      if (current.path === WORLDBOOK_ROOT && error instanceof FileOpError && error.code === 'NOT_FOUND') break
      bump(scan, 'readErrors')
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const path = `${current.path}/${entry.name}`
      if (entry.type === 'directory') {
        if (current.depth >= MAX_DEPTH || directories + queue.length >= MAX_DIRECTORIES) bump(scan, 'limits')
        else queue.push({ path, depth: current.depth + 1 })
        continue
      }
      if (entry.type !== 'file' || !isCandidatePath(path)) continue
      if (scan.scanned >= MAX_FILES) { bump(scan, 'limits'); fileLimitReached = true; break }
      scan.scanned++
      const remainingBytes = MAX_SCAN_BYTES - totalBytes
      if (remainingBytes <= 0) { bump(scan, 'limits'); fileLimitReached = true; break }
      try {
        const file = await readTextFileLimited(files, path, Math.min(MAX_FILE_BYTES, remainingBytes))
        const size = utf8Bytes(file.text)
        if (totalBytes + size > MAX_SCAN_BYTES) { bump(scan, 'limits'); continue }
        totalBytes += size
        candidates.push({ path, text: file.text, version: file.version })
      } catch (error) {
        if (error instanceof FileOpError && error.code === 'TOO_LARGE') bump(scan, 'limits')
        else bump(scan, 'readErrors')
      }
    }
  }
  return { candidates, scan }
}

async function savedDocument(files: WorkspaceFileContext, activePath: string | undefined): Promise<{ path: string; text: string } | undefined> {
  if (!activePath || hiddenPath(activePath) || !/\.(md|txt)$/i.test(activePath)) return undefined
  try {
    return { path: activePath, text: (await readTextFile(files, activePath)).text.slice(0, 8_000) }
  } catch {
    return undefined
  }
}

export async function compileContext(
  files: WorkspaceFileContext,
  userRequest: string,
  activePath?: string,
  authorPreferences?: string,
): Promise<ProjectContextCompilation> {
  const { candidates, scan } = await scanWorldbook(files)
  const activeDocument = await savedDocument(files, activePath)
  const read = async (path: typeof PROJECT_CONTEXT_SOURCE_PATHS[number]): Promise<ProjectContextReadResult> => {
    try {
      return { ok: true, value: await readTextFile(files, path) }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof FileOpError ? error.code : 'IO',
          message: error instanceof Error ? error.message : 'read failed',
        },
      }
    }
  }
  return await compileProjectContextV2(userRequest, read, {
    candidates,
    activePath: activeDocument?.path,
    savedDocumentText: activeDocument?.text,
    scan,
    authorPreferences,
  })
}
