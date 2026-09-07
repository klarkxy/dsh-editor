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
  type EditorCoreDraft,
  type EditorCoreHandle,
  type EditorCorePaperProjection,
  type EditorCoreProps,
  type EditorCoreSlot,
  type EditorCoreStatus,
  type EditorCoreTypography,
} from './editor.tsx'
