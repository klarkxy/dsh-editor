import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeWorkspaceRelative } from 'dsh-manuscript/host-api'

export const METADATA_DIRECTORY = '.dsh-editor'
const MAX_TEXT_BYTES = 2_000_000
const REPLACE_ATTEMPTS = 8
const REPLACE_DELAY_MS = 25
const TRANSIENT_REPLACE_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'EAGAIN'])

export type MetadataAccess = {
  path: string
  mode: string
}

export class MetadataIoError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'BLOCKED' | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MetadataIoError'
  }
}

function byteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function assertWritableMetadata(access: MetadataAccess): void {
  if (access.mode === 'read-only') throw new MetadataIoError('project folder is read-only', 'READ_ONLY')
}

async function safeWorkspaceRoot(root: string): Promise<string> {
  const resolved = path.resolve(root)
  let state: import('node:fs').Stats
  try {
    state = await fs.lstat(resolved)
  } catch (error) {
    throw new MetadataIoError('workspace root is unavailable', 'IO', { cause: error })
  }
  if (state.isSymbolicLink() || !state.isDirectory()) throw new MetadataIoError('workspace root is unsafe', 'BLOCKED')
  try {
    return await fs.realpath(resolved)
  } catch (error) {
    throw new MetadataIoError('workspace root is unavailable', 'IO', { cause: error })
  }
}

export async function ensureMetadataDirectory(root: string): Promise<void> {
  const canonicalRoot = await safeWorkspaceRoot(root)
  const target = path.join(root, METADATA_DIRECTORY)
  try {
    await fs.mkdir(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new MetadataIoError('failed to create project metadata directory', 'IO', { cause: error })
    }
  }
  const state = await fs.lstat(target)
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw new MetadataIoError('project metadata directory is unsafe', 'BLOCKED')
  }
  const canonical = await fs.realpath(target)
  if (!isInside(canonicalRoot, canonical)) {
    throw new MetadataIoError('project metadata directory escapes workspace', 'BLOCKED')
  }
}

async function resolveMetadataFile(root: string, relative: string): Promise<{ path: string; size: number } | null> {
  let normalized: string
  try {
    normalized = normalizeWorkspaceRelative(relative)
  } catch (error) {
    throw new MetadataIoError('metadata path is invalid', 'BLOCKED', { cause: error })
  }
  const canonicalRoot = await safeWorkspaceRoot(root)
  let cursor = path.resolve(root)
  let size = 0
  const parts = normalized.split('/')
  for (let index = 0; index < parts.length; index++) {
    cursor = path.join(cursor, parts[index]!)
    let state: import('node:fs').Stats
    try {
      state = await fs.lstat(cursor)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new MetadataIoError('failed to inspect project metadata', 'IO', { cause: error })
    }
    if (state.isSymbolicLink()) throw new MetadataIoError('project metadata path is unsafe', 'BLOCKED')
    if (index < parts.length - 1) {
      if (!state.isDirectory()) throw new MetadataIoError('project metadata path is unsafe', 'BLOCKED')
      continue
    }
    if (!state.isFile()) throw new MetadataIoError('project metadata path is unsafe', 'BLOCKED')
    size = state.size
  }
  let canonicalParent: string
  try {
    canonicalParent = await fs.realpath(path.dirname(cursor))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new MetadataIoError('failed to inspect project metadata', 'IO', { cause: error })
  }
  if (!isInside(canonicalRoot, canonicalParent)) throw new MetadataIoError('project metadata path escapes workspace', 'BLOCKED')
  return { path: cursor, size }
}

/** Only a missing file is absent. Callers choose whether an optional read may fail. */
export async function readMetadataText(root: string, relative: string): Promise<string | null> {
  try {
    const target = await resolveMetadataFile(root, relative)
    if (!target) return null
    if (target.size > MAX_TEXT_BYTES) throw new MetadataIoError('metadata file exceeds 2 MB', 'BLOCKED')
    const text = await fs.readFile(target.path, 'utf8')
    if (byteSize(text) > MAX_TEXT_BYTES) throw new MetadataIoError('metadata file exceeds 2 MB', 'BLOCKED')
    return text
  } catch (error) {
    if (error instanceof MetadataIoError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new MetadataIoError('failed to read project metadata', 'IO', { cause: error })
  }
}

/**
 * Same-directory temp file + replace. Windows locks receive bounded retries;
 * replacement failure leaves the old target intact and never counts as success.
 */
export async function writeMetadataTextAtomic(root: string, relative: string, text: string): Promise<void> {
  if (byteSize(text) > MAX_TEXT_BYTES) throw new MetadataIoError('metadata file exceeds 2 MB', 'BLOCKED')
  let normalized: string
  try {
    normalized = normalizeWorkspaceRelative(relative)
  } catch (error) {
    throw new MetadataIoError('metadata path is invalid', 'BLOCKED', { cause: error })
  }
  const parts = normalized.split('/')
  if (parts[0] !== METADATA_DIRECTORY || parts.length !== 2 || parts[1]!.startsWith('.')) {
    throw new MetadataIoError('metadata path is invalid', 'BLOCKED')
  }
  const directory = path.join(root, METADATA_DIRECTORY)
  const target = path.join(directory, parts[1]!)
  const tmp = path.join(directory, `.${parts[1]!}.${randomUUID()}.tmp`)
  let staged = false
  try {
    await ensureMetadataDirectory(root)
    // Reject an existing unsafe target rather than replacing it as if absent.
    await resolveMetadataFile(root, normalized)
    const handle = await fs.open(tmp, 'wx')
    staged = true
    try {
      await handle.writeFile(text, 'utf8')
    } finally {
      await handle.close()
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(tmp, target)
        return
      } catch (error) {
        if (process.platform !== 'win32' || attempt >= REPLACE_ATTEMPTS
          || !TRANSIENT_REPLACE_ERRORS.has((error as NodeJS.ErrnoException).code ?? '')) throw error
        await new Promise((resolve) => setTimeout(resolve, REPLACE_DELAY_MS * attempt))
      }
    }
  } catch (error) {
    if (staged) await fs.unlink(tmp).catch(() => undefined)
    if (error instanceof MetadataIoError) throw error
    throw new MetadataIoError('failed to write project metadata', 'IO', { cause: error })
  }
}
