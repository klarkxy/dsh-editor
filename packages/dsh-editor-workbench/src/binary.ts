import type {
  FileSystemLike,
  FsInfoLike,
  FsTargetLike,
  WorkspaceFileContext,
} from 'dsh-manuscript/host-api'
import { normalizeWorkspaceRelative } from 'dsh-manuscript/host-api'
import { FILE_READ_BINARY_MAX_BYTES, FILE_READ_BINARY_MIME } from './contracts.ts'

/**
 * FileSystemLike plus a `readBytes` method. The shared `FileSystemLike`
 * contract in `dsh-manuscript/host-api` is text-only; the workbench uses
 * this extension to fetch image bytes through the same canonical fence.
 */
export type BinaryFileSystem = FileSystemLike & {
  readBytes: (target: FsTargetLike, signal?: AbortSignal) => Promise<Uint8Array>
}

export type BinaryAccess = Omit<WorkspaceFileContext, 'fs'> & { fs: BinaryFileSystem }

export class BinaryError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_PATH' | 'INVALID_EXTENSION' | 'TOO_LARGE' | 'NOT_FOUND' | 'BLOCKED' | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BinaryError'
  }
}

function fsErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return typeof error.code === 'string' ? error.code : ''
}

function mapFsError(error: unknown): never {
  const code = fsErrorCode(error)
  if (code === 'FS_NOT_FOUND') throw new BinaryError('path not found', 'NOT_FOUND', { cause: error })
  if (code === 'FS_NOT_DIRECTORY') throw new BinaryError('not a directory', 'BLOCKED', { cause: error })
  if (code === 'FS_NOT_TEXT' || code === 'FS_NOT_REGULAR_FILE') {
    throw new BinaryError('not a regular file', 'BLOCKED', { cause: error })
  }
  if (code === 'FS_TOO_LARGE') throw new BinaryError('file too large', 'TOO_LARGE', { cause: error })
  if (code === 'FS_STALE_VERSION') throw new BinaryError('file changed on disk', 'IO', { cause: error })
  if (code === 'FS_NOT_OBSERVED') throw new BinaryError('file already exists', 'BLOCKED', { cause: error })
  if (code === 'FS_SANDBOX_DENIED' || code === 'FS_PERMISSION_DENIED') {
    throw new BinaryError('file access denied', 'BLOCKED', { cause: error })
  }
  if (code === 'FS_ABORTED') throw new BinaryError('operation cancelled', 'IO', { cause: error })
  throw new BinaryError(error instanceof Error ? error.message : 'filesystem operation failed', 'IO', { cause: error })
}

async function assertNoSymlinkComponents(access: BinaryAccess, relative: string): Promise<void> {
  const components = relative === '.' ? ['.'] : relative.split('/').map((_, index, all) => all.slice(0, index + 1).join('/'))
  for (const component of components) {
    let info
    try {
      info = await access.fs.lstat(component, { cwd: access.cwd }, access.signal)
    } catch (error) {
      mapFsError(error)
    }
    if (info?.type === 'symlink') throw new BinaryError('symbolic links are not supported', 'BLOCKED')
    if (!info) break
  }
}

async function resolveBinaryTarget(access: BinaryAccess, relativeInput: string): Promise<{ relative: string; target: FsTargetLike; info: FsInfoLike | undefined }> {
  const relative = normalizeWorkspaceRelative(relativeInput)
  await assertNoSymlinkComponents(access, relative)

  let target: FsTargetLike
  try {
    target = await access.fs.resolve(relative, { cwd: access.cwd, signal: access.signal })
  } catch (error) {
    mapFsError(error)
  }
  if (!access.fs.contains(access.root, target)) throw new BinaryError('canonical path escapes workspace', 'INVALID_PATH')

  // Repeat the component walk after canonical resolution so a link swapped in
  // during resolution is rejected as well.
  await assertNoSymlinkComponents(access, relative)

  let info: FsInfoLike | undefined
  try {
    info = await access.fs.stat(target, access.signal)
  } catch (error) {
    mapFsError(error)
  }
  return { relative, target, info }
}

function mimeFor(extension: string): string | undefined {
  return FILE_READ_BINARY_MIME[extension.toLowerCase()]
}

export async function readImageFile(input: {
  access: BinaryAccess
  path: string
}): Promise<{ base64: string; mime: string }> {
  const { access, path } = input
  const relative = (() => {
    try {
      return normalizeWorkspaceRelative(path)
    } catch (error) {
      throw new BinaryError('image path is invalid', 'INVALID_PATH', { cause: error })
    }
  })()
  const extension = (relative === '.' ? '' : relative.slice(relative.lastIndexOf('/') + 1).match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
  const mime = mimeFor(extension)
  if (!mime) throw new BinaryError(`unsupported image extension: ${extension || '(none)'}`, 'INVALID_EXTENSION')

  const resolved = await resolveBinaryTarget(access, relative)
  if (!resolved.info) throw new BinaryError('image was not found', 'NOT_FOUND')
  if (resolved.info.type !== 'file') throw new BinaryError('not a regular file', 'BLOCKED')
  if (resolved.info.size !== undefined && resolved.info.size > FILE_READ_BINARY_MAX_BYTES) {
    throw new BinaryError('image exceeds the 20 MB size limit', 'TOO_LARGE')
  }

  let bytes: Uint8Array
  try {
    bytes = await access.fs.readBytes(resolved.target, access.signal)
  } catch (error) {
    mapFsError(error)
  }
  if (bytes.byteLength > FILE_READ_BINARY_MAX_BYTES) {
    throw new BinaryError('image exceeds the 20 MB size limit', 'TOO_LARGE')
  }

  let after: FsInfoLike | undefined
  try {
    after = await access.fs.stat(resolved.target, access.signal)
  } catch (error) {
    mapFsError(error)
  }
  if (!after || after.type !== 'file' || String(after.version) !== String(resolved.info.version)) {
    throw new BinaryError('image changed while it was read', 'IO')
  }

  return { base64: Buffer.from(bytes).toString('base64'), mime }
}
