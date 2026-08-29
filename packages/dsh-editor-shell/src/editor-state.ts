export type SaveState = 'empty' | 'loading' | 'saved' | 'draft' | 'conflict' | 'error'

export type EditorDocument = { sessionId: string; path: string; text: string; version: string }

export type SelectionTicket = {
  sessionId: string
  path: string
  revision: number
  start: number
  end: number
  selectedText: string
}

export function isDirty(document: EditorDocument | null, text: string): boolean {
  return !!document && document.text !== text
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
