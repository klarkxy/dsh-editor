import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeWorkspaceRelative } from 'dsh-manuscript/host-api'

export const METADATA_DIRECTORY = '.dsh-editor'
const MAX_TEXT_BYTES = 2_000_000

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
  return await fs.realpath(resolved)
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

async function resolveMetadataFile(root: string, relative: string): Promise<string | null> {
  const normalized = normalizeWorkspaceRelative(relative)
  const canonicalRoot = await safeWorkspaceRoot(root)
  let cursor = path.resolve(root)
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
  }
  let canonicalParent: string
  try {
    canonicalParent = await fs.realpath(path.dirname(cursor))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new MetadataIoError('failed to inspect project metadata', 'IO', { cause: error })
  }
  if (!isInside(canonicalRoot, canonicalParent)) throw new MetadataIoError('project metadata path escapes workspace', 'BLOCKED')
  return cursor
}

/** Missing, empty, oversized, or unreadable metadata is treated as absent. */
export async function readMetadataText(root: string, relative: string): Promise<string | null> {
  try {
    const target = await resolveMetadataFile(root, relative)
    if (!target) return null
    const text = await fs.readFile(target, 'utf8')
    if (byteSize(text) > MAX_TEXT_BYTES) return null
    return text
  } catch (error) {
    if (error instanceof MetadataIoError && error.code === 'BLOCKED') return null
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof MetadataIoError && error.code === 'IO') return null
    return null
  }
}

/**
 * Same-directory temp file + rename. On Windows the existing target is unlinked
 * first; readers fail-open if they observe the brief gap.
 */
export async function writeMetadataTextAtomic(root: string, relative: string, text: string): Promise<void> {
  if (byteSize(text) > MAX_TEXT_BYTES) throw new MetadataIoError('metadata file exceeds 2 MB', 'BLOCKED')
  const normalized = normalizeWorkspaceRelative(relative)
  const parts = normalized.split('/')
  if (parts[0] !== METADATA_DIRECTORY || parts.length !== 2 || parts[1]!.startsWith('.')) {
    throw new MetadataIoError('metadata path is invalid', 'BLOCKED')
  }
  await ensureMetadataDirectory(root)
  const directory = path.join(root, METADATA_DIRECTORY)
  const target = path.join(directory, parts[1]!)
  const tmp = path.join(directory, `.${parts[1]!}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(tmp, text, 'utf8')
    try {
      await fs.rename(tmp, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error
    }
    await fs.unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    await fs.rename(tmp, target)
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined)
    if (error instanceof MetadataIoError) throw error
    throw new MetadataIoError('failed to write project metadata', 'IO', { cause: error })
  }
}
