// Public surface of the editor-core module. Imported via the
// `dsh-manuscript/client/editor-core` package export; in-tree imports from
// the source files use the `./...` paths.
export * from './editor-state.ts'
export * from './completion-preference.ts'
export { editorCoreStyles } from './styles.ts'
export {
  DEFAULT_TYPOGRAPHY,
  FONT_STACKS,
  normalizeTypography,
  typographyCssVariables,
  type ResolvedTypography,
  type TypographyInput,
} from './typography.ts'
export {
  activeParagraphRange,
  buildFocusParagraphDecorations,
  focusParagraphEnabled,
  focusParagraphExtension,
  shouldRecenterTypewriter,
  typewriterConfig,
  typewriterExtension,
  typewriterScrollTop,
  type TypewriterOptions,
} from './typewriter.ts'
export {
  EditorCore,
  defaultFimPayload,
  defaultPatchPayload,
  type EditorCoreDraft,
  type EditorCoreHandle,
  type EditorCorePaperProjection,
  type EditorCoreProps,
  type EditorCoreSlot,
  type EditorCoreStatus,
  type EditorCoreTypography,
  type FimPayloadInput,
  type PatchPayloadInput,
} from './editor.tsx'
export { REWRITE_PRESETS, type RewritePresetId } from './rewrite-presets.ts'
export {
  captureEditorTarget,
  editorCommandState,
  isEditorTargetCurrent,
  isolateReplaceSpec,
  paperSelectionText,
  runClipboardCopy,
  runClipboardCut,
  runClipboardPaste,
  shouldPreserveSelectionOnContextMouseDown,
  visiblePaperRange,
  type ClipboardCommandResult,
  type EditorCommandState,
  type EditorContextMenuEvent,
  type EditorTargetLive,
  type EditorTargetSnapshot,
} from './editor-clipboard.ts'
export { openFindPanel, openReplacePanel } from './search.ts'
