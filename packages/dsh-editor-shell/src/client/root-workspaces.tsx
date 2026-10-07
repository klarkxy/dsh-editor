import { isNovelIndexJobTitle } from '../novel-index.ts'
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import type { SessionFace, SessionId, WorkspaceId, WorkspaceView } from '../dsh-compat.ts'
import { WORKBENCH_RPC_CHANNEL, type ProjectInspectionResponse } from 'dsh-editor-workbench/contracts'
import { firstOpenDocumentPath } from '../project-files.ts'
import { errorMessage, resumableConversationId, safeRpcCall, type RpcResult, type ShellContext, type WorkspaceOpenState, type PendingWorkspaceOpen, type WorkspaceIntent, LatestRequestGate, claimInitialWorkspaceResume, consumeInitialWorkspaceResume, startupResumeWorkspace, hasRelocatableManuscriptFiles, isSessionMissing, relocationFailureMessage, supportedWorkspaceTextPaths, workspaceFileContent, workspaceOpenFailureMessage, createFlowWorkspace, cleanupFlowWorkspace as cleanupOwnedFlowWorkspace } from './shared.ts'
import { NewProjectDialog } from './dialogs.tsx'
import { ActivityDots, Input } from './ui/index.ts'
import { Button as ThemesButton, Flex, Text } from '@radix-ui/themes'
import { idleImportFlow, importReview, recoverImport, type ImportFlow, type ImportProbeView } from './import-flow.ts'
import { ImportDialog } from './import-dialog.tsx'
import { t } from '../i18n/index.ts'
import type { Dispatch, SetStateAction } from 'react'
import type { WorkspaceListState } from '../dsh-compat.ts'

export async function collectWorkspaceFiles(ctx: ShellContext, sessionId: string): Promise<string[]> {
  const queue = ['']
  const files: string[] = []
  while (queue.length) {
    const directory = queue.shift()!
    const listed = await safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: directory || '.',
    }))
    if (!listed.ok) throw new Error(errorMessage(listed))
    for (const entry of listed.value.entries ?? []) {
      if (entry.name.startsWith('.')) continue
      const child = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.type === 'directory') queue.push(child)
      else if (entry.type === 'file') files.push(child)
    }
  }
  return files
}

export async function verifyWorkspaceSession(ctx: ShellContext, sessionId: SessionId, knownFiles?: string[]): Promise<string | undefined> {
  const files = knownFiles ?? (await collectWorkspaceFiles(ctx, sessionId))
  const textFiles = supportedWorkspaceTextPaths(files)
  /* 根目录的项目规则文件是协作约定而非稿件：只有 AGENTS.md 时仍落在新建文件封面。 */
  const initialPath = firstOpenDocumentPath(textFiles)
  if (!initialPath) return undefined
  const read = await safeRpcCall<{ text: string; version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', {
    sessionId,
    path: initialPath,
  }))
  if (!read.ok) throw new Error(errorMessage(read))
  return initialPath
}

async function inspectRegisteredWorkspace(ctx: ShellContext, workspacePath: string): Promise<ProjectInspectionResponse> {
  const inspected = await safeRpcCall<ProjectInspectionResponse>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.inspect', { workspacePath }))
  if (!inspected.ok) throw new Error(errorMessage(inspected))
  return inspected.value
}

async function pingWorkspaceSession(ctx: ShellContext, sessionId: SessionId): Promise<RpcResult<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>> {
  return await safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: '.' }))
}

export function workspaceResumeExcludedIds(hostArchivedIds: readonly SessionId[], byId: Record<string, { title?: string } | undefined>): SessionId[] {
  const internalIndexIds = Object.entries(byId).filter(([, item]) => item && isNovelIndexJobTitle(item.title ?? '')).map(([id]) => id)
  return [...hostArchivedIds, ...internalIndexIds]
}

export async function connectUsableWorkspaceSession(
  ctx: ShellContext,
  workspaceId: WorkspaceId,
  preferred?: SessionId,
  authoritativeWorkspace?: WorkspaceView,
): Promise<SessionId> {
  if (preferred) {
    const listed = await pingWorkspaceSession(ctx, preferred)
    if (listed.ok) return preferred
    if (!isSessionMissing(listed)) throw new Error(errorMessage(listed))
  }
  const first = await ctx.uiWorkspace.connectWorkspace(workspaceId, authoritativeWorkspace)
  if (first !== preferred) {
    const listed = await pingWorkspaceSession(ctx, first)
    if (listed.ok) return first
    if (!isSessionMissing(listed)) throw new Error(errorMessage(listed))
  }
  await ctx.workspaces.archiveSession(first)
  let second = await ctx.uiWorkspace.connectWorkspace(workspaceId, authoritativeWorkspace)
  /* archive 后快照可能还挂着同一条空白会话；再拿到同一个 id 就强制新建，避免死循环。 */
  if (second === first) second = await ctx.uiWorkspace.createSession(workspaceId)
  if (second === first) throw new Error('session is not live')
  const retry = await pingWorkspaceSession(ctx, second)
  if (!retry.ok) throw new Error(isSessionMissing(retry) ? 'session is not live' : errorMessage(retry))
  return second
}

export async function verifyRelocatedWorkspaceSession(ctx: ShellContext, sessionId: SessionId): Promise<string> {
  const files = await collectWorkspaceFiles(ctx, sessionId)
  if (!hasRelocatableManuscriptFiles(files)) throw new Error('relocated workspace has no readable manuscript')
  /* 与打开作品同一套自动打开规则：任意可见 md/txt，排除 AGENTS.md；没有候选就失败。 */
  const initialPath = firstOpenDocumentPath(supportedWorkspaceTextPaths(files))
  if (!initialPath) throw new Error('relocated workspace has no readable manuscript')
  const read = await safeRpcCall<{ text: string; version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', {
    sessionId,
    path: initialPath,
  }))
  if (!read.ok) throw new Error(errorMessage(read))
  return initialPath
}

// Workspace registration, intent and import recovery share one request lifetime.
export function useRootWorkspaces({
  ctx, workspaces, selectedWorkspace, currentWorkspace, session, fileSession,
  workspaceOpen, setWorkspaceOpen, setPath, setWorkbenchNote,
  saveEditorBeforeAction, canLeaveAssistantDraft, setAssistantDraftDirty, setFocusMode,
}: {
  ctx: ShellContext
  workspaces: WorkspaceListState
  selectedWorkspace?: WorkspaceView
  currentWorkspace?: WorkspaceView
  session?: SessionFace
  fileSession?: SessionFace
  workspaceOpen: WorkspaceOpenState
  setWorkspaceOpen: Dispatch<SetStateAction<WorkspaceOpenState>>
  setPath: Dispatch<SetStateAction<string>>
  setWorkbenchNote: Dispatch<SetStateAction<string>>
  saveEditorBeforeAction(): Promise<boolean>
  canLeaveAssistantDraft(): Promise<boolean>
  setAssistantDraftDirty: Dispatch<SetStateAction<boolean>>
  setFocusMode: Dispatch<SetStateAction<boolean>>
}) {
  const current = session?.sessionId
  const [homeNote, setHomeNote] = useState('')
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [manualWorkspaceMode, setManualWorkspaceMode] = useState<'existing' | null>(null)
  const [manualWorkspacePath, setManualWorkspacePath] = useState('')
  const [newProject, setNewProject] = useState<{ busy: boolean; note: string } | null>(null)
  const [projectDirectory, setProjectDirectory] = useState<string>()
  const newProjectOpen = Boolean(newProject)
  useEffect(() => {
    if (!newProjectOpen) return
    let current = true
    setProjectDirectory(undefined)
    void safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.homeDirectory', {}))
      .then((result) => { if (current) setProjectDirectory(result.ok ? result.value.path : '') })
    return () => { current = false }
  }, [newProjectOpen, ctx.connection.rpc])
  const [relocatingWorkspaceId, setRelocatingWorkspaceId] = useState<WorkspaceId | undefined>()
  const [importFlow, setImportFlow] = useState<ImportFlow>(idleImportFlow)
  const [removeRecentTarget, setRemoveRecentTarget] = useState<WorkspaceView | null>(null)
  const temporaryFlowWorkspaces = useRef(new Set<string>())
  const temporarySourceWorkspaces = useRef(new Map<string, string>())
  const workspaceOpenGate = useRef(new LatestRequestGate()).current
  const pendingWorkspaceOpen = useRef<PendingWorkspaceOpen | null>(null)
  const initialWorkspaceResumeStarted = useRef(false)
  const workspaceMenuTrigger = useRef<HTMLButtonElement | null>(null)
  const workspaceMenuYields = useRef(false)
  const pathFallbackInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => setWorkspaceMenuOpen(false), [workspaceOpen.kind === 'ready' ? workspaceOpen.workspaceId : undefined])
  const finishWorkspaceOpen = async (
    pending: PendingWorkspaceOpen,
    sessionId: SessionId,
    initialPath: string | undefined,
  ) => {
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    let warning = pending.warning
    if (pending.replaceWorkspaceId && pending.replaceWorkspaceId !== pending.workspace.workspaceId) {
      try {
        await ctx.workspaces.delete(pending.replaceWorkspaceId)
      } catch {
        warning = warning ? t('note.oldEntryNotRemoved', { warning }) : t('note.newOpenedOldRemains')
      }
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    }
    /* File RPCs retain the workspace session independently of the visible Chat
     * selection, so reopening a conversation does not change the editor session. */
    const workspaceListState = ctx.workspaces.list.getSnapshot()
    const sessionListState = ctx.sessions.list.getSnapshot()
    const workspaceView = workspaceListState.items.find((item) => item.workspaceId === pending.workspace.workspaceId) ?? pending.workspace
    const selectedSessionId = resumableConversationId({
      sessionIds: workspaceView.sessionIds,
      byId: sessionListState.byId ?? {},
      archivedIds: workspaceResumeExcludedIds(workspaceListState.archivedSessionIds ?? [], sessionListState.byId ?? {}),
      fallback: sessionId,
    })
    await ctx.uiWorkspace.openWorkspaceSession(sessionId)
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    await ctx.uiWorkspace.openSession(selectedSessionId)
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    pendingWorkspaceOpen.current = null
    setPath(initialPath ?? '')
    setWorkspaceOpen({
      kind: 'ready',
      workspaceId: pending.workspace.workspaceId,
      sessionId: selectedSessionId,
      path: pending.workspace.path,
      warning,
    })
  }
  const prepareExistingWorkspace = async (pending: PendingWorkspaceOpen, sessionId: SessionId, knownTextFiles?: string[]) => {
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    const relocatedInitialPath = pending.replaceWorkspaceId
      ? await verifyRelocatedWorkspaceSession(ctx, sessionId)
      : undefined
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', { targetSessionId: sessionId }))
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (recovery.ok && recovery.value.state === 'recoverable') {
      const nextImportFlow = recoverImport(sessionId, pending.workspace.workspaceId, recovery.value)
      if (nextImportFlow.kind === 'recover') {
        pendingWorkspaceOpen.current = pending
        setWorkspaceOpen({
          kind: 'needs-recovery',
          workspaceId: pending.workspace.workspaceId,
          sessionId,
          path: pending.workspace.path,
          title: pending.workspace.title,
          recovery: 'import',
        })
        setImportFlow(nextImportFlow)
        return
      }
      pending.warning = t('note.brokenImportIgnored')
    }
    if (!recovery.ok) pending.warning = t('note.unverifiedImportIgnored')
    const initialPath = relocatedInitialPath ?? (await verifyWorkspaceSession(ctx, sessionId, knownTextFiles))
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (!initialPath) {
      const allFiles = await collectWorkspaceFiles(ctx, sessionId)
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      if (workspaceFileContent(allFiles) === 'unsupported') throw new Error('workspace has no supported text files')
      await finishWorkspaceOpen(pending, sessionId, undefined)
      return
    }
    await finishWorkspaceOpen(pending, sessionId, initialPath)
  }
  const prepareNewWorkspace = async (pending: PendingWorkspaceOpen, sessionId: SessionId) => {
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    // 只按可见文件判定：新建作品只预建了空目录，不能因此被认为“已有其他内容”
    const allFiles = await collectWorkspaceFiles(ctx, sessionId)
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    const content = workspaceFileContent(allFiles)
    if (content !== 'empty') {
      if (content === 'unsupported') throw new Error('new workspace folder contains unrelated files')
      pendingWorkspaceOpen.current = pending
      setWorkspaceOpen({
        kind: 'needs-intent', workspaceId: pending.workspace.workspaceId,
        path: pending.workspace.path, title: pending.workspace.title, intent: 'open',
        message: t('note.folderAlreadyWork'),
      })
      setHomeNote('')
      return
    }
    const initialized = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.init', { sessionId, newProject: true }))
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (!initialized.ok) throw new Error(errorMessage(initialized))
    const initialPath = await verifyWorkspaceSession(ctx, sessionId)
    await finishWorkspaceOpen(pending, sessionId, initialPath)
  }
  const openRegisteredWorkspace = async (workspace: WorkspaceView, sessionId?: SessionId, replaceWorkspaceId?: WorkspaceId) => {
    const ticket = workspaceOpenGate.begin(`workspace:${workspace.workspaceId}:${workspace.path}`)
    const pending: PendingWorkspaceOpen = { ticket, workspace, intent: 'open', registrationCreated: false, replaceWorkspaceId }
    pendingWorkspaceOpen.current = null
    setOpeningWorkspace(true)
    setHomeNote('')
    setWorkspaceOpen({ kind: 'checking', workspaceId: workspace.workspaceId, path: workspace.path, title: workspace.title })
    try {
      const registered = await ctx.workspaces.create({ path: workspace.path })
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending.workspace = registered
    } catch {
      if (!workspaceOpenGate.isCurrent(ticket)) return
      ctx.uiWorkspace.clearSession()
      const message = t('note.folderMoved')
      setWorkspaceOpen({ kind: 'needs-relocation', workspaceId: workspace.workspaceId, path: workspace.path, title: workspace.title, message })
      setHomeNote(message)
      setOpeningWorkspace(false)
      return
    }
    const current = pending.workspace
    let inspection: ProjectInspectionResponse
    try {
      inspection = await inspectRegisteredWorkspace(ctx, current.path)
    } catch {
      if (!workspaceOpenGate.isCurrent(ticket)) return
      const message = t('note.folderCheckFailed')
      setWorkspaceOpen({ kind: 'error', workspaceId: current.workspaceId, path: current.path, title: current.title, message })
      setHomeNote(message)
      setOpeningWorkspace(false)
      return
    }
    if (!workspaceOpenGate.isCurrent(ticket)) return
    if (!inspection.textFiles.length) {
      if (!inspection.hasVisibleEntries) {
        pendingWorkspaceOpen.current = pending
        setWorkspaceOpen({
          kind: 'needs-intent', workspaceId: current.workspaceId, path: current.path, title: current.title,
          intent: 'create', message: t('note.folderNotWork'),
        })
        setOpeningWorkspace(false)
        return
      }
      const message = t('error.noTextFiles')
      setWorkspaceOpen({ kind: 'error', workspaceId: current.workspaceId, path: current.path, title: current.title, message })
      setHomeNote(message)
      setOpeningWorkspace(false)
      return
    }
    try {
      const connectedSessionId = await connectUsableWorkspaceSession(ctx, current.workspaceId, sessionId, current)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending.sessionId = connectedSessionId
      await prepareExistingWorkspace(pending, connectedSessionId, inspection.textFiles)
    } catch (error) {
      if (!workspaceOpenGate.isCurrent(ticket)) return
      ctx.uiWorkspace.clearSession()
      const message = workspaceOpenFailureMessage(error)
      setWorkspaceOpen({ kind: 'error', workspaceId: current.workspaceId, path: current.path, title: current.title, message })
      setHomeNote(message)
    } finally {
      if (workspaceOpenGate.isCurrent(ticket)) setOpeningWorkspace(false)
    }
  }
  const openPickedWorkspace = async (path: string, intent: WorkspaceIntent, replaceWorkspaceId?: WorkspaceId) => {
    const ticket = workspaceOpenGate.begin(`path:${path}`)
    const replacedWorkspace = replaceWorkspaceId ? workspaces.items.find((item) => item.workspaceId === replaceWorkspaceId) : undefined
    let pending: PendingWorkspaceOpen | undefined
    let stage: 'registering' | 'inspecting' | 'connecting' | 'initializing' | 'verifying' = 'registering'
    setOpeningWorkspace(true)
    setHomeNote('')
    setWorkspaceOpen({ kind: 'checking', path, title: path })
    try {
      const registration = await createFlowWorkspace(ctx, path)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending = {
        ticket,
        workspace: registration.workspace,
        intent,
        registrationCreated: registration.created,
        replaceWorkspaceId,
      }
      stage = 'inspecting'
      const inspection = await inspectRegisteredWorkspace(ctx, registration.workspace.path)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      if (replaceWorkspaceId && !hasRelocatableManuscriptFiles(inspection.textFiles)) throw new Error('relocated workspace has no readable manuscript')
      if (intent === 'create' && inspection.hasVisibleEntries) {
        if (!inspection.textFiles.length) throw new Error('new workspace folder contains unrelated files')
        pendingWorkspaceOpen.current = pending
        setWorkspaceOpen({
          kind: 'needs-intent', workspaceId: registration.workspace.workspaceId,
          path: registration.workspace.path, title: registration.workspace.title, intent: 'open',
          message: t('note.folderAlreadyWork'),
        })
        setManualWorkspaceMode(null)
        setManualWorkspacePath('')
        return
      }
      if (intent === 'open' && !inspection.textFiles.length) {
        if (inspection.hasVisibleEntries) throw new Error('workspace has no supported text files')
        pendingWorkspaceOpen.current = pending
        setWorkspaceOpen({
          kind: 'needs-intent', workspaceId: registration.workspace.workspaceId,
          path: registration.workspace.path, title: registration.workspace.title, intent: 'create',
          message: t('note.folderNotWork'),
        })
        setManualWorkspaceMode(null)
        setManualWorkspacePath('')
        return
      }
      stage = 'connecting'
      const sessionId = await connectUsableWorkspaceSession(ctx, registration.workspace.workspaceId, undefined, registration.workspace)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending.sessionId = sessionId
      stage = intent === 'create' ? 'initializing' : 'verifying'
      if (intent === 'create') await prepareNewWorkspace(pending, sessionId)
      else await prepareExistingWorkspace(pending, sessionId, inspection.textFiles)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      setManualWorkspaceMode(null)
      setManualWorkspacePath('')
      setRelocatingWorkspaceId(undefined)
    } catch (error) {
      if (!workspaceOpenGate.isCurrent(ticket)) return
      let cleanupFailed = false
      if (pending?.registrationCreated && !pending.sessionId) {
        try { await ctx.workspaces.delete(pending.workspace.workspaceId) } catch { cleanupFailed = true }
      }
      if (!workspaceOpenGate.isCurrent(ticket)) return
      const detail = error instanceof Error ? error.message : ''
      const message = replaceWorkspaceId
        ? relocationFailureMessage(cleanupFailed)
        : /unrelated files/i.test(detail)
          ? t('note.newNeedsEmpty')
          : /no supported text files/i.test(detail)
            ? t('error.noTextFiles')
            : stage === 'registering'
              ? t('note.folderMissing')
              : stage === 'inspecting'
                ? t('note.folderCheckFailed')
              : stage === 'initializing'
                ? t('note.initFailedKeep')
                : workspaceOpenFailureMessage(error)
      setWorkspaceOpen(replacedWorkspace
        ? { kind: 'needs-relocation', workspaceId: replacedWorkspace.workspaceId, path: replacedWorkspace.path, title: replacedWorkspace.title, message }
        : { kind: 'error', path, title: path, message })
      setHomeNote(message)
      setManualWorkspaceMode((replaceWorkspaceId || intent === 'create') ? null : 'existing')
      setManualWorkspacePath((replaceWorkspaceId || intent === 'create') ? '' : path)
      if (replaceWorkspaceId) setRelocatingWorkspaceId(undefined)
    } finally {
      if (workspaceOpenGate.isCurrent(ticket)) setOpeningWorkspace(false)
    }
  }
  const continuePendingWorkspaceIntent = async () => {
    const pending = pendingWorkspaceOpen.current
    if (!pending || workspaceOpen.kind !== 'needs-intent' || pending.workspace.workspaceId !== workspaceOpen.workspaceId) return
    pending.intent = workspaceOpen.intent
    setOpeningWorkspace(true)
    setHomeNote('')
    setWorkspaceOpen({ kind: 'checking', workspaceId: pending.workspace.workspaceId, path: pending.workspace.path, title: pending.workspace.title })
    try {
      const sessionId = await connectUsableWorkspaceSession(ctx, pending.workspace.workspaceId, pending.sessionId, pending.workspace)
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      pending.sessionId = sessionId
      if (pending.intent === 'create') await prepareNewWorkspace(pending, sessionId)
      else await prepareExistingWorkspace(pending, sessionId)
    } catch (error) {
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      let cleanupFailed = false
      if (pending.registrationCreated && !pending.sessionId) {
        try { await ctx.workspaces.delete(pending.workspace.workspaceId) } catch { cleanupFailed = true }
      }
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      pendingWorkspaceOpen.current = null
      const message = pending.intent === 'create'
        ? t('note.initFailedCleanup', { cleanup: cleanupFailed ? t('note.cleanupRecentFailed') : '' })
        : `${workspaceOpenFailureMessage(error)}${cleanupFailed ? t('note.cleanupRecentFailed') : ''}`
      setWorkspaceOpen({ kind: 'error', path: pending.workspace.path, title: pending.workspace.title, message })
      setHomeNote(message)
    } finally {
      if (workspaceOpenGate.isCurrent(pending.ticket)) setOpeningWorkspace(false)
    }
  }
  const cancelPendingWorkspaceIntent = async () => {
    const pending = pendingWorkspaceOpen.current
    if (!pending || workspaceOpen.kind !== 'needs-intent') return
    workspaceOpenGate.begin('home')
    pendingWorkspaceOpen.current = null
    setOpeningWorkspace(true)
    let cleanupFailed = false
    if (pending.registrationCreated && !pending.sessionId) {
      try { await ctx.workspaces.delete(pending.workspace.workspaceId) } catch { cleanupFailed = true }
    }
    setOpeningWorkspace(false)
    setWorkspaceOpen({ kind: 'idle' })
    setManualWorkspaceMode(null)
    setManualWorkspacePath('')
    setHomeNote(cleanupFailed
      ? t('note.cancelledCleanupFailed')
      : pending.registrationCreated && pending.sessionId
        ? t('note.cancelledSessionKept')
        : '')
  }
  useEffect(() => {
    if (workspaceOpen.kind !== 'idle') return
    const workspace = startupResumeWorkspace(workspaces.items, selectedWorkspace)
    if (!workspace) return
    if (!claimInitialWorkspaceResume(initialWorkspaceResumeStarted)) return
    void openRegisteredWorkspace(workspace, session?.sessionId)
  }, [selectedWorkspace?.workspaceId, session?.sessionId, workspaceOpen.kind, workspaces.items])
  const relocateWorkspace = async (workspace: WorkspaceView) => {
    if (openingWorkspace) return
    let path: string | null
    try {
      path = await ctx.uiWorkspace.pickDirectory()
    } catch {
      setRelocatingWorkspaceId(workspace.workspaceId)
      setManualWorkspaceMode('existing')
      setManualWorkspacePath('')
      setHomeNote(t('note.pickerUnavailableRelocate'))
      return
    }
    if (!path) return
    await openPickedWorkspace(path, 'open', workspace.workspaceId)
  }
  const requestRemoveRecent = (workspace: WorkspaceView) => {
    if (openingWorkspace) return
    setRemoveRecentTarget(workspace)
  }
  const confirmRemoveRecent = async () => {
    const workspace = removeRecentTarget
    if (!workspace || openingWorkspace) return
    setRemoveRecentTarget(null)
    await removeRecentWorkspace(workspace)
  }
  const removeRecentWorkspace = async (workspace: WorkspaceView) => {
    if (openingWorkspace) return
    try {
      await ctx.workspaces.delete(workspace.workspaceId)
      workspaceOpenGate.begin('home')
      setWorkspaceOpen({ kind: 'idle' })
      setHomeNote(t('note.removedFromRecent'))
    } catch {
      setHomeNote(t('note.removeRecentFailed'))
    }
  }
  const startWorkspaceFromPicker = async () => {
    if (openingWorkspace) return
    setHomeNote('')
    setManualWorkspaceMode(null)
    setOpeningWorkspace(true)
    let picked: string | null
    try {
      picked = await ctx.uiWorkspace.pickDirectory()
    } catch {
      setOpeningWorkspace(false)
      setManualWorkspaceMode('existing')
      setHomeNote(t('note.pickerUnavailablePath'))
      if (session) {
        setWorkbenchNote(t('note.pickerUnavailablePath'))
        setWorkspaceMenuOpen(true)
      }
      return
    }
    if (!picked) {
      setOpeningWorkspace(false)
      return
    }
    await openPickedWorkspace(picked, 'open')
  }
  const pickWorkspaceDirectory = async () => {
    try {
      const path = await ctx.uiWorkspace.pickDirectory()
      if (!path) {
        const message = t('note.noFolderPicked')
        if (session) setWorkbenchNote(message)
        else setHomeNote(message)
        return
      }
      await openPickedWorkspace(path, 'open', relocatingWorkspaceId)
    } catch {
      const message = t('note.pickerUnavailablePath')
      if (session) setWorkbenchNote(message)
      else setHomeNote(message)
    }
  }
  const submitWorkspacePath = async (event: FormEvent) => {
    event.preventDefault()
    const path = manualWorkspacePath.trim()
    if (!path) {
      const message = t('note.enterFolderPath')
      if (session) setWorkbenchNote(message)
      else setHomeNote(message)
      return
    }
    await openPickedWorkspace(path, 'open', relocatingWorkspaceId)
  }
  const closePathFallback = () => {
    if (openingWorkspace) return
    setManualWorkspaceMode(null)
    setRelocatingWorkspaceId(undefined)
    setHomeNote('')
    if (session) setWorkbenchNote('')
  }
  const pathFallbackForm = manualWorkspaceMode ? <form className="path-fallback" onSubmit={submitWorkspacePath}>
    <Flex direction="column" gap="3">
      <Text as="label" size="2">
        <Flex direction="column" gap="1">
          <span>
            {t('home.pathLabel')}
          </span>
          <Input
            ref={pathFallbackInput}
            value={manualWorkspacePath}
            onChange={setManualWorkspacePath}
            placeholder={t('home.pathPlaceholder')}
            aria-label={t('home.pathLabel')}
            disabled={openingWorkspace} />
        </Flex>
      </Text>
      <Flex justify="end" gap="2" wrap="wrap">
        <ThemesButton
          variant="soft"
          color="gray"
          type="button"
          disabled={openingWorkspace}
          onClick={() => void pickWorkspaceDirectory()}>
          {t('home.chooseFolder')}
        </ThemesButton>
        <ThemesButton variant="solid" type="submit" disabled={openingWorkspace}>
          {openingWorkspace ? <Fragment>
            <ActivityDots />
            {t('home.opening')}
          </Fragment> : t('home.openThisFolder')}
        </ThemesButton>
        <ThemesButton variant="soft" color="gray" type="button" disabled={openingWorkspace} onClick={closePathFallback}>
          {t('common.cancel')}
        </ThemesButton>
      </Flex>
    </Flex>
  </form> : null
  const closeWorkspaceChrome = () => {
    setWorkspaceMenuOpen(false)
  }
  const leaveToHome = async () => {
    closeWorkspaceChrome()
    if (!(await saveEditorBeforeAction())) return
    if (!(await canLeaveAssistantDraft())) return
    /* 草稿确认期间作者可能继续输入：确认后重新保存并核对当前身份。 */
    if (!(await saveEditorBeforeAction())) return
    consumeInitialWorkspaceResume(initialWorkspaceResumeStarted)
    setAssistantDraftDirty(false)
    setFocusMode(false)
    workspaceOpenGate.begin('home')
    pendingWorkspaceOpen.current = null
    setWorkspaceOpen({ kind: 'idle' })
    ctx.uiWorkspace.clearSession()
  }
  const switchToWorkspace = async (id: WorkspaceId) => {
    closeWorkspaceChrome()
    if (!id || id === currentWorkspace?.workspaceId) return
    if (!(await saveEditorBeforeAction())) return
    if (!(await canLeaveAssistantDraft())) return
    /* 草稿确认期间作者可能继续输入：确认后重新保存并核对当前身份。 */
    if (!(await saveEditorBeforeAction())) return
    setAssistantDraftDirty(false)
    const workspace = workspaces.items.find((item) => item.workspaceId === id)
    if (!workspace) { setWorkbenchNote(t('note.entryChanged')); return }
    await openRegisteredWorkspace(workspace)
  }
  const startNewProject = async () => {
    closeWorkspaceChrome()
    if (openingWorkspace || newProject) return
    if (fileSession) {
      if (!(await saveEditorBeforeAction())) return
      if (!(await canLeaveAssistantDraft())) return
      /* 草稿确认期间作者可能继续输入：确认后重新保存并核对当前身份。 */
      if (!(await saveEditorBeforeAction())) return
      setAssistantDraftDirty(false)
    }
    setHomeNote('')
    setManualWorkspaceMode(null)
    setNewProject({ busy: false, note: '' })
  }
  const submitNewProject = async (title: string) => {
    if (!newProject || newProject.busy || openingWorkspace) return
    setNewProject({ busy: true, note: '' })
    setOpeningWorkspace(true)
    const created = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.createHome', { title }))
    if (!created.ok) {
      setOpeningWorkspace(false)
      setNewProject({ busy: false, note: errorMessage(created) })
      return
    }
    setNewProject(null)
    await openPickedWorkspace(created.value.path, 'create')
  }
  const closeNewProject = () => {
    if (newProject?.busy) return
    setNewProject(null)
  }
  const renderNewProjectDialog = () => <NewProjectDialog
    directory={projectDirectory}
    open={Boolean(newProject)}
    busy={newProject?.busy ?? false}
    note={newProject?.note ?? ''}
    returnFocusRef={workspaceMenuTrigger}
    onClose={closeNewProject}
    onCreate={(title: string) => void submitNewProject(title)} />
  const registerFlowWorkspace = (workspacePath: string) => createFlowWorkspace(ctx, workspacePath, temporaryFlowWorkspaces.current)
  const bindTemporarySource = (sessionId: string, workspaceId: string, created: boolean) => {
    if (created) temporarySourceWorkspaces.current.set(sessionId, workspaceId)
  }
  const cleanupFlowWorkspace = (workspaceId: string): Promise<boolean> => cleanupOwnedFlowWorkspace(ctx.workspaces, temporaryFlowWorkspaces.current, workspaceId)
  const cleanupTemporarySource = async (sessionId: string): Promise<boolean> => {
    const workspaceId = temporarySourceWorkspaces.current.get(sessionId)
    if (!workspaceId) return true
    const cleaned = await cleanupFlowWorkspace(workspaceId)
    if (cleaned) temporarySourceWorkspaces.current.delete(sessionId)
    return cleaned
  }
  const preserveFlowWorkspace = (workspaceId: string) => {
    temporaryFlowWorkspaces.current.delete(workspaceId)
  }
  const closeImportFlow = (_restoreFocus = true) => {
    setImportFlow(idleImportFlow)
  }
  const selectImportSource = async (targetSessionId: SessionId, targetWorkspaceId: WorkspaceId) => {
    const sourcePath = await ctx.uiWorkspace.pickDirectory()
    if (!sourcePath) { closeImportFlow(); return }
    let sourceSessionId: SessionId | undefined
    let createdSourceWorkspaceId: WorkspaceId | undefined
    try {
      const sourceRegistration = await registerFlowWorkspace(sourcePath)
      if (sourceRegistration.created) createdSourceWorkspaceId = sourceRegistration.workspace.workspaceId
      sourceSessionId = await ctx.uiWorkspace.connectWorkspace(sourceRegistration.workspace.workspaceId, sourceRegistration.workspace)
      bindTemporarySource(sourceSessionId, sourceRegistration.workspace.workspaceId, sourceRegistration.created)
      setImportFlow({ kind: 'working', message: t('note.importChecking') })
      const probe = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', {
        sourceSessionId, targetSessionId,
      }))
      if (!probe.ok || probe.value.state !== 'ready') {
        const sourceCleaned = await cleanupTemporarySource(sourceSessionId)
        closeImportFlow()
        const note = probe.ok ? probe.value.message ?? t('note.importDirectoryDenied') : t('note.importCheckFailed')
        setHomeNote(sourceCleaned ? note : t('note.tempEntryNotRemoved', { note }))
        return
      }
      setImportFlow(importReview(sourceSessionId, targetSessionId, targetWorkspaceId, probe.value))
    } catch (error) {
      const sourceCleaned = sourceSessionId
        ? await cleanupTemporarySource(sourceSessionId)
        : createdSourceWorkspaceId ? await cleanupFlowWorkspace(createdSourceWorkspaceId) : true
      if (!sourceCleaned) {
        closeImportFlow()
        setHomeNote(t('note.importStartCleanupFailed'))
        return
      }
      throw error
    }
  }
  const applyImportFlow = async () => {
    if (importFlow.kind !== 'review') return
    const flow = importFlow
    setImportFlow({ kind: 'working', message: t('note.importCopying') })
    const applied = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importApply', {
      sourceSessionId: flow.sourceSessionId, targetSessionId: flow.targetSessionId, probeToken: flow.probe.token,
    }))
    if (!applied.ok) {
      const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', { targetSessionId: flow.targetSessionId }))
      const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
      if (recovery.ok && recovery.value.state === 'recoverable') {
        setImportFlow(recoverImport(flow.targetSessionId, flow.targetWorkspaceId, recovery.value))
        if (!sourceCleaned) setHomeNote(t('note.importRecoverableCleanupFailed'))
      } else {
        const targetCleaned = await cleanupFlowWorkspace(flow.targetWorkspaceId)
        closeImportFlow(false)
        setHomeNote(sourceCleaned && targetCleaned ? t('note.importFailedRetry') : t('note.importFailedCleanup'))
      }
      return
    }
    const initialized = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.init', { sessionId: flow.targetSessionId, newProject: false }))
    const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
    preserveFlowWorkspace(flow.targetWorkspaceId)
    if (!initialized.ok) {
      closeImportFlow(false)
      setHomeNote(sourceCleaned ? t('note.importDoneInitFailed') : t('note.importDoneInitAndCleanupFailed'))
      return
    }
    try {
      const pending = pendingWorkspaceOpen.current
      const initialPath = await verifyWorkspaceSession(ctx, flow.targetSessionId as SessionId)
      if (pending && pending.workspace.workspaceId === flow.targetWorkspaceId) {
        await finishWorkspaceOpen(pending, flow.targetSessionId as SessionId, initialPath)
      } else {
        const workspace = workspaces.items.find((item) => item.workspaceId === flow.targetWorkspaceId)
        if (workspace) await openRegisteredWorkspace(workspace, flow.targetSessionId as SessionId)
      }
      closeImportFlow(false)
      if (!sourceCleaned) setHomeNote(t('note.importDoneSourceRemains'))
    } catch {
      closeImportFlow(false)
      setHomeNote(t('note.importDoneUnreadable'))
    }
  }
  const cleanupImportFlow = async () => {
    if (importFlow.kind === 'recover') {
      setImportFlow({
        kind: 'cleanup-confirm',
        targetSessionId: importFlow.targetSessionId,
        targetWorkspaceId: importFlow.targetWorkspaceId,
        receiptId: importFlow.probe.receiptId!,
      })
      return
    }
    if (importFlow.kind !== 'cleanup-confirm') return
    const flow = importFlow
    setImportFlow({ kind: 'working', message: t('note.importCleaning') })
    const cleaned = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importCleanup', {
      targetSessionId: flow.targetSessionId,
      receiptId: flow.receiptId,
    }))
    if (cleaned.ok) {
      if (current === flow.targetSessionId) ctx.uiWorkspace.clearSession()
      const targetCleaned = await cleanupFlowWorkspace(flow.targetWorkspaceId)
      if (pendingWorkspaceOpen.current?.workspace.workspaceId === flow.targetWorkspaceId) {
        workspaceOpenGate.begin('home')
        pendingWorkspaceOpen.current = null
        setWorkspaceOpen({ kind: 'idle' })
      }
      closeImportFlow()
      setHomeNote(targetCleaned ? t('note.importCleaned') : t('note.importCleanedCleanupFailed'))
      return
    }
    const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', { targetSessionId: flow.targetSessionId }))
    if (recovery.ok && recovery.value.state === 'recoverable') {
      setImportFlow(recoverImport(flow.targetSessionId, flow.targetWorkspaceId, {
        ...recovery.value,
        message: recovery.value.message ?? t('note.importCleanFailed'),
      }))
      return
    }
    if (current === flow.targetSessionId) ctx.uiWorkspace.clearSession()
    closeImportFlow()
    setHomeNote(t('note.importCleanFailed'))
  }
  const cancelImportFlow = async () => {
    const flow = importFlow
    let cleaned = true
    if (flow.kind === 'review') {
      const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
      const targetCleaned = await cleanupFlowWorkspace(flow.targetWorkspaceId)
      cleaned = sourceCleaned && targetCleaned
    }
    if ((flow.kind === 'recover' || flow.kind === 'cleanup-confirm') && current === flow.targetSessionId) ctx.uiWorkspace.clearSession()
    if (flow.kind !== 'idle' && flow.kind !== 'working' && pendingWorkspaceOpen.current?.workspace.workspaceId === flow.targetWorkspaceId) {
      workspaceOpenGate.begin('home')
      pendingWorkspaceOpen.current = null
      setWorkspaceOpen({ kind: 'idle' })
    }
    closeImportFlow()
    if (!cleaned) setHomeNote(t('note.importCancelledCleanupFailed'))
  }
  const renderImportDialog = () => <ImportDialog
    flow={importFlow}
    onCancel={() => void cancelImportFlow()}
    onApply={() => void applyImportFlow()}
    onContinue={() => importFlow.kind === 'recover'
      ? void selectImportSource(importFlow.targetSessionId as SessionId, importFlow.targetWorkspaceId as WorkspaceId).catch(() => closeImportFlow())
      : undefined}
    onCleanup={() => void cleanupImportFlow()} />
  const openAnotherWorkspace = async () => {
    closeWorkspaceChrome()
    if (!(await saveEditorBeforeAction())) return
    if (!(await canLeaveAssistantDraft())) return
    /* 草稿确认期间作者可能继续输入：确认后重新保存并核对当前身份。 */
    if (!(await saveEditorBeforeAction())) return
    setAssistantDraftDirty(false)
    await startWorkspaceFromPicker()
  }

  return {
    homeNote, openingWorkspace, workspaceMenuOpen, setWorkspaceMenuOpen,
    manualWorkspaceMode, newProject, pathFallbackInput, pathFallbackForm,
    workspaceMenuTrigger, workspaceMenuYields, removeRecentTarget, setRemoveRecentTarget,
    openRegisteredWorkspace, continuePendingWorkspaceIntent, cancelPendingWorkspaceIntent,
    relocateWorkspace, requestRemoveRecent, confirmRemoveRecent, startWorkspaceFromPicker,
    closePathFallback, closeWorkspaceChrome, leaveToHome, switchToWorkspace,
    startNewProject, openAnotherWorkspace, renderNewProjectDialog, renderImportDialog,
  }
}
