/**
 * Browser-safe Shell extension seats.
 *
 * How a sidebar contribution receives context
 * ------------------------------------------
 * `ctx.slots.renderSlot` on the client renderer only accepts `'root'`
 * (renderer SlotRegistry: `renderSlot(key, owner)` is the root entry;
 * official `dsh-client-runtime` types are gone). Child list seats
 * render through the `renderSlot` function the slot renderer injects into the
 * root entry's props (`RootOwnerProps` plus that face).
 *
 * Shell calls `renderSlot(SIDEBAR_TOOLS_SLOT, seatContext)` and
 * `renderSlot(CENTER_OVERLAYS_SLOT, seatContext)` with the same owner
 * object. The renderer merges that owner into each contribution's
 * registered `render` component props (together with global standard kit
 * fields such as `useSessions`). A contribution of the form
 * `(props: ShellToolSeatContext) => …` therefore receives `sessionId`,
 * `openDocument`, `ProposalCard`, and the rest as its own props.
 */
import type { ComponentType, ReactNode } from 'react'

export const SIDEBAR_TOOLS_SLOT = 'dsh-editor.sidebar.tools'
export const CENTER_OVERLAYS_SLOT = 'dsh-editor.center.overlays'
export const COMMANDS_SERVICE = 'dshEditorCommands'
/** Chat tool-result cards. Plugins `inject` this and `register` a renderer per tool name. */
export const MESSAGE_CARDS_SERVICE = 'dshEditorMessageCards'
/**
 * Layout contract for `CENTER_OVERLAYS_SLOT` contributions: put this attribute
 * on the overlay's root element while it is open (render `null` when closed).
 * The Shell places any element carrying it into the editor's grid cell and
 * hides the editor underneath; plugins must not write their own grid rules.
 */
export const CENTER_OVERLAY_ATTRIBUTE = 'data-dsh-center-overlay'

export type ShellLocale = 'zh' | 'en'

/** Range accepted by today's `openDocument(path, hit)` (SearchHit / ProofreadFinding). */
export type ShellRange = {
  start: number
  end: number
  version?: string
  line?: number
  column?: number
  excerpt?: string
}

export type ShellProposalCardProps = {
  sessionId: string
  proposal: {
    marker: 'dsh-editor.proposal'
    version: 1
    kind: 'edit'
    path: string
    oldText: string
    newText: string
    summary: string
  }
  onApplied(path: string): void
  onDismiss?(): void
}

export type ShellToolSeatContext = {
  /** Live workbench session, or empty when no workspace is open. */
  sessionId: string
  /** Currently open manuscript path, or empty. */
  activePath: string
  /** True when the open editor buffer has unsaved changes. */
  editorDirty: boolean
  /** Bumps when the file tree should reload. */
  treeRevision: number
  /** Bumps when the open document should reload from disk. */
  contentRevision: number
  /** Author-facing UI language. */
  locale: ShellLocale
  /** Open a document, optionally revealing a range. */
  openDocument(path: string, range?: ShellRange): void
  /** After a plugin-confirmed write: refresh tree/content and navigate when safe. */
  onApplied(path: string): void
  /** Show a short status line in the Shell chrome. */
  note(message: string): void
  /** Open the file sidebar and leave focus mode so a tool panel can be seen. */
  revealSidebar(): void
  /** Ask the Shell to reload tree glyphs, the open document, or the cached overview used by the tree. */
  refresh(scope: 'tree' | 'content' | 'overview'): void
  /** Expand file-tree ancestors so `path` is visible. */
  expandTreePath(path: string): void
  /** Highlight a tree row (today used by the cards plugin for the selected card). */
  highlightTreePath(path: string | null): void
  /** Currently pinned document path, or null when the pinned pane is empty. */
  pinnedPath: string | null
  /** Pin `path` beside the editor, or unpin it when it is already pinned. */
  togglePin(path: string): void
  /** Shell-owned author-confirmation card. Plugins never write author content themselves. */
  ProposalCard: ComponentType<ShellProposalCardProps>
}

export type ShellCommandShortcut = {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export type ShellCommand = {
  id: string
  group: 'workspace' | 'writing' | 'view'
  label: Record<ShellLocale, string>
  hint?: Record<ShellLocale, string>
  /** Extra palette search terms; labels and hints are already searchable. */
  keywords?: string[]
  /** `ctrl` is Ctrl on Windows and Cmd on macOS, matching `workspaceShortcut`. */
  shortcut?: ShellCommandShortcut
  when?: 'workspace' | 'always'
  enabled?(context: ShellToolSeatContext): boolean
  run(context: ShellToolSeatContext): void
}

export type ShellCommandRegistry = {
  register(command: ShellCommand): () => void
  list(): ShellCommand[]
  subscribe(listener: () => void): () => void
}

/**
 * Callbacks Chat already owns when a plugin card renders inside a tool-result row.
 * `onApplied` / `refresh` / `note` are the same faces as `ShellToolSeatContext`.
 */
export type ShellMessageCardContext = {
  /** Live workbench session for the conversation that produced this tool result. */
  sessionId: string
  /** Author-facing UI language. */
  locale: ShellLocale
  /** After a plugin-confirmed write: refresh tree/content and navigate when safe. */
  onApplied(path: string): void
  /** Ask the Shell to reload tree glyphs, the open document, or the cached overview. */
  refresh(scope: 'tree' | 'content' | 'overview'): void
  /** Show a short status line in the Shell chrome (Chat composer note today). */
  note(message: string): void
}

export type ShellMessageCard = {
  /** `node.call.name` on the conversation tool-result; Chat looks up cards by this key only. */
  toolName: string
  /**
   * Render that tool's result. `result` is the payload Chat already has for the row:
   * the parsed receipt when the adapter recognized one, otherwise the raw body/text.
   * A node replaces the default tool row. `null` declines this payload and Chat
   * keeps the default tool row.
   */
  render(props: { result: unknown; context: ShellMessageCardContext }): ReactNode | null
}

export type ShellMessageCardRegistry = {
  /** Register a card. Duplicate `toolName` throws. The disposer unregisters it. */
  register(card: ShellMessageCard): () => void
  /** The card for this tool, or `undefined` when none is registered. */
  get(toolName: string): ShellMessageCard | undefined
  /** Notify Chat (or tests) after register/dispose. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
}

export type ShortcutInput = {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function createCommandRegistry(): ShellCommandRegistry {
  const commands: ShellCommand[] = []
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    register(command) {
      if (commands.some((item) => item.id === command.id)) {
        throw new Error(`duplicate shell command id: ${command.id}`)
      }
      commands.push(command)
      emit()
      return () => {
        const index = commands.indexOf(command)
        if (index < 0) return
        commands.splice(index, 1)
        emit()
      }
    },
    list() {
      return [...commands]
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function createMessageCardRegistry(): ShellMessageCardRegistry {
  const cards = new Map<string, ShellMessageCard>()
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    register(card) {
      if (cards.has(card.toolName)) {
        throw new Error(`duplicate message card toolName: ${card.toolName}`)
      }
      cards.set(card.toolName, card)
      emit()
      return () => {
        if (cards.get(card.toolName) !== card) return
        cards.delete(card.toolName)
        emit()
      }
    },
    get(toolName) {
      return cards.get(toolName)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function shortcutMatches(shortcut: ShellCommandShortcut, input: ShortcutInput): boolean {
  const mod = input.ctrlKey || input.metaKey
  if (Boolean(shortcut.ctrl) !== mod) return false
  if (Boolean(shortcut.shift) !== input.shiftKey) return false
  if (Boolean(shortcut.alt) !== input.altKey) return false
  return input.key.toLowerCase() === shortcut.key.toLowerCase()
}

export function matchRegistryShortcut(commands: readonly ShellCommand[], input: ShortcutInput): ShellCommand | undefined {
  return commands.find((command) => command.shortcut && shortcutMatches(command.shortcut, input))
}

export type RegistryPaletteItem = {
  id: string
  group: ShellCommand['group']
  label: string
  hint?: string
  keywords?: string[]
  disabled?: boolean
  run(): void
}

export function registryPaletteItems(
  commands: readonly ShellCommand[],
  locale: ShellLocale,
  context: ShellToolSeatContext,
  hasWorkspace: boolean,
): RegistryPaletteItem[] {
  return commands.map((command) => {
    const workspaceOnly = command.when === 'workspace'
    const disabled = (workspaceOnly && !hasWorkspace) || command.enabled?.(context) === false
    return {
      id: command.id,
      group: command.group,
      label: command.label[locale] || command.label.zh,
      hint: command.hint?.[locale] || command.hint?.zh,
      keywords: command.keywords,
      disabled,
      run: () => {
        if (disabled) return
        if (workspaceOnly) context.revealSidebar()
        command.run(context)
      },
    }
  })
}
