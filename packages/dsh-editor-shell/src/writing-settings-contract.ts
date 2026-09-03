import type { CompletionPreference } from './completion-preference.ts'

export const WRITING_SETTINGS_NAMESPACE = 'dsh-editor-writing'

export type WritingPreferences = {
  completion: CompletionPreference
  authorPreferences: string
  authorMemory: string
}
