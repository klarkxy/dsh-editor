import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeWorkspaceRelative } from 'dsh-manuscript/host-api'
import { LifecycleError } from './errors.ts'
import { lstatOptional } from './files.ts'

export const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const ENTRY_NAME_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/

export type MkdirSafeFail = (kind: 'unsafe-root' | 'unsafe-dir' | 'escape') => Error

/** Visible single-segment entry name used by `entry.*` and `cards.create`. */
export function validateEntryName(value: string): string {
  if (typeof value !== 'string') throw new LifecycleError('entry name is required', 'INVALID_PATH')
  const name = value.trim()
  if (!name
    || name === '.'
    || name === '..'
    || name.includes('/')
    || name.includes('\\')
    || ENTRY_NAME_FORBIDDEN.test(name)
    || name.startsWith('.')
    || name.length > 120
    || /[. ]$/.test(name)
    || RESERVED_NAME.test(name)) {
    throw new LifecycleError('entry name is invalid', 'INVALID_PATH')
  }
  return name
}

/** 逐级 mkdir，且拒绝 symlink / 越界。错误类型由调用方注入，避免和 proposal / lifecycle 循环依赖。 */
export async function mkdirSafe(
  root: string,
  relative: string,
  fail: MkdirSafeFail,
  options?: { normalize?: boolean },
): Promise<void> {
  const absolute = path.resolve(root)
  const state = await fs.lstat(absolute)
  if (state.isSymbolicLink() || !state.isDirectory()) throw fail('unsafe-root')
  const canonicalRoot = await fs.realpath(absolute)
  const raw = options?.normalize ? normalizeWorkspaceRelative(relative) : relative
  let cursor = path.resolve(root)
  for (const part of raw.split('/').filter((item) => item && item !== '.')) {
    cursor = path.join(cursor, part)
    try {
      await fs.mkdir(cursor)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const dirState = await fs.lstat(cursor)
    if (dirState.isSymbolicLink() || !dirState.isDirectory()) throw fail('unsafe-dir')
    const canonical = await fs.realpath(cursor)
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw fail('escape')
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LifecycleError('operation cancelled', 'IO')
}

async function assertExistingDirectory(target: string, label: string): Promise<void> {
  const state = await lstatOptional(target)
  if (!state) throw new LifecycleError(`${label} does not exist`, 'IO')
  if (state.isSymbolicLink()) throw new LifecycleError(`${label} cannot be a symbolic link`, 'BLOCKED')
  if (!state.isDirectory()) throw new LifecycleError(`${label} must be a directory`, 'IO')
}

/** Validate one visible directory name segment (no separators, hidden names, device names). */
export function validateDirectorySegment(name: string): string {
  if (
    !name
    || name !== name.trim()
    || name.length > 80
    || name.startsWith('.')
    || ENTRY_NAME_FORBIDDEN.test(name)
    || /[. ]$/.test(name)
    || RESERVED_NAME.test(name)
  ) throw new LifecycleError('directory name is invalid', 'INVALID_PATH')
  return name
}

/** Create one visible directory below an existing parent. Parent must already exist. */
export async function createVisibleDirectory(input: {
  root: string
  mode: string
  relative: string
  signal?: AbortSignal
}): Promise<{ path: string }> {
  if (input.mode === 'read-only') throw new LifecycleError('project folder is read-only', 'READ_ONLY')
  throwIfAborted(input.signal)
  const root = path.resolve(input.root)
  const segments = input.relative.replace(/\\/g, '/').split('/').map(validateDirectorySegment)
  const relative = segments.join('/')
  await assertExistingDirectory(root, 'project folder')
  const parent = path.join(root, ...segments.slice(0, -1))
  await assertExistingDirectory(parent, 'parent directory')
  const target = path.join(parent, segments[segments.length - 1]!)
  const state = await lstatOptional(target)
  if (state) {
    if (state.isSymbolicLink()) throw new LifecycleError('directory cannot be a symbolic link', 'BLOCKED')
    throw new LifecycleError('directory already exists', 'EXISTS')
  }
  try {
    await fs.mkdir(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new LifecycleError('directory already exists', 'EXISTS', { cause: error })
    }
    throw new LifecycleError('failed to create directory', 'IO', { cause: error })
  }
  await assertExistingDirectory(target, 'directory')
  return { path: relative }
}
