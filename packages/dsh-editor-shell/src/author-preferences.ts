import { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from 'dsh-editor-workbench/contracts'

export const AUTHOR_PREFERENCES_KEY = 'dsh-editor.writing.author-preferences'
export { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from 'dsh-editor-workbench/contracts'

export function readAuthorPreferences(storage: Pick<Storage, 'getItem'> | undefined): string {
  try {
    return normalizeAuthorPreferences(storage?.getItem(AUTHOR_PREFERENCES_KEY))
  } catch {
    return ''
  }
}
