import type { RewritePresetId } from 'dsh-manuscript/client/editor-core'
import type { MessageKey } from './i18n/index.ts'
import { isChapterDocumentPath } from './overview-view.ts'

export const CUSTOM_INSTRUCTION_MAX = 400

export function presetLabelKey(id: RewritePresetId): MessageKey {
  return `rewrite.preset.${id}`
}

/** Trim, collapse whitespace, cap at 400 characters; empty input becomes null. */
export function normalizeCustomInstruction(text: string): string | null {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return null
  return normalized.length > CUSTOM_INSTRUCTION_MAX
    ? normalized.slice(0, CUSTOM_INSTRUCTION_MAX)
    : normalized
}

export function canRewritePath(path: string): boolean {
  return isChapterDocumentPath(path)
}
