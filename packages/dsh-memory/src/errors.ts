export class MemoryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'MemoryError'
  }
}

export const MEMORY_CONFLICT = 'MEMORY_CONFLICT'
export const MEMORY_INVALID = 'MEMORY_INVALID'
export const MEMORY_NOT_FOUND = 'MEMORY_NOT_FOUND'
export const MEMORY_DISABLED = 'MEMORY_DISABLED'
export const MEMORY_SAVE_FAILED = 'MEMORY_SAVE_FAILED'
export const MEMORY_CAPACITY = 'MEMORY_CAPACITY'
export const MEMORY_SCOPE = 'MEMORY_SCOPE'
export const MEMORY_EVIDENCE = 'MEMORY_EVIDENCE'
export const MEMORY_TOMBSTONE = 'MEMORY_TOMBSTONE'
export const MEMORY_STALE = 'MEMORY_STALE'
export const MEMORY_AI_UNAVAILABLE = 'MEMORY_AI_UNAVAILABLE'
export const MEMORY_CANCELLED = 'MEMORY_CANCELLED'
export const MEMORY_DELETED = 'MEMORY_DELETED'

export function fail(code: string, message: string): never {
  throw new MemoryError(message, code)
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  return name === 'AbortError' || name === 'TimeoutError' || code === 'ABORT_ERR' || code === 'ABORTED'
}
