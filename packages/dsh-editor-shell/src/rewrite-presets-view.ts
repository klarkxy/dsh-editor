import type { RewritePresetId } from 'dsh-manuscript/client/editor-core'
import { isAuxiliaryAuthorFile } from './auxiliary-files.ts'
import { isChapterDocumentPath } from './project-files.ts'
import type { MessageKey } from './i18n/index.ts'

export const CUSTOM_INSTRUCTION_MAX = 400

export function presetLabelKey(id: RewritePresetId): MessageKey {
  return `rewrite.preset.${id}`
}

/** Trim, keep line breaks, collapse horizontal whitespace, cap at 400 characters; empty input becomes null. */
export function normalizeCustomInstruction(text: string): string | null {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim()
  if (!normalized) return null
  return normalized.length > CUSTOM_INSTRUCTION_MAX
    ? normalized.slice(0, CUSTOM_INSTRUCTION_MAX)
    : normalized
}

/** Project-relative only: reject POSIX/Windows absolute, UNC, and drive forms. */
function isProjectRelativeAuthorPath(path: string): boolean {
  if (!path || path.includes('\0')) return false
  if (path.startsWith('/') || path.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(path) || path.includes(':')) return false
  return true
}

/** Visible author-owned .md/.txt across the project, including root and nested folders. */
export function canRewritePath(path: string): boolean {
  return isProjectRelativeAuthorPath(path) && isChapterDocumentPath(path) && !isAuxiliaryAuthorFile(path)
}
