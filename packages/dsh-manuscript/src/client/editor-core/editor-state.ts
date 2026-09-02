// Unified editor state helpers shared by the standalone manuscript client and
// the workspace shell. Pure functions only — no React, no IO. The shared
// helpers cover:
//
// - Document & buffer identity (SaveState, EditorDocument, EditorStatus,
//   DocumentTarget, SelectionTicket, StoredDraft).
// - Buffer diffing (isDirty / hasUnsavedChanges).
// - Single-shot semantics for the read & write RPCs (shouldApplyRead,
//   isStaleWriteError, shouldRetainDraftAfterSave).
// - Selection ticket lifecycle (selectionTicket / isSelectionCurrent /
//   applySelectionPatch).
// - Ghost completion acceptance (canApplyGhost / applyGhost /
//   addCompletionCandidate).
// - sessionStorage draft round-trip (documentKey / draftStorageKey /
//   parseStoredDraft).
//
// The standalone client and the shell each pick the function they need; the
// rest is exported so callers do not have to maintain their own copies.

export type SaveState = 'empty' | 'loading' | 'saved' | 'draft' | 'conflict' | 'error'

export type EditorStatus = 'loading' | 'saved' | 'dirty' | 'conflict' | 'error'

export type EditorDocument = { sessionId: string; path: string; text: string; version: string }

export type DocumentTarget = { sessionId: string; cwd: string; path: string }

export type StoredDraft = DocumentTarget & { text: string; version: string }

export type SelectionTicket = {
  sessionId: string
  path: string
  revision: number
  start: number
  end: number
  selectedText: string
}

export function documentKey(target: DocumentTarget): string {
  return `${target.sessionId}\u0000${target.cwd}\u0000${target.path}`
}

export function isDirty(document: EditorDocument | null, text: string): boolean {
  return !!document && document.text !== text
}

export function hasUnsavedChanges(text: string, savedText: string): boolean {
  return text !== savedText
}

export function saveState(document: EditorDocument | null, text: string, conflict = false): SaveState {
  if (!document) return 'empty'
  if (conflict) return 'conflict'
  return isDirty(document, text) ? 'draft' : 'saved'
}

export function canApplyGhost(state: SaveState, ghost: string): boolean {
  return state !== 'conflict' && state !== 'error' && ghost.trim().length > 0
}

export function applyGhost(text: string, at: number, ghost: string): string {
  const caret = Math.max(0, Math.min(at, text.length))
  return `${text.slice(0, caret)}${ghost}${text.slice(caret)}`
}

export function addCompletionCandidate(
  candidates: readonly string[],
  candidate: string,
  maximum = 3,
): { candidates: string[]; index: number; added: boolean } {
  const existing = candidates.indexOf(candidate)
  if (existing >= 0) return { candidates: [...candidates], index: existing, added: false }
  if (!candidate.trim() || candidates.length >= maximum) {
    return { candidates: [...candidates], index: Math.max(0, candidates.length - 1), added: false }
  }
  const next = [...candidates, candidate]
  return { candidates: next, index: next.length - 1, added: true }
}

export function selectionTicket(
  document: EditorDocument,
  text: string,
  revision: number,
  start: number,
  end: number,
): SelectionTicket | undefined {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  if (from === to) return undefined
  return {
    sessionId: document.sessionId,
    path: document.path,
    revision,
    start: from,
    end: to,
    selectedText: text.slice(from, to),
  }
}

export function isSelectionCurrent(
  ticket: SelectionTicket,
  document: EditorDocument | null,
  text: string,
  revision: number,
): boolean {
  return !!document &&
    document.sessionId === ticket.sessionId &&
    document.path === ticket.path &&
    revision === ticket.revision &&
    text.slice(ticket.start, ticket.end) === ticket.selectedText
}

export function applySelectionPatch(text: string, ticket: SelectionTicket, replacement: string): string {
  return `${text.slice(0, ticket.start)}${replacement}${text.slice(ticket.end)}`
}

/** A late read must never replace the document currently requested by the user. */
export function shouldApplyRead(
  responseId: number,
  activeRequestId: number,
  responseTarget: DocumentTarget,
  requestedTarget: DocumentTarget,
): boolean {
  return responseId === activeRequestId && documentKey(responseTarget) === documentKey(requestedTarget)
}

export function isStaleWriteError(message: string): boolean {
  return /changed on disk|\bSTALE\b/i.test(message)
}

/** A successful write only cleans the exact buffer it submitted. */
export function shouldRetainDraftAfterSave(
  submittedText: string,
  currentText: string,
  submittedGeneration: number,
  currentGeneration: number,
): boolean {
  return submittedGeneration !== currentGeneration && hasUnsavedChanges(currentText, submittedText)
}

// Session IDs can change when DSH reloads; a draft belongs to the workspace
// document, while RPC authority always comes from the live session ID.
export function draftStorageKey(target: DocumentTarget): string {
  return `dsh-manuscript:draft:${encodeURIComponent(`${target.cwd}\u0000${target.path}`)}`
}

export function parseStoredDraft(value: string | null, target: DocumentTarget): StoredDraft | null {
  if (!value) return null
  try {
    const draft = JSON.parse(value) as Partial<StoredDraft>
    if (draft.cwd !== target.cwd || draft.path !== target.path || typeof draft.text !== 'string' || typeof draft.version !== 'string') return null
    return { sessionId: target.sessionId, cwd: draft.cwd, path: draft.path, text: draft.text, version: draft.version }
  } catch {
    return null
  }
}
