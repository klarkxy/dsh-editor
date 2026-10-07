import { useCallback, type MutableRefObject } from 'react'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { redoDepth, undoDepth } from '@codemirror/commands'
import {
  captureEditorTarget, editorCommandState, isEditorTargetCurrent, isolateReplaceSpec,
  paperRangeToView, visiblePaperRange,
  type EditorCommandState, type EditorTargetLive, type EditorTargetSnapshot,
} from './editor-clipboard.ts'
import { isDirty, type EditorDocument } from './editor-state.ts'
import type { EditorCorePaperProjection } from './editor-contracts.ts'

type EditorCommandOptions = {
  viewRef: MutableRefObject<EditorView | null>
  docRef: MutableRefObject<EditorDocument | null>
  textRef: MutableRefObject<string>
  revisionRef: MutableRefObject<number>
  documentGenerationRef: MutableRefObject<number>
  paperOffsetRef: MutableRefObject<number>
  paperProjection: EditorCorePaperProjection
  selection: { start: number; end: number }
  isDocumentReady(): boolean
  isGenerating(): boolean
  conflictRef: MutableRefObject<boolean>
  completionEnabledRef: MutableRefObject<boolean>
  enablePatchRef: MutableRefObject<boolean>
}

/** Commands always inspect the live view/buffer and pin asynchronous targets. */
export function useEditorCommands({
  viewRef, docRef, textRef, revisionRef, documentGenerationRef, paperOffsetRef,
  paperProjection, selection, isDocumentReady, isGenerating,
  conflictRef, completionEnabledRef, enablePatchRef,
}: EditorCommandOptions) {
  const liveTarget = useCallback((): EditorTargetLive | null => {
    const current = docRef.current
    if (!current || !isDocumentReady()) return null
    return {
      sessionId: current.sessionId,
      path: current.path,
      documentGeneration: documentGenerationRef.current,
      revision: revisionRef.current,
      text: textRef.current,
    }
  }, [])

  const captureTarget = useCallback((): EditorTargetSnapshot | null => {
    const live = liveTarget()
    if (!live) return null
    const view = viewRef.current
    const main = view?.state.selection.main
    const offset = paperOffsetRef.current
    const start = main ? main.from + offset : selection.start
    const end = main ? main.to + offset : selection.end
    return captureEditorTarget({ ...live, start, end })
  }, [liveTarget, selection.start, selection.end])

  const readCommandState = useCallback((): EditorCommandState => {
    const view = viewRef.current
    const current = docRef.current
    const offset = paperOffsetRef.current
    const main = view?.state.selection.main
    const start = main ? main.from + offset : selection.start
    const end = main ? main.to + offset : selection.end
    const visible = current ? visiblePaperRange({
      text: textRef.current,
      paperOffset: offset,
      start,
      end,
    }) : undefined
    const paperLength = current ? Math.max(0, paperProjection.project(current.path, textRef.current).text.length) : 0
    return editorCommandState({
      loaded: isDocumentReady(),
      conflict: conflictRef.current,
      busy: isGenerating(),
      completionEnabled: completionEnabledRef.current,
      enablePatch: enablePatchRef.current,
      hasVisibleSelection: Boolean(visible),
      collapsed: start === end,
      dirty: isDirty(current, textRef.current),
      canUndo: view ? undoDepth(view.state) > 0 : false,
      canRedo: view ? redoDepth(view.state) > 0 : false,
      paperLength,
    })
  }, [paperProjection, selection.start, selection.end])

  const replaceSelection = useCallback((insert: string, target?: EditorTargetSnapshot): boolean => {
    const view = viewRef.current
    const live = liveTarget()
    if (!view || !live) return false
    const snapshot = target ?? captureTarget()
    if (!snapshot) return false
    if (!isEditorTargetCurrent(snapshot, live)) return false
    const range = paperRangeToView({
      paperOffset: paperOffsetRef.current,
      start: snapshot.start,
      end: snapshot.end,
      docLength: view.state.doc.length,
    })
    view.dispatch(isolateReplaceSpec({ from: range.from, to: range.to, insert }))
    return true
  }, [captureTarget, liveTarget])

  const restoreTarget = useCallback((target: EditorTargetSnapshot): boolean => {
    const view = viewRef.current
    const live = liveTarget()
    if (!view || !live || !isEditorTargetCurrent(target, live)) return false
    const range = paperRangeToView({
      paperOffset: paperOffsetRef.current,
      start: target.start,
      end: target.end,
      docLength: view.state.doc.length,
    })
    view.dispatch({
      selection: range.from === range.to
        ? EditorSelection.cursor(range.from)
        : EditorSelection.range(range.from, range.to),
      scrollIntoView: true,
    })
    view.focus()
    return true
  }, [liveTarget])

  return { liveTarget, captureTarget, readCommandState, replaceSelection, restoreTarget }
}
