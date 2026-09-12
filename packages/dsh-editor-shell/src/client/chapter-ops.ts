import { createElement as e, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from 'react'
import type { ProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import { isChapterDocumentPath } from '../chapter-status-view.ts'
import {
  anchorOccurrences,
  basenameOf,
  buildMergeProposal,
  buildSplitProposal,
  dirnameOf,
  isMarkdownChapterPath,
  isValidChapterFileName,
  neighbourChapters,
  normalizeChapterFileName,
  paragraphAt,
  suggestSplitName,
} from '../chapter-ops-view.ts'
import { ProposalCard } from './chat.ts'
import { Button, Dialog } from './ui/index.ts'
import { errorMessage, safeRpcCall, type ShellContext } from './shared.ts'
import { t, useLocale } from '../i18n/index.ts'

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
  const visible = isChapterDocumentPath(path)
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

function SplitFormDialog(props: {
  open?: boolean
  path: string
  initialAnchor: string
  initialName: string
  files: readonly string[]
  sessionId: string
  ctx: ShellContext
  onCancel(): void
  onReady(proposal: ProposalMarker): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const open = props.open ?? true
  const [anchor, setAnchor] = useState(props.initialAnchor)
  const [newName, setNewName] = useState(props.initialName)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const textarea = useRef<HTMLTextAreaElement | null>(null)
  const submit = async () => {
    const fileName = normalizeChapterFileName(newName)
    if (!isValidChapterFileName(fileName)) { setNote(t('chapterOps.nameInvalid')); return }
    const directory = dirnameOf(props.path)
    const newPath = directory ? `${directory}/${fileName}` : fileName
    if (newPath === props.path || props.files.includes(newPath)) { setNote(t('chapterOps.nameExists')); return }
    if (!anchor.trim()) { setNote(t('chapterOps.anchorEmpty')); return }
    setBusy(true)
    setNote('')
    const existing = await safeRpcCall<{ text: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: newPath,
    }))
    if (existing.ok) {
      setBusy(false)
      setNote(t('chapterOps.nameExists'))
      return
    }
    const read = await safeRpcCall<{ text: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: props.path,
    }))
    setBusy(false)
    if (!read.ok) { setNote(errorMessage(read) || t('chapterOps.readFailed')); return }
    const count = anchorOccurrences(read.value.text, anchor)
    if (count === 0) { setNote(t('chapterOps.anchorMissing')); return }
    if (count !== 1) { setNote(t('chapterOps.anchorAmbiguous')); return }
    props.onReady(buildSplitProposal({
      path: props.path,
      anchor,
      newPath,
      summary: t('chapterOps.splitSummary', { path: props.path, newPath }),
    }))
  }
  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next && !busy) props.onCancel() },
    title: t('chapterOps.splitTitle'),
    className: 'file-dialog prompt-dialog chapter-ops-dialog',
    overlayClassName: 'file-dialog-overlay',
    dismissible: !busy,
    initialFocusRef: textarea,
    returnFocusRef: props.returnFocusRef,
  },
      e('header', null,
        e('h2', { id: 'chapter-ops-split-title' }, t('chapterOps.splitTitle')),
        e(Button, { variant: 'icon', className: 'icon-button', 'aria-label': t('common.close'), disabled: busy, onClick: props.onCancel }, '×'),
      ),
      e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (!busy) void submit() } },
        e('p', { className: 'muted' }, t('chapterOps.splitFile'), ' ', e('code', null, props.path)),
        e('label', null, t('chapterOps.anchor'),
          e('textarea', {
            ref: textarea,
            value: anchor,
            rows: 4,
            disabled: busy,
            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setAnchor(event.target.value),
          }),
        ),
        e('p', { className: 'muted' }, t('chapterOps.anchorHint')),
        e('label', null, t('chapterOps.newFileName'),
          e('input', {
            value: newName,
            maxLength: 120,
            disabled: busy,
            onChange: (event: ChangeEvent<HTMLInputElement>) => setNewName(event.target.value),
          }),
        ),
        note ? e('p', { className: 'warning', role: 'alert' }, note) : null,
        e('footer', null,
          e(Button, { disabled: busy, onClick: props.onCancel }, t('common.cancel')),
          e(Button, { variant: 'primary', type: 'submit', className: 'primary-action', disabled: busy || !anchor.trim() || !newName.trim() }, busy ? t('common.loading') : t('chapterOps.preview')),
        ),
      ),
  )
}

function ProposalReviewDialog(props: {
  open?: boolean
  ctx: ShellContext
  sessionId: string
  proposal: ProposalMarker
  onApplied(path: string): void
  onClose(): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const open = props.open ?? true
  const close = useRef<HTMLButtonElement | null>(null)
  const title = props.proposal.kind === 'merge' ? t('chapterOps.mergeTitle') : t('chapterOps.reviewTitle')
  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next) props.onClose() },
    title,
    className: 'file-dialog chapter-ops-dialog',
    overlayClassName: 'file-dialog-overlay',
    initialFocusRef: close,
    returnFocusRef: props.returnFocusRef,
  },
      e('header', null,
        e('h2', { id: 'chapter-ops-review-title' }, title),
        e(Button, { ref: close, variant: 'icon', className: 'icon-button', 'aria-label': t('common.close'), onClick: props.onClose }, '×'),
      ),
      props.proposal.kind === 'merge' ? e('p', { className: 'muted' }, t('chapterOps.mergeArchiveHint')) : null,
      e('div', { className: 'chapter-ops-card' },
        e(ProposalCard, {
          ctx: props.ctx,
          sessionId: props.sessionId,
          proposal: props.proposal,
          onApplied: props.onApplied,
        }),
      ),
      e('footer', null,
        e(Button, { onClick: props.onClose }, t('chapterOps.closeReview')),
      ),
  )
}

export function ChapterOpsLayer(props: {
  ctx: ShellContext
  sessionId: string
  files: readonly string[]
  request: ChapterOpsRequest | null
  getEditorSnapshot(): EditorSnapshot | null
  onClose(): void
  onApplied(path: string): void
  returnFocusRef?: RefObject<HTMLElement | null>
}): ReactNode {
  useLocale()
  const [review, setReview] = useState<{ proposal: ProposalMarker } | null>(null)
  useEffect(() => {
    setReview(null)
  }, [props.request])
  const open = Boolean(props.request)
  const snapshot = useRef<{ request: ChapterOpsRequest; review: { proposal: ProposalMarker } | null } | null>(null)
  if (props.request) snapshot.current = { request: props.request, review }
  const display = snapshot.current
  if (!display) return null
  const request = display.request
  if (display.review) {
    return e(ProposalReviewDialog, {
      open,
      ctx: props.ctx,
      sessionId: props.sessionId,
      proposal: display.review.proposal,
      onApplied: props.onApplied,
      onClose: props.onClose,
      returnFocusRef: props.returnFocusRef,
    })
  }
  if (request.kind === 'merge') {
    return e(ProposalReviewDialog, {
      open,
      ctx: props.ctx,
      sessionId: props.sessionId,
      proposal: buildMergeProposal({
        path: request.path,
        sourcePath: request.sourcePath,
        summary: t('chapterOps.mergeSummary', { path: request.path, sourcePath: request.sourcePath }),
      }),
      onApplied: props.onApplied,
      onClose: props.onClose,
      returnFocusRef: props.returnFocusRef,
    })
  }
  const suggested = suggestSplitName(request.path, props.files)
  return e(SplitFormDialog, {
    key: `${request.path}:${request.source}`,
    open,
    path: request.path,
    initialAnchor: initialSplitAnchor(request.source, props.getEditorSnapshot()),
    initialName: basenameOf(suggested),
    files: props.files,
    sessionId: props.sessionId,
    ctx: props.ctx,
    onCancel: props.onClose,
    onReady: (proposal) => setReview({ proposal }),
    returnFocusRef: props.returnFocusRef,
  })
}
