import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { activeParagraphRange } from './typewriter.ts'

/** Transient selection in the visible paper. No new block identity or document write. */
export function selectParagraphInView(view: Pick<EditorView, 'state' | 'composing' | 'dispatch' | 'focus'>): boolean {
  if (view.composing) return false
  const { from, to } = activeParagraphRange(view.state.doc, view.state.selection.main.head)
  if (!view.state.doc.sliceString(from, to).trim()) return false
  view.dispatch({ selection: EditorSelection.range(from, to), scrollIntoView: true })
  view.focus()
  return true
}
