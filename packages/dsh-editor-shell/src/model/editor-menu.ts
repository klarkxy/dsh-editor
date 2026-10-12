import type { EditorCommandState } from 'dsh-manuscript/client/editor-core'

export type EditorMenuAction =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'selectParagraph'
  | 'lookupReferences'
  | 'save'
  | 'find'
  | 'replace'
  | 'complete'
  | 'rewrite'

export type EditorMenuModel = {
  state: EditorCommandState
  canRewritePath: boolean
  canSelectParagraph?: boolean
  canLookupReferences?: boolean
}
