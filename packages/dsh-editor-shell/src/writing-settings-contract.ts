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
  /** Application-private migration fence, committed atomically with imported model fields. */
  writingModelsImported?: boolean
  authorPreferences: string
  authorMemory: string
  typewriter: boolean
  focusParagraph: boolean
  fontSize: number
  lineHeight: number
  fontFamily: PaperFontFamily
  paragraphSpacing: number
  paperWidth: PaperWidth
  /** 正文段落首行缩进两个汉字宽度。 */
  firstLineIndent: boolean
  /** 中文小节号 / 分节符居中（live preview 装饰）。 */
  centerSectionMarks: boolean
}

/** Existing Host preference service; model consumers may wait for startup migration. */
export type EditorWritingPreferences = {
  read(): WritingPreferences
  remember(observation: string): Promise<'added' | 'already-present'>
  modelsReady?(): Promise<void>
}

/** Ephemeral Host model-readiness response; carries no author preference or memory data. */
export type WritingModelMigrationStatus = { error?: string; chatModel?: WritingModelRoute }

export function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

const WRITING_EFFORTS = new Set(['off', 'low', 'medium', 'high', 'xhigh', 'max'])

/** Host `off` and public `none` are the same none-thinking slot. */
export function normalizeWritingEffort(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  if (id === 'none') return 'off'
  return WRITING_EFFORTS.has(id) ? id : undefined
}

/** Empty provider+model means the documented fallback (current chat / runtime default). */
export function normalizeWritingModelRoute(value: unknown): WritingModelRoute | undefined {
  const record = object(value)
  if (!record) return undefined
  if (typeof record.provider !== 'string' || typeof record.model !== 'string') return undefined
  const provider = record.provider.trim()
  const model = record.model.trim()
  if (!provider && !model) return undefined
  const reasoningEffort = normalizeWritingEffort(record.reasoningEffort)
  return reasoningEffort ? { provider, model, reasoningEffort } : { provider, model }
}

export function writingModelRouteValue(route: WritingModelRoute | undefined): WritingModelRoute {
  return route ?? { provider: '', model: '' }
}

