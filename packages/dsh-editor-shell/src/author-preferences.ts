export const AUTHOR_PREFERENCES_KEY = 'dsh-editor.writing.author-preferences'
export const AUTHOR_PREFERENCES_MAX_CHARS = 1_200

export function normalizeAuthorPreferences(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim().slice(0, AUTHOR_PREFERENCES_MAX_CHARS)
}

export function readAuthorPreferences(storage: Pick<Storage, 'getItem'> | undefined): string {
  try {
    return normalizeAuthorPreferences(storage?.getItem(AUTHOR_PREFERENCES_KEY))
  } catch {
    return ''
  }
}
