import type { CompletionPreference } from './completion-preference.ts'

export const WRITING_SETTINGS_NAMESPACE = 'dsh-editor-writing'

export type PaperFontFamily = 'serif' | 'sans' | 'mono'
export type PaperWidth = 'narrow' | 'medium' | 'wide'

export type WritingPreferences = {
  completion: CompletionPreference
  authorPreferences: string
  authorMemory: string
  typewriter: boolean
  focusParagraph: boolean
  fontSize: number
  lineHeight: number
  fontFamily: PaperFontFamily
  paragraphSpacing: number
  paperWidth: PaperWidth
}
