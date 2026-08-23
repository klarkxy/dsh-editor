export class PathConfineError extends Error {
  readonly code = 'PATH_ESCAPE'
  constructor(message: string) {
    super(message)
    this.name = 'PathConfineError'
  }
}

/**
 * Validate and normalize a workspace-relative path without consulting the host
 * filesystem. Canonical containment is checked separately with `ctx.fs`.
 */
export function normalizeWorkspaceRelative(relative: string): string {
  if (typeof relative !== 'string') throw new PathConfineError('path must be a string')
  if (relative.includes('\0')) throw new PathConfineError('path contains NUL')
  const path = relative.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.includes(':')) {
    throw new PathConfineError('absolute and device paths are not allowed')
  }

  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new PathConfineError('path escapes workspace')
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length === 0 ? '.' : parts.join('/')
}

export function parentRelative(relative: string): string {
  const normalized = normalizeWorkspaceRelative(relative)
  if (normalized === '.') return '.'
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '.' : normalized.slice(0, index)
}
