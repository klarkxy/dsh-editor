import { normalizeAuthorPreferences } from 'dsh-editor-workbench/contracts'

export const AUTHOR_PREFERENCES_KEY = 'dsh-editor.writing.author-preferences'
export { AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorPreferences } from 'dsh-editor-workbench/contracts'

export function readAuthorPreferences(storage: Pick<Storage, 'getItem'> | undefined): string {
  try {
    return normalizeAuthorPreferences(storage?.getItem(AUTHOR_PREFERENCES_KEY))
  } catch {
    return ''
  }
}
