import { isolateHistory } from '@codemirror/commands'
import { EditorSelection, type TransactionSpec } from '@codemirror/state'

/** Snapshot of an editor target that must be re-checked after any async gap. */
export type EditorTargetSnapshot = {
  sessionId: string
  path: string
  documentGeneration: number
  revision: number
  start: number
  end: number
  selectedText: string
}

export type EditorTargetLive = {
  sessionId: string
  path: string
  documentGeneration: number
  revision: number
  text: string
}

export type EditorCommandState = {
  loaded: boolean
  conflict: boolean
  busy: boolean
  completionEnabled: boolean
  enablePatch: boolean
  hasVisibleSelection: boolean
  collapsed: boolean
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  canCut: boolean
  canCopy: boolean
  canPaste: boolean
  canSelectAll: boolean
  canSave: boolean
  canFind: boolean
  canReplace: boolean
  canComplete: boolean
  canRewrite: boolean
}

export type EditorContextMenuEvent = {
  x: number
  y: number
  source: 'pointer' | 'keyboard'
}

export function captureEditorTarget(input: {
  sessionId: string
  path: string
  documentGeneration: number
  revision: number
  start: number
  end: number
  text: string
}): EditorTargetSnapshot {
  const start = Math.max(0, Math.min(input.start, input.text.length))
  const end = Math.max(start, Math.min(input.end, input.text.length))
  return {
    sessionId: input.sessionId,
    path: input.path,
    documentGeneration: input.documentGeneration,
    revision: input.revision,
    start,
    end,
    selectedText: input.text.slice(start, end),
  }
}

/**
 * Generation + revision must both match. Path and selected text alone cannot
 * tell a reload or chapter switch that happens to keep the same string.
 */
export function isEditorTargetCurrent(snapshot: EditorTargetSnapshot, live: EditorTargetLive): boolean {
  return snapshot.sessionId === live.sessionId
    && snapshot.path === live.path
    && snapshot.documentGeneration === live.documentGeneration
    && snapshot.revision === live.revision
    && live.text.slice(snapshot.start, snapshot.end) === snapshot.selectedText
}

/** Visible-paper slice of a full-file range. Frontmatter stays hidden. */
export function visiblePaperRange(input: {
  text: string
  paperOffset: number
  start: number
  end: number
}): { from: number; to: number } | undefined {
  const offset = Math.max(0, input.paperOffset)
  const from = Math.max(offset, Math.min(input.start, input.text.length))
  const to = Math.max(from, Math.min(input.end, input.text.length))
  if (from >= to) return undefined
  return { from, to }
}

export function paperSelectionText(input: {
  text: string
  paperOffset: number
  start: number
  end: number
}): string {
  const range = visiblePaperRange(input)
  return range ? input.text.slice(range.from, range.to) : ''
}

export function paperRangeToView(input: {
  paperOffset: number
  start: number
  end: number
  docLength: number
}): { from: number; to: number } {
  const from = Math.max(0, Math.min(input.docLength, input.start - input.paperOffset))
  const to = Math.max(from, Math.min(input.docLength, input.end - input.paperOffset))
  return { from, to }
}

export function shouldPreserveSelectionOnContextMouseDown(input: {
  from: number
  to: number
  clickPos: number
}): boolean {
  return input.from !== input.to && input.clickPos >= input.from && input.clickPos <= input.to
}

export function contextMenuSource(button: number): EditorContextMenuEvent['source'] {
  return button === 2 ? 'pointer' : 'keyboard'
}

export function editorCommandState(input: {
  loaded: boolean
  conflict: boolean
  busy: boolean
  completionEnabled: boolean
  enablePatch: boolean
  hasVisibleSelection: boolean
  collapsed: boolean
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  paperLength: number
}): EditorCommandState {
  const loaded = input.loaded
  const localEdit = loaded
  return {
    loaded,
    conflict: input.conflict,
    busy: input.busy,
    completionEnabled: input.completionEnabled,
    enablePatch: input.enablePatch,
    hasVisibleSelection: input.hasVisibleSelection,
    collapsed: input.collapsed,
    dirty: input.dirty,
    canUndo: localEdit && input.canUndo,
    canRedo: localEdit && input.canRedo,
    canCut: localEdit && input.hasVisibleSelection,
    canCopy: localEdit && input.hasVisibleSelection,
    canPaste: localEdit,
    canSelectAll: localEdit && input.paperLength > 0,
    canSave: loaded && input.dirty && !input.conflict,
    canFind: loaded,
    canReplace: loaded,
    canComplete: loaded && input.completionEnabled && input.collapsed && !input.conflict && !input.busy,
    canRewrite: loaded && input.completionEnabled && input.enablePatch && input.hasVisibleSelection && !input.conflict && !input.busy,
  }
}

export function isolateReplaceSpec(input: {
  from: number
  to: number
  insert: string
}): TransactionSpec {
  return {
    changes: { from: input.from, to: input.to, insert: input.insert },
    selection: EditorSelection.cursor(input.from + input.insert.length),
    annotations: isolateHistory.of('full'),
    userEvent: input.insert ? 'input.paste' : 'delete.cut',
  }
}

export type ClipboardCommandResult = 'ok' | 'unavailable' | 'write-failed' | 'read-failed' | 'expired' | 'blocked'

export async function runClipboardCopy(input: {
  allowed: boolean
  text: string
  writeText(text: string): Promise<void>
}): Promise<ClipboardCommandResult> {
  if (!input.allowed) return 'blocked'
  try {
    await input.writeText(input.text)
    return 'ok'
  } catch {
    return 'write-failed'
  }
}

/** Write first; only delete after the write succeeds and the snapshot is still live. */
export async function runClipboardCut(input: {
  allowed: boolean
  text: string
  writeText(text: string): Promise<void>
  stillCurrent(): boolean
  deleteSelection(): boolean
}): Promise<ClipboardCommandResult> {
  if (!input.allowed) return 'blocked'
  try {
    await input.writeText(input.text)
  } catch {
    return 'write-failed'
  }
  if (!input.stillCurrent()) return 'expired'
  return input.deleteSelection() ? 'ok' : 'expired'
}

export async function runClipboardPaste(input: {
  allowed: boolean
  readText(): Promise<string>
  stillCurrent(): boolean
  replaceSelection(text: string): boolean
}): Promise<ClipboardCommandResult> {
  if (!input.allowed) return 'blocked'
  let text: string
  try {
    text = await input.readText()
  } catch {
    return 'read-failed'
  }
  if (!input.stillCurrent()) return 'expired'
  if (text === '') return 'ok'
  return input.replaceSelection(text) ? 'ok' : 'expired'
}
