import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { externalSync, ghostField, livePreviewExtension, paperHighlight, paperMarkdown, paperTheme, setGhostEffect } from './codemirror.ts'
import { closeSearchPanelIfFocused, isPaperSearchPanelFocused, paperEscapePriority, paperSearch } from './search.ts'
import { focusParagraphExtension, typewriterExtension } from './typewriter.ts'
import { contextMenuSource, shouldPreserveSelectionOnContextMouseDown, type EditorContextMenuEvent } from './editor-clipboard.ts'
import type { EditorCorePaperProjection, EditorCoreProps } from './editor-contracts.ts'

/** Stable dispatch from CodeMirror listeners to the current editor render. */
export type PaperViewCallbacks = {
  setTextFromPaper(paper: string): void
  flushText(): void
  onSelection(start: number, end: number): void
  acceptGhost(): void
  acceptPatch(): void
  complete(): void
  cancelSuggestions(): boolean
  save(): void
  hasGhost(): boolean
  hasProposal(): boolean
  hasCompletionActivity(): boolean
  onContextMenu(event: EditorContextMenuEvent): void
  hasContextMenu(): boolean
  canEdit(): boolean
}

type PaperViewOptions = {
  containerRef: RefObject<HTMLDivElement>
  viewRef: MutableRefObject<EditorView | null>
  callbacksRef: MutableRefObject<PaperViewCallbacks>
  paperOffsetRef: MutableRefObject<number>
  textFlushTimer: MutableRefObject<ReturnType<typeof globalThis.setTimeout> | null>
  typewriter: boolean
  focusParagraph: boolean
  centerSectionMarks: boolean
  documentReady: boolean
  isDocumentReady(): boolean
  path: string
  paperProjection: EditorCorePaperProjection
  textRef: MutableRefObject<string>
  documentGenerationRef: MutableRefObject<number>
  pendingCursorRef: MutableRefObject<number | null>
  paperText: string
  renderGeneration: number
  ghost: string
  ghostAt: number
  paperOffset: number
  testIdPrefix: string
  slotClassName: NonNullable<EditorCoreProps['slotClassName']>
}

/** Owns one view and its reconfiguration; document changes never remount it. */
export function usePaperView({
  containerRef, viewRef, callbacksRef, paperOffsetRef, textFlushTimer,
  typewriter, focusParagraph, centerSectionMarks, documentReady, isDocumentReady,
  path, paperProjection, textRef, documentGenerationRef, pendingCursorRef,
  paperText, renderGeneration, ghost, ghostAt, paperOffset, testIdPrefix, slotClassName,
}: PaperViewOptions): void {
  const syncedGenerationRef = useRef(-1)
  const writingCompartments = useRef({
    typewriter: new Compartment(),
    focusParagraph: new Compartment(),
    livePreview: new Compartment(),
    history: new Compartment(),
    editability: new Compartment(),
  })

  // Mount the EditorView once; content flows in through the sync effect.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const cb = callbacksRef
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: '',
        extensions: [
          EditorView.contentAttributes.of({ 'aria-label': '文稿正文' }),
          writingCompartments.current.history.of(history()),
          writingCompartments.current.editability.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
          EditorState.changeFilter.of((transaction) => !transaction.docChanged || Boolean(transaction.annotation(externalSync)) || cb.current.canEdit()),
          paperMarkdown,
          paperHighlight,
          paperTheme,
          writingCompartments.current.livePreview.of(livePreviewExtension({ centerSectionMarks })),
          ghostField,
          paperSearch(),
          writingCompartments.current.typewriter.of(typewriterExtension({ enabled: typewriter })),
          writingCompartments.current.focusParagraph.of(focusParagraphExtension(focusParagraph)),
          EditorView.lineWrapping,
          Prec.highest(EditorView.domEventHandlers({
            mousedown(event, view) {
              if (event.button !== 2 || !cb.current.hasContextMenu() || view.composing) return false
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
              if (pos == null) return false
              const sel = view.state.selection.main
              if (shouldPreserveSelectionOnContextMouseDown({ from: sel.from, to: sel.to, clickPos: pos })) {
                event.preventDefault()
                return true
              }
              view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true })
              return true
            },
            keydown(event, view) {
              if (!cb.current.hasContextMenu() || (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey))) return false
              event.preventDefault()
              if (view.composing || event.isComposing || event.keyCode === 229) return true
              const rect = view.coordsAtPos(view.state.selection.main.head) ?? view.contentDOM.getBoundingClientRect()
              cb.current.onContextMenu({ x: rect.left, y: rect.bottom, source: 'keyboard' })
              return true
            },
            contextmenu(event, view) {
              if (!cb.current.hasContextMenu()) return false
              event.preventDefault()
              if (view.composing) return true
              cb.current.onContextMenu({
                x: event.clientX,
                y: event.clientY,
                source: contextMenuSource(event.button),
              })
              return true
            },
            blur() {
              // Leaving the paper settles the debounced text state so header UI
              // (word count / status) reflects the final buffer immediately.
              cb.current.flushText()
            },
          })),
          Prec.high(keymap.of([
            {
              key: 'Tab',
              run: (v) => {
                // Find-bar focus and IME composition both consume Tab
                // before ghost acceptance.
                if (isPaperSearchPanelFocused(v) || v.composing || !cb.current.hasGhost()) return false
                cb.current.acceptGhost()
                return true
              },
            },
            {
              key: 'Escape',
              run: (v) => {
                const action = paperEscapePriority({
                  searchPanelFocused: isPaperSearchPanelFocused(v),
                  completionActive: cb.current.hasCompletionActivity(),
                })
                if (action === 'close-search') return closeSearchPanelIfFocused(v)
                if (action === 'cancel-completion') return cb.current.cancelSuggestions()
                return false
              },
            },
            { key: 'Mod-s', run: () => { cb.current.save(); return true } },
            {
              key: 'Mod-Enter',
              run: (v) => {
                if (isPaperSearchPanelFocused(v) || v.composing) return false
                if (cb.current.hasProposal()) cb.current.acceptPatch()
                else cb.current.complete()
                return true
              },
            },
          ])),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            const external = update.transactions.some((tr) => tr.annotation(externalSync))
            if (update.docChanged && !external) {
              cb.current.setTextFromPaper(update.state.doc.toString())
            }
            if (update.docChanged || update.selectionSet) {
              const main = update.state.selection.main
              const offset = paperOffsetRef.current
              cb.current.onSelection(main.from + offset, main.to + offset)
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    // Test handle for e2e scripts: read/write the document via evaluate.
    ;(container as unknown as { __cmView: EditorView }).__cmView = view
    return () => {
      if (textFlushTimer.current != null) { globalThis.clearTimeout(textFlushTimer.current); textFlushTimer.current = null }
      view.destroy()
      viewRef.current = null
      delete (container as unknown as { __cmView?: EditorView }).__cmView
    }
  }, [])

  // Runtime toggle: typewriter / focus-paragraph are Compartment-backed so a
  // prop change does not rebuild the EditorView (ghost, search, and proposal
  // keymaps stay mounted).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: [
        writingCompartments.current.typewriter.reconfigure(typewriterExtension({ enabled: typewriter })),
        writingCompartments.current.focusParagraph.reconfigure(focusParagraphExtension(focusParagraph)),
        writingCompartments.current.livePreview.reconfigure(livePreviewExtension({ centerSectionMarks })),
      ],
    })
  }, [typewriter, focusParagraph, centerSectionMarks])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: writingCompartments.current.editability.reconfigure([
      EditorState.readOnly.of(!documentReady), EditorView.editable.of(documentReady),
    ]) })
  }, [documentReady])

  // Replace a loaded document without carrying undo entries across chapters.
  // Local edits keep their existing history and flow back through the listener.
  // The dispatch guard compares CM against the authoritative textRef — never the
  // debounced React state — so a lagging flush can never wipe fresh keystrokes,
  // while external updates (load / chapter switch / proposal apply) still land.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !isDocumentReady()) return
    const generation = documentGenerationRef.current
    const changedDocument = syncedGenerationRef.current !== generation
    if (changedDocument) view.dispatch({ effects: writingCompartments.current.history.reconfigure([]) })
    const target = paperProjection.project(path, textRef.current).text
    const current = view.state.doc.toString()
    if (current !== target) {
      const pending = pendingCursorRef.current
      pendingCursorRef.current = null
      const anchor = pending == null ? undefined : Math.max(0, Math.min(target.length, pending))
      view.dispatch({
        changes: { from: 0, to: current.length, insert: target },
        selection: anchor == null ? undefined : { anchor },
        annotations: externalSync.of(true),
      })
    }
    if (changedDocument) {
      view.dispatch({ effects: writingCompartments.current.history.reconfigure(history()) })
      syncedGenerationRef.current = generation
    }
  }, [paperText, renderGeneration, documentReady, isDocumentReady, path, paperProjection])

  // React ghost state → CM ghost widget (paper coordinates).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const at = Math.max(0, Math.min(view.state.doc.length, ghostAt - paperOffset))
    view.dispatch({
      effects: setGhostEffect.of(
        ghost
          ? { at, text: ghost, testId: `${testIdPrefix}-ghost`, className: slotClassName.ghost }
          : null,
      ),
    })
  }, [ghost, ghostAt, paperOffset, testIdPrefix, slotClassName])

}
