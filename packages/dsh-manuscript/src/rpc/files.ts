import type {
  FileSystemLike,
  FsInfoLike,
  FsTargetLike,
  SandboxExecutionPolicyLike,
} from '../host.ts'
import { normalizeWorkspaceRelative, parentRelative, PathConfineError } from './paths.ts'

export type DirKind = 'file' | 'directory' | 'other'

export type DirEntry = {
  name: string
  type: DirKind
}

export class FileOpError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_FOUND'
      | 'NOT_DIRECTORY'
      | 'EXISTS'
      | 'STALE'
      | 'NOT_TEXT'
      | 'PARENT_MISSING'
      | 'TOO_LARGE'
      | 'DENIED'
      | 'SYMLINK'
      | 'CANCELLED'
      | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'FileOpError'
  }
}

/** Soft ceiling for manuscript text IO. */
export const MAX_TEXT_BYTES = 2_000_000

export type WorkspaceFileContext = {
  fs: FileSystemLike
  cwd: string
  root: FsTargetLike
  policy: SandboxExecutionPolicyLike
  signal?: AbortSignal
}

type ResolvedPath = {
  relative: string
  target: FsTargetLike
  info: FsInfoLike | undefined
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function fsErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return typeof error.code === 'string' ? error.code : ''
}

function mapFsError(error: unknown): never {
  const code = fsErrorCode(error)
  if (code === 'FS_NOT_FOUND') throw new FileOpError('path not found', 'NOT_FOUND', { cause: error })
  if (code === 'FS_NOT_DIRECTORY') throw new FileOpError('not a directory', 'NOT_DIRECTORY', { cause: error })
  if (code === 'FS_NOT_TEXT' || code === 'FS_NOT_REGULAR_FILE') {
    throw new FileOpError('not a regular text file', 'NOT_TEXT', { cause: error })
  }
  if (code === 'FS_TOO_LARGE') throw new FileOpError('file too large', 'TOO_LARGE', { cause: error })
  if (code === 'FS_STALE_VERSION') throw new FileOpError('file changed on disk', 'STALE', { cause: error })
  if (code === 'FS_NOT_OBSERVED') throw new FileOpError('file already exists', 'EXISTS', { cause: error })
  if (code === 'FS_SANDBOX_DENIED' || code === 'FS_PERMISSION_DENIED') {
    throw new FileOpError('file access denied', 'DENIED', { cause: error })
  }
  if (code === 'FS_ABORTED') throw new FileOpError('operation cancelled', 'CANCELLED', { cause: error })
  throw new FileOpError(error instanceof Error ? error.message : 'filesystem operation failed', 'IO', { cause: error })
}

function assertWritable(context: WorkspaceFileContext): void {
  if (context.policy.mode === 'read-only') {
    throw new FileOpError('workspace is read-only', 'DENIED')
  }
}

async function assertNoSymlinkComponents(context: WorkspaceFileContext, relative: string): Promise<void> {
  const components = relative === '.' ? ['.'] : relative.split('/').map((_, index, all) => all.slice(0, index + 1).join('/'))
  for (const component of components) {
    let info
    try {
      info = await context.fs.lstat(component, { cwd: context.cwd }, context.signal)
    } catch (error) {
      mapFsError(error)
    }
    if (info?.type === 'symlink') throw new FileOpError('symbolic links are not supported', 'SYMLINK')
    if (!info) break
  }
}

async function resolveScoped(context: WorkspaceFileContext, relativeInput: string): Promise<ResolvedPath> {
  const relative = normalizeWorkspaceRelative(relativeInput)
  await assertNoSymlinkComponents(context, relative)

  let target: FsTargetLike
  try {
    target = await context.fs.resolve(relative, { cwd: context.cwd, signal: context.signal })
  } catch (error) {
    mapFsError(error)
  }
  if (!context.fs.contains(context.root, target)) throw new PathConfineError('canonical path escapes workspace')

  // Repeat the component walk after canonical resolution so a link swapped in
  // during resolution is rejected as well. The resolved target still receives
  // the provider-owned canonical containment fence above.
  await assertNoSymlinkComponents(context, relative)

  let info: FsInfoLike | undefined
  try {
    info = await context.fs.stat(target, context.signal)
  } catch (error) {
    mapFsError(error)
  }
  return { relative, target, info }
}

function sortDirEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name)
    if (a.type === 'directory') return -1
    if (b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })
}

export async function listDir(context: WorkspaceFileContext, relative: string): Promise<DirEntry[]> {
  return await listDirStrict(context, relative)
}

/** Provider-confined directory listing with no native fallback, for security-sensitive walks. */
export async function listDirStrict(context: WorkspaceFileContext, relative: string): Promise<DirEntry[]> {
  const resolved = await resolveScoped(context, relative)
  if (!resolved.info) throw new FileOpError('directory not found', 'NOT_FOUND')
  if (resolved.info.type !== 'directory') throw new FileOpError('not a directory', 'NOT_DIRECTORY')
  try {
    const entries = await context.fs.listDir(resolved.target, context.signal)
    return sortDirEntries(
      entries
        .filter((entry) => entry.name !== '.' && entry.name !== '..')
        .map((entry) => ({ name: entry.name, type: entry.type })),
    )
  } catch (error) {
    if (error instanceof PathConfineError || error instanceof FileOpError) throw error
    mapFsError(error)
  }
}

export async function readTextFile(
  context: WorkspaceFileContext,
  relative: string,
): Promise<{ text: string; version: string }> {
  const resolved = await resolveScoped(context, relative)
  if (!resolved.info) throw new FileOpError('file not found', 'NOT_FOUND')
  if (resolved.info.type !== 'file') throw new FileOpError('not a regular file', 'NOT_TEXT')
  if (resolved.info.size !== undefined && resolved.info.size > MAX_TEXT_BYTES) {
    throw new FileOpError('file too large', 'TOO_LARGE')
  }
  let text: string
  try {
    text = await context.fs.readText(resolved.target, context.signal)
  } catch (error) {
    mapFsError(error)
  }
  if (byteLength(text) > MAX_TEXT_BYTES) throw new FileOpError('file too large', 'TOO_LARGE')

  let after: FsInfoLike | undefined
  try {
    after = await context.fs.stat(resolved.target, context.signal)
  } catch (error) {
    mapFsError(error)
  }
  if (!after || after.type !== 'file' || String(after.version) !== String(resolved.info.version)) {
    throw new FileOpError('file changed while it was read', 'STALE')
  }
  return { text, version: String(after.version) }
}

/** Create a file only if its parent directory already exists. Never mkdir. */
export async function createTextFile(
  context: WorkspaceFileContext,
  relative: string,
  text: string,
): Promise<{ version: string }> {
  assertWritable(context)
  if (byteLength(text) > MAX_TEXT_BYTES) throw new FileOpError('file too large', 'TOO_LARGE')
  const normalized = normalizeWorkspaceRelative(relative)
  if (normalized === '.') throw new FileOpError('file path is required', 'NOT_TEXT')
  const parent = await resolveScoped(context, parentRelative(normalized))
  if (!parent.info || parent.info.type !== 'directory') {
    throw new FileOpError('parent directory does not exist', 'PARENT_MISSING')
  }
  const resolved = await resolveScoped(context, normalized)
  if (resolved.info) throw new FileOpError('file already exists', 'EXISTS')
  try {
    const result = await context.fs.writeText(
      resolved.target,
      text,
      { kind: 'createIfAbsent' },
      context.signal,
      context.policy,
    )
    return { version: String(result.version) }
  } catch (error) {
    mapFsError(error)
  }
}

export async function writeTextFile(
  context: WorkspaceFileContext,
  relative: string,
  text: string,
  expectedVersion: string,
): Promise<{ version: string }> {
  assertWritable(context)
  if (!expectedVersion) throw new FileOpError('file version is required', 'STALE')
  if (byteLength(text) > MAX_TEXT_BYTES) throw new FileOpError('file too large', 'TOO_LARGE')
  const resolved = await resolveScoped(context, relative)
  if (!resolved.info) throw new FileOpError('file not found', 'NOT_FOUND')
  if (resolved.info.type !== 'file') throw new FileOpError('not a regular file', 'NOT_TEXT')
  try {
    const result = await context.fs.writeText(
      resolved.target,
      text,
      { kind: 'replaceIfVersion', version: expectedVersion },
      context.signal,
      context.policy,
    )
    return { version: String(result.version) }
  } catch (error) {
    mapFsError(error)
  }
}
