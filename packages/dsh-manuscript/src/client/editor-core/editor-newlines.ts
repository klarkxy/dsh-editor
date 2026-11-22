export type EditorLineSeparator = '\n' | '\r\n'

/** Disk / buffer line ending. CodeMirror stores a unified LF document. */
export function detectLineSeparator(text: string): EditorLineSeparator {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

export function toEditorLf(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/** Restore the original line ending when writing paper text back into the buffer. */
export function fromEditorLf(paperLf: string, original: string): string {
  const lf = paperLf.replace(/\r\n/g, '\n')
  return detectLineSeparator(original) === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf
}

export function editorLfIndex(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(text.length, index))
  return toEditorLf(text.slice(0, clamped)).length
}

export function toEditorChanges(
  text: string,
  changes: readonly { from: number; to: number; insert: string }[],
  paperOffset = 0,
): { from: number; to: number; insert: string }[] {
  const prefix = editorLfIndex(text, paperOffset)
  return changes.map((change) => ({
    from: editorLfIndex(text, change.from) - prefix,
    to: editorLfIndex(text, change.to) - prefix,
    insert: toEditorLf(change.insert),
  }))
}
