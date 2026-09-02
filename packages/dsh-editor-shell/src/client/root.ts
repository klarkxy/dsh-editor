import {
  createElement as e,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-connection/client'
import {
  WORKBENCH_RPC_CHANNEL,
  type ChapterStatus,
  type ProjectContextReceiptBundle,
  type ProjectInspectionResponse,
  type ProjectOverview,
} from 'dsh-editor-workbench/contracts'
import { normalizeAuthorPreferences } from '../author-preferences.ts'
import { documentTemplate, manuscriptGroupPath, nextChapterPath, nextDocumentPath, sortChapterPaths, type DocumentKind } from '../project-files.ts'
import { registerRoot } from '../root-registration.ts'
import { writingPreferences, createWritingMigration, decodeWritingPreferences, registerWritingSettings, WRITING_SETTINGS_NAMESPACE, type WritingPreferences } from '../writing-settings.ts'
import { redesignedStyles } from '../styles.ts'
import { createDialogDirectory, errorMessage, isStaleFailure, safeRpcCall, storedPanelOpen, storedPanelWidth, workspaceShortcut, type RpcResult, type ShellContext, type WorkspaceOpenState, type PendingWorkspaceOpen, type WorkspaceIntent, LatestRequestGate, claimInitialWorkspaceResume, hasRelocatableManuscriptFiles, hasVisibleWorkspaceEntries, isSessionMissing, proposalAppliedNavigation, relocationFailureMessage, supportedWorkspaceTextPaths, workspaceOpenFailureMessage, createFlowWorkspace } from './shared.ts'
import { currentSession, DeepSeekWhaleMark, PaperStage, PanelResizer, useObservable } from './components.ts'
import { ConfirmDialog, CreateDocumentDialog, NewProjectDialog, TextPromptDialog } from './dialogs.ts'
import { ThemeToggle, useTheme } from './theme.ts'
import { Tree, FileContextMenu } from './sidebar.ts'
import { Editor } from './editor.ts'
import { Chat } from './chat.ts'
import { buildNovelIndexPrompt } from '../novel-index.ts'

const SIDEBAR_DEFAULT = 248
const SIDEBAR_MIN = 196
const SIDEBAR_MAX = 420
const ASSISTANT_DEFAULT = 384
const ASSISTANT_MIN = 300
const ASSISTANT_MAX = 560

type CreateRequest = { kind: DocumentKind | 'group'; directory: string }
type FileSession = NonNullable<NonNullable<ReturnType<ShellContext['sessions']['binding']>>['session']> | undefined

type SearchHit = { path: string; line: number; column: number; start: number; end: number; excerpt: string; version: string }

function rpcFailureText(result: RpcResult): string {
  if (result.ok) return ''
  return `${result.error.code ?? ''} ${result.error.message ?? ''}`
}

async function collectWorkspaceFiles(ctx: ShellContext, sessionId: string): Promise<string[]> {
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

async function verifyWorkspaceSession(ctx: ShellContext, sessionId: SessionId): Promise<string | undefined> {
  const files = await collectWorkspaceFiles(ctx, sessionId)
  const textFiles = supportedWorkspaceTextPaths(files)
  const initialPath = sortChapterPaths(textFiles)[0] ?? textFiles[0]
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

async function connectUsableWorkspaceSession(
  ctx: ShellContext,
  workspaceId: WorkspaceId,
  preferred?: SessionId,
): Promise<SessionId> {
  if (preferred) {
    const listed = await pingWorkspaceSession(ctx, preferred)
    if (listed.ok) return preferred
    if (!isSessionMissing(listed)) throw new Error(errorMessage(listed))
  }
  const first = await ctx.workspaces.connectWorkspace(workspaceId)
  if (first !== preferred) {
    const listed = await pingWorkspaceSession(ctx, first)
    if (listed.ok) return first
    if (!isSessionMissing(listed)) throw new Error(errorMessage(listed))
  }
  await ctx.workspaces.archiveSession(first)
  const second = await ctx.workspaces.connectWorkspace(workspaceId)
  if (second === first) throw new Error('session is not live')
  const retry = await pingWorkspaceSession(ctx, second)
  if (!retry.ok) throw new Error(isSessionMissing(retry) ? 'session is not live' : errorMessage(retry))
  return second
}

async function verifyRelocatedWorkspaceSession(ctx: ShellContext, sessionId: SessionId): Promise<string> {
  const files = await collectWorkspaceFiles(ctx, sessionId)
  if (!hasRelocatableManuscriptFiles(files)) throw new Error('relocated workspace has no readable manuscript')
  const initialPath = sortChapterPaths(files)[0]!
  const read = await safeRpcCall<{ text: string; version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', {
    sessionId,
    path: initialPath,
  }))
  if (!read.ok) throw new Error(errorMessage(read))
  return initialPath
}

function Root({ ctx, writingScope, settingsControl }: {
  ctx: ShellContext
  writingScope: SettingsScope<WritingPreferences>
  settingsControl: ReactNode
}) {
  const sessions = useObservable(ctx.sessions.list)
  const workspaces = useObservable(ctx.workspaces.list)
  const session = currentSession(ctx)
  const current = sessions.current
  const selectedWorkspace = workspaces.items.find((workspace) => current && workspace.sessionIds.includes(current))
    ?? workspaces.items.find((workspace) => workspace.path === (current ? sessions.byId[current]?.cwd : undefined))
  const [workspaceOpen, setWorkspaceOpen] = useState<WorkspaceOpenState>({ kind: 'idle' })
  const fileSessionId = workspaceOpen.kind === 'ready' ? workspaceOpen.sessionId : undefined
  const fileSession: FileSession | undefined = fileSessionId ? ctx.sessions.binding(fileSessionId)?.session : undefined
  const fileSessionIdRef = useRef<SessionId | undefined>(fileSessionId)
  fileSessionIdRef.current = fileSessionId
  const openWorkspaceId = workspaceOpen.kind === 'ready' ? workspaceOpen.workspaceId : undefined
  const currentWorkspace = workspaceOpen.kind === 'ready'
    ? workspaces.items.find((workspace) => workspace.workspaceId === workspaceOpen.workspaceId) ?? selectedWorkspace
    : selectedWorkspace
  const writingSnapshot = useObservable(writingScope)
  const writing = writingPreferences(writingSnapshot, globalThis.localStorage)
  const [path, setPath] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [workbenchNote, setWorkbenchNote] = useState('')
  const [treeRevision, setTreeRevision] = useState(0)
  const [treeExpansionPath, setTreeExpansionPath] = useState('')
  const [contentRevision, setContentRevision] = useState(0)
  const [homeNote, setHomeNote] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false)
  const [manualWorkspaceMode, setManualWorkspaceMode] = useState<'existing' | null>(null)
  const [manualWorkspacePath, setManualWorkspacePath] = useState('')
  const [newProject, setNewProject] = useState<{ busy: boolean; note: string } | null>(null)
  const [relocatingWorkspaceId, setRelocatingWorkspaceId] = useState<WorkspaceId | undefined>()
  const [sidebarOpen, setSidebarOpen] = useState(() => storedPanelOpen('dsh-editor.layout.sidebar-open', true))
  const [sidebarWidth, setSidebarWidth] = useState(() => storedPanelWidth('dsh-editor.layout.sidebar-width', SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX))
  const [assistantOpen, setAssistantOpen] = useState(() => storedPanelOpen('dsh-editor.layout.assistant-open', true))
  const [assistantWidth, setAssistantWidth] = useState(() => storedPanelWidth('dsh-editor.layout.assistant-width', ASSISTANT_DEFAULT, ASSISTANT_MIN, ASSISTANT_MAX))
  const [assistantDraftDirty, setAssistantDraftDirty] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState<{ resolve(value: boolean): void } | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [chatFocusNonce, setChatFocusNonce] = useState(0)
  const [overview, setOverview] = useState<ProjectOverview | null | undefined>(null)
  const [overviewBusy, setOverviewBusy] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [overviewRevision, setOverviewRevision] = useState(0)
  const [statusBusy, setStatusBusy] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [fileMenu, setFileMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [managePath, setManagePath] = useState<string | null>(null)
  const [manageBusy, setManageBusy] = useState(false)
  const [manageNote, setManageNote] = useState('')
  const [theme, setTheme] = useTheme()
  useEffect(() => () => leaveConfirm?.resolve(false), [leaveConfirm])
  const canLeaveAssistantDraft = async (): Promise<boolean> => {
    if (!assistantDraftDirty) return true
    return await new Promise<boolean>((resolve) => setLeaveConfirm({ resolve }))
  }
  const resolveLeaveConfirm = (value: boolean) => {
    leaveConfirm?.resolve(value)
    setLeaveConfirm(null)
  }
  const settingsControlRef = useRef<HTMLSpanElement | null>(null)
  const openSettings = () => {
    const trigger = settingsControlRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
    if (trigger) { trigger.click(); return }
    if (session) setWorkbenchNote('设置当前不可用，请稍后重试。')
    else setHomeNote('设置当前不可用，请稍后重试。')
  }
  const overviewRequestGate = useRef(new LatestRequestGate()).current
  const workspaceOpenGate = useRef(new LatestRequestGate()).current
  const pendingWorkspaceOpen = useRef<PendingWorkspaceOpen | null>(null)
  const initialWorkspaceResumeStarted = useRef(false)
  const createReturnFocus = useRef<HTMLElement | null>(null)
  const fileManageReturnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => { document.title = 'DSH Editor' }, [])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.sidebar-open', String(sidebarOpen)) } catch { /* View preferences remain optional. */ }
  }, [sidebarOpen])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.assistant-open', String(assistantOpen)) } catch { /* View preferences remain optional. */ }
  }, [assistantOpen])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.sidebar-width', String(sidebarWidth)) } catch { /* View preferences remain optional. */ }
  }, [sidebarWidth])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.assistant-width', String(assistantWidth)) } catch { /* View preferences remain optional. */ }
  }, [assistantWidth])
  useEffect(() => {
    const hotkey = (event: globalThis.KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const action = workspaceShortcut(event)
      if (!action || event.repeat) return
      if (action !== 'settings' && !session) return
      event.preventDefault()
      if (action === 'settings') { void openSettings(); return }
      if (action === 'toggle-sidebar') {
        if (focusMode) { setFocusMode(false); setSidebarOpen(true) } else setSidebarOpen((value) => !value)
        return
      }
      if (action === 'toggle-assistant') {
        if (focusMode) { setFocusMode(false); setAssistantOpen(true) } else setAssistantOpen((value) => !value)
        return
      }
      if (action === 'toggle-focus') { setFocusMode((value) => !value); return }
      if (action === 'focus-assistant') {
        setFocusMode(false)
        setAssistantOpen(true)
        setChatFocusNonce((value) => value + 1)
        return
      }
      if (editorDirty) return
      const buttons = document.querySelectorAll<HTMLButtonElement>('[aria-label="章节导航"] button')
      const button = action === 'previous-chapter' ? buttons[0] : buttons[1]
      if (button && !button.disabled) button.click()
    }
    globalThis.addEventListener('keydown', hotkey, true)
    return () => globalThis.removeEventListener('keydown', hotkey, true)
  }, [editorDirty, focusMode, session?.sessionId])
  useEffect(() => {
    if (!chatFocusNonce || !assistantOpen || focusMode) return
    globalThis.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus(), 0)
  }, [assistantOpen, chatFocusNonce, focusMode])
  useEffect(() => {
    if (!openWorkspaceId) setPath('')
    setFiles([]); setWorkbenchNote(''); setEditorDirty(false); setTreeExpansionPath('')
    setFileMenu(null); setManagePath(null); setManageNote('')
    setOverview(null); setOverviewError(''); setOverviewBusy(false); setStatusBusy(false); setWorkspaceMenuOpen(false); setWorkspaceSwitcherOpen(false)
  }, [openWorkspaceId])
  useEffect(() => {
    if (!fileSession) { setFiles([]); return }
    let live = true
    void collectWorkspaceFiles(ctx, fileSession.sessionId).then((paths) => {
      if (live) setFiles(sortChapterPaths(paths))
    }).catch(() => {
      if (live) { setFiles([]); setWorkbenchNote('未能读取完整章节顺序。') }
    })
    return () => { live = false }
  }, [ctx.connection.rpc, fileSession?.sessionId, treeRevision])
  const loadOverview = async () => {
    if (!fileSession) return
    const ticket = overviewRequestGate.begin(fileSession.sessionId)
    setOverviewBusy(true); setOverviewError('')
    const result = await safeRpcCall<ProjectOverview>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.overview', { sessionId: fileSession.sessionId }))
    if (!overviewRequestGate.isCurrent(ticket)) return
    setOverviewBusy(false)
    if (!result.ok) {
      setOverview(null)
      setOverviewError(/invalid|status|状态/i.test(rpcFailureText(result))
        ? '章节状态文件已损坏，为避免覆盖数据，状态修改已停用。正文仍可正常编辑和导出。'
        : errorMessage(result))
      return
    }
    setOverview(result.value)
  }
  useEffect(() => {
    if (!fileSession) { setOverview(null); setOverviewBusy(false); return }
    void loadOverview()
  }, [ctx.connection.rpc, fileSession?.sessionId, treeRevision, contentRevision, overviewRevision])
  const updateChapterStatus = async (chapterPath: string, status: ChapterStatus) => {
    if (!fileSession || !overview || statusBusy) return
    const requestSessionId = fileSession.sessionId
    const ticket = overviewRequestGate.begin(requestSessionId)
    setStatusBusy(true); setOverviewError('')
    const result = await safeRpcCall<ProjectOverview>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'chapter.statusSet', {
      sessionId: fileSession.sessionId,
      path: chapterPath,
      status,
      expectedStatusRevision: overview.statusRevision,
    }))
    if (fileSessionIdRef.current !== requestSessionId) return
    setStatusBusy(false)
    if (!overviewRequestGate.isCurrent(ticket)) {
      setOverviewRevision((value) => value + 1)
      return
    }
    if (!result.ok) {
      setOverviewError(isStaleFailure(result) ? '作品进度已在别处变化，已重新读取；请再次选择状态。' : errorMessage(result))
      setOverviewRevision((value) => value + 1)
      return
    }
    setOverview(result.value)
    setWorkbenchNote(`已更新章节状态`)
  }
  const openDocument = (nextPath: string) => {
    if (editorDirty && nextPath !== path) {
      setWorkbenchNote('请先保存当前文档。')
      return
    }
    setWorkbenchNote('')
    setPath(nextPath)
  }
  const openFileMenu = (selectedPath: string, position: { x: number; y: number }) => {
    if (editorDirty) { setWorkbenchNote('请先保存当前文档。'); return }
    setWorkbenchNote('')
    setFileMenu({ path: selectedPath, x: position.x, y: position.y })
  }
  const openRenameDialog = (selectedPath: string) => {
    if (editorDirty) { setWorkbenchNote('请先保存当前文档。'); return }
    fileManageReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFileMenu(null)
    setManagePath(selectedPath)
    setManageNote('')
  }
  const closeRenameDialog = () => {
    if (manageBusy) return
    const target = fileManageReturnFocus.current
    setManagePath(null)
    setManageNote('')
    if (target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const renameManaged = async (name: string) => {
    if (!fileSession || !managePath || manageBusy) return
    setManageBusy(true); setManageNote('')
    const read = await safeRpcCall<{ version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: fileSession.sessionId, path: managePath }))
    setManageBusy(false)
    if (!read.ok) { setManageNote(errorMessage(read)); return }
    const renamed = await safeRpcCall<{ path: string; metadataWarning?: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'file.rename', {
      sessionId: fileSession.sessionId,
      path: managePath,
      newName: name,
      expectedVersion: read.value.version,
    }))
    if (!renamed.ok) { setManageNote(errorMessage(renamed)); return }
    if (path === managePath) setPath(renamed.value.path)
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(renamed.value.metadataWarning ? `已重命名为 ${renamed.value.path}；${renamed.value.metadataWarning}` : `已重命名为 ${renamed.value.path}`)
    setManagePath(null)
  }
  const openCreateDialog = (kind: DocumentKind | 'group', directory?: string) => {
    if (!fileSession) return
    if (editorDirty) { setCreateNote('请先保存当前文档。'); return }
    createReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCreateNote('')
    setCreateRequest({ kind, directory: createDialogDirectory(kind, directory) })
  }
  const closeCreateDialog = () => {
    if (createBusy) return
    const target = createReturnFocus.current
    setCreateRequest(null)
    setCreateNote('')
    globalThis.setTimeout(() => target?.focus(), 0)
  }
  const create = async (title: string) => {
    if (!fileSession || !createRequest) return
    const request = createRequest
    setCreateBusy(true)
    setCreateNote('')
    if (request.kind === 'group') {
      const groupPath = manuscriptGroupPath(title)
      const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'structure.groupCreate', {
        sessionId: fileSession.sessionId,
        path: groupPath,
      }))
      setCreateBusy(false)
      if (!result.ok) { setCreateNote(errorMessage(result)); return }
      setCreateRequest(null)
      setTreeRevision((old) => old + 1)
      setWorkbenchNote(`已创建 ${result.value.path}`)
      return
    }
    const kind: DocumentKind = request.kind
    let workspaceFiles: string[]
    try {
      workspaceFiles = await collectWorkspaceFiles(ctx, fileSession.sessionId)
    } catch {
      setCreateBusy(false)
      setCreateNote('未能读取完整目录，请重试。')
      return
    }
    const file = kind === 'chapter'
      ? nextChapterPath(workspaceFiles, request.directory)
      : nextDocumentPath(kind, title, workspaceFiles)
    const result = await safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'file.create', {
      sessionId: fileSession.sessionId,
      path: file,
      text: documentTemplate(kind, title),
    }))
    setCreateBusy(false)
    if (!result.ok) { setCreateNote(errorMessage(result)); return }
    setCreateRequest(null)
    openDocument(file)
    setTreeRevision((old) => old + 1)
  }
  const triggerExistingIndex = (workspaceId: WorkspaceId, sessionId: SessionId) => {
    void Promise.resolve().then(async () => {
      const prepared = await ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.prepareIndex', { sessionId }) as RpcResult
      if (!prepared.ok) throw new Error(errorMessage(prepared))
      const indexedSession = ctx.sessions.binding(sessionId)?.session
      if (!indexedSession) throw new Error('session unavailable')
      const result = await indexedSession.prompt([{ type: 'text', text: buildNovelIndexPrompt() }], 'queue')
      if (!result.ok) throw new Error('prompt rejected')
      void workspaceId
    }).catch(() => undefined)
  }
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
        warning = warning ? `${warning} 旧的最近入口未能移除。` : '新位置已打开，但旧的最近入口未能移除。'
      }
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    }
    pendingWorkspaceOpen.current = null
    setPath(initialPath ?? '')
    setWorkspaceOpen({
      kind: 'ready',
      workspaceId: pending.workspace.workspaceId,
      sessionId,
      path: pending.workspace.path,
      warning,
    })
    ctx.sessions.open(sessionId)
  }
  const prepareExistingWorkspace = async (pending: PendingWorkspaceOpen, sessionId: SessionId) => {
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    const relocatedInitialPath = pending.replaceWorkspaceId
      ? await verifyRelocatedWorkspaceSession(ctx, sessionId)
      : undefined
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    const initialPath = relocatedInitialPath ?? await verifyWorkspaceSession(ctx, sessionId)
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (!initialPath) {
      const root = await safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: '.' }))
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      if (!root.ok) throw new Error(errorMessage(root))
      if (hasVisibleWorkspaceEntries(root.value.entries ?? [])) throw new Error('workspace has no supported text files')
      pendingWorkspaceOpen.current = pending
      setWorkspaceOpen({
        kind: 'needs-intent', workspaceId: pending.workspace.workspaceId,
        path: pending.workspace.path, title: pending.workspace.title, intent: 'create',
        message: '这个文件夹还没有可打开的 Markdown 或 TXT 作品文件。',
      })
      setHomeNote('')
      return
    }
    await finishWorkspaceOpen(pending, sessionId, initialPath)
  }
  const prepareNewWorkspace = async (pending: PendingWorkspaceOpen, sessionId: SessionId) => {
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    const root = await safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: '.' }))
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (!root.ok) throw new Error(errorMessage(root))
    if (hasVisibleWorkspaceEntries(root.value.entries ?? [])) {
      const files = supportedWorkspaceTextPaths(await collectWorkspaceFiles(ctx, sessionId))
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      if (!files.length) throw new Error('new workspace folder contains unrelated files')
      pendingWorkspaceOpen.current = pending
      setWorkspaceOpen({
        kind: 'needs-intent', workspaceId: pending.workspace.workspaceId,
        path: pending.workspace.path, title: pending.workspace.title, intent: 'open',
        message: '这个文件夹已经包含 Markdown 或 TXT 作品文件，不会按新作品初始化。',
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
      ctx.sessions.clear()
      const message = '原作品文件夹已移动或无法读取。'
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
      const message = '作品目录检查未能完成，请重试。'
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
          intent: 'create', message: '这个文件夹还没有可打开的 Markdown 或 TXT 作品文件。',
        })
        setOpeningWorkspace(false)
        return
      }
      const message = '没有找到可打开的 Markdown 或 TXT 作品文件。'
      setWorkspaceOpen({ kind: 'error', workspaceId: current.workspaceId, path: current.path, title: current.title, message })
      setHomeNote(message)
      setOpeningWorkspace(false)
      return
    }
    try {
      const connectedSessionId = await connectUsableWorkspaceSession(ctx, current.workspaceId, sessionId)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending.sessionId = connectedSessionId
      await prepareExistingWorkspace(pending, connectedSessionId)
    } catch (error) {
      if (!workspaceOpenGate.isCurrent(ticket)) return
      ctx.sessions.clear()
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
          message: '这个文件夹已经包含 Markdown 或 TXT 作品文件，不会按新作品初始化。',
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
          message: '这个文件夹还没有可打开的 Markdown 或 TXT 作品文件。',
        })
        setManualWorkspaceMode(null)
        setManualWorkspacePath('')
        return
      }
      stage = 'connecting'
      const sessionId = await connectUsableWorkspaceSession(ctx, registration.workspace.workspaceId)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending.sessionId = sessionId
      stage = intent === 'create' ? 'initializing' : 'verifying'
      if (intent === 'create') await prepareNewWorkspace(pending, sessionId)
      else await prepareExistingWorkspace(pending, sessionId)
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
          ? '新作品必须使用空文件夹；当前文件夹已有其他内容。'
          : /no supported text files/i.test(detail)
            ? '没有找到可打开的 Markdown 或 TXT 作品文件。'
            : stage === 'registering'
              ? '作品文件夹不存在或无法读取，请重新选择。'
              : stage === 'inspecting'
                ? '作品目录检查未能完成，请重试。'
              : stage === 'initializing'
                ? '新作品初始化未能完成；已有文件不会被覆盖。'
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
      const sessionId = await connectUsableWorkspaceSession(ctx, pending.workspace.workspaceId, pending.sessionId)
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
        ? `新作品初始化未能完成；已有文件不会被覆盖。${cleanupFailed ? ' 最近作品入口未能自动移除。' : ''}`
        : `${workspaceOpenFailureMessage(error)}${cleanupFailed ? ' 最近作品入口未能自动移除。' : ''}`
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
      ? '已取消，但本次新增的最近作品入口未能自动移除。'
      : pending.registrationCreated && pending.sessionId
        ? '已取消；作品会话已经建立，因此最近作品入口已保留。'
        : '')
  }
  useEffect(() => {
    if (workspaceOpen.kind !== 'idle' || !selectedWorkspace || !session) return
    if (!claimInitialWorkspaceResume(initialWorkspaceResumeStarted)) return
    void openRegisteredWorkspace(selectedWorkspace, session.sessionId)
  }, [selectedWorkspace?.workspaceId, session?.sessionId, workspaceOpen.kind])
  const relocateWorkspace = async (workspace: WorkspaceView) => {
    if (openingWorkspace) return
    let path: string | null
    try {
      path = await ctx.workspaces.pickDirectory()
    } catch {
      setRelocatingWorkspaceId(workspace.workspaceId)
      setManualWorkspaceMode('existing')
      setManualWorkspacePath('')
      setHomeNote('目录选择器暂时不可用，请直接输入作品的新位置。')
      return
    }
    if (!path) return
    await openPickedWorkspace(path, 'open', workspace.workspaceId)
  }
  const removeBrokenWorkspace = async (workspace: WorkspaceView) => {
    if (openingWorkspace) return
    try {
      await ctx.workspaces.delete(workspace.workspaceId)
      workspaceOpenGate.begin('home')
      setWorkspaceOpen({ kind: 'idle' })
      setHomeNote('已从最近移除；磁盘中的作品未被删除。')
    } catch {
      setHomeNote('最近入口未能移除，请重试。')
    }
  }
  const startWorkspaceFromPicker = async () => {
    if (openingWorkspace) return
    setHomeNote('')
    setManualWorkspaceMode(null)
    setOpeningWorkspace(true)
    let picked: string | null
    try {
      picked = await ctx.workspaces.pickDirectory()
    } catch {
      setOpeningWorkspace(false)
      setManualWorkspaceMode('existing')
      setHomeNote('目录选择器暂时不可用，请直接输入作品路径。')
      if (session) {
        setWorkbenchNote('目录选择器暂时不可用，请直接输入作品路径。')
        setWorkspaceSwitcherOpen(false)
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
      const path = await ctx.workspaces.pickDirectory()
      if (!path) {
        const message = '未选择文件夹，可直接输入路径。'
        if (session) setWorkbenchNote(message)
        else setHomeNote(message)
        return
      }
      await openPickedWorkspace(path, 'open', relocatingWorkspaceId)
    } catch {
      const message = '目录选择器暂时不可用，请直接输入作品路径。'
      if (session) setWorkbenchNote(message)
      else setHomeNote(message)
    }
  }
  const submitWorkspacePath = async (event: FormEvent) => {
    event.preventDefault()
    const path = manualWorkspacePath.trim()
    if (!path) {
      const message = '请输入作品文件夹路径。'
      if (session) setWorkbenchNote(message)
      else setHomeNote(message)
      return
    }
    await openPickedWorkspace(path, 'open', relocatingWorkspaceId)
  }
  const pathFallbackForm = manualWorkspaceMode ? e('form', { className: 'path-fallback', onSubmit: submitWorkspacePath },
    e('label', null,
      e('span', null, '作品文件夹路径'),
      e('input', {
        value: manualWorkspacePath,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setManualWorkspacePath(event.target.value),
        placeholder: '例如 D:/小说/作品',
        'aria-label': '作品文件夹路径',
        autoFocus: true,
      }),
    ),
    e('div', null,
      e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void pickWorkspaceDirectory() }, '选择文件夹'),
      e('button', { className: 'primary-action', type: 'submit', disabled: openingWorkspace },
        openingWorkspace ? '打开中…' : '打开此目录',
      ),
      e('button', {
        type: 'button',
        disabled: openingWorkspace,
        onClick: () => {
          setManualWorkspaceMode(null)
          setRelocatingWorkspaceId(undefined)
          setHomeNote('')
          if (session) setWorkbenchNote('')
        },
      }, '取消'),
    ),
  ) : null
  const closeWorkspaceChrome = () => {
    setWorkspaceMenuOpen(false)
    setWorkspaceSwitcherOpen(false)
  }
  const leaveToHome = async () => {
    closeWorkspaceChrome()
    if (editorDirty) { setWorkbenchNote('请先保存当前文档，再返回作品列表。'); return }
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    setAssistantOpen(false)
    setFocusMode(false)
    workspaceOpenGate.begin('home')
    pendingWorkspaceOpen.current = null
    setWorkspaceOpen({ kind: 'idle' })
    ctx.sessions.clear()
  }
  const switchToWorkspace = async (id: WorkspaceId) => {
    closeWorkspaceChrome()
    if (!id || id === currentWorkspace?.workspaceId) return
    if (editorDirty) { setWorkbenchNote('请先保存当前文档，再切换作品。'); return }
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    const workspace = workspaces.items.find((item) => item.workspaceId === id)
    if (!workspace) { setWorkbenchNote('作品入口已经变化，请重新选择。'); return }
    await openRegisteredWorkspace(workspace)
  }
  const startNewProject = async () => {
    closeWorkspaceChrome()
    if (openingWorkspace || newProject) return
    if (fileSession) {
      if (editorDirty) { setWorkbenchNote('请先保存当前文档，再新建作品。'); return }
      if (!(await canLeaveAssistantDraft())) return
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
  const renderNewProjectDialog = () => newProject ? e(NewProjectDialog, {
    busy: newProject.busy,
    note: newProject.note,
    onClose: closeNewProject,
    onCreate: (title: string) => void submitNewProject(title),
  }) : null
  const openAnotherWorkspace = async () => {
    closeWorkspaceChrome()
    if (editorDirty) {
      setWorkbenchNote('请先保存当前文档，再打开作品。')
      return
    }
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    await startWorkspaceFromPicker()
  }

  if (workspaceOpen.kind === 'checking') {
    return e('main', { className: 'shell no-session', style: { minWidth: 0, display: 'grid' } },
      e('style', null, redesignedStyles),
      e('section', { className: 'workspace-checking', 'aria-label': '正在验证作品' },
        e('h1', null, '正在检查作品'),
        e('p', { role: 'status', 'aria-live': 'polite' }, '正在确认目录、恢复状态和正文文件…'),
        e('code', null, workspaceOpen.path),
      ),
    )
  }

  if (!fileSession || workspaceOpen.kind !== 'ready') {
    return e('main', { className: 'shell no-session', style: { minWidth: 0, display: 'grid' } },
      e('style', null, redesignedStyles),
      e('header', { className: 'chrome' },
        e('div', { className: 'brand-lockup' },
          e('span', { className: 'brand-mark', 'aria-hidden': 'true' }, 'D'),
          e('strong', null, 'DSH Editor'),
        ),
        e('span', { className: 'local-state' }, '本地作品'),
        e('span', { ref: settingsControlRef, className: 'native-settings-control' }, settingsControl),
      ),
      e(PaperStage, { label: '空白稿纸' },
        e('p', { className: 'home-hint' }, '打开已有作品，或填写名称后在「文档/dsh-editor」下新建。'),
        e('div', { className: 'home-actions' },
          e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void startWorkspaceFromPicker() }, '打开作品'),
          e('button', { type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void startNewProject() }, '新建'),
        ),
        pathFallbackForm,
        workspaceOpen.kind === 'needs-intent' ? e('section', { className: 'workspace-intent-prompt', role: 'alert' },
          e('strong', null, workspaceOpen.intent === 'create' ? '这个目录还不是作品' : '这里已经有作品内容'),
          e('p', null, workspaceOpen.message),
          e('code', null, workspaceOpen.path),
          e('div', null,
            e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace, onClick: () => void continuePendingWorkspaceIntent() }, workspaceOpen.intent === 'create' ? '在这里新建' : '改为打开'),
            e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void cancelPendingWorkspaceIntent() }, '取消'),
          ),
        ) : null,
        workspaceOpen.kind === 'error' ? e('code', null, workspaceOpen.path) : null,
        homeNote ? e('p', { className: 'warning', role: 'alert' }, homeNote) : null,
        e('section', { className: 'home-recent', 'aria-label': '最近作品' },
          e('header', null, e('h2', null, '最近作品'), e('small', null, workspaces.items.length ? `${workspaces.items.length} 个入口` : '尚无作品入口')),
          workspaces.items.length ? e('div', { className: 'workspace-list' }, workspaces.items.map((workspace) => {
            const needsRelocation = workspaceOpen.kind === 'needs-relocation' && workspaceOpen.workspaceId === workspace.workspaceId
            return e('article', { className: `workspace-row${needsRelocation ? ' needs-relocation' : ''}`, key: workspace.workspaceId },
              e('button', {
                className: 'tree-row', type: 'button', disabled: openingWorkspace,
                onClick: () => void openRegisteredWorkspace(workspace),
              }, e('strong', null, workspace.title || workspace.path), e('small', null, workspace.path)),
              needsRelocation ? e('div', { className: 'workspace-relocation', role: 'alert' },
                e('p', null, workspaceOpen.message), e('code', null, workspaceOpen.path),
                e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace, onClick: () => void relocateWorkspace(workspace) }, '重新定位'),
                e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void removeBrokenWorkspace(workspace) }, '从最近移除'),
              ) : null,
            )
          })) : e('p', { className: 'muted home-recent-empty' }, '打开过的作品会显示在这里。'),
        ),
      ),
      renderNewProjectDialog(),
    )
  }

  const chatSession = session ?? fileSession
  const sidebarVisible = sidebarOpen && !focusMode
  const assistantVisible = assistantOpen && !focusMode
  const layoutColumns = [
    sidebarVisible ? `${sidebarWidth}px 7px` : '',
    'minmax(420px,1fr)',
    assistantVisible ? `7px ${assistantWidth}px` : '',
  ].filter(Boolean).join(' ')

  return e('main', {
    className: `shell layout-shell${focusMode ? ' focus-mode' : ''}${sidebarVisible ? ' files-open' : ''}${assistantVisible ? ' assistant-open' : ''}`,
    style: { minWidth: 0, gridTemplateColumns: layoutColumns },
  },
    e('style', null, redesignedStyles),
    e('header', { className: 'chrome' },
      e('div', { className: 'workspace-chrome', role: 'group', 'aria-label': '作品' },
        e('details', {
          className: 'project-switcher',
          open: workspaceSwitcherOpen,
          onToggle: (event: ChangeEvent<HTMLDetailsElement>) => {
            const open = event.currentTarget.open
            setWorkspaceSwitcherOpen(open)
            if (open) setWorkspaceMenuOpen(false)
          },
        },
          e('summary', {
            role: 'button',
            title: '切换作品',
            'aria-label': '切换作品',
            'aria-expanded': workspaceSwitcherOpen,
            'aria-controls': 'workspace-switcher-list',
          }, e('span', null, currentWorkspace?.title || currentWorkspace?.path || '作品')),
          e('div', { id: 'workspace-switcher-list', className: 'workspace-menu-panel', 'aria-label': '最近作品' },
            e('div', { className: 'workspace-menu-actions' },
              workspaces.items.map((workspace) => e('button', {
                key: workspace.workspaceId,
                type: 'button',
                'aria-current': workspace.workspaceId === currentWorkspace?.workspaceId ? 'true' : undefined,
                disabled: openingWorkspace,
                onClick: () => void switchToWorkspace(workspace.workspaceId),
              }, workspace.title || workspace.path)),
            ),
          ),
        ),
        e('details', {
          className: 'workspace-menu',
          open: workspaceMenuOpen,
          onToggle: (event: ChangeEvent<HTMLDetailsElement>) => {
            const open = event.currentTarget.open
            setWorkspaceMenuOpen(open)
            if (open) setWorkspaceSwitcherOpen(false)
          },
        },
          e('summary', { role: 'button', title: '作品菜单', 'aria-label': '作品菜单', 'aria-expanded': workspaceMenuOpen, 'aria-controls': 'workspace-actions' }, '作品'),
          e('div', { id: 'workspace-actions', className: 'workspace-menu-panel', 'aria-label': '作品操作' },
            e('div', { className: 'workspace-menu-actions' },
              e('button', { type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void openAnotherWorkspace() }, '打开作品'),
              e('button', { type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void startNewProject() }, '新建'),
              e('button', { type: 'button', 'aria-label': '返回作品列表', onClick: () => void leaveToHome() }, '返回作品列表'),
            ),
            pathFallbackForm,
          ),
        ),
      ),
      e('nav', { className: 'layout-controls', 'aria-label': '工作台布局' },
        e('button', {
          type: 'button',
          disabled: focusMode,
          'aria-pressed': sidebarOpen,
          title: sidebarOpen ? '隐藏文件栏' : '显示文件栏',
          onClick: () => setSidebarOpen((value) => !value),
        }, '文件'),
        e('button', {
          type: 'button',
          'aria-pressed': focusMode,
          title: focusMode ? '退出专注写作' : '进入专注写作',
          onClick: () => setFocusMode((value) => !value),
        }, focusMode ? '退出专注' : '专注'),
        e('button', {
          type: 'button',
          disabled: focusMode,
          'aria-pressed': assistantOpen,
          title: assistantOpen ? '隐藏写作搭档' : '显示写作搭档',
          onClick: () => setAssistantOpen((value) => !value),
        }, '搭档'),
      ),
      e('div', { className: 'topbar-actions' },
        e(ThemeToggle, { theme, onChange: setTheme }),
        e('span', { ref: settingsControlRef, className: 'native-settings-control' }, settingsControl),
      ),
    ),
    sidebarVisible ? e('aside', { className: 'sidebar', 'aria-label': '文件与项目资料' },
      e('div', { className: 'side-title' }, e('span', null, '文件'), e('button', { className: 'icon-button', type: 'button', onClick: () => openCreateDialog('chapter'), title: '新建章节', 'aria-label': '新建章节' }, '＋')),
      e('details', { className: 'project-actions' },
        e('summary', null, '新建资料'),
        e('div', null,
          e('button', { type: 'button', onClick: () => openCreateDialog('group') }, '卷/部'),
          e('button', { type: 'button', onClick: () => openCreateDialog('outline') }, '大纲'),
          e('button', { type: 'button', onClick: () => openCreateDialog('character') }, '人物'),
          e('button', { type: 'button', onClick: () => openCreateDialog('world') }, '设定'),
        ),
      ),
      createNote ? e('p', { className: 'warning pad', role: 'alert' }, createNote) : null,
      workspaceOpen.warning ? e('p', { className: 'warning pad', role: 'status' }, workspaceOpen.warning) : null,
      workbenchNote ? e('p', { className: `pad`, role: 'status' }, workbenchNote) : null,
      e(Tree, { ctx, sessionId: fileSession.sessionId, active: path, expandPath: treeExpansionPath, onOpen: openDocument, onFileMenu: openFileMenu, onCreateChapter: (directory: string) => openCreateDialog('chapter', directory), onCreateInGroup: (kind) => openCreateDialog(kind), onCreateGroup: () => openCreateDialog('group'), revision: treeRevision }),
    ) : null,
    sidebarVisible ? e(PanelResizer, {
      side: 'left',
      value: sidebarWidth,
      minimum: SIDEBAR_MIN,
      maximum: SIDEBAR_MAX,
      defaultValue: SIDEBAR_DEFAULT,
      label: '调整文件栏宽度',
      onChange: setSidebarWidth,
    }) : null,
    e(Editor, {
      ctx, session: fileSession, path, files, onOpen: openDocument, create: () => openCreateDialog('chapter'),
      externalRevision: contentRevision, onDirtyChange: setEditorDirty,
      completionPreference: writing.completion,
      authorPreferences: normalizeAuthorPreferences(writing.authorPreferences),
      chapterStatus: overview?.chapters.find((chapter) => chapter.path === path)?.status,
      statusBusy,
      onChapterStatus: (chapterPath: string, status: ChapterStatus) => void updateChapterStatus(chapterPath, status),
      onSaved: () => setOverviewRevision((value) => value + 1),
    }),
    assistantVisible ? e(PanelResizer, {
      side: 'right',
      value: assistantWidth,
      minimum: ASSISTANT_MIN,
      maximum: ASSISTANT_MAX,
      defaultValue: ASSISTANT_DEFAULT,
      label: '调整写作搭档宽度',
      onChange: setAssistantWidth,
    }) : null,
    e(Chat, {
      key: chatSession.sessionId,
      ctx,
      session: chatSession,
      workspaceId: currentWorkspace?.workspaceId,
      activePath: path,
      authorPreferences: normalizeAuthorPreferences(writing.authorPreferences),
      hidden: !assistantVisible,
      onClose: () => setAssistantOpen(false),
      onConfigure: openSettings,
      onDraftDirtyChange: setAssistantDraftDirty,
      onApplied: (appliedPath: string) => {
        const navigation = proposalAppliedNavigation(appliedPath, path, editorDirty)
        setTreeRevision((old) => old + 1)
        if (navigation.expandPath) setTreeExpansionPath(navigation.expandPath)
        if (!navigation.openPath) {
          setWorkbenchNote('建议已应用；当前文档有未保存内容，请先保存，再打开应用的文件。')
          return
        }
        openDocument(navigation.openPath)
        if (navigation.refreshContent) setContentRevision((old) => old + 1)
      },
    }),
    !assistantVisible && !focusMode ? e('button', {
      className: 'assistant-launcher',
      type: 'button',
      'aria-label': '打开写作搭档',
      'aria-expanded': false,
      onClick: () => setAssistantOpen(true),
    }, e('span', { 'aria-hidden': 'true' }, e(DeepSeekWhaleMark)), e('strong', null, '搭档')) : null,
    leaveConfirm ? e(ConfirmDialog, {
      id: 'leave-assistant-draft',
      title: '放弃未发送的消息？',
      message: '离开当前作品或打开设置后，这段文字不会自动保存。',
      confirmLabel: '放弃并继续',
      onCancel: () => resolveLeaveConfirm(false),
      onConfirm: () => resolveLeaveConfirm(true),
    }) : null,
    createRequest ? e(CreateDocumentDialog, {
      key: `${createRequest.kind}:${createRequest.directory}`,
      request: createRequest,
      busy: createBusy,
      note: createNote,
      onClose: closeCreateDialog,
      onCreate: (title: string) => void create(title),
    }) : null,
    renderNewProjectDialog(),
    fileMenu ? e(FileContextMenu, {
      path: fileMenu.path,
      x: fileMenu.x,
      y: fileMenu.y,
      onClose: () => setFileMenu(null),
      onRename: () => openRenameDialog(fileMenu.path),
    }) : null,
    managePath ? e(TextPromptDialog, {
      id: 'rename-file',
      title: '重命名文件',
      label: '新名称',
      initialValue: managePath.split('/').at(-1) ?? '',
      confirmLabel: '保存新名称',
      onCancel: closeRenameDialog,
      onConfirm: renameManaged,
    }) : null,
  )
}

type NativeSettingsRootProps = {
  renderSlot(key: 'sidebar.settings', owner: { wide: boolean }): ReactNode
}

type RegisterShellRootOptions = {
  writingScope: SettingsScope<WritingPreferences>
  registerRoot: (ctx: ShellContext, render: (props: unknown) => ReactNode) => void
  settingsControl: ReactNode
}

export function registerShellRoot(ctx: Context, options: RegisterShellRootOptions): void {
  const client = ctx as ShellContext
  options.registerRoot(client, (props) => e(Root, {
    ctx: client,
    writingScope: options.writingScope,
    settingsControl: (props as typeof props & NativeSettingsRootProps).renderSlot('sidebar.settings', { wide: true }),
  }))
}

// re-exports so external spec files still see the surface area of the old monolith
export { chapterStatusText as _chapterStatusText, isSuccessWorkbenchNote as _isSuccessWorkbenchNote, searchSkippedText as _searchSkippedText } from './shared.ts'
