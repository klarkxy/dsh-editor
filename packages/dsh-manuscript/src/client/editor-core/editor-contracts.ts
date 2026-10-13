import type { CSSProperties, ReactNode } from 'react'
import type { ShellToolSeatContext } from 'dsh-editor-seats'
import type { EditorCommandState, EditorContextMenuEvent, EditorTargetSnapshot } from './editor-clipboard.ts'
import type { EditorDocument, SelectionTicket } from './editor-state.ts'
import type { CompletionPreference } from './completion-preference.ts'
import type { TypographyInput } from './typography.ts'

// EditorCore only needs to issue RPCs; hosts that also register handlers can
// pass the full RpcBag and the structural type will still match.
export type EditorCoreRpc = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
}

export type EditorCoreHandle = {
  save(): Promise<boolean>
  /**
   * Writes a new full document text that must differ only in the hidden header
   * (e.g. chapter beats / chapter-end state). Rechecks the caller's target
   * snapshot (session/path/generation/revision), applies the text via the
   * existing setText path, and persists through the same save mechanism as
   * the body — awaiting the real file.write acknowledgement. Returns false
   * (without writing) when a save is already in flight, the buffer conflicts,
   * the target is stale, or the visible paper text would change.
   */
  saveMetadataText(next: string, target: EditorTargetSnapshot): Promise<boolean>
  discard(): void
  isDirty(): boolean
  getText(): string
  getDocument(): EditorDocument | null
  getSelection(): { start: number; end: number }
  setGhost(candidates: string[], index: number, at: number): void
  clearGhost(): void
  setProposal(proposal: { ticket: SelectionTicket; text: string } | null): void
  /**
   * Reveal and select an absolute character range in the open document.
   * `start` / `end` are offsets in the full file text (including any
   * projected prefix such as worldbook frontmatter). Out-of-range ends
   * are clamped to the visible paper; the selection is scrolled into
   * view and the editor is focused.
   */
  revealRange(start: number, end: number): void
  /**
   * Cancel a draft-sync timeout that has not yet called draft.put/delete.
   * Does not abort an already-enqueued queue operation. Shell-owned
   * conflict resolution must call this before deleting the owned draft.
   */
  cancelPendingDraftSync(): void
  /**
   * Request a selection rewrite. When `instruction` is omitted the Host uses
   * the default patch prompt; the built-in footer button keeps that path.
   * An optional snapshot pins the original range across a custom-dialog gap.
   */
  requestRewrite(instruction?: string, target?: EditorTargetSnapshot): void
  focus(): void
  getFocusTarget(): HTMLElement | null
  isComposing(): boolean
  getCommandState(): EditorCommandState
  captureTarget(): EditorTargetSnapshot | null
  isTargetCurrent(target: EditorTargetSnapshot): boolean
  restoreTarget(target: EditorTargetSnapshot): boolean
  undo(): boolean
  redo(): boolean
  selectAll(): boolean
  /** Select a visible paragraph without changing text; optional for older hosts. */
  selectParagraph?(target?: EditorTargetSnapshot): boolean
  replaceSelection(text: string, target?: EditorTargetSnapshot): boolean
  getVisibleSelectionText(): string
  getVisiblePaperText(): string
  getPaperOffset(): number
  openFind(): boolean
  openReplace(): boolean
  requestCompletion(): void
  /**
   * Viewport coordinates of a document position (full-file offset, matching
   * the other handle APIs). Returns null while the position is not rendered.
   * Used by hosts to anchor floating UI (e.g. the rewrite popover) to text.
   */
  coordsAtPos(pos: number): { left: number; top: number; right: number; bottom: number } | null
}

export type EditorCoreDraftBackup = {
  path: string
  text: string
  baseText: string
  baseVersion: string
  ownerId?: string
  revision?: string
  updatedAt?: string
}

export type EditorCoreDraft =
  | {
      kind: 'host'
      call: (endpoint: 'draft.get' | 'draft.put' | 'draft.delete' | 'draft.list', payload: Record<string, unknown>) => Promise<unknown>
      syncDelayMs?: number
    }
  | {
      kind: 'session'
      cwd: string
      syncDelayMs?: number
    }
  | { kind: 'none' }

export type EditorCorePaperProjection = {
  project(path: string, text: string): { text: string; offset: number }
  replace(path: string, text: string, paperText: string): string
}

/** Optional paper typography. Omitted fields keep today's 17px / 1.9 / serif defaults. */
export type EditorCoreTypography = TypographyInput

export type EditorCoreProps = {
  sessionId: string
  cwd?: string
  path: string

  rpc: EditorCoreRpc
  draft?: EditorCoreDraft

  onDirtyChange?(dirty: boolean): void
  onSaved?(): void
  onError?(message: string): void
  onNotice?(message: string): void
  onStatusChange?(status: EditorCoreStatus): void

  // Caller receives a handle once mounted; the handle exposes imperative
  // save / discard so the host can coordinate switch-while-dirty flows
  // (manuscript's "保存后切换" / "放弃修改并切换" pattern). A `null`
  // argument is delivered on unmount so the host can release its cache.
  onHandle?(handle: EditorCoreHandle | null): void

  testIdPrefix?: string
  paperClassName?: string
  paperStyle?: CSSProperties
  slotClassName?: Partial<Record<EditorCoreSlot, string>>
  slotStyle?: Partial<Record<EditorCoreSlot, CSSProperties>>

  completionPreference?: CompletionPreference
  /** Host may identify author documents outside the legacy 正文/ directory. */
  automaticCompletionEligible?: boolean
  /**
   * Optional completion capability gate (default true for compatibility).
   * When false, no FIM or selection-rewrite RPC is ever issued — the manual
   * 补全/修改选段 buttons and the automatic FIM trigger are all disabled.
   */
  completionEnabled?: boolean
  authorPreferences?: string
  chapterContext?: string
  fimDelayMs?: number
  maxGhostCandidates?: number
  showGhostTip?: boolean
  buildFimPayload?(input: FimPayloadInput): Record<string, unknown>
  buildPatchPayload?(input: PatchPayloadInput): Record<string, unknown>
  extractFimText?(value: unknown): string
  extractPatchText?(value: unknown): string

  enablePatch?: boolean
  showProposalDiff?: boolean

  enableRewriteSelection?: boolean
  onRewriteSelection?(selection: string, path: string): void | Promise<void>

  paperProjection?: EditorCorePaperProjection

  /** Keep the caret line at a fixed viewport ratio (default 0.5) while typing or moving the cursor. */
  typewriter?: boolean
  /** Paper measure and type. Applied as `--paper-*` CSS variables on the editor root. */
  typography?: EditorCoreTypography
  /** Dim every paragraph except the one that contains the caret. */
  focusParagraph?: boolean

  autoSaveDelayMs?: number
  externalRevision?: number

  // Shell-specific conflict recovery actions. When provided, the matching
  // button is rendered alongside EditorCore's built-in discard. The host
  // owns the actual flow (e.g. confirm dialog, copy-as-conflict).
  onReloadDisk?(): void
  onSaveConflictCopy?(): void

  // Install a beforeunload warning while the buffer is dirty. The shell
  // wants the browser prompt; the manuscript overlay adds its own.
  enableBeforeUnload?: boolean

  // Custom header/footer nodes for hosts that need to inject extra UI
  // (e.g. a row of chapter shortcuts in the shell's footer). Rendered
  // after the built-in controls.
  headerExtras?: ReactNode
  footerExtras?: ReactNode

  /**
   * In-document page header (原稿页眉): rendered through a React portal
   * into a host element anchored at the start of `.cm-scroller`, so it
   * scrolls away with the document instead of sticking. When provided, the
   * built-in header bar is not rendered.
   */
  paperHeader?: ReactNode
  /**
   * Host-rendered conflict notice. When provided it replaces the built-in
   * conflict strip and the conflict footer buttons (the host wires the same
   * `onReloadDisk` / `onSaveConflictCopy` / discard flows).
   */
  conflictNotice?: ReactNode
  /** Host button implementation (seats ShellToolSeatContext['Button']) for SeatButton chrome. */
  hostButton?: ShellToolSeatContext['Button']

  /**
   * Hide the built-in always-on complete/save/rewrite buttons. Ghosts,
   * proposals, stop, conflict, and backups stay on demand. Overlay hosts
   * keep the default (false) so their chrome does not change.
   */
  compactControls?: boolean
  /** Fired after a paper context-menu gesture; hosts own the actual menu. */
  onEditorContextMenu?(event: EditorContextMenuEvent): void
}

export type EditorCoreStatus = 'empty' | 'loading' | 'saved' | 'draft' | 'conflict' | 'error'

export type EditorCoreSlot =
  | 'outer'
  | 'header'
  | 'tools'
  | 'textarea'
  | 'mirror'
  | 'ghost'
  | 'ghostCard'
  | 'ghostTip'
  | 'proposal'
  | 'conflict'
  | 'notice'
  | 'footer'

export type FimPayloadInput = {
  sessionId: string
  path: string
  prefix: string
  suffix: string
  authorPreferences?: string
  chapterContext?: string
}

export type PatchPayloadInput = {
  sessionId: string
  path: string
  selectedText: string
  before: string
  after: string
  authorPreferences?: string
  chapterContext?: string
  instruction?: string
}
