import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { FileOpError, normalizeWorkspaceRelative, readTextFile } from 'dsh-manuscript/host-api'
import type { WorkspaceOpAccess } from './access.ts'
import { LifecycleError } from './errors.ts'

export type LoadedText = { text: string; version: string; bytes: number; sha256: string }

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export async function lstatOptional(target: string): Promise<import('node:fs').Stats | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function safeRoot(root: string): Promise<string> {
  const absolute = path.resolve(root)
  const state = await fs.lstat(absolute)
  if (state.isSymbolicLink() || !state.isDirectory()) throw new LifecycleError('workspace root is unsafe', 'BLOCKED')
  return await fs.realpath(absolute)
}

export async function safeDirectory(root: string, relative: string): Promise<string> {
  const canonicalRoot = await safeRoot(root)
  const normalized = normalizeWorkspaceRelative(relative)
  let cursor = path.resolve(root)
  if (normalized === '.') return cursor
  for (const part of normalized.split('/')) {
    cursor = path.join(cursor, part)
    const state = await lstatOptional(cursor)
    if (!state || state.isSymbolicLink() || !state.isDirectory()) {
      throw new LifecycleError('directory path is missing or unsafe', 'BLOCKED')
    }
    const canonical = await fs.realpath(cursor)
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new LifecycleError('directory path escapes workspace', 'BLOCKED')
    }
  }
  return cursor
}

export async function safeExistingFile(root: string, relative: string): Promise<string | undefined> {
  const normalized = normalizeWorkspaceRelative(relative)
  const parent = await safeDirectory(root, path.posix.dirname(normalized))
  const target = path.join(parent, path.posix.basename(normalized))
  const state = await lstatOptional(target)
  if (!state) return undefined
  if (state.isSymbolicLink() || !state.isFile()) throw new LifecycleError('document path is not a safe regular file', 'BLOCKED')
  return target
}

export async function safeAbsentFile(root: string, relative: string): Promise<string> {
  const normalized = normalizeWorkspaceRelative(relative)
  const parent = await safeDirectory(root, path.posix.dirname(normalized))
  const target = path.join(parent, path.posix.basename(normalized))
  const state = await lstatOptional(target)
  if (state) throw new LifecycleError('destination already exists', 'EXISTS')
  return target
}

export async function loadedDocument(access: WorkspaceOpAccess, relative: string): Promise<LoadedText> {
  try {
    const value = await readTextFile(access.files, relative)
    return { ...value, bytes: byteSize(value.text), sha256: hash(value.text) }
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') throw new LifecycleError('document was not found', 'NOT_FOUND', { cause: error })
    throw error
  }
}
