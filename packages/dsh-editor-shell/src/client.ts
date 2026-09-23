import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from './dsh-compat.ts'
import type { ReactNode } from 'react'
import { registerRoot } from './root-registration.ts'
import {
  WRITING_SETTINGS_NAMESPACE,
  createWritingMigration,
  decodeWritingPreferences,
} from './writing-settings.tsx'
import { decodeHostThemePreference, writeHostThemePreference, type HostThemeSync } from './client/theme.tsx'
import { decodeLocalePreference } from './client/settings-general.tsx'
import { bindLocalePreference } from './i18n/index.ts'
import { type ShellContext } from './client/shared.ts'
import { registerShellRoot } from './client/root.tsx'
import { provideEditorUiWorkspace } from './client/ui-workspace.ts'
import { bindOfficialConversation } from './client/chat.tsx'
import { COMMANDS_SERVICE, MESSAGE_CARDS_SERVICE, createCommandRegistry, createMessageCardRegistry } from './seats.ts'

export const name = 'dsh-editor-shell-client'
export const inject = [
  'slots', 'sessions', 'workspaces', 'connection', 'configForms', 'settingsSchema', 'remote',
  'remote.session', 'remote.settings', 'remote.credentials', 'remote.llm', 'remote.directoryPicker', 'remote.agentPresets',
  'uiSession', 'locale',
] as const

// Re-exports — keep the old monolith surface so existing callers and specs still work.
export {
  canSubmitComposer,
  claimInitialWorkspaceResume,
  consumeInitialWorkspaceResume,
  clampPanelWidth,
  createFlowWorkspace,
  errorMessage,
  hasRelocatableManuscriptFiles,
  hasVisibleWorkspaceEntries,
  isSessionMissing,
  isStaleFailure,
  isSuccessWorkbenchNote,
  canMoveTreeEntry,
  treeDropDirectory,
  treeMoveTargetDir,
  treeParentPath,
  isWorldbookPath,
  LatestRequestGate,
  orderTreeEntries,
  memoryAppliedNavigation,
  proposalAppliedNavigation,
  relocationFailureMessage,
  resumableConversationId,
  replaceWorldbookPaperText,
  safeRpcCall,
  searchSkippedText,
  shouldSubmitComposer,
  snapshotTimeLabel,
  startupResumeWorkspace,
  supportedWorkspaceTextPaths,
  TRANSIENT_STATUS_NOTE_MS,
  treeExpansionPaths,
  treeRevealDirectories,
  treeRowPadding,
  worldbookPaperProjection,
  workspaceOpenFailureMessage,
  workspaceFileContent,
  workspaceShortcut,
} from './client/shared.ts'
export type {
  ManagedWorkspace,
  PendingWorkspaceOpen,
  ProjectContextReceiptBundle,
  RequestTicket,
  RpcResult,
  ShellContext,
  TreeEntry,
  WorkspaceIntent,
  WorkspaceOpenState,
  WorkspaceShortcutAction,
} from './client/shared.ts'
export { THEME_STORAGE_KEY, THEME_VALUES, ThemeToggle, useTheme } from './client/theme.tsx'
export { ACCENT_STORAGE_KEY, ACCENT_VALUES, useAccent } from './client/theme.tsx'
export type { AccentValue, HostThemeSync, ThemeValue } from './client/theme.tsx'
export { ConfirmDialog, ConversationPresetPicker, NewProjectDialog, TextPromptDialog } from './client/dialogs.tsx'
export { Chat, ModelPicker, PendingCard, ProjectContextReceiptView, ProposalCard, bindOfficialConversation, conversationChatSource } from './client/chat.tsx'
export { Editor } from './client/editor.tsx'
export { FileContextMenu, Tree } from './client/sidebar.tsx'
export { DeepSeekWhaleMark, PaperStage, currentSession, useObservable } from './client/components.tsx'

type SettingsSlot = { get<T>(entryId: string): SettingsScope<T> }

export function apply(ctx: Context): void {
  const client = ctx as ShellContext & { configForms: SettingsSlot }
  const writingScope = client.configForms.get<NonNullable<ReturnType<typeof decodeWritingPreferences>>>(WRITING_SETTINGS_NAMESPACE)
  provideEditorUiWorkspace(client)
  bindOfficialConversation(client)
  const migrateWritingPreferences = createWritingMigration(writingScope, globalThis.localStorage)
  void migrateWritingPreferences()
  // Host chrome follows the host `ui-theme` preference; sync it so the
  // paper/ink toggle themes the host chrome too. Best-effort: when the scope
  // is read-only or the write fails, the local toggle still works.
  const localeScope = client.configForms.get<NonNullable<ReturnType<typeof decodeLocalePreference>>>('locale')
  bindLocalePreference(localeScope)
  const hostThemeScope = client.configForms.get<NonNullable<ReturnType<typeof decodeHostThemePreference>>>('ui-theme')
  const hostThemeSync: HostThemeSync = {
    read: () => hostThemeScope.getSnapshot().value?.preference,
    write: (preference) => writeHostThemePreference(hostThemeScope, preference),
    subscribe: (listener) => hostThemeScope.subscribe(listener),
  }
  const commands = createCommandRegistry()
  const messageCards = createMessageCardRegistry()
  ctx.provide(COMMANDS_SERVICE, commands)
  ctx.provide(MESSAGE_CARDS_SERVICE, messageCards)
  registerShellRoot(client, {
    writingScope,
    migrateWriting: migrateWritingPreferences,
    hostThemeSync,
    commands,
    registerRoot: (target: ShellContext, render: (props: unknown) => ReactNode) => registerRoot(target, render),
  })
}
