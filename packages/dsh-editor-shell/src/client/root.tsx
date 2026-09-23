import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope, SessionFace, SessionId, WorkspaceId, WorkspaceView } from '../dsh-compat.ts'
import {
  WORKBENCH_RPC_CHANNEL,
  type ArchiveListResponse,
  type ProjectContextReceiptBundle,
  type ProjectInspectionResponse,
  type ProjectOverview,
  type SnapshotResponse,
} from 'dsh-editor-workbench/contracts'
import { AUTHOR_MEMORY_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from '../author-preferences.ts'
import { defaultCreateDirectory, exportDirectoryOf, firstOpenDocumentPath, isManuscriptChapterPath, normalizeProjectDirectory, sortChapterPaths, sortDocumentPaths } from '../project-files.ts'
import { CENTER_OVERLAYS_SLOT, EXTENSIONS_SLOT, PLUGINS_SETTINGS_SLOT, SIDEBAR_TOOLS_SLOT, ZHIHU_SETTINGS_SLOT, registerRoot } from '../root-registration.ts'
import { matchRegistryShortcut, registryPaletteItems, type ShellCommandRegistry, type ShellProposalCardProps, type ShellRange, type ShellToolSeatContext } from '../seats.ts'
import { writingPreferences, writingTypography, type WritingMigration, type WritingModelRoute, type WritingPreferences } from '../writing-settings.tsx'
import { CONVERSATION_SETTINGS_NAMESPACE, conversationWorkRecord, decodeConversationSettings } from '../conversation-store.ts'
import { PROGRESS_RECORD_DEBOUNCE_MS, createDebouncedInvoker, progressRecordChars } from '../progress-record.ts'
import { redesignedStyles } from '../styles.ts'
import { errorMessage, isStaleFailure, canMoveTreeEntry, treeMoveTargetDir, partialApplyDetails, resumableConversationId, safeRpcCall, snapshotTimeLabel, storedPanelOpen, storedPanelWidth, workspaceShortcut, type RevealRequest, type RpcResult, type ShellContext, type WorkspaceOpenState, type PendingWorkspaceOpen, type WorkspaceIntent, LatestRequestGate, claimInitialWorkspaceResume, consumeInitialWorkspaceResume, startupResumeWorkspace, hasRelocatableManuscriptFiles, hasVisibleWorkspaceEntries, isSessionMissing, proposalAppliedNavigation, relocationFailureMessage, supportedWorkspaceTextPaths, workspaceOpenFailureMessage, createFlowWorkspace, FlowWorkspaceCleanupError } from './shared.ts'
import { useTransientSuccessNote } from './transient-note.ts'
import { currentSession, DeepSeekWhaleMark, ImagePreviewOverlay, PaperStage, ShellErrorBoundary, useMediaQuery, useObservable } from './components.tsx'
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, type PanelImperativeHandle, type PanelSize } from 'react-resizable-panels'
import { BoundProposalCard, CenterOverlays, ChatColumn, EditorColumn, SidebarColumn, panelPixels, type FileMenuKind } from './root-columns.tsx'
import { HomeScreen } from './root-home.tsx'
import { WorkbenchTopbar } from './root-topbar.tsx'
import { FolderIcon, FocusIcon, NewDocIcon } from './icons.tsx'
import { ConfirmDialog, NewProjectDialog, TextPromptDialog } from './dialogs.tsx'
import { SettingsDialog, SettingsTrigger, type SettingsRenderSlot, type SettingsTab } from './settings.tsx'
import { ThemeToggle, useAccent, useTheme, type HostThemeSync } from './theme.tsx'
import { Tree, FileContextMenu } from './sidebar.tsx'
import { ChapterOpsLayer, chapterMenuModel, requestMergeChapter, requestSplitChapter, shouldOpenAfterChapterApply, snapshotFromHandle, type ChapterOpsRequest, type EditorSnapshotHandle } from './chapter-ops.tsx'
import { isMarkdownChapterPath } from '../chapter-ops-view.ts'
import { Editor } from './editor.tsx'
import { Chat, ProposalCard } from './chat.tsx'
import type { CompletionPreference, EditorCoreHandle } from 'dsh-manuscript/client/editor-core'
import { saveOpenEditor, type EditorSaveBlockReason } from '../wrap-up-view.ts'
import { featureEnabled } from '../capabilities.ts'
import { useShellCapabilities } from './capabilities.ts'
import { CommandPalette, CommandPaletteTrigger } from './command-palette.tsx'
import { Select as HostSelect } from './select.tsx'
import { ActivityDots, ActivityRing, ActivityShimmer, ActivitySkeleton, ActivityText, Button as HostButton, Dialog as HostDialog, Input, Input as HostInput, TextArea as HostTextArea, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, ShellUiProvider, Tooltip, m, radixThemesStyles, useChromeMotion } from './ui/index.ts'
import { Button as ThemesButton, Callout, Flex, IconButton, Text } from '@radix-ui/themes'
import { WindowControls, titleBarDoubleClick, windowBridge } from './window-controls.tsx'
import { SearchPanel, toRevealRequest, type SearchHit } from './search-panel.tsx'
import { PinnedPane } from './pinned-pane.tsx'
import { canPinPath, storedPinnedPath, validatePinnedPath } from '../pinned-pane-view.ts'

import { collectDocuments, downloadExport, ExportPreviewDialog } from './export-dialog.tsx'
import { prepareExport, type ChapterExport, type ExportFormat } from '../export.ts'
import { idleImportFlow, importReview, recoverImport, type ImportFlow, type ImportProbeView } from './import-flow.ts'
import { ImportDialog } from './import-dialog.tsx'
import { ArchivePanel, DOCUMENT_ARCHIVE_UI, canArchivePath, type ArchiveView } from './archive.tsx'
import { HistoryPanel } from './history-dialog.tsx'
import { t, useLocale, type MessageKey } from '../i18n/index.ts'


const HOST_UI_OWNER = { Select: HostSelect, Dialog: HostDialog, Button: HostButton, Input: HostInput, TextArea: HostTextArea }

/* 自动保存被拦住时的驻留原因提示：组字/冲突/保存失败/保存期间新输入/身份变化。 */
const SAVE_STAY_NOTE: Record<EditorSaveBlockReason, MessageKey> = {
  composing: 'note.staySaveComposing',
  conflict: 'note.staySaveConflict',
  save: 'note.staySaveFailed',
  typing: 'note.staySaveTyping',
  identity: 'note.staySaveIdentity',
}

const SIDEBAR_DEFAULT = 248
const SIDEBAR_MIN = 196
const SIDEBAR_MAX = 420
const ASSISTANT_DEFAULT = 384
const ASSISTANT_MIN = 300
const ASSISTANT_MAX = 720
const PINNED_DEFAULT = 340
const PINNED_MIN = 260
const PINNED_MAX = 560

type TreeCreateRequest = { kind: 'file' | 'folder'; directory: string }
type FileSession = NonNullable<NonNullable<ReturnType<ShellContext['sessions']['binding']>>['session']> | undefined

type FileMenuState = { kind: FileMenuKind; path: string; x: number; y: number } | null
type ClipboardEntry = { op: 'copy' | 'cut'; path: string; kind: FileMenuKind } | null

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

async function verifyWorkspaceSession(ctx: ShellContext, sessionId: SessionId, knownFiles?: string[]): Promise<string | undefined> {
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
  const first = await ctx.uiWorkspace.connectWorkspace(workspaceId)
  if (first !== preferred) {
    const listed = await pingWorkspaceSession(ctx, first)
    if (listed.ok) return first
    if (!isSessionMissing(listed)) throw new Error(errorMessage(listed))
  }
  await ctx.workspaces.archiveSession(first)
  let second = await ctx.uiWorkspace.connectWorkspace(workspaceId)
  /* archive 后快照可能还挂着同一条空白会话；再拿到同一个 id 就强制新建，避免死循环。 */
  if (second === first) second = await ctx.uiWorkspace.createSession(workspaceId)
  if (second === first) throw new Error('session is not live')
  const retry = await pingWorkspaceSession(ctx, second)
  if (!retry.ok) throw new Error(isSessionMissing(retry) ? 'session is not live' : errorMessage(retry))
  return second
}

async function verifyRelocatedWorkspaceSession(ctx: ShellContext, sessionId: SessionId): Promise<string> {
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

function Root({ ctx, writingScope, migrateWriting, hostThemeSync, extensionsDock, pluginsSettings, zhihuSettings, commands, renderSlot }: {
  ctx: ShellContext
  writingScope: SettingsScope<WritingPreferences>
  migrateWriting: WritingMigration
  hostThemeSync?: HostThemeSync
  extensionsDock?: ReactNode
  pluginsSettings?: ReactNode
  zhihuSettings?: ReactNode
  commands: ShellCommandRegistry
  renderSlot?: SettingsRenderSlot
}) {
  const locale = useLocale()
  /* 可选 AI 能力：加载完成前不挂载 Chat / 自动索引;失败是显式错误态(可重试)。 */
  const shellCapabilities = useShellCapabilities(ctx)
  const capabilityState = shellCapabilities.state
  const capabilityReady = capabilityState.kind === 'ready'
  const assistantEnabled = capabilityState.kind === 'ready' && featureEnabled(capabilityState.value, 'assistant')
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
  const conversationScope = useMemo(() => ctx.settingsScope.bind({ namespace: CONVERSATION_SETTINGS_NAMESPACE, decode: decodeConversationSettings }), [ctx])
  /* 助手提议 author_observe 时的写入回调：把 observation 作为新行追加到 authorMemory。
     限 AUTHOR_MEMORY_MAX_CHARS 字(2000),追加后超限直接拒绝,提示作者去设置页整理。 */
  const onAcceptMemory = useCallback(async (observation: string): Promise<boolean> => {
    const trimmed = observation.trim()
    if (!trimmed) return false
    const current = writing.authorMemory ?? ''
    const next = current ? `${current}\n${trimmed}` : trimmed
    if (next.length > AUTHOR_MEMORY_MAX_CHARS) return false
    try {
      await writingScope.set('authorMemory', next)
      return true
    } catch {
      return false
    }
  }, [writing.authorMemory, writingScope])
  const [path, setPath] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [workbenchNote, setWorkbenchNote] = useState('')
  const expireWorkbenchNote = useCallback((note: string) => {
    setWorkbenchNote((current) => current === note ? '' : current)
  }, [])
  useTransientSuccessNote(workbenchNote, expireWorkbenchNote)
  const [treeRevision, setTreeRevision] = useState(0)
  const [treeExpansionPath, setTreeExpansionPath] = useState('')
  const [contentRevision, setContentRevision] = useState(0)
  const [homeNote, setHomeNote] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [treeCreateRequest, setTreeCreateRequest] = useState<TreeCreateRequest | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<SnapshotResponse[] | null>(null)
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<SnapshotResponse | null>(null)
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [manualWorkspaceMode, setManualWorkspaceMode] = useState<'existing' | null>(null)
  const [manualWorkspacePath, setManualWorkspacePath] = useState('')
  const [newProject, setNewProject] = useState<{ busy: boolean; note: string } | null>(null)
  const [relocatingWorkspaceId, setRelocatingWorkspaceId] = useState<WorkspaceId | undefined>()
  const [sidebarOpen, setSidebarOpen] = useState(() => storedPanelOpen('dsh-editor.layout.sidebar-open', true))
  const [sidebarWidth, setSidebarWidth] = useState(() => storedPanelWidth('dsh-editor.layout.sidebar-width', SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX))
  const [assistantOpen, setAssistantOpen] = useState(() => storedPanelOpen('dsh-editor.layout.assistant-open', true))
  const [assistantWidth, setAssistantWidth] = useState(() => storedPanelWidth('dsh-editor.layout.assistant-width', ASSISTANT_DEFAULT, ASSISTANT_MIN, ASSISTANT_MAX))
  const overlayAssistant = useMediaQuery('(max-width: 1040px)')
  const compactChrome = useMediaQuery('(max-width: 760px)')
  const [pinnedPath, setPinnedPath] = useState<string | null>(() => {
    const stored = storedPinnedPath('dsh-editor.layout.pinned-path')
    return stored && canPinPath(stored) ? stored : null
  })
  const [pinnedWidth, setPinnedWidth] = useState(() => storedPanelWidth('dsh-editor.layout.pinned-width', PINNED_DEFAULT, PINNED_MIN, PINNED_MAX))
  const sidebarWidthRef = useRef(sidebarWidth)
  const assistantWidthRef = useRef(assistantWidth)
  const pinnedWidthRef = useRef(pinnedWidth)
  const [assistantDraftDirty, setAssistantDraftDirty] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState<{ resolve(value: boolean): void } | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [chatFocusNonce, setChatFocusNonce] = useState(0)
  const [overview, setOverview] = useState<ProjectOverview | null | undefined>(null)
  const [overviewRevision, setOverviewRevision] = useState(0)
  const [editorDirty, setEditorDirty] = useState(false)
  /* editorDirty 的 ref 镜像：需要稳定身份的回调（memo 列的 props）读它而不是闭包值，
     翻转不再连带重渲染所有列；新鲜度与闭包一致（渲染期同步，事件总在渲染后触发）。 */
  const editorDirtyRef = useRef(editorDirty)
  editorDirtyRef.current = editorDirty
  const [fileMenu, setFileMenu] = useState<FileMenuState>(null)
  const [chapterOps, setChapterOps] = useState<ChapterOpsRequest | null>(null)
  const editorHandleRef = useRef<EditorCoreHandle | null>(null)
  /* 返回首页/切换作品/新建/打开/树内导航前，先通过当前编辑器句柄保存：保存成功才继续。
     不依赖滞后的 dirty 布尔状态——句柄里存在与当前选择一致的有效文档就走保存
     （干净缓冲区内部直接放行，不落盘）；组字/冲突/失败/保存期间新输入/身份变化都留在原处。 */
  const navSaveBusyRef = useRef(false)
  const latestDocRef = useRef({ path: '', fileSessionId: '' })
  latestDocRef.current = { path, fileSessionId: fileSession?.sessionId ?? '' }
  const saveEditorBeforeAction = async (): Promise<boolean> => {
    const handle = editorHandleRef.current
    const doc = handle?.getDocument()
    const latest = latestDocRef.current
    /* 空白稿纸/未选中文件等无有效当前文档：无可保存，放行。 */
    if (!handle || !doc || doc.sessionId !== latest.fileSessionId || doc.path !== latest.path) return true
    if (navSaveBusyRef.current) return false
    navSaveBusyRef.current = true
    const result = await saveOpenEditor(handle, { sessionId: doc.sessionId, path: doc.path })
    navSaveBusyRef.current = false
    if (!result.ok) {
      setWorkbenchNote(t(SAVE_STAY_NOTE[result.reason]))
      return false
    }
    /* await 之后复核：句柄文档身份与 root 当前文档/会话都不能变；保存期间发生的切换优先，
       旧请求不得替新作品/新章节导航。 */
    const after = handle.getDocument()
    const now = latestDocRef.current
    if (!after || after.sessionId !== doc.sessionId || after.path !== doc.path
      || now.fileSessionId !== doc.sessionId || now.path !== doc.path) return false
    return true
  }
  /* 编辑器 dirty 状态经 React 回传有滞后；是否真有未保存内容直接读句柄实时缓冲区。 */
  const editorHasUnsavedText = () => {
    const handle = editorHandleRef.current
    if (!handle) return false
    const doc = handle.getDocument()
    return Boolean(doc && handle.getText() !== doc.text)
  }
  const [clipboard, setClipboard] = useState<ClipboardEntry>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; kind: FileMenuKind } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ path: string; kind: FileMenuKind } | null>(null)
  const [imagePreview, setImagePreview] = useState<{ path: string; url: string } | null>(null)
  const lastImagePreview = useRef<{ path: string; url: string } | null>(null)
  if (imagePreview) lastImagePreview.current = imagePreview
  const [managePath, setManagePath] = useState<string | null>(null)
  const [manageBusy, setManageBusy] = useState(false)
  const [manageNote, setManageNote] = useState('')
  const [theme, setTheme] = useTheme(undefined, hostThemeSync)
  // 色彩风格只需订阅:模块级 store 负责落 data-accent,设置弹窗内改选时这里同步重渲染。
  const [accent] = useAccent()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  /* searchQuery/searchSubmitTick 已下沉到 SidebarColumn：输入按键不再上升到 Root。 */
  const [highlightPath, setHighlightPath] = useState<string | null>(null)
  const [reveal, setReveal] = useState<RevealRequest | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState('')
  const [exportChapters, setExportChapters] = useState<ChapterExport[] | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archives, setArchives] = useState<ArchiveView[]>([])
  const [archiveInvalid, setArchiveInvalid] = useState(0)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveNote, setArchiveNote] = useState('')
  const [importFlow, setImportFlow] = useState<ImportFlow>(idleImportFlow)
  const [removeRecentTarget, setRemoveRecentTarget] = useState<WorkspaceView | null>(null)

  const temporaryFlowWorkspaces = useRef(new Set<string>())
  const temporarySourceWorkspaces = useRef(new Map<string, string>())
  const archiveRequestGate = useRef(new LatestRequestGate()).current
  const [startupUpdate, setStartupUpdate] = useState<{ version: string } | null>(null)
  /* 启动更新检查:主进程在后台跑,挂载后拉取缓存结果;仅发现新版本时弹轻提示,
     已是最新/失败都静默。浏览器开发模式没有桥,直接不跑。 */
  useEffect(() => {
    const check = windowBridge()?.getStartupUpdate
    if (!check) return
    let live = true
    void check().then((result) => {
      if (!live || result.status !== 'update-available' || !result.latest) return
      setStartupUpdate({ version: result.latest.version })
    }).catch(() => undefined)
    return () => { live = false }
  }, [])
  useEffect(() => () => leaveConfirm?.resolve(false), [leaveConfirm])
  const canLeaveAssistantDraft = async (): Promise<boolean> => {
    if (!assistantDraftDirty) return true
    return await new Promise<boolean>((resolve) => setLeaveConfirm({ resolve }))
  }
  const resolveLeaveConfirm = (value: boolean) => {
    leaveConfirm?.resolve(value)
    setLeaveConfirm(null)
  }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsFocusTab, setSettingsFocusTab] = useState<SettingsTab | undefined>()
  const openSettings = useCallback((tab?: SettingsTab) => {
    setSettingsFocusTab(tab)
    setSettingsOpen(true)
  }, [])
  const overviewRequestGate = useRef(new LatestRequestGate()).current
  const progressRecord = useRef(createDebouncedInvoker(PROGRESS_RECORD_DEBOUNCE_MS)).current
  const fileSessionRef = useRef(fileSession)
  fileSessionRef.current = fileSession
  const seatContextRef = useRef<ShellToolSeatContext | null>(null)
  useEffect(() => () => progressRecord.cancel(), [progressRecord])
  const workspaceOpenGate = useRef(new LatestRequestGate()).current
  const pendingWorkspaceOpen = useRef<PendingWorkspaceOpen | null>(null)
  const initialWorkspaceResumeStarted = useRef(false)
  const fileManageReturnFocus = useRef<HTMLElement | null>(null)
  const menuYieldsToDialog = useRef(false)
  const workspaceMenuTrigger = useRef<HTMLButtonElement | null>(null)
  const workspaceMenuYields = useRef(false)
  const pathFallbackInput = useRef<HTMLInputElement | null>(null)
  /* 工作区 <main> 的句柄。 */
  const shellMainRef = useRef<HTMLElement | null>(null)
  const homeCardOpen = useChromeMotion('card', 0)
  const homeCardNew = useChromeMotion('card', 0.05)
  const workspaceChromeMotion = useChromeMotion('page')
  const pinValidatedSession = useRef<string | undefined>()
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
    try {
      if (pinnedPath) globalThis.localStorage?.setItem('dsh-editor.layout.pinned-path', pinnedPath)
      else globalThis.localStorage?.removeItem('dsh-editor.layout.pinned-path')
    } catch { /* View preferences remain optional. */ }
  }, [pinnedPath])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.pinned-width', String(pinnedWidth)) } catch { /* View preferences remain optional. */ }
  }, [pinnedWidth])
  useEffect(() => {
    const hotkey = (event: globalThis.KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return
      const action = workspaceShortcut(event)
      if (action) {
      if (event.repeat) return
      if (action !== 'settings' && !session) return
      event.preventDefault()
      if (action === 'settings') { void openSettings(); return }
      if (action === 'toggle-sidebar') {
        if (focusMode) { setFocusMode(false); setSidebarOpen(true) } else setSidebarOpen((value) => !value)
        return
      }
      if (action === 'toggle-assistant') {
        if (!assistantEnabled) return
        if (focusMode) { setFocusMode(false); setAssistantOpen(true) } else setAssistantOpen((value) => !value)
        return
      }
      if (action === 'toggle-focus') { setFocusMode((value) => !value); return }
      if (action === 'focus-assistant') {
        if (!assistantEnabled) return
        setFocusMode(false)
        setAssistantOpen(true)
        setChatFocusNonce((value) => value + 1)
        return
      }
      if (action === 'search') {
        if (workspaceOpen.kind !== 'ready') return
        setFocusMode(false)
        setSidebarOpen(true)
        setSearchOpen(true)
        return
      }
      if (action === 'toggle-typewriter') {
        void writingScope.set('typewriter', !writing.typewriter)
        return
      }
      if (action === 'toggle-focus-paragraph') {
        void writingScope.set('focusParagraph', !writing.focusParagraph)
        return
      }
      }
      if (event.repeat) return
      const command = matchRegistryShortcut(commands.list(), event)
      if (!command) return
      if (command.when === 'workspace' && (!session || workspaceOpen.kind !== 'ready')) return
      event.preventDefault()
      setFocusMode(false)
      setPaletteOpen(false)
      const seat = seatContextRef.current
      if (!seat) return
      if (command.when === 'workspace') seat.revealSidebar()
      command.run(seat)
    }
    globalThis.addEventListener('keydown', hotkey, true)
    return () => globalThis.removeEventListener('keydown', hotkey, true)
  }, [assistantEnabled, commands, focusMode, path, session?.sessionId, workspaceOpen.kind, writing.typewriter, writing.focusParagraph])
  useEffect(() => {
    if (!chatFocusNonce || !assistantOpen || focusMode || !assistantEnabled) return
    globalThis.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus(), 0)
  }, [assistantEnabled, assistantOpen, chatFocusNonce, focusMode])
  useEffect(() => {
    if (!openWorkspaceId) setPath('')
    setFiles([]); setWorkbenchNote(''); setEditorDirty(false); setTreeExpansionPath('')
    setFileMenu(null); setChapterOps(null); setManagePath(null); setManageNote('')
    setClipboard(null); setDeleteTarget(null); setRenameTarget(null)
    setOverview(null); setWorkspaceMenuOpen(false)
    setHistoryOpen(false); setSnapshots(null); setRollbackTarget(null)
    setSearchOpen(false); setHighlightPath(null); setReveal(null); setExportChapters(null); setExportNote('')
    progressRecord.cancel()
    setArchiveOpen(false); setArchives([]); setArchiveNote('')
  }, [openWorkspaceId])
  useEffect(() => {
    if (!historyOpen || !fileSession) { setSnapshots(null); return }
    let live = true
    void (async () => {
      const result = await safeRpcCall<SnapshotResponse[]>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.list', { sessionId: fileSession.sessionId }))
      if (!live) return
      setSnapshots(result.ok && Array.isArray(result.value) ? result.value : [])
      if (!result.ok) setWorkbenchNote(errorMessage(result))
    })()
    return () => { live = false }
  }, [historyOpen, fileSession?.sessionId, snapshotRevision])
  useEffect(() => {
    if (!fileSession) { setFiles([]); return }
    let live = true
    void collectWorkspaceFiles(ctx, fileSession.sessionId).then((paths) => {
      if (!live) return
      const next = sortDocumentPaths(paths)
      setFiles(next)
      if (pinValidatedSession.current !== fileSession.sessionId) {
        pinValidatedSession.current = fileSession.sessionId
        setPinnedPath((current) => validatePinnedPath(current, next))
      }
    }).catch(() => {
      if (live) { setFiles([]); setWorkbenchNote(t('error.chapterOrder')) }
    })
    return () => { live = false }
  }, [ctx.connection.rpc, fileSession?.sessionId, treeRevision])
  const chapterFiles = useMemo(() => sortChapterPaths(files), [files])
  const loadOverview = async () => {
    if (!fileSession) return
    const ticket = overviewRequestGate.begin(fileSession.sessionId)
    const result = await safeRpcCall<ProjectOverview>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.overview', { sessionId: fileSession.sessionId }))
    if (!overviewRequestGate.isCurrent(ticket)) return
    if (!result.ok) {
      setOverview(null)
      return
    }
    setOverview(result.value)
  }
  useEffect(() => {
    if (!fileSession) { setOverview(null); return }
    void loadOverview()
  }, [ctx.connection.rpc, fileSession?.sessionId, treeRevision, contentRevision, overviewRevision])
  /* 统一导航入口：树/搜索/钉住/命令面板/章节导航都先走保存 gate，成功再跳转；失败留原处。
     导航发起时记下当前文档身份，保存期间被更新的导航优先，避免旧请求覆盖新选择。 */
  /* 保存 gate 与 dirty 判定的内部帮手都直读 ref（editorHandleRef/latestDocRef/navSaveBusyRef），
     因此 openDocument 只以 path 为依赖：身份稳定，供 memo 列与命令面板复用。 */
  const openDocument = useCallback((nextPath: string, hit?: SearchHit) => {
    if (nextPath === path && !hit) return
    if (editorHasUnsavedText()) {
      const fromPath = path
      const fromSessionId = latestDocRef.current.fileSessionId
      void (async () => {
        if (!(await saveEditorBeforeAction())) return
        if (latestDocRef.current.path !== fromPath || latestDocRef.current.fileSessionId !== fromSessionId) return
        setWorkbenchNote('')
        setPath(nextPath)
        setReveal(hit ? toRevealRequest(hit) : null)
      })()
      return
    }
    setWorkbenchNote('')
    setPath(nextPath)
    setReveal(hit ? toRevealRequest(hit) : null)
  }, [path])
  const recordSavedProgress = async () => {
    const session = fileSessionRef.current
    if (!session) return
    const refreshed = await safeRpcCall<ProjectOverview>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.overview', { sessionId: session.sessionId }))
    if (!refreshed.ok) return
    setOverview(refreshed.value)
    const chars = progressRecordChars(refreshed.value)
    if (chars === null) return
    await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'progress.record', {
      sessionId: session.sessionId,
      totalChars: chars,
    }))
  }
  const openImagePreview = useCallback(async (imagePath: string) => {
    if (!fileSession) return
    const read = await safeRpcCall<{ base64: string; mime: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'file.readBinary', {
      sessionId: fileSession.sessionId,
      path: imagePath,
    }))
    if (!read.ok) { setWorkbenchNote(errorMessage(read)); return }
    setWorkbenchNote('')
    const bytes = Uint8Array.from(globalThis.atob(read.value.base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: read.value.mime }))
    setImagePreview((old) => {
      const stale = old ?? lastImagePreview.current
      if (stale?.url && stale.url !== url) URL.revokeObjectURL(stale.url)
      return { path: imagePath, url }
    })
  }, [fileSession, ctx])
  const closeImagePreview = () => setImagePreview(null)
  useEffect(() => {
    if (imagePreview) return undefined
    const last = lastImagePreview.current
    if (!last) return undefined
    const timer = globalThis.setTimeout(() => {
      if (lastImagePreview.current?.url === last.url) {
        URL.revokeObjectURL(last.url)
        lastImagePreview.current = null
      }
    }, 400)
    return () => globalThis.clearTimeout(timer)
  }, [imagePreview])
  const openFileMenu = useCallback((kind: FileMenuKind, selectedPath: string, position: { x: number; y: number }, trigger?: HTMLElement | null) => {
    if (editorDirtyRef.current) { setWorkbenchNote(t('error.saveFirst')); return }
    setWorkbenchNote('')
    menuYieldsToDialog.current = false
    fileManageReturnFocus.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setFileMenu({ kind, path: selectedPath, x: position.x, y: position.y })
  }, [])
  const yieldMenuToDialog = () => {
    menuYieldsToDialog.current = true
    setFileMenu(null)
  }
  const restoreTreeTriggerIfMenuDismissed = () => {
    if (menuYieldsToDialog.current) return
    const target = fileManageReturnFocus.current
    if (target?.isConnected) target.focus()
  }
  const closeFileMenu = () => setFileMenu(null)
  const beginChapterSplit = (target: string, source: 'tree' | 'cursor') => {
    if (source === 'tree') yieldMenuToDialog()
    else {
      fileManageReturnFocus.current = null
      setFileMenu(null)
    }
    const next = requestSplitChapter({ path: target, source, editorDirty, activePath: path })
    if (!next.ok) { setWorkbenchNote(next.reason === 'unsaved' ? t('error.saveFirst') : t('chapterOps.splitTxtDisabled')); return }
    setChapterOps(next.request)
  }
  const beginChapterMerge = (chapterPath: string, direction: 'previous' | 'next') => {
    yieldMenuToDialog()
    const next = requestMergeChapter({ chapterPath, direction, files: chapterFiles, editorDirty, activePath: path })
    if (!next.ok) {
      setWorkbenchNote(next.reason === 'unsaved' ? t('error.saveFirst') : t('chapterOps.mergeMdOnly'))
      return
    }
    setChapterOps(next.request)
  }
  const applyChapterOps = (appliedPath: string) => {
    setTreeRevision((value) => value + 1)
    if (appliedPath.startsWith('正文/')) setTreeExpansionPath(appliedPath)
    if (!chapterOps || !shouldOpenAfterChapterApply(chapterOps, appliedPath)) {
      if (appliedPath === path) setContentRevision((value) => value + 1)
      return
    }
    openDocument(appliedPath)
    setContentRevision((value) => value + 1)
  }
  /* 把绝对路径转为父目录(用于"在文件行右键 → 粘贴"的目录来源)。根目录统一用 '.'(Host 同时接受 '' 与 '.')。 */
  const parentOf = (target: string): string => {
    const index = target.lastIndexOf('/')
    return index < 0 ? '.' : target.slice(0, index)
  }
  const openRenameDialog = (selectedPath: string) => {
    if (editorDirty) { setWorkbenchNote(t('error.saveFirst')); return }
    yieldMenuToDialog()
    setManagePath(selectedPath)
    setManageNote('')
  }
  const closeRenameDialog = () => {
    if (manageBusy) return
    setManagePath(null)
    setManageNote('')
  }
  const renameManaged = async (name: string) => {
    if (!fileSession || !managePath || manageBusy) return
    setManageBusy(true); setManageNote('')
    const read = await safeRpcCall<{ version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: fileSession.sessionId, path: managePath }))
    setManageBusy(false)
    if (!read.ok) { setManageNote(errorMessage(read)); return }
    const renamed = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'file.rename', {
      sessionId: fileSession.sessionId,
      path: managePath,
      newName: name,
      expectedVersion: read.value.version,
    }))
    if (!renamed.ok) { setManageNote(errorMessage(renamed)); return }
    if (path === managePath) setPath(renamed.value.path)
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.renamed', { path: renamed.value.path }))
    setManagePath(null)
  }
  /* 目录行重命名:走 workbench entry.rename,不需要读 version；失败时把 note 放进
     fileManageReturnFocus 触发的输入框状态。 */
  const submitRenameEntry = async (name: string) => {
    if (!fileSession || !renameTarget) return
    const target = renameTarget
    setManageBusy(true); setManageNote('')
    const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'entry.rename', {
      sessionId: fileSession.sessionId,
      path: target.path,
      name,
    }))
    setManageBusy(false)
    if (!result.ok) { setManageNote(errorMessage(result)); return }
    const renamed = result.value.path
    if (path === target.path) setPath(renamed)
    else if (target.kind === 'directory' && path.startsWith(`${target.path}/`)) {
      /* 改名的是当前文稿的父目录：同步改写当前子路径。 */
      setPath(`${renamed}${path.slice(target.path.length)}`)
    }
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.renamed', { path: renamed }))
    setRenameTarget(null)
  }
  const closeRenameEntryDialog = () => {
    if (manageBusy) return
    setRenameTarget(null)
    setManageNote('')
  }
  const requestDeleteEntry = (kind: FileMenuKind, targetPath: string) => {
    if (editorDirty) { setWorkbenchNote(t('error.saveFirst')); return }
    yieldMenuToDialog()
    setDeleteTarget({ kind, path: targetPath })
  }
  const closeDeleteConfirm = () => {
    setDeleteTarget(null)
  }
  const confirmDeleteEntry = async () => {
    const target = deleteTarget
    if (!fileSession || !target || manageBusy) return
    setManageBusy(true)
    const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'entry.delete', {
      sessionId: fileSession.sessionId,
      path: target.path,
    }))
    setManageBusy(false)
    if (!result.ok) { setWorkbenchNote(errorMessage(result)); return }
    setDeleteTarget(null)
    if (target.kind === 'file' && path === target.path) setPath('')
    else if (target.kind === 'directory' && path.startsWith(`${target.path}/`)) {
      /* 删除的是当前文稿的父目录：当前子路径一并清空。 */
      setPath('')
    }
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.deleted', { path: target.path }))
  }
  const setClipboardFromMenu = (op: 'copy' | 'cut', kind: FileMenuKind, targetPath: string) => {
    /* cut 当前文稿或其父目录等于要搬走缓冲区：编辑器有未保存内容时先阻止，防 buffer 丢失。 */
    if (op === 'cut' && editorDirty && (targetPath === path || (kind === 'directory' && path.startsWith(`${targetPath}/`)))) {
      setWorkbenchNote(t('note.saveBeforeCut'))
      setFileMenu(null)
      return
    }
    setClipboard({ op, kind, path: targetPath })
    setWorkbenchNote(op === 'copy' ? t('note.copied', { path: targetPath }) : t('note.cut', { path: targetPath }))
    setFileMenu(null)
  }
  const pasteFromMenu = async () => {
    if (!fileSession || !fileMenu || !clipboard) return
    if (fileMenu.kind === 'directory') {
      /* 粘贴到树根时统一传 '.'（Host 同时接受 '' 与 '.'）。 */
      const targetDir = fileMenu.path === '' ? '.' : fileMenu.path
      await runClipboardPaste(targetDir)
      return
    }
    /* 文件行粘贴:放进该文件所在目录。 */
    await runClipboardPaste(parentOf(fileMenu.path))
  }
  const moveTreeEntry = useCallback(async (entry: { kind: FileMenuKind; path: string }, targetDir: string) => {
    if (!fileSession) return
    const dest = treeMoveTargetDir(targetDir)
    if (!canMoveTreeEntry(entry.path, dest)) return
    if (editorDirty && (entry.path === path || (entry.kind === 'directory' && path.startsWith(`${entry.path}/`)))) {
      setWorkbenchNote(t('note.saveBeforeCut'))
      return
    }
    const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'entry.move', {
      sessionId: fileSession.sessionId,
      path: entry.path,
      targetDir: dest,
    }))
    if (!result.ok) { setWorkbenchNote(errorMessage(result)); return }
    if (entry.kind === 'file' && path === entry.path) setPath(result.value.path)
    else if (entry.kind === 'directory' && path.startsWith(`${entry.path}/`)) {
      setPath(`${result.value.path}${path.slice(entry.path.length)}`)
    }
    if (clipboard?.path === entry.path) setClipboard(null)
    setTreeExpansionPath(result.value.path)
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.movedTo', { path: result.value.path }))
  }, [fileSession, editorDirty, path, clipboard, ctx])
  const runClipboardPaste = async (targetDir: string) => {
    if (!fileSession || !clipboard) return
    const sessionId = fileSession.sessionId
    const entry = clipboard
    setFileMenu(null)
    if (entry.op === 'copy') {
      const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'entry.copy', {
        sessionId,
        path: entry.path,
        targetDir,
      }))
      if (!result.ok) { setWorkbenchNote(errorMessage(result)); return }
      setTreeRevision((value) => value + 1)
      setWorkbenchNote(t('note.copiedTo', { path: result.value.path }))
      return
    }
    await moveTreeEntry(entry, targetDir)
  }
  const openTreeCreate = (kind: 'file' | 'folder', directory: string) => {
    if (!fileSession) return
    void (async () => {
      /* 与导航同一套保存 gate：有未保存内容先保存；空白稿纸/无选中文件直接放行。 */
      if (!(await saveEditorBeforeAction())) return
      if (fileMenu) yieldMenuToDialog()
      else fileManageReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : fileManageReturnFocus.current
      setCreateNote('')
      setTreeCreateRequest({ kind, directory })
    })()
  }
  const closeTreeCreate = () => {
    if (createBusy) return
    setTreeCreateRequest(null)
    setCreateNote('')
  }
  const submitTreeCreate = async (name: string) => {
    if (!fileSession || !treeCreateRequest) return
    const request = treeCreateRequest
    setCreateBusy(true)
    setCreateNote('')
    if (request.kind === 'folder') {
      const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'directory.create', {
        sessionId: fileSession.sessionId,
        path: request.directory ? `${request.directory}/${name}` : name,
      }))
      setCreateBusy(false)
      if (!result.ok) { setCreateNote(errorMessage(result)); return }
      setTreeCreateRequest(null)
      setTreeRevision((old) => old + 1)
      setWorkbenchNote(t('note.created', { path: result.value.path }))
      return
    }
    const fileName = /\.[a-z0-9]{1,8}$/i.test(name) ? name : `${name}.md`
    const target = request.directory ? `${request.directory}/${fileName}` : fileName
    const result = await safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'file.create', {
      sessionId: fileSession.sessionId,
      path: target,
      text: '',
    }))
    setCreateBusy(false)
    if (!result.ok) { setCreateNote(errorMessage(result)); return }
    setTreeCreateRequest(null)
    openDocument(target)
    setTreeRevision((old) => old + 1)
  }
  const commitSnapshot = async () => {
    if (!fileSession || snapshotBusy) return
    setSnapshotBusy(true)
    const label = snapshotTimeLabel(Date.now())
    const result = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.create', { sessionId: fileSession.sessionId, label }))
    setSnapshotBusy(false)
    if (!result.ok) { setWorkbenchNote(errorMessage(result)); return }
    setWorkbenchNote(t('note.committed', { label }))
    setSnapshotRevision((value) => value + 1)
  }
  const requestRollback = (snapshot: SnapshotResponse) => {
    if (snapshotBusy) return
    if (editorDirtyRef.current) { setWorkbenchNote(t('note.saveBeforeRollback')); return }
    setRollbackTarget(snapshot)
  }
  const confirmRollback = async () => {
    const target = rollbackTarget
    if (!fileSession || !target || snapshotBusy) return
    setSnapshotBusy(true)
    const result = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.rollback', { sessionId: fileSession.sessionId, snapshotId: target.snapshotId }))
    setSnapshotBusy(false)
    if (!result.ok) {
      /* 部分回滚：不声称零写入，展示安全快照并刷新各视图到真实的中间状态。 */
      const partial = partialApplyDetails(result)
      if (partial) {
        setRollbackTarget(null)
        const wrote = partial.appliedPaths.length ? t('note.rollbackPartialPaths', { count: partial.appliedPaths.length }) : ''
        const snapshot = partial.safetySnapshotId ? t('note.rollbackPartialSnapshot', { id: partial.safetySnapshotId }) : ''
        const backup = partial.recoveryPath ? t('note.rollbackPartialBackup', { path: partial.recoveryPath }) : ''
        setWorkbenchNote(t('note.rollbackPartial', { wrote, snapshot, backup }))
        setSnapshotRevision((value) => value + 1)
        setTreeRevision((value) => value + 1)
        setContentRevision((value) => value + 1)
        setOverviewRevision((value) => value + 1)
        return
      }
      setWorkbenchNote(errorMessage(result))
      return
    }
    setRollbackTarget(null)
    setWorkbenchNote(t('note.rolledBack', { label: target.label ?? target.createdAt }))
    setSnapshotRevision((value) => value + 1)
    setTreeRevision((value) => value + 1)
    setContentRevision((value) => value + 1)
    setOverviewRevision((value) => value + 1)
    try {
      const remaining = await collectWorkspaceFiles(ctx, fileSession.sessionId)
      if (path && !remaining.includes(path)) setPath('')
    } catch { /* 目录树刷新会带出最新状态 */ }
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
        warning = warning ? t('note.oldEntryNotRemoved', { warning }) : t('note.newOpenedOldRemains')
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
    /* 右侧对话回到这个作品上一次使用的会话；连接用的空白会话仍保留给文件 RPC。 */
    const workspaceListState = ctx.workspaces.list.getSnapshot()
    const sessionListState = ctx.sessions.list.getSnapshot()
    const workspaceView = workspaceListState.items.find((item) => item.workspaceId === pending.workspace.workspaceId) ?? pending.workspace
    const conversationWork = conversationWorkRecord(conversationScope.getSnapshot().value, pending.workspace.workspaceId)
    ctx.sessions.open(resumableConversationId({
      sessionIds: workspaceView.sessionIds,
      byId: sessionListState.byId ?? {},
      archivedIds: [
        ...(workspaceListState.archivedSessionIds ?? []),
        ...conversationWork.archivedIds as SessionId[],
        ...conversationWork.tombstoneIds as SessionId[],
      ],
      fallback: sessionId,
    }))
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
      const root = await safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: '.' }))
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      if (!root.ok) throw new Error(errorMessage(root))
      if (hasVisibleWorkspaceEntries(root.value.entries ?? [])) throw new Error('workspace has no supported text files')
      pendingWorkspaceOpen.current = pending
      setWorkspaceOpen({
        kind: 'needs-intent', workspaceId: pending.workspace.workspaceId,
        path: pending.workspace.path, title: pending.workspace.title, intent: 'create',
        message: t('note.folderNotWork'),
      })
      setHomeNote('')
      return
    }
    await finishWorkspaceOpen(pending, sessionId, initialPath)
  }
  const prepareNewWorkspace = async (pending: PendingWorkspaceOpen, sessionId: SessionId) => {
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    // 只按可见文件判定：新建作品只预建了空目录，不能因此被认为“已有其他内容”
    const allFiles = await collectWorkspaceFiles(ctx, sessionId)
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (allFiles.length) {
      const files = supportedWorkspaceTextPaths(allFiles)
      if (!files.length) throw new Error('new workspace folder contains unrelated files')
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
      ctx.sessions.clear()
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
      const connectedSessionId = await connectUsableWorkspaceSession(ctx, current.workspaceId, sessionId)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending.sessionId = connectedSessionId
      await prepareExistingWorkspace(pending, connectedSessionId, inspection.textFiles)
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
      const sessionId = await connectUsableWorkspaceSession(ctx, registration.workspace.workspaceId)
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
    ctx.sessions.clear()
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
    open={Boolean(newProject)}
    busy={newProject?.busy ?? false}
    note={newProject?.note ?? ''}
    returnFocusRef={workspaceMenuTrigger}
    onClose={closeNewProject}
    onCreate={(title: string) => void submitNewProject(title)} />
  const openSearchPanel = () => {
    if (!fileSession) return
    setFocusMode(false)
    setSidebarOpen(true)
    setSearchOpen(true)
    setPaletteOpen(false)
  }
  /* 记忆更新确认/撤销成功后的刷新：与提案 onApplied 同一套导航与刷新规则。 */
  const refreshAppliedPath = useCallback((appliedPath: string) => {
    const navigation = proposalAppliedNavigation(appliedPath, path, editorDirtyRef.current)
    setTreeRevision((old) => old + 1)
    if (navigation.expandPath) setTreeExpansionPath(navigation.expandPath)
    if (!navigation.openPath) {
      setWorkbenchNote(t('note.appliedDirty'))
      return
    }
    openDocument(navigation.openPath)
    if (navigation.refreshContent) setContentRevision((old) => old + 1)
  }, [openDocument, path])
  const openSeatDocument = useCallback((target: string, range?: ShellRange) => {
    openDocument(target, range ? {
      path: target,
      line: range.line ?? 1,
      column: range.column ?? 1,
      start: range.start,
      end: range.end,
      excerpt: range.excerpt ?? '',
      version: range.version ?? '',
    } : undefined)
  }, [openDocument])
  const BoundSeatProposalCard = useMemo(() => {
    function Card(props: ShellProposalCardProps) {
      return <BoundProposalCard {...props} ctx={ctx} />;
    }
    return Card
  }, [ctx])
  const [commandTick, setCommandTick] = useState(0)
  useEffect(() => commands.subscribe(() => setCommandTick((value) => value + 1)), [commands])
  const revealSidebar = useCallback(() => {
    setFocusMode(false)
    setSidebarOpen(true)
  }, [])
  const refreshSeat = useCallback((scope: 'tree' | 'content' | 'overview') => {
    if (scope === 'tree') setTreeRevision((value) => value + 1)
    else if (scope === 'content') setContentRevision((value) => value + 1)
    else setOverviewRevision((value) => value + 1)
  }, [])
  const toggleSeatPin = useCallback((target: string) => {
    setPinnedPath((current) => current === target ? null : target)
  }, [])
  /* seatContext 固化为真实依赖的 memo：不再每次渲染都换身份，插槽内容只在
     path/dirty/修订等字段变化时重渲染。 */
  const seatContext: ShellToolSeatContext = useMemo(() => ({
    sessionId: fileSession?.sessionId ?? '',
    activePath: path,
    editorDirty,
    treeRevision,
    contentRevision,
    locale,
    openDocument: openSeatDocument,
    onApplied: refreshAppliedPath,
    note: setWorkbenchNote,
    revealSidebar,
    refresh: refreshSeat,
    expandTreePath: setTreeExpansionPath,
    highlightTreePath: setHighlightPath,
    pinnedPath,
    togglePin: toggleSeatPin,
    ProposalCard: BoundSeatProposalCard,
    Select: HostSelect,
    Dialog: HostDialog,
    Button: HostButton,
    Input: HostInput,
    TextArea: HostTextArea,
  }), [fileSession?.sessionId, path, editorDirty, treeRevision, contentRevision, locale, openSeatDocument, refreshAppliedPath, revealSidebar, refreshSeat, toggleSeatPin, pinnedPath, BoundSeatProposalCard])
  seatContextRef.current = seatContext
  /* 注册表命令执行期经 proxy 读最新 seat；enabled 在投影构建时求值，所以
     依赖 memo 化的 seatContext 身份，不随无关根渲染重建。 */
  const seatRegistryContext = useMemo(() => new Proxy({} as ShellToolSeatContext, {
    get(_target, prop) {
      const current = seatContextRef.current
      return current ? Reflect.get(current, prop) : undefined
    },
    has(_target, prop) {
      const current = seatContextRef.current
      return current ? Reflect.has(current, prop) : false
    },
    ownKeys() {
      const current = seatContextRef.current
      return current ? Reflect.ownKeys(current) : []
    },
    getOwnPropertyDescriptor(_target, prop) {
      const current = seatContextRef.current
      if (!current) return undefined
      const descriptor = Reflect.getOwnPropertyDescriptor(current, prop)
      if (descriptor) descriptor.configurable = true
      return descriptor
    },
  }), [])
  const hasFileSession = Boolean(fileSession)
  const registryCommands = useMemo(
    () => registryPaletteItems(commands.list(), locale, seatRegistryContext, hasFileSession).map((item) => ({
      ...item,
      run: () => {
        setFocusMode(false)
        item.run()
      },
    })),
    [commandTick, commands, hasFileSession, locale, seatContext, seatRegistryContext],
  )
  /* 自动写入落盘后的轻量刷新：只刷新树与当前内容，不做编辑器导航。 */
  const refreshWrittenPath = useCallback((writtenPath: string) => {
    setTreeRevision((old) => old + 1)
    if (!editorDirtyRef.current && writtenPath === path) setContentRevision((old) => old + 1)
  }, [path])
  /* Chat 写入提案后的应用：与 refreshAppliedPath 同一套导航规则，供 memo 化的聊天下列复用。 */
  const onAppliedChat = useCallback((appliedPath: string) => {
    const navigation = proposalAppliedNavigation(appliedPath, path, editorDirtyRef.current)
    setTreeRevision((old) => old + 1)
    if (navigation.expandPath) setTreeExpansionPath(navigation.expandPath)
    if (!navigation.openPath) {
      setWorkbenchNote(t('note.appliedDirty'))
      return
    }
    openDocument(navigation.openPath)
    if (navigation.refreshContent) setContentRevision((old) => old + 1)
  }, [openDocument, path])
  /* 侧栏搜索命中/替换后的刷新：均经保存 gate 或内容修订，供 memo 化的侧栏列复用。 */
  const onSearchHitOpen = useCallback((hit: SearchHit) => openDocument(hit.path, hit), [openDocument])
  const onSearchReplaced = useCallback((paths: string[]) => {
    if (!paths.includes(path)) return
    const navigation = proposalAppliedNavigation(path, path, editorDirtyRef.current)
    if (navigation.refreshContent) setContentRevision((old) => old + 1)
  }, [path])
  const onSearchRequestOpen = useCallback(() => setSearchOpen(true), [])
  /* 树内新建文件/文件夹：openTreeCreate 读取 fileSession/fileMenu，二者列入依赖。 */
  const onTreeCreateFile = useCallback((directory: string) => openTreeCreate('file', directory), [fileSession, fileMenu])
  const onTreeCreateFolder = useCallback((directory: string) => openTreeCreate('folder', directory), [fileSession, fileMenu])
  const onCommitSnapshot = useCallback(() => { void commitSnapshot() }, [fileSession, snapshotBusy])
  const openHistoryPanel = useCallback(() => {
    closeWorkspaceChrome()
    setPaletteOpen(false)
    if (!fileSession) return
    setHistoryOpen(true)
  }, [fileSession])
  const onRequestRollback = useCallback((snapshot: SnapshotResponse) => requestRollback(snapshot), [snapshotBusy])
  /* 编辑器空态"新建"与句柄回传、保存回调：身份稳定，editorDirty 翻转不连带重渲染编辑列。 */
  const onEditorCreate = useCallback(() => openTreeCreate('file', defaultCreateDirectory({
    treeDirectory: fileMenu?.kind === 'directory' ? fileMenu.path : undefined,
    activePath: path,
  })), [fileSession, fileMenu, path])
  const onEditorHandle = useCallback((handle: EditorCoreHandle | null) => { editorHandleRef.current = handle }, [])
  const onEditorSaved = useCallback(() => {
    setOverviewRevision((value) => value + 1)
    if (path === pinnedPath) setContentRevision((value) => value + 1)
    progressRecord.schedule(() => { void recordSavedProgress() })
  }, [path, pinnedPath])
  /* 作者偏好/记忆/排版：由真实输入 memo，身份稳定，子列 memo 才能生效。 */
  const authorPreferences = useMemo(() => normalizeAuthorPreferences(writing.authorPreferences), [writing.authorPreferences])
  const authorMemory = useMemo(() => normalizeAuthorMemory(writing.authorMemory), [writing.authorMemory])
  const typography = useMemo(
    () => writingTypography(writing),
    [writing.fontSize, writing.lineHeight, writing.fontFamily, writing.paragraphSpacing, writing.paperWidth],
  )
  const registerFlowWorkspace = async (workspacePath: string) => {
    const registration = await createFlowWorkspace(ctx, workspacePath)
    if (registration.created) temporaryFlowWorkspaces.current.add(registration.workspace.workspaceId)
    return registration
  }
  const bindTemporarySource = (sessionId: string, workspaceId: string, created: boolean) => {
    if (created) temporarySourceWorkspaces.current.set(sessionId, workspaceId)
  }
  const cleanupFlowWorkspace = async (workspaceId: string): Promise<boolean> => {
    if (!temporaryFlowWorkspaces.current.has(workspaceId)) return true
    try {
      await ctx.workspaces.delete(workspaceId as WorkspaceId)
      temporaryFlowWorkspaces.current.delete(workspaceId)
      return true
    } catch {
      return false
    }
  }
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
      sourceSessionId = await ctx.uiWorkspace.connectWorkspace(sourceRegistration.workspace.workspaceId)
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
      if (error instanceof FlowWorkspaceCleanupError || !sourceCleaned) {
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
      if (current === flow.targetSessionId) ctx.sessions.clear()
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
    if (current === flow.targetSessionId) ctx.sessions.clear()
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
    if ((flow.kind === 'recover' || flow.kind === 'cleanup-confirm') && current === flow.targetSessionId) ctx.sessions.clear()
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
  const exportDocuments = async (directory?: string) => {
    closeWorkspaceChrome()
    setPaletteOpen(false)
    if (!fileSession) return
    if (!(await saveEditorBeforeAction())) { setExportChapters([]); return }
    const requestSessionId = fileSession.sessionId
    const target = directory === undefined ? exportDirectoryOf(path) : normalizeProjectDirectory(directory)
    setExporting(true)
    setExportNote(t('note.exportPreparing'))
    try {
      const chapters = await collectDocuments(ctx, requestSessionId, target)
      if (fileSessionIdRef.current !== requestSessionId) return
      setExportChapters(chapters)
      setExportNote(chapters.length ? t('note.exportReady') : t('note.exportEmpty'))
    } catch (error) {
      if (fileSessionIdRef.current !== requestSessionId) return
      const message = error instanceof Error ? error.message : ''
      setExportChapters([])
      setExportNote(/没有可导出|正文为空|empty|cannot export/i.test(message) ? message : t('note.exportFailed'))
    } finally {
      if (fileSessionIdRef.current === requestSessionId) setExporting(false)
    }
  }
  const confirmExport = (format: ExportFormat) => {
    if (!exportChapters?.length) return
    const title = currentWorkspace?.title || t('workspace.untitled')
    try {
      const prepared = prepareExport(exportChapters, title, format)
      downloadExport(prepared.filename, prepared.content, prepared.format)
      setExportNote(t('note.exportGenerated', { filename: prepared.filename }))
      setExportChapters(null)
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : t('note.exportFailed'))
    }
  }
  const loadArchives = async () => {
    if (!fileSession) return
    const ticket = archiveRequestGate.begin(fileSession.sessionId)
    setArchiveBusy(true)
    setArchiveNote('')
    const result = await safeRpcCall<ArchiveListResponse>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.list', { sessionId: fileSession.sessionId }))
    if (!archiveRequestGate.isCurrent(ticket)) return
    setArchiveBusy(false)
    if (!result.ok) { setArchiveNote(errorMessage(result)); return }
    setArchives(result.value.items)
    setArchiveInvalid(result.value.invalid)
  }
  const openArchivePanel = () => {
    closeWorkspaceChrome()
    setPaletteOpen(false)
    if (!fileSession) return
    setArchiveOpen(true)
    void loadArchives()
  }
  const archiveManaged = async (selectedPath: string) => {
    setFileMenu(null)
    if (!fileSession || archiveBusy) return
    if (editorDirty) { setWorkbenchNote(t('error.saveFirst')); return }
    setArchiveBusy(true)
    setWorkbenchNote('')
    const read = await safeRpcCall<{ version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', {
      sessionId: fileSession.sessionId,
      path: selectedPath,
    }))
    if (!read.ok) {
      setArchiveBusy(false)
      setWorkbenchNote(errorMessage(read))
      return
    }
    const archived = await safeRpcCall<ArchiveView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.apply', {
      sessionId: fileSession.sessionId,
      path: selectedPath,
      expectedVersion: read.value.version,
    }))
    setArchiveBusy(false)
    if (!archived.ok) { setWorkbenchNote(errorMessage(archived)); return }
    if (archived.value.state !== 'archived') { setWorkbenchNote(t('note.archiveIncomplete')); await loadArchives(); return }
    if (path === selectedPath) { setPath(''); setReveal(null) }
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.archived', { path: archived.value.path }))
    await loadArchives()
  }
  const continueArchive = async (item: ArchiveView) => {
    if (!fileSession || archiveBusy || editorDirty) { if (editorDirty) setArchiveNote(t('error.saveFirst')); return }
    setArchiveBusy(true)
    setArchiveNote('')
    const result = await safeRpcCall<ArchiveView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.apply', {
      sessionId: fileSession.sessionId,
      archiveId: item.archiveId,
    }))
    setArchiveBusy(false)
    if (!result.ok) { setArchiveNote(errorMessage(result)); return }
    setTreeRevision((value) => value + 1)
    await loadArchives()
  }
  const restoreArchived = async (item: ArchiveView) => {
    if (!fileSession || archiveBusy || editorDirty) { if (editorDirty) setArchiveNote(t('error.saveFirst')); return }
    if (!item.version) { setArchiveNote(t('note.archiveUnverified')); return }
    setArchiveBusy(true)
    setArchiveNote('')
    const result = await safeRpcCall<ArchiveView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.restore', {
      sessionId: fileSession.sessionId,
      archiveId: item.archiveId,
      expectedVersion: item.version,
    }))
    setArchiveBusy(false)
    if (!result.ok) { setArchiveNote(errorMessage(result)); return }
    if (result.value.state !== 'restored') { setArchiveNote(t('note.restoreBlocked')); await loadArchives(); return }
    setTreeRevision((value) => value + 1)
    openDocument(result.value.path)
    setWorkbenchNote(t('note.restored', { path: result.value.path }))
    await loadArchives()
  }
  /* 命令面板:复用 useTheme / openSettings / startWorkspaceFromPicker /
     startNewProject / openDocument / setFocusMode 全部已有的回调,palette
     本身只负责"按下执行"的分发。文件列表来自已加载好的 files 状态(已经
     是排过序的 .md/.txt),不另外发 RPC。 */
  const renderCommandPalette = () => <CommandPalette
    open={paletteOpen}
    onOpenChange={setPaletteOpen}
    theme={theme}
    onThemeChange={setTheme}
    onOpenWorkspace={() => { if (fileSession) { void openAnotherWorkspace() } else { void startWorkspaceFromPicker() } }}
    onNewProject={() => { void startNewProject() }}
    onOpenSettings={() => openSettings()}
    onToggleFocus={() => setFocusMode((value) => !value)}
    onOpenDocument={(target: string) => openDocument(target)}
    onOpenSearch={() => openSearchPanel()}
    registryCommands={registryCommands}
    onExport={() => { void exportDocuments() }}
    onOpenArchives={() => openArchivePanel()}
    onOpenHistory={() => openHistoryPanel()}
    onSplitAtCursor={() => beginChapterSplit(path, 'cursor')}
    canSplitAtCursor={Boolean(fileSession) && !editorDirty && isMarkdownChapterPath(path)}
    onToggleTypewriter={() => { void writingScope.set('typewriter', !writing.typewriter) }}
    onToggleFocusParagraph={() => { void writingScope.set('focusParagraph', !writing.focusParagraph) }}
    typewriter={writing.typewriter}
    focusParagraph={writing.focusParagraph}
    onPinCurrent={() => { if (canPinPath(path)) setPinnedPath(path) }}
    canPinCurrent={Boolean(fileSession) && canPinPath(path)}
    onUnpin={() => setPinnedPath(null)}
    pinnedPath={pinnedPath}
    hasWorkspace={Boolean(fileSession)}
    focusMode={focusMode}
    files={files}
    activePath={path} />
  const openAnotherWorkspace = async () => {
    closeWorkspaceChrome()
    if (!(await saveEditorBeforeAction())) return
    if (!(await canLeaveAssistantDraft())) return
    /* 草稿确认期间作者可能继续输入：确认后重新保存并核对当前身份。 */
    if (!(await saveEditorBeforeAction())) return
    setAssistantDraftDirty(false)
    await startWorkspaceFromPicker()
  }

  const chatSession = session ?? fileSession
  const sidebarVisible = sidebarOpen && !focusMode
  const sidebarInGrid = sidebarVisible && !compactChrome
  const assistantVisible = assistantOpen && !focusMode && assistantEnabled && !compactChrome
  const assistantInGrid = assistantVisible && !overlayAssistant
  const pinnedVisible = pinnedPath !== null && !focusMode
  /* 写作搭档面板始终挂载（草稿是 Chat 本地 state），关闭=折叠到 0 宽；
     窄窗 overlay 抽屉与网格共用同一实例，窗口越过断点不丢草稿。
     hooks 必须全部早于下方的首页早退分支，否则违反渲染顺序。 */
  const assistantPanelRef = useRef<PanelImperativeHandle>(null)
  useEffect(() => {
    const panel = assistantPanelRef.current
    if (!panel) return
    const sync = () => {
      if (assistantInGrid) { if (panel.isCollapsed()) panel.expand() }
      else if (!panel.isCollapsed()) panel.collapse()
    }
    /* 侧栏/钉住栏挂上或卸下时 Group 会重算尺寸；折叠态可能被 minSize 顶开。
       先同步一次，再在下一帧补一次，避免空列留在稿纸右侧。 */
    sync()
    const frame = globalThis.requestAnimationFrame(sync)
    return () => globalThis.cancelAnimationFrame(frame)
  }, [assistantInGrid, sidebarInGrid, pinnedVisible])

  if (workspaceOpen.kind === 'checking' || !fileSession || workspaceOpen.kind !== 'ready') {
    return (
      <ShellUiProvider theme={theme} accent={accent}>
        <HomeScreen
          workspaceOpen={workspaceOpen}
          extensionsDock={extensionsDock}
          openingWorkspace={openingWorkspace}
          newProjectBusy={Boolean(newProject)}
          onOpenWork={startWorkspaceFromPicker}
          onNewProject={startNewProject}
          homeCardOpen={homeCardOpen}
          homeCardNew={homeCardNew}
          pathFallbackForm={pathFallbackForm}
          onContinueIntent={continuePendingWorkspaceIntent}
          onCancelIntent={cancelPendingWorkspaceIntent}
          homeNote={homeNote}
          workspaces={workspaces.items}
          onOpenWorkspace={(workspace) => void openRegisteredWorkspace(workspace)}
          onRelocate={(workspace) => void relocateWorkspace(workspace)}
          removeRecentTarget={removeRecentTarget}
          onRequestRemoveRecent={requestRemoveRecent}
          onCancelRemoveRecent={() => setRemoveRecentTarget(null)}
          onConfirmRemoveRecent={() => void confirmRemoveRecent()}
          dialogs={<>
            {renderNewProjectDialog()}
            {renderCommandPalette()}
            {renderImportDialog()}
          </>}
          settingsDialog={<SettingsDialog
            open={settingsOpen}
            ctx={ctx}
            writingScope={writingScope}
            migrateWriting={migrateWriting}
            assistant={capabilityReady ? featureEnabled(capabilityState.value, 'assistant') : undefined}
            pluginsTab={pluginsSettings}
            zhihuTab={zhihuSettings}
            focusTab={settingsFocusTab}
            renderSlot={renderSlot}
            onClose={() => setSettingsOpen(false)} />}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSettings={openSettings} />
      </ShellUiProvider>
    );
  }

  const fileMenuChapterModel = fileMenu ? chapterMenuModel(fileMenu.path, chapterFiles) : null

  return (
    <ShellUiProvider theme={theme} accent={accent}>
      <main
        className={`shell layout-shell${focusMode ? ' focus-mode' : ''}${sidebarInGrid ? ' files-open' : ''}${assistantVisible ? ' assistant-open' : ''}${assistantInGrid ? ' assistant-in-grid' : ''}${assistantVisible && overlayAssistant ? ' assistant-overlay' : ''}${pinnedVisible ? ' pinned-open' : ''}`}
        ref={shellMainRef}
        style={{ minWidth: 0 }}>
        <WorkbenchTopbar
          workspaceChromeMotion={workspaceChromeMotion}
          workspaceMenuOpen={workspaceMenuOpen}
          onWorkspaceMenuOpenChange={(open: boolean) => { if (open) workspaceMenuYields.current = false; setWorkspaceMenuOpen(open) }}
          onWorkspaceMenuYield={() => { workspaceMenuYields.current = true }}
          menuTriggerRef={workspaceMenuTrigger}
          menuYieldsRef={workspaceMenuYields}
          currentWorkspace={currentWorkspace}
          workspaces={workspaces.items}
          openingWorkspace={openingWorkspace}
          newProjectBusy={Boolean(newProject)}
          exporting={exporting}
          onSwitchWorkspace={(workspaceId) => void switchToWorkspace(workspaceId)}
          onOpenAnotherWorkspace={() => void openAnotherWorkspace()}
          onNewProject={() => void startNewProject()}
          onExportDocuments={() => void exportDocuments()}
          onOpenArchive={openArchivePanel}
          onLeaveHome={() => void leaveToHome()}
          sidebarOpen={sidebarOpen}
          compactChrome={compactChrome}
          focusMode={focusMode}
          assistantOpen={assistantOpen}
          onToggleSidebar={() => setSidebarOpen((value) => !value)}
          onToggleFocusMode={() => setFocusMode((value) => !value)}
          onToggleAssistant={() => setAssistantOpen((value) => !value)}
          extensionsDock={extensionsDock}
          theme={theme}
          onThemeChange={setTheme}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSettings={openSettings} />
        <PanelGroup
          orientation="horizontal"
          className="shell-panels"
          resizeTargetMinimumSize={{ coarse: 28, fine: 12 }}
          onLayoutChanged={(_layout, meta) => {
            /* 拖动中途不要 setState：v4 会把变化中的 defaultSize 当成新布局，pointer capture 也会丢。 */
            if (!meta.isUserInteraction) return
            setSidebarWidth(sidebarWidthRef.current)
            if (assistantWidthRef.current > 0) setAssistantWidth(assistantWidthRef.current)
            setPinnedWidth(pinnedWidthRef.current)
          }}>
          {sidebarInGrid ? <>
            <Panel
              id="sidebar"
              className="shell-panel"
              defaultSize={sidebarWidth}
              minSize={SIDEBAR_MIN}
              maxSize={SIDEBAR_MAX}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size: PanelSize) => { if (size.inPixels > 0) sidebarWidthRef.current = panelPixels(size) }}>
              <SidebarColumn
                ctx={ctx}
                sessionId={fileSession.sessionId}
                searchOpen={searchOpen}
                onSearchRequestOpen={onSearchRequestOpen}
                onOpenDocument={openDocument}
                onSearchReplaced={onSearchReplaced}
                activePath={path}
                activeDirty={editorDirty}
                fileRevision={treeRevision}
                historyOpen={historyOpen}
                snapshotBusy={snapshotBusy}
                onCommitSnapshot={onCommitSnapshot}
                onOpenHistory={openHistoryPanel}
                createNote={createNote}
                workspaceWarning={workspaceOpen.warning}
                workbenchNote={workbenchNote}
                expandPath={treeExpansionPath}
                highlightPath={highlightPath ?? undefined}
                onOpen={openDocument}
                onPreviewImage={openImagePreview}
                onFileMenu={openFileMenu}
                onCreateFile={onTreeCreateFile}
                onCreateFolder={onTreeCreateFolder}
                onMove={moveTreeEntry}
                renderSlot={renderSlot}
                seatContext={seatContext} />
            </Panel>
            <PanelResizeHandle
              className="panel-resizer left"
              aria-label={t('workspace.resizeFiles')}
              title={t('resizer.aria', { label: t('workspace.resizeFiles') })} />
          </> : null}
          <Panel id="editor" className="shell-panel editor-cell" minSize={420}>
            <EditorColumn
              ctx={ctx}
              fileSession={fileSession}
              path={path}
              files={isManuscriptChapterPath(path) ? chapterFiles : files}
              referenceFiles={files}
              referenceRevision={treeRevision}
              onOpenReference={openDocument}
              onPinReference={setPinnedPath}
              onCreate={onEditorCreate}
              onHandle={onEditorHandle}
              contentRevision={contentRevision}
              onDirtyChange={setEditorDirty}
              reveal={reveal}
              completionPreference={writing.completion}
              completionEnabled={capabilityReady ? featureEnabled(capabilityState.value, 'completion') : false}
              authorPreferences={authorPreferences}
              authorMemory={authorMemory}
              typewriter={writing.typewriter}
              focusParagraph={writing.focusParagraph}
              typography={typography}
              onSaved={onEditorSaved} />
            <CenterOverlays
              show={Boolean(fileSession) && !focusMode}
              renderSlot={renderSlot}
              seatContext={seatContext} />
          </Panel>
          {pinnedVisible && pinnedPath ? <>
            <PanelResizeHandle
              className="panel-resizer right"
              aria-label={t('pin.resize')}
              title={t('resizer.aria', { label: t('pin.resize') })} />
            <Panel
              id="pinned"
              className="shell-panel"
              defaultSize={pinnedWidth}
              minSize={PINNED_MIN}
              maxSize={PINNED_MAX}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size: PanelSize) => { if (size.inPixels > 0) pinnedWidthRef.current = panelPixels(size) }}>
              <PinnedPane
                ctx={ctx}
                sessionId={fileSession.sessionId}
                path={pinnedPath}
                treeRevision={treeRevision}
                contentRevision={contentRevision}
                onUnpin={() => setPinnedPath(null)}
                onOpenDocument={(cardPath: string) => {
                  setTreeExpansionPath(cardPath)
                  openDocument(cardPath)
                }}
                onMissing={() => {
                  setWorkbenchNote(t('pin.missing'))
                  setPinnedPath(null)
                }} />
            </Panel>
          </> : null}
          {assistantInGrid ? <PanelResizeHandle
            className="panel-resizer right"
            aria-label={t('workspace.resizeAssistant')}
            title={t('resizer.aria', { label: t('workspace.resizeAssistant') })} /> : null}
          {assistantEnabled && chatSession ? <Panel
            id="assistant"
            className="shell-panel"
            panelRef={assistantPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize={assistantWidth}
            minSize={ASSISTANT_MIN}
            maxSize={ASSISTANT_MAX}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size: PanelSize) => { if (size.inPixels > 0) assistantWidthRef.current = panelPixels(size) }}>
            <ChatColumn
              ctx={ctx}
              chatSession={chatSession}
              workspaceId={currentWorkspace?.workspaceId}
              activePath={path}
              authorPreferences={authorPreferences}
              authorMemory={authorMemory}
              chatModel={writing.chatModel}
              onAcceptMemory={onAcceptMemory}
              hidden={!assistantVisible}
              overlay={assistantVisible && overlayAssistant}
              onConfigure={openSettings}
              onDraftDirtyChange={setAssistantDraftDirty}
              onWritten={refreshWrittenPath}
              onApplied={onAppliedChat} />
          </Panel> : null}
        </PanelGroup>
        {assistantVisible && overlayAssistant ? <ThemesButton
          type="button"
          variant="ghost"
          color="gray"
          className="chat-overlay-dismiss"
          aria-label={t('workspace.hideAssistant')}
          onClick={() => setAssistantOpen(false)} /> : null}
        {!assistantVisible && !focusMode && !compactChrome ? (
          capabilityState.kind === 'error'
            ? <Callout.Root className="assistant-launcher capability-note" color="red" role="alert">
            <Flex direction="column" gap="2">
              <Callout.Text>
                {t('capabilities.loadFailed', { error: capabilityState.message })}
              </Callout.Text>
              <ThemesButton size="1" variant="solid" type="button" onClick={shellCapabilities.retry}>
                {t('capabilities.retry')}
              </ThemesButton>
            </Flex>
          </Callout.Root>
            : !capabilityReady
              ? <Callout.Root className="assistant-launcher capability-note" role="status">
            <Flex align="center" gap="2">
              <ActivityDots />
              <Callout.Text>
                {t('capabilities.loading')}
              </Callout.Text>
            </Flex>
          </Callout.Root>
              : assistantEnabled
                ? <IconButton
            className="assistant-launcher"
            variant="solid"
            size="3"
            type="button"
            aria-label={t('workspace.openAssistant')}
            aria-expanded={false}
            onClick={() => setAssistantOpen(true)}>
            <span aria-hidden="true">
              <DeepSeekWhaleMark />
            </span>
          </IconButton>
                : null
        ) : null}
        <ConfirmDialog
          open={Boolean(leaveConfirm)}
          id="leave-assistant-draft"
          title={t('chat.discardDraftTitle')}
          message={t('chat.leaveDraftBody')}
          confirmLabel={t('chat.discardAndContinue')}
          onCancel={() => resolveLeaveConfirm(false)}
          onConfirm={() => resolveLeaveConfirm(true)} />
        <TextPromptDialog
          open={Boolean(treeCreateRequest)}
          id="tree-create"
          title={treeCreateRequest?.kind === 'folder' ? t('workspace.newFolder') : t('workspace.newFile')}
          label={treeCreateRequest?.kind === 'folder' ? t('workspace.folderName') : t('workspace.fileName')}
          initialValue=""
          confirmLabel={t('common.create')}
          busy={createBusy}
          returnFocusRef={fileManageReturnFocus}
          onCancel={closeTreeCreate}
          onConfirm={(name: string) => void submitTreeCreate(name)} />
        <ConfirmDialog
          open={Boolean(rollbackTarget)}
          id="snapshot-rollback"
          title={t('workspace.rollbackTitle')}
          message={t('workspace.rollbackBody', { label: rollbackTarget?.label ?? rollbackTarget?.createdAt ?? '' })}
          confirmLabel={t('workspace.rollback')}
          onCancel={() => setRollbackTarget(null)}
          onConfirm={() => void confirmRollback()} />
        {renderNewProjectDialog()}
        {fileMenu ? <FileContextMenu
          kind={fileMenu.kind}
          path={fileMenu.path}
          x={fileMenu.x}
          y={fileMenu.y}
          canPaste={Boolean(clipboard)}
          onClose={closeFileMenu}
          onDismissFocus={restoreTreeTriggerIfMenuDismissed}
          onCreateFile={() => openTreeCreate('file', defaultCreateDirectory({
            treeDirectory: fileMenu.kind === 'directory' ? fileMenu.path : parentOf(fileMenu.path),
            activePath: path,
          }))}
          onCreateFolder={() => openTreeCreate('folder', defaultCreateDirectory({
            treeDirectory: fileMenu.kind === 'directory' ? fileMenu.path : parentOf(fileMenu.path),
            activePath: path,
          }))}
          onExportDirectory={() => { void exportDocuments(fileMenu.kind === 'directory' ? fileMenu.path : undefined) }}
          onCopy={() => setClipboardFromMenu('copy', fileMenu.kind, fileMenu.path)}
          onCut={() => setClipboardFromMenu('cut', fileMenu.kind, fileMenu.path)}
          onPaste={() => void pasteFromMenu()}
          onRename={() => {
            /* 文件行保留原有 file.rename 流程（需要 expectedVersion）；
               目录行走 workbench entry.rename（不需要 version）。 */
            if (fileMenu.kind === 'file') openRenameDialog(fileMenu.path)
            else {
              yieldMenuToDialog()
              setRenameTarget({ kind: 'directory', path: fileMenu.path })
              setManageNote('')
            }
          }}
          onArchive={() => void archiveManaged(fileMenu.path)}
          canArchive={canArchivePath(fileMenu.kind, fileMenu.path)}
          onDelete={() => requestDeleteEntry(fileMenu.kind, fileMenu.path)}
          onSplit={() => beginChapterSplit(fileMenu.path, 'tree')}
          onMergePrevious={() => beginChapterMerge(fileMenu.path, 'previous')}
          onMergeNext={() => beginChapterMerge(fileMenu.path, 'next')}
          canSplit={fileMenuChapterModel?.canSplit ?? false}
          canMergePrevious={fileMenuChapterModel?.canMergePrevious ?? false}
          canMergeNext={fileMenuChapterModel?.canMergeNext ?? false}
          splitDisabledTitle={fileMenuChapterModel?.splitDisabledTitle ?? ''}
          mergePreviousDisabledTitle={fileMenuChapterModel?.mergePreviousDisabledTitle ?? ''}
          mergeNextDisabledTitle={fileMenuChapterModel?.mergeNextDisabledTitle ?? ''}
          onPin={() => { setPinnedPath(fileMenu.path); setFileMenu(null) }}
          onUnpin={() => { setPinnedPath(null); setFileMenu(null) }}
          isPinned={pinnedPath === fileMenu.path} /> : null}
        {fileSession ? <ChapterOpsLayer
          ctx={ctx}
          sessionId={fileSession.sessionId}
          files={files}
          request={chapterOps}
          getEditorSnapshot={() => snapshotFromHandle(editorHandleRef.current)}
          onClose={() => setChapterOps(null)}
          onApplied={applyChapterOps}
          returnFocusRef={fileManageReturnFocus} /> : null}
        <TextPromptDialog
          open={Boolean(managePath)}
          id="rename-file"
          title={t('workspace.renameFile')}
          label={t('workspace.newName')}
          initialValue={managePath?.split('/').at(-1) ?? ''}
          confirmLabel={t('workspace.saveNewName')}
          returnFocusRef={fileManageReturnFocus}
          onCancel={closeRenameDialog}
          onConfirm={renameManaged} />
        <TextPromptDialog
          open={Boolean(renameTarget)}
          id="rename-entry"
          title={renameTarget?.kind === 'directory' ? t('workspace.renameFolder') : t('common.rename')}
          label={t('workspace.newName')}
          initialValue={renameTarget?.path.split('/').at(-1) ?? ''}
          confirmLabel={t('workspace.saveNewName')}
          note={manageNote}
          busy={manageBusy}
          returnFocusRef={fileManageReturnFocus}
          onCancel={closeRenameEntryDialog}
          onConfirm={submitRenameEntry} />
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          id="delete-entry"
          title={deleteTarget?.kind === 'directory' ? t('workspace.deleteFolderTitle') : t('workspace.deleteFileTitle')}
          message={t('workspace.deleteBody', { path: deleteTarget?.path ?? '' })}
          confirmLabel={t('common.delete')}
          returnFocusRef={fileManageReturnFocus}
          onCancel={closeDeleteConfirm}
          onConfirm={() => void confirmDeleteEntry()} />
        {renderCommandPalette()}
        {renderImportDialog()}
        <ExportPreviewDialog
          open={exporting || exportChapters !== null}
          chapters={exportChapters ?? []}
          title={currentWorkspace?.title || t('workspace.untitled')}
          busy={exporting}
          note={exportNote}
          returnFocusRef={workspaceMenuTrigger}
          onCancel={() => { setExportChapters(null); setExportNote('') }}
          onExport={confirmExport} />
        <ShellErrorBoundary>
          <HistoryPanel
            open={historyOpen}
            snapshots={snapshots}
            busy={snapshotBusy}
            editorDirty={editorDirty}
            onRollback={onRequestRollback}
            onClose={() => { if (!snapshotBusy) setHistoryOpen(false) }} />
        </ShellErrorBoundary>
        {DOCUMENT_ARCHIVE_UI ? <ArchivePanel
          open={archiveOpen}
          items={archives}
          invalid={archiveInvalid}
          busy={archiveBusy}
          note={archiveNote}
          editorDirty={editorDirty}
          returnFocusRef={workspaceMenuTrigger}
          onRestore={(item: ArchiveView) => void restoreArchived(item)}
          onContinue={(item: ArchiveView) => void continueArchive(item)}
          onClose={() => { if (!archiveBusy) setArchiveOpen(false) }} /> : null}
        <HostDialog
          open={Boolean(manualWorkspaceMode)}
          onOpenChange={(next: boolean) => { if (!next) closePathFallback() }}
          title={t('home.pathLabel')}
          className="file-dialog path-fallback-dialog file-dialog-overlay"
          overlayClassName="file-dialog-overlay"
          dismissible={!openingWorkspace}
          initialFocusRef={pathFallbackInput}
          returnFocusRef={workspaceMenuTrigger}>
          {pathFallbackForm}
        </HostDialog>
        <ImagePreviewOverlay
          open={Boolean(imagePreview)}
          path={(imagePreview ?? lastImagePreview.current)?.path ?? ''}
          url={(imagePreview ?? lastImagePreview.current)?.url ?? ''}
          onClose={closeImagePreview} />
        <SettingsDialog
          open={settingsOpen}
          ctx={ctx}
          writingScope={writingScope}
          migrateWriting={migrateWriting}
          assistant={capabilityReady ? featureEnabled(capabilityState.value, 'assistant') : undefined}
          pluginsTab={pluginsSettings}
          zhihuTab={zhihuSettings}
          focusTab={settingsFocusTab}
          renderSlot={renderSlot}
          onClose={() => setSettingsOpen(false)} />
        {startupUpdate && !settingsOpen ? <Callout.Root className="update-toast" role="status">
          <Flex align="center" gap="3">
            <Text className="update-toast-text" size="2">
              {t('about.toast', { version: startupUpdate.version })}
            </Text>
            <ThemesButton
              size="1"
              variant="solid"
              type="button"
              className="update-toast-action"
              onClick={() => { setStartupUpdate(null); openSettings('about') }}>
              {t('about.viewDetails')}
            </ThemesButton>
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              type="button"
              className="icon-button update-toast-close"
              aria-label={t('about.dismissToast')}
              onClick={() => setStartupUpdate(null)}>
              ×
            </IconButton>
          </Flex>
        </Callout.Root> : null}
      </main>
    </ShellUiProvider>
  );
}

type RegisterShellRootOptions = {
  writingScope: SettingsScope<WritingPreferences>
  migrateWriting: WritingMigration
  hostThemeSync?: HostThemeSync
  commands: ShellCommandRegistry
  registerRoot: (ctx: ShellContext, render: (props: unknown) => ReactNode) => void
}

// The renderer injects renderSlot into the root entry's props. The dock is a
// launcher rail hosted inside the top chrome (see .shell-extensions-dock in
// styles.ts): a reserved layout strip rather than a full-screen overlay, so
// collapsed launchers can never cover the composer. The rail stays
// click-through and each contributed component opts into pointer events;
// open panels position against their launcher via the --dsh-ext-* contract.
type RootSlotProps = { renderSlot?: SettingsRenderSlot }

function ExtensionsDock(props: { rootProps: unknown }) {
  const renderSlot = (props.rootProps as RootSlotProps | null | undefined)?.renderSlot
  return (
    <div className="shell-extensions-dock" data-testid="shell-extensions-dock">
      {renderSlot ? renderSlot(EXTENSIONS_SLOT, HOST_UI_OWNER) : null}
    </div>
  );
}

/* 样式一次注入 document.head（镜像面板包的 injectStyles 模式）：50KB 常量字符串
   不再作为 React 子节点参与每次渲染的 diff。注册即注入，早于 root 首次渲染，无 FOUC；
   去重标记保证 effect 重跑不会重复插入。 */
function injectShellStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const css = radixThemesStyles + redesignedStyles
  const existing = document.head.querySelector('style[data-dsh-editor-shell-styles]')
  if (existing) {
    existing.setAttribute('data-plugin', 'dsh-editor-shell')
    existing.textContent = css
    return () => existing.remove()
  }
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'dsh-editor-shell')
  style.setAttribute('data-dsh-editor-shell-styles', '')
  style.textContent = css
  document.head.appendChild(style)
  return () => style.remove()
}

export function registerShellRoot(ctx: Context, options: RegisterShellRootOptions): void {
  if (typeof document !== 'undefined') ctx.effect(() => injectShellStyles(), 'dsh-editor-shell-client.styles')
  const client = ctx as ShellContext
  options.registerRoot(client, (props) => <ShellErrorBoundary>
    <Root
      ctx={client}
      writingScope={options.writingScope}
      migrateWriting={options.migrateWriting}
      hostThemeSync={options.hostThemeSync}
      commands={options.commands}
      renderSlot={(props as RootSlotProps).renderSlot}
      extensionsDock={<ExtensionsDock rootProps={props} />}
      pluginsSettings={(props as RootSlotProps).renderSlot?.(PLUGINS_SETTINGS_SLOT, HOST_UI_OWNER) ?? null}
      zhihuSettings={(props as RootSlotProps).renderSlot?.(ZHIHU_SETTINGS_SLOT, HOST_UI_OWNER) ?? null} />
  </ShellErrorBoundary>)
}

// re-exports so external spec files still see the surface area of the old monolith
export { isSuccessWorkbenchNote as _isSuccessWorkbenchNote, searchSkippedText as _searchSkippedText } from './shared.ts'
