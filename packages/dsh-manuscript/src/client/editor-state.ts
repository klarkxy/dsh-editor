export type EditorStatus = 'loading' | 'saved' | 'dirty' | 'conflict' | 'error'

export type DocumentTarget = {
  sessionId: string
  cwd: string
  path: string
}

export type StoredDraft = DocumentTarget & {
  text: string
  version: string
}

export function documentKey(target: DocumentTarget): string {
  return `${target.sessionId}\u0000${target.cwd}\u0000${target.path}`
}

export function hasUnsavedChanges(text: string, savedText: string): boolean {
  return text !== savedText
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

export function draftStorageKey(target: DocumentTarget): string {
  // Session IDs can change when DSH reloads; a draft belongs to the workspace
  // document, while RPC authority always comes from the live session ID.
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
