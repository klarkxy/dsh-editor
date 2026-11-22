/** Browser-safe contracts for agent direct writes (writing_change). */

export const WRITING_CHANGE_TOOL_NAME = 'writing_change'
export const WRITING_CHANGE_MARKER = 'dsh-editor.writing-change'

export type WritingChangeKind = 'edit' | 'create' | 'split' | 'merge' | 'renames'
export type WritingChangeStatus = 'applied' | 'undone'
export type WritingChangeEdit = { oldText: string; newText: string }
export type WritingChangeRename = { from: string; to: string }
export type WritingChangeFile = { path: string; before: string | null; after: string | null }

export type WritingChangeReceipt = {
  marker: typeof WRITING_CHANGE_MARKER
  version: 1
  id: string
  kind: WritingChangeKind
  summary: string
  status: WritingChangeStatus
  paths: string[]
  count: number
  message?: string
}

export type WritingChangeRecord = {
  version: 1
  id: string
  sessionId: string
  createdAt: string
  kind: WritingChangeKind
  summary: string
  status: WritingChangeStatus
  files: WritingChangeFile[]
  edits?: WritingChangeEdit[]
  renames?: WritingChangeRename[]
  archiveId?: string
  message?: string
}

const KINDS: readonly WritingChangeKind[] = ['edit', 'create', 'split', 'merge', 'renames']

export function isWritingChangeReceipt(value: unknown): value is WritingChangeReceipt {
  const v = value as WritingChangeReceipt | null | undefined
  return Boolean(v && typeof v === 'object'
    && v.marker === WRITING_CHANGE_MARKER && v.version === 1
    && typeof v.id === 'string' && typeof v.summary === 'string'
    && KINDS.includes(v.kind) && ['applied', 'undone'].includes(v.status)
    && Array.isArray(v.paths) && v.paths.every((item) => typeof item === 'string')
    && typeof v.count === 'number')
}

export function parseWritingChangeReceipt(text: string): WritingChangeReceipt | undefined {
  try {
    const value = JSON.parse(text)
    return isWritingChangeReceipt(value) ? value : undefined
  } catch { return undefined }
}
