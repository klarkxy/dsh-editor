import path from 'node:path'

export class PathConfineError extends Error {
  readonly code = 'PATH_ESCAPE'
  constructor(message: string) {
    super(message)
    this.name = 'PathConfineError'
  }
}

/** Resolve `relative` under `cwd`. Rejects absolute paths, `..` escapes, and empty names. */
export function confinePath(cwd: string, relative: string): string {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new PathConfineError('workspace cwd is required')
  }
  if (typeof relative !== 'string') {
    throw new PathConfineError('path must be a string')
  }
  const trimmed = relative.replace(/\\/g, '/').trim()
  if (trimmed.length === 0 || trimmed === '.') {
    return path.resolve(cwd)
  }
  if (path.win32.isAbsolute(trimmed) || path.posix.isAbsolute(trimmed)) {
    throw new PathConfineError('absolute paths are not allowed')
  }
  if (/^[a-zA-Z]:/.test(trimmed)) {
    throw new PathConfineError('absolute paths are not allowed')
  }
  if (trimmed.includes('\0')) {
    throw new PathConfineError('path contains NUL')
  }
  const root = path.resolve(cwd)
  const resolved = path.resolve(root, trimmed)
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathConfineError('path escapes workspace')
  }
  return resolved
}

export function toPosixRelative(cwd: string, absolute: string): string {
  const root = path.resolve(cwd)
  const rel = path.relative(root, absolute)
  return rel.split(path.sep).join('/')
}
