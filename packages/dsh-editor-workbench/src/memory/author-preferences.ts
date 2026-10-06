export const AUTHOR_MEMORY_MAX_CHARS = 2_000

export function normalizeAuthorMemory(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim().slice(0, AUTHOR_MEMORY_MAX_CHARS)
}

export const AUTHOR_PREFERENCES_MAX_CHARS = 1_200

export function normalizeAuthorPreferences(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim().slice(0, AUTHOR_PREFERENCES_MAX_CHARS)
}
