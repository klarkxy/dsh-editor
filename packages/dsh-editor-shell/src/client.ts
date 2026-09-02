import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactNode } from 'react'
import { registerRoot } from './root-registration.ts'
import {
  WRITING_SETTINGS_NAMESPACE,
  createWritingMigration,
  decodeWritingPreferences,
  registerWritingSettings,
  type WritingPreferences,
} from './writing-settings.ts'
import { type ShellContext } from './client/shared.ts'
import { registerShellRoot } from './client/root.ts'

export const name = 'dsh-editor-shell-client'
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'settingsScope'] as const

// Re-exports — keep the old monolith surface so existing callers and specs still work.
export {
  authorFlowExamples,
  canSubmitComposer,
  chapterStatusText,
  claimInitialWorkspaceResume,
  clampPanelWidth,
  createDialogDirectory,
  createFlowWorkspace,
  errorMessage,
  hasRelocatableManuscriptFiles,
  hasVisibleWorkspaceEntries,
  isChapterDocumentPath,
  isManagedGroupName,
  isSessionMissing,
  isStaleFailure,
  isSuccessWorkbenchNote,
  LatestRequestGate,
  managedGroupDirectories,
  orderTreeEntries,
  proposalAppliedNavigation,
  relocationFailureMessage,
  replaceWorldbookPaperText,
  resizedPanelWidth,
  safeRpcCall,
  searchSkippedText,
  shouldSubmitComposer,
  supportedWorkspaceTextPaths,
  treeExpansionPaths,
  treeRowPadding,
  worldbookPaperProjection,
  workspaceOpenFailureMessage,
  workspaceShortcut,
} from './client/shared.ts'
export type {
  AuthorFlowExample,
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
export type { ThemeValue } from './client/theme.ts'
export { ConfirmDialog, CreateDocumentDialog, NewProjectDialog, TextPromptDialog } from './client/dialogs.ts'
export type { CreateDocumentRequest } from './client/dialogs.ts'
export { Chat, ModelIndicator, NewConversationPicker, PendingCard, ProjectContextReceiptView, ProposalCard } from './client/chat.ts'
export { Editor } from './client/editor.ts'
export { FileContextMenu, Tree } from './client/sidebar.ts'
export { DeepSeekWhaleMark, PaperStage, PanelResizer, currentSession, useObservable } from './client/components.ts'

type SettingsSlot = { bind(spec: { namespace: string; decode(value: unknown): WritingPreferences | undefined }): SettingsScope<WritingPreferences> }

export function apply(ctx: Context): void {
  const client = ctx as ShellContext & { settingsScope: SettingsSlot }
  const writingScope = client.settingsScope.bind({ namespace: WRITING_SETTINGS_NAMESPACE, decode: decodeWritingPreferences })
  const migrateWritingPreferences = createWritingMigration(writingScope, globalThis.localStorage)
  void migrateWritingPreferences()
  registerWritingSettings(client, writingScope, migrateWritingPreferences)
  registerShellRoot(client, {
    writingScope,
    registerRoot: (target: ShellContext, render: (props: unknown) => ReactNode) => registerRoot(target, render),
    settingsControl: null,
  })
}
