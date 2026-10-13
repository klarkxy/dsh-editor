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
  | 'pin'

export type EditorMenuModel = {
  state: EditorCommandState
  canRewritePath: boolean
  canSelectParagraph?: boolean
  canLookupReferences?: boolean
  /** 「钉在旁边」可用：当前文档路径可钉且宿主接了 onPinReference。 */
  canPin?: boolean
}
