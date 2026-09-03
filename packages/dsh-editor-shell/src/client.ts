import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactNode } from 'react'
import { registerRoot } from './root-registration.ts'
import {
  WRITING_SETTINGS_NAMESPACE,
  createWritingMigration,
  decodeWritingPreferences,
  type WritingPreferences,
} from './writing-settings.ts'
import {
  PROGRESS_SETTINGS_NAMESPACE,
  decodeWritingProgress,
  type WritingProgress,
} from './writing-progress.ts'
import { decodeHostThemePreference, writeHostThemePreference, type HostThemeSync } from './client/theme.ts'
import { type ShellContext } from './client/shared.ts'
import { registerShellRoot } from './client/root.ts'

export const name = 'dsh-editor-shell-client'
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'settingsScope', 'settingsSchema', 'remote'] as const

// Re-exports — keep the old monolith surface so existing callers and specs still work.
export {
  canSubmitComposer,
  claimInitialWorkspaceResume,
  clampPanelWidth,
  createFlowWorkspace,
  errorMessage,
  hasRelocatableManuscriptFiles,
  hasVisibleWorkspaceEntries,
  isSessionMissing,
  isStaleFailure,
  isSuccessWorkbenchNote,
  LatestRequestGate,
  orderTreeEntries,
  proposalAppliedNavigation,
  relocationFailureMessage,
  resumableConversationId,
  replaceWorldbookPaperText,
  resizedPanelWidth,
  safeRpcCall,
  searchSkippedText,
  shouldSubmitComposer,
  snapshotTimeLabel,
  supportedWorkspaceTextPaths,
  treeExpansionPaths,
  treeRowPadding,
  worldbookPaperProjection,
  workspaceOpenFailureMessage,
  workspaceShortcut,
} from './client/shared.ts'
export type {
  ManagedWorkspace,
  PendingWorkspaceOpen,
  ProjectContextReceiptBundle,
  RequestTicket,
  ResizablePanelSide,
  RpcResult,
  ShellContext,
  TreeEntry,
  WorkspaceIntent,
  WorkspaceOpenState,
  WorkspaceShortcutAction,
} from './client/shared.ts'
export { THEME_STORAGE_KEY, THEME_VALUES, ThemeToggle, useTheme } from './client/theme.ts'
export type { HostThemeSync, ThemeValue } from './client/theme.ts'
export { ConfirmDialog, NewProjectDialog, TextPromptDialog } from './client/dialogs.ts'
export { Chat, ModelPicker, NewConversationPicker, PendingCard, ProjectContextReceiptView, ProposalCard } from './client/chat.ts'
export { Editor } from './client/editor.ts'
export { FileContextMenu, Tree } from './client/sidebar.ts'
export { DeepSeekWhaleMark, PaperStage, PanelResizer, currentSession, useObservable } from './client/components.ts'

type SettingsSlot = { bind<T>(spec: { namespace: string; decode?(value: unknown): T | undefined }): SettingsScope<T> }

export function apply(ctx: Context): void {
  const client = ctx as ShellContext & { settingsScope: SettingsSlot }
  const writingScope = client.settingsScope.bind({ namespace: WRITING_SETTINGS_NAMESPACE, decode: decodeWritingPreferences })
  const migrateWritingPreferences = createWritingMigration(writingScope, globalThis.localStorage)
  void migrateWritingPreferences()
  // Host chrome follows the host `ui-theme` preference; sync it so the
  // paper/ink toggle themes the host chrome too. Best-effort: when the scope
  // is read-only or the write fails, the local toggle still works.
  const hostThemeScope = client.settingsScope.bind({ namespace: 'ui-theme', decode: decodeHostThemePreference })
  const hostThemeSync: HostThemeSync = {
    read: () => hostThemeScope.getSnapshot().value?.preference,
    write: (preference) => writeHostThemePreference(hostThemeScope, preference),
    subscribe: (listener) => hostThemeScope.subscribe(listener),
  }
  const progressScope: SettingsScope<WritingProgress> = client.settingsScope.bind({
    namespace: PROGRESS_SETTINGS_NAMESPACE,
    decode: decodeWritingProgress,
  })
  registerShellRoot(client, {
    writingScope,
    migrateWriting: migrateWritingPreferences,
    progressScope,
    hostThemeSync,
    registerRoot: (target: ShellContext, render: (props: unknown) => ReactNode) => registerRoot(target, render),
  })
}
