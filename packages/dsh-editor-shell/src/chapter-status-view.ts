import type { ChapterStatus, ProjectOverview } from 'dsh-editor-workbench/contracts'
import { t } from './i18n/index.ts'

export type { ChapterStatus }

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  get draft() { return t('status.draft') },
  get revising() { return t('status.revising') },
  get final() { return t('status.final') },
}

export function chapterStatusLabel(status: ChapterStatus): string {
  return CHAPTER_STATUS_LABELS[status] ?? CHAPTER_STATUS_LABELS.draft
}

export function chapterStatusGlyph(status: ChapterStatus): string {
  if (status === 'revising') return t('status.glyphRevising')
  if (status === 'final') return t('status.glyphFinal')
  return t('status.glyphDraft')
}

export function isChapterDocumentPath(path: string): boolean {
  return /^正文\/.+\.(?:md|txt)$/i.test(path)
}

/** Flatten project.overview into path → status for tree badges. Later entries win. */
export function buildChapterStatusMap(overview: ProjectOverview | null | undefined): Record<string, ChapterStatus> {
  const result: Record<string, ChapterStatus> = {}
  if (!overview) return result
  for (const chapter of overview.chapters) {
    if (!isChapterDocumentPath(chapter.path)) continue
    result[chapter.path] = chapter.status
  }
  return result
}
