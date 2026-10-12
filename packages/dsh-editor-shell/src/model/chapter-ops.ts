import { isManuscriptChapterPath } from '../project-files.ts'
import { isMarkdownChapterPath, neighbourChapters, paragraphAt } from '../chapter-ops-view.ts'
import { t } from '../i18n/index.ts'

export type ChapterOpsRequest =
  | { kind: 'split'; path: string; source: 'tree' | 'cursor' }
  | { kind: 'merge'; path: string; sourcePath: string }

export type EditorSnapshotHandle = {
  getText(): string
  getSelection(): { start: number; end: number }
}

export type EditorSnapshot = { text: string; offset: number; selected: string }

export function snapshotFromHandle(handle: EditorSnapshotHandle | null): EditorSnapshot | null {
  if (handle) {
    const text = handle.getText()
    const selection = handle.getSelection()
    return { text, offset: selection.start, selected: text.slice(selection.start, selection.end) }
  }
  const selected = globalThis.getSelection?.()?.toString() ?? ''
  return selected ? { text: '', offset: 0, selected } : null
}

export function initialSplitAnchor(source: 'tree' | 'cursor', snapshot: EditorSnapshot | null): string {
  if (source !== 'cursor') return ''
  if (snapshot?.text) return paragraphAt(snapshot.text, snapshot.offset)
  return snapshot?.selected ?? ''
}

export function requestSplitChapter(input: {
  path: string
  source: 'tree' | 'cursor'
  editorDirty: boolean
  activePath: string
}): { ok: true; request: ChapterOpsRequest } | { ok: false; reason: 'unsaved' | 'not-markdown' } {
  if (!isMarkdownChapterPath(input.path)) return { ok: false, reason: 'not-markdown' }
  if (input.editorDirty && (input.source === 'cursor' || input.activePath === input.path)) {
    return { ok: false, reason: 'unsaved' }
  }
  return { ok: true, request: { kind: 'split', path: input.path, source: input.source } }
}

export function requestMergeChapter(input: {
  chapterPath: string
  direction: 'previous' | 'next'
  files: readonly string[]
  editorDirty: boolean
  activePath: string
}): { ok: true; request: ChapterOpsRequest } | { ok: false; reason: 'unsaved' | 'no-neighbour' | 'not-markdown' } {
  const { previous, next } = neighbourChapters(input.chapterPath, input.files)
  const path = input.direction === 'previous' ? previous : input.chapterPath
  const sourcePath = input.direction === 'previous' ? input.chapterPath : next
  if (!path || !sourcePath) return { ok: false, reason: 'no-neighbour' }
  if (!isMarkdownChapterPath(path) || !isMarkdownChapterPath(sourcePath)) return { ok: false, reason: 'not-markdown' }
  if (input.editorDirty && (input.activePath === path || input.activePath === sourcePath)) {
    return { ok: false, reason: 'unsaved' }
  }
  return { ok: true, request: { kind: 'merge', path, sourcePath } }
}

export function shouldOpenAfterChapterApply(request: ChapterOpsRequest, appliedPath: string): boolean {
  if (request.kind === 'split') return appliedPath !== request.path
  return appliedPath === request.path
}

export function chapterMenuModel(path: string, files: readonly string[]): {
  visible: boolean
  canSplit: boolean
  canMergePrevious: boolean
  canMergeNext: boolean
  splitDisabledTitle: string
  mergePreviousDisabledTitle: string
  mergeNextDisabledTitle: string
} {
  const visible = isManuscriptChapterPath(path)
  const markdown = isMarkdownChapterPath(path)
  const { previous, next } = neighbourChapters(path, files)
  const canMergePrevious = Boolean(previous && markdown && isMarkdownChapterPath(previous))
  const canMergeNext = Boolean(next && markdown && isMarkdownChapterPath(next))
  return {
    visible,
    canSplit: markdown,
    canMergePrevious,
    canMergeNext,
    splitDisabledTitle: markdown ? '' : t('chapterOps.splitTxtDisabled'),
    mergePreviousDisabledTitle: previous && !canMergePrevious
      ? t('chapterOps.mergeMdOnly')
      : previous
        ? ''
        : t('chapterOps.mergeNoPrevious'),
    mergeNextDisabledTitle: next && !canMergeNext
      ? t('chapterOps.mergeMdOnly')
      : next
        ? ''
        : t('chapterOps.mergeNoNext'),
  }
}
