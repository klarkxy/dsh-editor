import type { CompletionPreference } from './completion-preference.ts'

export const WRITING_SETTINGS_NAMESPACE = 'dsh-editor-writing'
export const COMPLETION_DELAY = { min: 500, max: 5000, default: 1500 } as const

export type PaperFontFamily = 'serif' | 'sans' | 'mono'
export type PaperWidth = 'narrow' | 'medium' | 'wide'
export type WritingModelRoute = { provider: string; model: string; reasoningEffort?: string }

export type WritingPreferences = {
  completion: CompletionPreference
  completionDelayMs?: number
  completionModel?: WritingModelRoute
  rewriteModel?: WritingModelRoute
  chatModel?: WritingModelRoute
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
