import fs from 'node:fs/promises'
import path from 'node:path'
import { confinePath, PathConfineError } from './paths.ts'

export type DirKind = 'file' | 'directory' | 'other'

export type DirEntry = {
  name: string
  type: DirKind
}

export class FileOpError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'NOT_DIRECTORY' | 'EXISTS' | 'STALE' | 'NOT_TEXT' | 'PARENT_MISSING' | 'TOO_LARGE' | 'IO' | 'BAD_NAME',
  ) {
    super(message)
    this.name = 'FileOpError'
  }
}

/** Soft ceiling for manuscript text IO. Binary detection still happens first. */
export const MAX_TEXT_BYTES = 2_000_000

export function versionToken(mtimeMs: number, size: number): string {
  return `${mtimeMs}:${size}`
}

async function tokenFor(abs: string): Promise<string> {
  const st = await fs.stat(abs)
  return versionToken(st.mtimeMs, st.size)
}

export async function listDir(cwd: string, relative: string): Promise<DirEntry[]> {
  const abs = confinePath(cwd, relative)
  let st
  try {
    st = await fs.stat(abs)
  } catch {
    throw new FileOpError('directory not found', 'NOT_FOUND')
  }
  if (!st.isDirectory()) throw new FileOpError('not a directory', 'NOT_DIRECTORY')
  const names = await fs.readdir(abs)
  const entries: DirEntry[] = []
  for (const name of names) {
    if (name === '.' || name === '..') continue
    const child = path.join(abs, name)
    let type: DirKind = 'other'
    try {
      const cst = await fs.lstat(child)
      if (cst.isSymbolicLink()) type = 'other'
      else if (cst.isDirectory()) type = 'directory'
      else if (cst.isFile()) type = 'file'
    } catch {
      type = 'other'
    }
    entries.push({ name, type })
  }
  entries.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name)
    if (a.type === 'directory') return -1
    if (b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

export async function readTextFile(cwd: string, relative: string): Promise<{ text: string; version: string }> {
  const abs = confinePath(cwd, relative)
  let st
  try {
    st = await fs.lstat(abs)
  } catch {
    throw new FileOpError('file not found', 'NOT_FOUND')
  }
  if (st.isSymbolicLink()) throw new FileOpError('symlinks are not readable', 'NOT_TEXT')
  if (!st.isFile()) throw new FileOpError('not a regular file', 'NOT_TEXT')
  if (st.size > MAX_TEXT_BYTES) throw new FileOpError('file too large', 'TOO_LARGE')
  const buf = await fs.readFile(abs)
  if (buf.includes(0)) throw new FileOpError('binary files are not supported', 'NOT_TEXT')
  return { text: buf.toString('utf8'), version: versionToken(st.mtimeMs, st.size) }
}

/** Create a file only if its parent directory already exists. Never mkdir. */
export async function createTextFile(
  cwd: string,
  relative: string,
  text: string,
): Promise<{ version: string }> {
  const abs = confinePath(cwd, relative)
  const parent = path.dirname(abs)
  const root = confinePath(cwd, '.')
  if (parent !== root && !parent.startsWith(root + path.sep) && parent !== root) {
    throw new PathConfineError('path escapes workspace')
  }
  let pst
  try {
    pst = await fs.stat(parent)
  } catch {
    throw new FileOpError('parent directory does not exist', 'PARENT_MISSING')
  }
  if (!pst.isDirectory()) throw new FileOpError('parent is not a directory', 'PARENT_MISSING')
  try {
    await fs.writeFile(abs, text, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new FileOpError('file already exists', 'EXISTS')
    throw new FileOpError('write failed', 'IO')
  }
  return { version: await tokenFor(abs) }
}

export async function writeTextFile(
  cwd: string,
  relative: string,
  text: string,
  expectedVersion: string,
): Promise<{ version: string }> {
  const abs = confinePath(cwd, relative)
  let st
  try {
    st = await fs.stat(abs)
  } catch {
    throw new FileOpError('file not found', 'NOT_FOUND')
  }
  if (!st.isFile()) throw new FileOpError('not a regular file', 'NOT_TEXT')
  const current = versionToken(st.mtimeMs, st.size)
  if (current !== expectedVersion) {
    throw new FileOpError('file changed on disk', 'STALE')
  }
  await fs.writeFile(abs, text, { encoding: 'utf8', flag: 'w' })
  return { version: await tokenFor(abs) }
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Basename only. Adds .md when missing. Rejects path separators and reserved names. */
export function assertBasename(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new FileOpError('empty name', 'BAD_NAME')
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    throw new PathConfineError('basename must not contain a path')
  }
  if (trimmed === '.' || trimmed === '..') throw new FileOpError('invalid name', 'BAD_NAME')
  if (/[<>:"|?*]/.test(trimmed)) throw new FileOpError('invalid name', 'BAD_NAME')
  if (/[. ]$/.test(trimmed)) throw new FileOpError('invalid name', 'BAD_NAME')
  const withExt = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`
  const stem = withExt.replace(/\.md$/i, '')
  if (RESERVED.test(stem)) throw new FileOpError('reserved name', 'BAD_NAME')
  return withExt
}

export function parentRel(relative: string): string {
  const posix = relative.replace(/\\/g, '/').replace(/^\.\//, '')
  const index = posix.lastIndexOf('/')
  return index < 0 ? '.' : posix.slice(0, index)
}

export async function renameTextFile(
  cwd: string,
  fromRel: string,
  newName: string,
): Promise<{ path: string; version: string }> {
  const fromAbs = confinePath(cwd, fromRel)
  let st
  try {
    st = await fs.lstat(fromAbs)
  } catch {
    throw new FileOpError('file not found', 'NOT_FOUND')
  }
  if (!st.isFile()) throw new FileOpError('not a regular file', 'NOT_TEXT')
  const base = assertBasename(newName)
  const dir = parentRel(fromRel)
  const toRel = dir === '.' ? base : `${dir}/${base}`
  const toAbs = confinePath(cwd, toRel)
  if (path.dirname(toAbs) !== path.dirname(fromAbs)) {
    throw new PathConfineError('rename must stay in the same directory')
  }
  if (fromAbs === toAbs) return { path: toRel, version: await tokenFor(fromAbs) }
  try {
    await fs.lstat(toAbs)
    throw new FileOpError('file already exists', 'EXISTS')
  } catch (error) {
    if (error instanceof FileOpError || error instanceof PathConfineError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw new FileOpError('stat failed', 'IO')
  }
  await fs.rename(fromAbs, toAbs)
  return { path: toRel, version: await tokenFor(toAbs) }
}
