import {
  createElement as e,
  useEffect,
  useMemo,
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
  type ArchiveListResponse,
  type ChapterStatus,
  type ProjectContextReceiptBundle,
  type ProjectInspectionResponse,
  type ProjectOverview,
  type SnapshotResponse,
} from 'dsh-editor-workbench/contracts'
import { AUTHOR_MEMORY_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from '../author-preferences.ts'
import { sortChapterPaths } from '../project-files.ts'
import { EXTENSIONS_SLOT, registerRoot } from '../root-registration.ts'
import { writingPreferences, writingTypography, type WritingMigration, type WritingPreferences } from '../writing-settings.ts'
import { CONVERSATION_SETTINGS_NAMESPACE, conversationWorkRecord, decodeConversationSettings } from '../conversation-store.ts'
import {
  localDateKey,
  nextBaselines,
  progressChipProps,
  writingProgressFor,
  type WritingProgress,
  type WritingProgressScope,
} from '../writing-progress.ts'
import { applyChapterStatus, buildChapterStatusMap } from '../overview-view.ts'
import { PROGRESS_RECORD_DEBOUNCE_MS, createDebouncedInvoker, progressRecordChars } from '../progress-record.ts'
import { redesignedStyles } from '../styles.ts'
import { errorMessage, isStaleFailure, partialApplyDetails, resumableConversationId, safeRpcCall, snapshotTimeLabel, storedPanelOpen, storedPanelWidth, workspaceShortcut, type RevealRequest, type RpcResult, type ShellContext, type WorkspaceOpenState, type PendingWorkspaceOpen, type WorkspaceIntent, LatestRequestGate, claimInitialWorkspaceResume, hasRelocatableManuscriptFiles, hasVisibleWorkspaceEntries, isSessionMissing, proposalAppliedNavigation, relocationFailureMessage, supportedWorkspaceTextPaths, workspaceOpenFailureMessage, createFlowWorkspace, FlowWorkspaceCleanupError } from './shared.ts'
import { currentSession, DeepSeekWhaleMark, ImagePreviewOverlay, PaperStage, PanelResizer, useObservable } from './components.ts'
import { ConfirmDialog, NewProjectDialog, TextPromptDialog } from './dialogs.ts'
import { SettingsDialog, SettingsTrigger } from './settings.tsx'
import { ThemeToggle, useTheme, type HostThemeSync } from './theme.ts'
import { Tree, FileContextMenu } from './sidebar.ts'
import { ChapterOpsLayer, chapterMenuModel, requestMergeChapter, requestSplitChapter, shouldOpenAfterChapterApply, snapshotFromHandle, type ChapterOpsRequest, type EditorSnapshotHandle } from './chapter-ops.ts'
import { isMarkdownChapterPath } from '../chapter-ops-view.ts'
import { Editor } from './editor.ts'
import { Chat } from './chat.ts'
import { useShellCapabilities } from './capabilities.ts'
import { CommandPalette, CommandPaletteTrigger } from './command-palette.tsx'
import { WindowControls, titleBarDoubleClick, windowBridge } from './window-controls.tsx'
import { AboutUpdateDialog } from './about-dialog.tsx'
import { SearchPanel, toRevealRequest, type SearchHit } from './search-panel.ts'
import { OverviewPanel } from './overview-panel.ts'
import { ProofreadPanel, type ProofreadRequest } from './proofread-panel.ts'
import { CardsDetail, CardsPanel, type CardsCatalog } from './cards-panel.ts'
import { PinnedPane } from './pinned-pane.ts'
import { canPinPath, pinnedLayoutColumns, storedPinnedPath, validatePinnedPath } from '../pinned-pane-view.ts'
import { isCharacterCardPath, isWorldbookCardPath } from '../cards-view.ts'
import type { ProofreadFinding } from '../proofread-view.ts'
import { collectChapters, downloadExport, ExportPreviewDialog } from './export-dialog.ts'
import { prepareExport, type ChapterExport, type ExportFormat } from '../export.ts'
import { idleImportFlow, importReview, recoverImport, type ImportFlow, type ImportProbeView } from './import-flow.ts'
import { ImportDialog } from './import-dialog.ts'
import { ArchivePanel, canArchivePath, type ArchiveView } from './archive.ts'
import { t, useLocale } from '../i18n/index.ts'


const SIDEBAR_DEFAULT = 248
const SIDEBAR_MIN = 196
const SIDEBAR_MAX = 420
const ASSISTANT_DEFAULT = 384
const ASSISTANT_MIN = 300
const ASSISTANT_MAX = 560
const PINNED_DEFAULT = 340
const PINNED_MIN = 260
const PINNED_MAX = 560

/* 首页入口卡的图标(线性几何,1.6px stroke,1.5 视口单位的内边距)。
   故意做成 currentColor 的描边色,颜色由 CSS 控制,符合纸/墨双主题。 */
function FolderIcon() {
  return e('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', 'aria-hidden': 'true' },
    e('path', { d: 'M3.5 7.5a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.6 1.6a2 2 0 0 0 1.4.6h4.4a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' }),
    e('path', { d: 'M3.5 9.5h17' }),
  )
}
function NewDocIcon() {
  return e('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round', 'aria-hidden': 'true' },
    e('path', { d: 'M7 3.5h6.5l4 4v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z' }),
    e('path', { d: 'M13.5 3.5v4h4' }),
    e('path', { d: 'M12 11v7M8.5 14.5h7' }),
  )
}

/* 把 WorkspaceView.updatedAt(ISO-8601)格式化为首页最近作品区使用的简短时间标签:
   60 秒内=刚刚,1 小时内=分钟前,今天=小时前,昨天,7 天内=天数前,
   更早用 M月D日(同年)或 YYYY/MM/DD(跨年)。失败时退回到空串,DOM 仍能挂上小标签。 */
function formatRecentTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return ''
  const diff = Math.max(0, now.getTime() - stamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return t('time.justNow')
  if (diff < hour) return t('time.minutesAgo', { count: Math.floor(diff / minute) })
  if (diff < day && now.getDate() === new Date(stamp).getDate()) return t('time.hoursAgo', { count: Math.floor(diff / hour) })
  const stampDate = new Date(stamp)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (stampDate.getFullYear() === yesterday.getFullYear() && stampDate.getMonth() === yesterday.getMonth() && stampDate.getDate() === yesterday.getDate()) return t('time.yesterday')
  if (diff < 7 * day) return t('time.daysAgo', { count: Math.floor(diff / day) })
  if (stampDate.getFullYear() === now.getFullYear()) return t('time.monthDay', { month: stampDate.getMonth() + 1, day: stampDate.getDate() })
  const yyyy = stampDate.getFullYear()
  const mm = String(stampDate.getMonth() + 1).padStart(2, '0')
  const dd = String(stampDate.getDate()).padStart(2, '0')
  return `${yyyy}/${mm}/${dd}`
}

type TreeCreateRequest = { kind: 'file' | 'folder'; directory: string }
type FileSession = NonNullable<NonNullable<ReturnType<ShellContext['sessions']['binding']>>['session']> | undefined

type FileMenuKind = 'file' | 'directory'
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

/** 关于/更新 入口:与 SettingsTrigger 同节奏的轻量顶栏按钮。 */
function AboutTrigger(props: { onOpen(): void }): ReactNode {
  return e('button', {
    type: 'button',
    className: 'about-trigger',
    'aria-haspopup': 'dialog',
    'aria-label': t('about.triggerAria'),
    title: t('about.triggerAria'),
    onClick: props.onOpen,
  },
    e('span', { className: 'about-trigger-icon', 'aria-hidden': true }, 'ⓘ'),
    t('about.trigger'),
  )
}

function Root({ ctx, writingScope, migrateWriting, progressScope, hostThemeSync, extensionsDock }: {
  ctx: ShellContext
  writingScope: SettingsScope<WritingPreferences>
  migrateWriting: WritingMigration
  progressScope: WritingProgressScope
  hostThemeSync?: HostThemeSync
  extensionsDock?: ReactNode
}) {
  useLocale()
  /* 可选 AI 能力：加载完成前不挂载 Chat / 自动索引;失败是显式错误态(可重试)。 */
  const shellCapabilities = useShellCapabilities(ctx)
  const capabilityState = shellCapabilities.state
  const capabilityReady = capabilityState.kind === 'ready'
  const assistantEnabled = capabilityState.kind === 'ready' && capabilityState.value.assistant
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
  const onAcceptMemory = async (observation: string): Promise<boolean> => {
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
  }
  const progressSnapshot = useObservable(progressScope)
  const writingProgress: WritingProgress = writingProgressFor(progressSnapshot)
  const writableProgress = progressSnapshot.status === 'ready' && progressSnapshot.writable !== false
  const [path, setPath] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [workbenchNote, setWorkbenchNote] = useState('')
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
  const [pinnedPath, setPinnedPath] = useState<string | null>(() => {
    const stored = storedPinnedPath('dsh-editor.layout.pinned-path')
    return stored && canPinPath(stored) ? stored : null
  })
  const [pinnedWidth, setPinnedWidth] = useState(() => storedPanelWidth('dsh-editor.layout.pinned-width', PINNED_DEFAULT, PINNED_MIN, PINNED_MAX))
  const [assistantDraftDirty, setAssistantDraftDirty] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState<{ resolve(value: boolean): void } | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [chatFocusNonce, setChatFocusNonce] = useState(0)
  const [overview, setOverview] = useState<ProjectOverview | null | undefined>(null)
  const [overviewRevision, setOverviewRevision] = useState(0)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [overviewNote, setOverviewNote] = useState('')
  const [statusBusyPath, setStatusBusyPath] = useState<string | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [fileMenu, setFileMenu] = useState<FileMenuState>(null)
  const [chapterOps, setChapterOps] = useState<ChapterOpsRequest | null>(null)
  const editorHandleRef = useRef<EditorSnapshotHandle | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardEntry>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; kind: FileMenuKind } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ path: string; kind: FileMenuKind } | null>(null)
  const [imagePreview, setImagePreview] = useState<{ path: string; url: string } | null>(null)
  const [managePath, setManagePath] = useState<string | null>(null)
  const [manageBusy, setManageBusy] = useState(false)
  const [manageNote, setManageNote] = useState('')
  const [theme, setTheme] = useTheme(undefined, hostThemeSync)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [proofreadOpen, setProofreadOpen] = useState(false)
  const [proofreadRequest, setProofreadRequest] = useState<ProofreadRequest | null>(null)
  const [cardsOpen, setCardsOpen] = useState(false)
  const [cardsKind, setCardsKind] = useState<'character' | 'worldbook'>('character')
  const [cardsSelectedPath, setCardsSelectedPath] = useState<string | null>(null)
  const [cardsCatalog, setCardsCatalog] = useState<CardsCatalog>({ characters: [], worldbook: [] })
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
  const [importTitle, setImportTitle] = useState<{ busy: boolean; note: string } | null>(null)
  const importReturnFocus = useRef<HTMLElement | null>(null)
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
  const openSettings = () => setSettingsOpen(true)
  const overviewRequestGate = useRef(new LatestRequestGate()).current
  const progressRecord = useRef(createDebouncedInvoker(PROGRESS_RECORD_DEBOUNCE_MS)).current
  const fileSessionRef = useRef(fileSession)
  fileSessionRef.current = fileSession
  useEffect(() => () => progressRecord.cancel(), [progressRecord])
  const workspaceOpenGate = useRef(new LatestRequestGate()).current
  const pendingWorkspaceOpen = useRef<PendingWorkspaceOpen | null>(null)
  const initialWorkspaceResumeStarted = useRef(false)
  const createReturnFocus = useRef<HTMLElement | null>(null)
  const fileManageReturnFocus = useRef<HTMLElement | null>(null)
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
      if (action === 'overview') {
        if (workspaceOpen.kind !== 'ready') return
        setFocusMode(false)
        setOverviewOpen(true)
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
      if (action === 'proofread') {
        if (workspaceOpen.kind !== 'ready') return
        setFocusMode(false)
        setSidebarOpen(true)
        setProofreadOpen(true)
        setProofreadRequest({ scope: path ? 'document' : 'manuscript', nonce: Date.now() })
        return
      }
      if (action === 'cards-character' || action === 'cards-worldbook') {
        if (workspaceOpen.kind !== 'ready') return
        const kind = action === 'cards-character' ? 'character' : 'worldbook'
        setFocusMode(false)
        setSidebarOpen(true)
        setCardsOpen(true)
        setCardsKind(kind)
        setCardsSelectedPath((current) => {
          if (!current) return current
          return (kind === 'character' ? isCharacterCardPath(current) : isWorldbookCardPath(current)) ? current : null
        })
        return
      }
      if (editorDirty) return
      const buttons = document.querySelectorAll<HTMLButtonElement>('.chapter-navigation button')
      const button = action === 'previous-chapter' ? buttons[0] : buttons[1]
      if (button && !button.disabled) button.click()
    }
    globalThis.addEventListener('keydown', hotkey, true)
    return () => globalThis.removeEventListener('keydown', hotkey, true)
  }, [assistantEnabled, editorDirty, focusMode, path, session?.sessionId, workspaceOpen.kind, writing.typewriter, writing.focusParagraph])
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
    setSearchOpen(false); setProofreadOpen(false); setProofreadRequest(null); setCardsOpen(false); setCardsSelectedPath(null); setCardsCatalog({ characters: [], worldbook: [] }); setReveal(null); setExportChapters(null); setExportNote('')
    setOverviewOpen(false); setOverviewNote(''); setStatusBusyPath(null); progressRecord.cancel()
    setArchiveOpen(false); setArchives([]); setArchiveNote('')
  }, [openWorkspaceId])
  useEffect(() => {
    if (!historyOpen || !fileSession) { setSnapshots(null); return }
    let live = true
    void (async () => {
      const result = await safeRpcCall<SnapshotResponse[]>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.list', { sessionId: fileSession.sessionId }))
      if (!live) return
      setSnapshots(result.ok ? result.value : [])
      if (!result.ok) setWorkbenchNote(errorMessage(result))
    })()
    return () => { live = false }
  }, [historyOpen, fileSession?.sessionId, snapshotRevision])
  useEffect(() => {
    if (!fileSession) { setFiles([]); return }
    let live = true
    void collectWorkspaceFiles(ctx, fileSession.sessionId).then((paths) => {
      if (!live) return
      const next = sortChapterPaths(paths)
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
  /* 拿到 overview 后,如果当前作品今天还没有基线,就写下"早上总字数";
     跨天 / 第一次打开作品时各写一次,后续静默。失败不打扰,下一次 overview 再试。 */
  useEffect(() => {
    if (!overview || !openWorkspaceId || !writableProgress) return
    const today = localDateKey(new Date())
    const existing = writingProgress.baselines[openWorkspaceId]
    if (existing && existing.date === today) return
    const next = nextBaselines(writingProgress, openWorkspaceId, today, overview.totals.chars)
    if (next === writingProgress.baselines) return
    void progressScope.set('baselines', next).catch(() => { /* 下次 overview 自然重试 */ })
  }, [overview, openWorkspaceId, writableProgress, writingProgress, progressScope])
  const openDocument = (nextPath: string, hit?: SearchHit) => {
    if (editorDirty && (nextPath !== path || hit)) {
      setWorkbenchNote(t('error.saveFirst'))
      return
    }
    setWorkbenchNote('')
    setOverviewOpen(false)
    setCardsSelectedPath(null)
    setPath(nextPath)
    setReveal(hit ? toRevealRequest(hit) : null)
  }
  const changeChapterStatus = async (chapterPath: string, status: ChapterStatus) => {
    if (!fileSession || !overview) return
    const previous = overview
    setOverview(applyChapterStatus(overview, chapterPath, status))
    setStatusBusyPath(chapterPath)
    setOverviewNote('')
    const result = await safeRpcCall<{ path: string; status: ChapterStatus }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'chapter.statusSet', {
      sessionId: fileSession.sessionId,
      path: chapterPath,
      status,
    }))
    setStatusBusyPath(null)
    if (!result.ok) {
      setOverview(previous)
      setOverviewNote(errorMessage(result))
      return
    }
    setOverviewRevision((value) => value + 1)
  }
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
  const openImagePreview = async (imagePath: string) => {
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
      if (old) URL.revokeObjectURL(old.url)
      return { path: imagePath, url }
    })
  }
  const closeImagePreview = () => {
    setImagePreview((old) => {
      if (old) URL.revokeObjectURL(old.url)
      return null
    })
  }
  const openFileMenu = (kind: FileMenuKind, selectedPath: string, position: { x: number; y: number }) => {
    if (editorDirty) { setWorkbenchNote(t('error.saveFirst')); return }
    setWorkbenchNote('')
    setFileMenu({ kind, path: selectedPath, x: position.x, y: position.y })
  }
  const closeFileMenu = () => setFileMenu(null)
  const beginChapterSplit = (target: string, source: 'tree' | 'cursor') => {
    setFileMenu(null)
    const next = requestSplitChapter({ path: target, source, editorDirty, activePath: path })
    if (!next.ok) { setWorkbenchNote(next.reason === 'unsaved' ? t('error.saveFirst') : t('chapterOps.splitTxtDisabled')); return }
    setChapterOps(next.request)
  }
  const beginChapterMerge = (chapterPath: string, direction: 'previous' | 'next') => {
    setFileMenu(null)
    const next = requestMergeChapter({ chapterPath, direction, files, editorDirty, activePath: path })
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
    setWorkbenchNote(renamed.value.metadataWarning ? t('note.renamedWithWarning', { path: renamed.value.path, warning: renamed.value.metadataWarning }) : t('note.renamed', { path: renamed.value.path }))
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
    const target = fileManageReturnFocus.current
    setRenameTarget(null)
    setManageNote('')
    if (target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const requestDeleteEntry = (kind: FileMenuKind, targetPath: string) => {
    if (editorDirty) { setWorkbenchNote(t('error.saveFirst')); return }
    fileManageReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFileMenu(null)
    setDeleteTarget({ kind, path: targetPath })
  }
  const closeDeleteConfirm = () => {
    const target = fileManageReturnFocus.current
    setDeleteTarget(null)
    if (target) globalThis.setTimeout(() => target.focus(), 0)
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
    /* cut:用 entry.move 走 workbench,内部其实是移动;成功后清空剪贴板。 */
    const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'entry.move', {
      sessionId,
      path: entry.path,
      targetDir,
    }))
    if (!result.ok) { setWorkbenchNote(errorMessage(result)); return }
    if (entry.kind === 'file' && path === entry.path) setPath(result.value.path)
    else if (entry.kind === 'directory' && path.startsWith(`${entry.path}/`)) {
      /* 剪切的是当前文稿的父目录：同步改写当前子路径，防 buffer 丢失。 */
      setPath(`${result.value.path}${path.slice(entry.path.length)}`)
    }
    setClipboard(null)
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.movedTo', { path: result.value.path }))
  }
  const openTreeCreate = (kind: 'file' | 'folder', directory: string) => {
    if (!fileSession) return
    if (editorDirty) { setCreateNote(t('error.saveFirst')); return }
    createReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFileMenu(null)
    setCreateNote('')
    setTreeCreateRequest({ kind, directory })
  }
  const closeTreeCreate = () => {
    if (createBusy) return
    const target = createReturnFocus.current
    setTreeCreateRequest(null)
    setCreateNote('')
    globalThis.setTimeout(() => target?.focus(), 0)
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
    setHistoryOpen(true)
    setSnapshotRevision((value) => value + 1)
  }
  const requestRollback = (snapshot: SnapshotResponse) => {
    if (snapshotBusy) return
    if (editorDirty) { setWorkbenchNote(t('note.saveBeforeRollback')); return }
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
  const prepareExistingWorkspace = async (pending: PendingWorkspaceOpen, sessionId: SessionId) => {
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
        importReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
      setHomeNote(t('note.pickerUnavailableRelocate'))
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
      picked = await ctx.workspaces.pickDirectory()
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
      const path = await ctx.workspaces.pickDirectory()
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
  const pathFallbackForm = manualWorkspaceMode ? e('form', { className: 'path-fallback', onSubmit: submitWorkspacePath },
    e('label', null,
      e('span', null, t('home.pathLabel')),
      e('input', {
        value: manualWorkspacePath,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setManualWorkspacePath(event.target.value),
        placeholder: t('home.pathPlaceholder'),
        'aria-label': t('home.pathLabel'),
        autoFocus: true,
      }),
    ),
    e('div', null,
      e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void pickWorkspaceDirectory() }, t('home.chooseFolder')),
      e('button', { className: 'primary-action', type: 'submit', disabled: openingWorkspace },
        openingWorkspace ? t('home.opening') : t('home.openThisFolder'),
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
      }, t('common.cancel')),
    ),
  ) : null
  const closeWorkspaceChrome = () => {
    setWorkspaceMenuOpen(false)
  }
  const leaveToHome = async () => {
    closeWorkspaceChrome()
    if (editorDirty) { setWorkbenchNote(t('note.saveBeforeHome')); return }
    if (!(await canLeaveAssistantDraft())) return
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
    if (editorDirty) { setWorkbenchNote(t('note.saveBeforeSwitch')); return }
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    const workspace = workspaces.items.find((item) => item.workspaceId === id)
    if (!workspace) { setWorkbenchNote(t('note.entryChanged')); return }
    await openRegisteredWorkspace(workspace)
  }
  const startNewProject = async () => {
    closeWorkspaceChrome()
    if (openingWorkspace || newProject) return
    if (fileSession) {
      if (editorDirty) { setWorkbenchNote(t('note.saveBeforeNew')); return }
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
  const openSearchPanel = () => {
    if (!fileSession) return
    setFocusMode(false)
    setSidebarOpen(true)
    setSearchOpen(true)
    setPaletteOpen(false)
  }
  const openOverviewPanel = () => {
    if (!fileSession) return
    setFocusMode(false)
    setOverviewOpen(true)
    setCardsSelectedPath(null)
    setPaletteOpen(false)
  }
  const openProofreadPanel = (scope: 'document' | 'manuscript' = 'document') => {
    if (!fileSession) return
    if (scope === 'document' && !path) {
      setWorkbenchNote(t('note.openDocBeforeProofread'))
      return
    }
    setFocusMode(false)
    setSidebarOpen(true)
    setProofreadOpen(true)
    setProofreadRequest({ scope, nonce: Date.now() })
    setPaletteOpen(false)
  }
  const openCardsPanel = (kind: 'character' | 'worldbook') => {
    if (!fileSession) return
    setFocusMode(false)
    setSidebarOpen(true)
    setCardsOpen(true)
    setCardsKind(kind)
    setCardsSelectedPath((path) => {
      if (!path) return path
      return (kind === 'character' ? isCharacterCardPath(path) : isWorldbookCardPath(path)) ? path : null
    })
    setPaletteOpen(false)
  }
  const toggleCardsPanel = (kind: 'character' | 'worldbook') => {
    if (cardsOpen && cardsKind === kind) {
      setCardsOpen(false)
      setCardsSelectedPath(null)
      return
    }
    openCardsPanel(kind)
  }
  const selectCard = (nextPath: string | null) => {
    setCardsSelectedPath(nextPath)
    if (nextPath) setOverviewOpen(false)
  }
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
  const closeImportFlow = (restoreFocus = true) => {
    const target = importReturnFocus.current
    importReturnFocus.current = null
    setImportFlow(idleImportFlow)
    if (restoreFocus && target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const startImportProject = async () => {
    closeWorkspaceChrome()
    setPaletteOpen(false)
    if (fileSession) {
      if (editorDirty) { setWorkbenchNote(t('note.saveBeforeImport')); return }
      if (!(await canLeaveAssistantDraft())) return
      setAssistantDraftDirty(false)
    }
    importReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setImportTitle({ busy: false, note: '' })
  }
  const submitImportTitle = async (title: string) => {
    if (!importTitle || importTitle.busy || openingWorkspace) return
    setImportTitle({ busy: true, note: '' })
    const created = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.createHome', { title }))
    if (!created.ok) {
      setImportTitle({ busy: false, note: errorMessage(created) })
      return
    }
    setImportTitle(null)
    try {
      const targetRegistration = await registerFlowWorkspace(created.value.path)
      const targetSessionId = await connectUsableWorkspaceSession(ctx, targetRegistration.workspace.workspaceId)
      pendingWorkspaceOpen.current = {
        ticket: workspaceOpenGate.begin(`import:${targetRegistration.workspace.workspaceId}`),
        workspace: targetRegistration.workspace,
        intent: 'create',
        registrationCreated: targetRegistration.created,
        sessionId: targetSessionId,
      }
      await selectImportSource(targetSessionId, targetRegistration.workspace.workspaceId)
    } catch (error) {
      closeImportFlow()
      setHomeNote(error instanceof Error ? error.message : t('note.importNotStarted'))
    }
  }
  const selectImportSource = async (targetSessionId: SessionId, targetWorkspaceId: WorkspaceId) => {
    const sourcePath = await ctx.workspaces.pickDirectory()
    if (!sourcePath) { closeImportFlow(); return }
    let sourceSessionId: SessionId | undefined
    let createdSourceWorkspaceId: WorkspaceId | undefined
    try {
      const sourceRegistration = await registerFlowWorkspace(sourcePath)
      if (sourceRegistration.created) createdSourceWorkspaceId = sourceRegistration.workspace.workspaceId
      sourceSessionId = await ctx.workspaces.connectWorkspace(sourceRegistration.workspace.workspaceId)
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
  const renderImportDialog = () => e(ImportDialog, {
    flow: importFlow,
    onCancel: () => void cancelImportFlow(),
    onApply: () => void applyImportFlow(),
    onContinue: () => importFlow.kind === 'recover'
      ? void selectImportSource(importFlow.targetSessionId as SessionId, importFlow.targetWorkspaceId as WorkspaceId).catch(() => closeImportFlow())
      : undefined,
    onCleanup: () => void cleanupImportFlow(),
  })
  const exportNovel = async () => {
    closeWorkspaceChrome()
    setPaletteOpen(false)
    if (!fileSession) return
    if (editorDirty) { setExportNote(t('note.saveBeforeExport')); setExportChapters([]); return }
    const requestSessionId = fileSession.sessionId
    setExporting(true)
    setExportNote(t('note.exportPreparing'))
    try {
      const chapters = await collectChapters(ctx, requestSessionId)
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
    setWorkbenchNote(archived.value.metadataWarning ? t('note.archivedWithWarning', { path: archived.value.path, warning: archived.value.metadataWarning }) : t('note.archived', { path: archived.value.path }))
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
    if (result.value.metadataWarning) setArchiveNote(result.value.metadataWarning)
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
    setWorkbenchNote(result.value.metadataWarning ? t('note.restoredWithWarning', { path: result.value.path, warning: result.value.metadataWarning }) : t('note.restored', { path: result.value.path }))
    await loadArchives()
  }
  /* 命令面板:复用 useTheme / openSettings / startWorkspaceFromPicker /
     startNewProject / openDocument / setFocusMode 全部已有的回调,palette
     本身只负责"按下执行"的分发。文件列表来自已加载好的 files 状态(已经
     是排过序的 .md/.txt),不另外发 RPC。 */
  const renderCommandPalette = () => e(CommandPalette, {
    open: paletteOpen,
    onOpenChange: setPaletteOpen,
    theme,
    onThemeChange: setTheme,
    onOpenWorkspace: () => { if (fileSession) { void openAnotherWorkspace() } else { void startWorkspaceFromPicker() } },
    onNewProject: () => { void startNewProject() },
    onOpenSettings: () => openSettings(),
    onToggleFocus: () => setFocusMode((value) => !value),
    onOpenDocument: (target: string) => openDocument(target),
    onOpenSearch: () => openSearchPanel(),
    onOpenOverview: () => openOverviewPanel(),
    onOpenProofread: (scope: 'document' | 'manuscript') => openProofreadPanel(scope),
    onOpenCards: (kind: 'character' | 'worldbook') => openCardsPanel(kind),
    onExport: () => { void exportNovel() },
    onImport: () => { void startImportProject() },
    onOpenArchives: () => openArchivePanel(),
    onSplitAtCursor: () => beginChapterSplit(path, 'cursor'),
    canSplitAtCursor: Boolean(fileSession) && !editorDirty && isMarkdownChapterPath(path),
    onToggleTypewriter: () => { void writingScope.set('typewriter', !writing.typewriter) },
    onToggleFocusParagraph: () => { void writingScope.set('focusParagraph', !writing.focusParagraph) },
    typewriter: writing.typewriter,
    focusParagraph: writing.focusParagraph,
    onPinCurrent: () => { if (canPinPath(path)) setPinnedPath(path) },
    canPinCurrent: Boolean(fileSession) && canPinPath(path),
    onUnpin: () => setPinnedPath(null),
    pinnedPath,
    hasWorkspace: Boolean(fileSession),
    focusMode,
    files,
    activePath: path,
  })
  const openAnotherWorkspace = async () => {
    closeWorkspaceChrome()
    if (editorDirty) {
      setWorkbenchNote(t('note.saveBeforeOpen'))
      return
    }
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    await startWorkspaceFromPicker()
  }

  if (workspaceOpen.kind === 'checking') {
    return e('main', { className: 'shell no-session', style: { minWidth: 0, display: 'grid' } },
      e('style', null, redesignedStyles),
      e('section', { className: 'workspace-checking', 'aria-label': t('home.verifying') },
        e('h1', null, t('home.checking')),
        e('p', { role: 'status', 'aria-live': 'polite' }, t('home.checkingDetail')),
        e('code', null, workspaceOpen.path),
      ),
      extensionsDock,
    )
  }

  if (!fileSession || workspaceOpen.kind !== 'ready') {
    return e('main', { className: 'shell no-session', style: { minWidth: 0, display: 'grid' } },
      e('style', null, redesignedStyles),
      e('header', { className: 'chrome', onDoubleClick: titleBarDoubleClick },
        e('div', { className: 'brand-lockup' },
          e('span', { className: 'brand-mark', 'aria-hidden': 'true' }, 'D'),
          e('strong', null, 'DSH Editor'),
        ),
        e('span', { className: 'local-state' }, t('home.title')),
        extensionsDock,
        e('span', { className: 'topbar-actions' },
          e(CommandPaletteTrigger, { onClick: () => setPaletteOpen(true) }),
          e(SettingsTrigger, { onOpen: openSettings }),
          e(AboutTrigger, { onOpen: () => setAboutOpen(true) }),
          e(WindowControls, null),
        ),
      ),
      e(PaperStage, { label: t('home.blankPaper') },
        e('p', { className: 'home-hint' }, t('home.intro')),
        e('div', { className: 'home-actions' },
          e('button', {
            className: 'home-entry-card', type: 'button',
            'aria-label': t('home.openWork'),
            disabled: openingWorkspace || Boolean(newProject),
            onClick: () => void startWorkspaceFromPicker(),
          },
            e('span', { className: 'home-entry-icon', 'aria-hidden': 'true' }, e(FolderIcon, null)),
            e('span', { className: 'home-entry-title' }, t('home.openWork')),
            e('span', { className: 'home-entry-desc' }, t('home.openWorkDesc')),
          ),
          e('button', {
            className: 'home-entry-card', type: 'button',
            'aria-label': t('home.new'),
            disabled: openingWorkspace || Boolean(newProject),
            onClick: () => void startNewProject(),
          },
            e('span', { className: 'home-entry-icon', 'aria-hidden': 'true' }, e(NewDocIcon, null)),
            e('span', { className: 'home-entry-title' }, t('home.new')),
            e('span', { className: 'home-entry-desc' }, t('home.newDesc')),
          ),
        ),
        e('button', {
          className: 'home-import-link',
          type: 'button',
          disabled: openingWorkspace || Boolean(newProject) || Boolean(importTitle),
          onClick: () => void startImportProject(),
        }, t('home.importExisting')),
        pathFallbackForm,
        workspaceOpen.kind === 'needs-intent' ? e('section', { className: 'workspace-intent-prompt', role: 'alert' },
          e('strong', null, workspaceOpen.intent === 'create' ? t('home.folderNotWork') : t('home.folderHasWork')),
          e('p', null, workspaceOpen.message),
          e('code', null, workspaceOpen.path),
          e('div', null,
            e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace, onClick: () => void continuePendingWorkspaceIntent() }, workspaceOpen.intent === 'create' ? t('home.createHere') : t('home.openInstead')),
            e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void cancelPendingWorkspaceIntent() }, t('common.cancel')),
          ),
        ) : null,
        workspaceOpen.kind === 'error' ? e('code', null, workspaceOpen.path) : null,
        homeNote ? e('p', { className: 'warning', role: 'alert' }, homeNote) : null,
        e('section', { className: 'home-recent', 'aria-label': t('home.recent') },
          e('header', null,
            e('h2', null, t('home.recent')),
            e('small', null, workspaces.items.length ? t('home.entryCount', { count: workspaces.items.length }) : t('home.noEntries')),
          ),
          workspaces.items.length ? e('div', { className: 'workspace-list' }, workspaces.items.map((workspace) => {
            const needsRelocation = workspaceOpen.kind === 'needs-relocation' && workspaceOpen.workspaceId === workspace.workspaceId
            const recentLabel = formatRecentTime(workspace.updatedAt)
            return e('article', { className: `workspace-row${needsRelocation ? ' needs-relocation' : ''}`, key: workspace.workspaceId },
              e('button', {
                className: 'tree-row', type: 'button', disabled: openingWorkspace,
                onClick: () => void openRegisteredWorkspace(workspace),
              },
                e('strong', null, workspace.title || workspace.path),
                e('small', null, workspace.path),
                recentLabel ? e('span', { className: 'workspace-time', 'aria-label': t('home.recentOpened', { label: recentLabel }) }, recentLabel) : null,
              ),
              needsRelocation ? e('div', { className: 'workspace-relocation', role: 'alert' },
                e('p', null, workspaceOpen.message), e('code', null, workspaceOpen.path),
                e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace, onClick: () => void relocateWorkspace(workspace) }, t('home.relocate')),
                e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void removeBrokenWorkspace(workspace) }, t('home.removeRecent')),
              ) : null,
            )
          })) : e('p', { className: 'muted home-recent-empty' }, t('home.recentEmpty')),
        ),
      ),
      renderNewProjectDialog(),
      renderCommandPalette(),
      renderImportDialog(),
      importTitle ? e(TextPromptDialog, {
        id: 'import-title-home',
        title: t('home.importAsNew'),
        label: t('home.workName'),
        initialValue: '',
        confirmLabel: t('home.chooseSource'),
        note: importTitle.note,
        busy: importTitle.busy,
        onCancel: () => { if (!importTitle.busy) setImportTitle(null) },
        onConfirm: (title: string) => void submitImportTitle(title),
      }) : null,
      settingsOpen ? e(SettingsDialog, { ctx, writingScope, migrateWriting, progressScope, assistant: capabilityReady ? capabilityState.value.assistant : undefined, onClose: () => setSettingsOpen(false) }) : null,
    )
  }

  const chatSession = session ?? fileSession
  const sidebarVisible = sidebarOpen && !focusMode
  const assistantVisible = assistantOpen && !focusMode && assistantEnabled
  const pinnedVisible = pinnedPath !== null && !focusMode
  const layoutColumns = pinnedLayoutColumns({
    sidebarVisible,
    sidebarWidth,
    pinnedVisible,
    pinnedWidth,
    assistantVisible,
    assistantWidth,
  })

  return e('main', {
    className: `shell layout-shell${focusMode ? ' focus-mode' : ''}${sidebarVisible ? ' files-open' : ''}${assistantVisible ? ' assistant-open' : ''}${pinnedVisible ? ' pinned-open' : ''}${overviewOpen ? ' overview-open' : ''}${cardsOpen && cardsSelectedPath ? ' cards-open' : ''}`,
    style: { minWidth: 0, gridTemplateColumns: layoutColumns },
  },
    e('style', null, redesignedStyles),
    e('header', { className: 'chrome', onDoubleClick: titleBarDoubleClick },
      e('div', { className: 'workspace-chrome', role: 'group', 'aria-label': t('workspace.work') },
        e('details', {
          className: 'workspace-menu',
          open: workspaceMenuOpen,
          onToggle: (event: ChangeEvent<HTMLDetailsElement>) => setWorkspaceMenuOpen(event.currentTarget.open),
        },
          e('summary', {
            role: 'button',
            title: t('workspace.menu'),
            'aria-label': t('workspace.menu'),
            'aria-expanded': workspaceMenuOpen,
            'aria-controls': 'workspace-actions',
          }, e('span', null, currentWorkspace?.title || currentWorkspace?.path || t('workspace.work'))),
          e('div', { id: 'workspace-actions', className: 'workspace-menu-panel', 'aria-label': t('workspace.actions') },
            workspaces.items.length ? e('div', { className: 'workspace-menu-actions', 'aria-label': t('workspace.switch') },
              workspaces.items.map((workspace) => e('button', {
                key: workspace.workspaceId,
                type: 'button',
                'aria-current': workspace.workspaceId === currentWorkspace?.workspaceId ? 'true' : undefined,
                disabled: openingWorkspace,
                onClick: () => void switchToWorkspace(workspace.workspaceId),
              }, workspace.title || workspace.path)),
            ) : null,
            workspaces.items.length ? e('hr', { className: 'workspace-menu-divider' }) : null,
            e('div', { className: 'workspace-menu-actions' },
              e('button', { type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void openAnotherWorkspace() }, t('home.openWork')),
              e('button', { type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void startNewProject() }, t('home.new')),
              e('button', { type: 'button', disabled: openingWorkspace || Boolean(newProject) || Boolean(importTitle), onClick: () => void startImportProject() }, t('workspace.import')),
              e('button', { type: 'button', disabled: exporting, onClick: () => { void exportNovel() } }, exporting ? t('workspace.exporting') : t('workspace.exportMarkdown')),
              e('button', { type: 'button', disabled: exporting, onClick: () => { void exportNovel() } }, t('workspace.exportTxt')),
              e('button', { type: 'button', onClick: () => openArchivePanel() }, t('workspace.archived')),
              e('button', { type: 'button', 'aria-label': t('workspace.backHome'), onClick: () => void leaveToHome() }, t('workspace.backHome')),
            ),
            pathFallbackForm,
          ),
        ),
      ),
      e('nav', { className: 'layout-controls', 'aria-label': t('workspace.layout') },
        e('button', {
          type: 'button',
          disabled: focusMode,
          'aria-pressed': sidebarOpen,
          title: sidebarOpen ? t('workspace.hideFiles') : t('workspace.showFiles'),
          onClick: () => setSidebarOpen((value) => !value),
        }, t('workspace.files')),
        e('button', {
          type: 'button',
          'aria-pressed': focusMode,
          title: focusMode ? t('workspace.exitFocus') : t('workspace.enterFocus'),
          onClick: () => setFocusMode((value) => !value),
        }, focusMode ? t('workspace.exitFocusShort') : t('workspace.focus')),
        e('button', {
          type: 'button',
          disabled: focusMode,
          'aria-pressed': assistantOpen,
          title: assistantOpen ? t('workspace.hideAssistant') : t('workspace.showAssistant'),
          onClick: () => setAssistantOpen((value) => !value),
        }, t('workspace.assistant')),
      ),
      extensionsDock,
      e('div', { className: 'topbar-actions' },
        e(ThemeToggle, { theme, onChange: setTheme }),
        e(CommandPaletteTrigger, { onClick: () => setPaletteOpen(true) }),
        e(SettingsTrigger, { onOpen: openSettings }),
        e(AboutTrigger, { onOpen: () => setAboutOpen(true) }),
        e(WindowControls, null),
      ),
    ),
    sidebarVisible ? e('aside', { className: 'sidebar', 'aria-label': t('workspace.filesAndNotes') },
      e('div', { className: 'side-title' },
        e('span', null, t('workspace.files')),
        e('span', { className: 'side-title-actions' },
          e('button', { className: 'side-action', type: 'button', 'aria-pressed': searchOpen, title: t('workspace.searchTitle'), 'aria-label': t('sidebar.search'), onClick: () => setSearchOpen((value) => !value) }, t('sidebar.search')),
          e('button', { className: 'side-action', type: 'button', 'aria-pressed': proofreadOpen, title: t('workspace.proofreadTitle'), 'aria-label': t('workspace.proofread'), onClick: () => setProofreadOpen((value) => !value) }, t('workspace.proofread')),
          e('button', { className: 'side-action', type: 'button', 'aria-pressed': overviewOpen, title: t('workspace.overviewTitle'), 'aria-label': t('workspace.overview'), onClick: () => { setOverviewOpen((value) => !value); setCardsSelectedPath(null) } }, t('workspace.overview')),
          e('button', { className: 'side-action', type: 'button', 'aria-pressed': cardsOpen && cardsKind === 'character', title: t('workspace.cardsTitle'), 'aria-label': t('workspace.people'), onClick: () => toggleCardsPanel('character') }, t('workspace.people')),
          e('button', { className: 'side-action', type: 'button', 'aria-pressed': cardsOpen && cardsKind === 'worldbook', title: t('workspace.worldbookTitle'), 'aria-label': t('workspace.settings'), onClick: () => toggleCardsPanel('worldbook') }, t('workspace.settings')),
          e('button', { className: 'side-action', type: 'button', disabled: snapshotBusy, title: t('workspace.commitTitle'), 'aria-label': t('workspace.commit'), onClick: () => void commitSnapshot() }, t('workspace.commit')),
          e('button', { className: 'side-action', type: 'button', 'aria-pressed': historyOpen, title: t('workspace.commitHistory'), 'aria-label': t('common.history'), onClick: () => setHistoryOpen((value) => !value) }, t('common.history')),
        ),
      ),
      (() => {
        const summary = progressChipProps({ overview, progress: writingProgress, workspaceId: openWorkspaceId })
        if (!summary) return null
        return e('div', { className: `writing-progress-chip${summary.reached ? ' reached' : ''}`, 'aria-label': summary.text }, summary.text)
      })(),
      searchOpen ? e(SearchPanel, {
        ctx,
        sessionId: fileSession.sessionId,
        revision: treeRevision,
        navigationBlocked: editorDirty,
        activePath: path,
        activeDirty: editorDirty,
        onOpen: (hit: SearchHit) => openDocument(hit.path, hit),
        onReplaced: (paths: string[]) => {
          if (!paths.includes(path)) return
          const navigation = proposalAppliedNavigation(path, path, editorDirty)
          if (navigation.refreshContent) setContentRevision((old) => old + 1)
        },
      }) : null,
      proofreadOpen ? e(ProofreadPanel, {
        ctx,
        sessionId: fileSession.sessionId,
        revision: treeRevision,
        navigationBlocked: editorDirty,
        activePath: path,
        request: proofreadRequest,
        onOpen: (finding: ProofreadFinding) => openDocument(finding.path, finding),
        onApplied: (appliedPath: string) => {
          const navigation = proposalAppliedNavigation(appliedPath, path, editorDirty)
          setTreeRevision((old) => old + 1)
          if (navigation.expandPath) setTreeExpansionPath(navigation.expandPath)
          if (!navigation.openPath) {
            setWorkbenchNote(t('note.appliedDirty'))
            return
          }
          openDocument(navigation.openPath)
          if (navigation.refreshContent) setContentRevision((old) => old + 1)
        },
      }) : null,
      cardsOpen ? e(CardsPanel, {
        ctx,
        sessionId: fileSession.sessionId,
        revision: treeRevision,
        kind: cardsKind,
        selectedPath: cardsSelectedPath,
        navigationBlocked: editorDirty,
        onKindChange: (kind) => openCardsPanel(kind),
        onSelect: selectCard,
        onCatalog: setCardsCatalog,
        onCreated: (createdPath: string) => {
          setTreeRevision((value) => value + 1)
          setTreeExpansionPath(createdPath)
          openDocument(createdPath)
        },
        onOpenHit: (hit: SearchHit) => openDocument(hit.path, hit),
      }) : null,
      historyOpen ? e('section', { className: 'snapshot-panel', 'aria-label': t('workspace.commitHistory') },
        snapshots === null
          ? e('p', { className: 'snapshot-empty' }, t('workspace.historyLoading'))
          : snapshots.length === 0
            ? e('p', { className: 'snapshot-empty' }, t('workspace.historyEmpty'))
            : snapshots.map((item) => e('div', { key: item.snapshotId, className: 'snapshot-row' },
                e('span', { className: 'snapshot-label', title: item.createdAt }, item.label ?? item.createdAt),
                e('span', { className: 'snapshot-meta' }, t('workspace.historyFiles', { count: item.files })),
                e('button', { className: 'snapshot-rollback', type: 'button', disabled: snapshotBusy, onClick: () => requestRollback(item) }, t('workspace.rollback')),
              )),
      ) : null,
      createNote ? e('p', { className: 'warning pad', role: 'alert' }, createNote) : null,
      workspaceOpen.warning ? e('p', { className: 'warning pad', role: 'status' }, workspaceOpen.warning) : null,
      workbenchNote ? e('p', { className: `pad`, role: 'status' }, workbenchNote) : null,
      e(Tree, { ctx, sessionId: fileSession.sessionId, active: path, expandPath: treeExpansionPath, highlightPath: cardsSelectedPath ?? undefined, onOpen: openDocument, onPreviewImage: (imagePath: string) => void openImagePreview(imagePath), onFileMenu: openFileMenu, onCreateFile: (directory: string) => openTreeCreate('file', directory), onCreateFolder: (directory: string) => openTreeCreate('folder', directory), revision: treeRevision, chapterStatuses: buildChapterStatusMap(overview) }),
    ) : null,
    sidebarVisible ? e(PanelResizer, {
      side: 'left',
      value: sidebarWidth,
      minimum: SIDEBAR_MIN,
      maximum: SIDEBAR_MAX,
      defaultValue: SIDEBAR_DEFAULT,
      label: t('workspace.resizeFiles'),
      onChange: setSidebarWidth,
    }) : null,
    e(Editor, {
      ctx, session: fileSession, path, files, onOpen: openDocument, create: () => openTreeCreate('file', '正文'),
      onHandle: (handle) => { editorHandleRef.current = handle },
      externalRevision: contentRevision, onDirtyChange: setEditorDirty, reveal,
      completionPreference: writing.completion,
      /* 能力未加载完成前不发起补全/改写 RPC;显式错误态由用户重试恢复。 */
      completionEnabled: capabilityReady ? capabilityState.value.completion : false,
      authorPreferences: normalizeAuthorPreferences(writing.authorPreferences),
      authorMemory: normalizeAuthorMemory(writing.authorMemory),
      typewriter: writing.typewriter,
      focusParagraph: writing.focusParagraph,
      typography: writingTypography(writing),
      onToggleTypewriter: () => { void writingScope.set('typewriter', !writing.typewriter) },
      onToggleFocusParagraph: () => { void writingScope.set('focusParagraph', !writing.focusParagraph) },
      onSaved: () => {
        setOverviewRevision((value) => value + 1)
        if (path === pinnedPath) setContentRevision((value) => value + 1)
        progressRecord.schedule(() => { void recordSavedProgress() })
      },
    }),
    overviewOpen ? e(OverviewPanel, {
      ctx,
      sessionId: fileSession.sessionId,
      overview,
      revision: overviewRevision,
      note: overviewNote,
      statusBusyPath,
      onClose: () => setOverviewOpen(false),
      onOpenChapter: (chapterPath: string) => openDocument(chapterPath),
      onStatusChange: (chapterPath: string, status: ChapterStatus) => { void changeChapterStatus(chapterPath, status) },
    }) : null,
    cardsOpen && cardsSelectedPath ? (() => {
      const selectedCard = cardsKind === 'character'
        ? cardsCatalog.characters.find((card) => card.path === cardsSelectedPath)
        : cardsCatalog.worldbook.find((card) => card.path === cardsSelectedPath)
      return selectedCard ? e(CardsDetail, {
        ctx,
        sessionId: fileSession.sessionId,
        kind: cardsKind,
        card: selectedCard,
        characters: cardsCatalog.characters,
        navigationBlocked: editorDirty,
        onClose: () => setCardsSelectedPath(null),
        onOpenDocument: (cardPath: string) => {
          setTreeExpansionPath(cardPath)
          openDocument(cardPath)
        },
        onSelectCard: selectCard,
        onChanged: () => setTreeRevision((value) => value + 1),
        onOpenHit: (hit: SearchHit) => openDocument(hit.path, hit),
        pinnedPath,
        onTogglePin: (cardPath: string) => setPinnedPath((current) => current === cardPath ? null : cardPath),
      }) : null
    })() : null,
    pinnedVisible && pinnedPath ? e(PanelResizer, {
      side: 'right',
      value: pinnedWidth,
      minimum: PINNED_MIN,
      maximum: PINNED_MAX,
      defaultValue: PINNED_DEFAULT,
      label: t('pin.resize'),
      onChange: setPinnedWidth,
    }) : null,
    pinnedVisible && pinnedPath ? e(PinnedPane, {
      ctx,
      sessionId: fileSession.sessionId,
      path: pinnedPath,
      treeRevision,
      contentRevision,
      onUnpin: () => setPinnedPath(null),
      onOpenDocument: (cardPath: string) => {
        setTreeExpansionPath(cardPath)
        openDocument(cardPath)
      },
      onMissing: () => {
        setWorkbenchNote(t('pin.missing'))
        setPinnedPath(null)
      },
    }) : null,
    assistantVisible ? e(PanelResizer, {
      side: 'right',
      value: assistantWidth,
      minimum: ASSISTANT_MIN,
      maximum: ASSISTANT_MAX,
      defaultValue: ASSISTANT_DEFAULT,
      label: t('workspace.resizeAssistant'),
      onChange: setAssistantWidth,
    }) : null,
    assistantEnabled && chatSession ? e(Chat, {
      key: chatSession.sessionId,
      ctx,
      session: chatSession,
      workspaceId: currentWorkspace?.workspaceId,
      activePath: path,
      authorPreferences: normalizeAuthorPreferences(writing.authorPreferences),
      authorMemory: normalizeAuthorMemory(writing.authorMemory),
      onAcceptMemory,
      hidden: !assistantVisible,
      onClose: () => setAssistantOpen(false),
      onConfigure: openSettings,
      onDraftDirtyChange: setAssistantDraftDirty,
      onApplied: (appliedPath: string) => {
        const navigation = proposalAppliedNavigation(appliedPath, path, editorDirty)
        setTreeRevision((old) => old + 1)
        if (navigation.expandPath) setTreeExpansionPath(navigation.expandPath)
        if (!navigation.openPath) {
          setWorkbenchNote(t('note.appliedDirty'))
          return
        }
        openDocument(navigation.openPath)
        if (navigation.refreshContent) setContentRevision((old) => old + 1)
      },
    }) : null,
    !assistantVisible && !focusMode ? (
      capabilityState.kind === 'error'
        ? e('div', { className: 'assistant-launcher capability-note', role: 'alert' },
          e('span', null, t('capabilities.loadFailed', { error: capabilityState.message })),
          e('button', { type: 'button', onClick: shellCapabilities.retry }, t('capabilities.retry')),
        )
        : !capabilityReady
          ? e('div', { className: 'assistant-launcher capability-note', role: 'status' }, t('capabilities.loading'))
          : assistantEnabled
            ? e('button', {
              className: 'assistant-launcher',
              type: 'button',
              'aria-label': t('workspace.openAssistant'),
              'aria-expanded': false,
              onClick: () => setAssistantOpen(true),
            }, e('span', { 'aria-hidden': 'true' }, e(DeepSeekWhaleMark)), e('strong', null, t('workspace.assistant')))
            : null
    ) : null,
    leaveConfirm ? e(ConfirmDialog, {
      id: 'leave-assistant-draft',
      title: t('chat.discardDraftTitle'),
      message: t('chat.leaveDraftBody'),
      confirmLabel: t('chat.discardAndContinue'),
      onCancel: () => resolveLeaveConfirm(false),
      onConfirm: () => resolveLeaveConfirm(true),
    }) : null,
    treeCreateRequest ? e(TextPromptDialog, {
      id: 'tree-create',
      key: `${treeCreateRequest.kind}:${treeCreateRequest.directory}`,
      title: treeCreateRequest.kind === 'folder' ? t('workspace.newFolder') : t('workspace.newFile'),
      label: treeCreateRequest.kind === 'folder' ? t('workspace.folderName') : t('workspace.fileName'),
      initialValue: '',
      confirmLabel: t('common.create'),
      onCancel: closeTreeCreate,
      onConfirm: (name: string) => void submitTreeCreate(name),
    }) : null,
    rollbackTarget ? e(ConfirmDialog, {
      id: 'snapshot-rollback',
      title: t('workspace.rollbackTitle'),
      message: t('workspace.rollbackBody', { label: rollbackTarget.label ?? rollbackTarget.createdAt }),
      confirmLabel: t('workspace.rollback'),
      onCancel: () => setRollbackTarget(null),
      onConfirm: () => void confirmRollback(),
    }) : null,
    renderNewProjectDialog(),
    fileMenu ? e(FileContextMenu, {
      kind: fileMenu.kind,
      path: fileMenu.path,
      x: fileMenu.x,
      y: fileMenu.y,
      canPaste: Boolean(clipboard),
      onClose: closeFileMenu,
      onCreateFile: () => openTreeCreate('file', fileMenu.kind === 'directory' ? fileMenu.path : parentOf(fileMenu.path)),
      onCreateFolder: () => openTreeCreate('folder', fileMenu.kind === 'directory' ? fileMenu.path : parentOf(fileMenu.path)),
      onCopy: () => setClipboardFromMenu('copy', fileMenu.kind, fileMenu.path),
      onCut: () => setClipboardFromMenu('cut', fileMenu.kind, fileMenu.path),
      onPaste: () => void pasteFromMenu(),
      onRename: () => {
        /* 文件行保留原有 file.rename 流程（需要 expectedVersion）；
           目录行走 workbench entry.rename（不需要 version）。 */
        if (fileMenu.kind === 'file') openRenameDialog(fileMenu.path)
        else {
          fileManageReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          setRenameTarget({ kind: 'directory', path: fileMenu.path })
          setManageNote('')
          setFileMenu(null)
        }
      },
      onArchive: () => void archiveManaged(fileMenu.path),
      canArchive: canArchivePath(fileMenu.kind, fileMenu.path),
      onDelete: () => requestDeleteEntry(fileMenu.kind, fileMenu.path),
      onSplit: () => beginChapterSplit(fileMenu.path, 'tree'),
      onMergePrevious: () => beginChapterMerge(fileMenu.path, 'previous'),
      onMergeNext: () => beginChapterMerge(fileMenu.path, 'next'),
      canSplit: chapterMenuModel(fileMenu.path, files).canSplit,
      canMergePrevious: chapterMenuModel(fileMenu.path, files).canMergePrevious,
      canMergeNext: chapterMenuModel(fileMenu.path, files).canMergeNext,
      splitDisabledTitle: chapterMenuModel(fileMenu.path, files).splitDisabledTitle,
      mergePreviousDisabledTitle: chapterMenuModel(fileMenu.path, files).mergePreviousDisabledTitle,
      mergeNextDisabledTitle: chapterMenuModel(fileMenu.path, files).mergeNextDisabledTitle,
      onPin: () => { setPinnedPath(fileMenu.path); setFileMenu(null) },
      onUnpin: () => { setPinnedPath(null); setFileMenu(null) },
      isPinned: pinnedPath === fileMenu.path,
    }) : null,
    fileSession ? e(ChapterOpsLayer, {
      ctx,
      sessionId: fileSession.sessionId,
      files,
      request: chapterOps,
      getEditorSnapshot: () => snapshotFromHandle(editorHandleRef.current),
      onClose: () => setChapterOps(null),
      onApplied: applyChapterOps,
    }) : null,
    managePath ? e(TextPromptDialog, {
      id: 'rename-file',
      title: t('workspace.renameFile'),
      label: t('workspace.newName'),
      initialValue: managePath.split('/').at(-1) ?? '',
      confirmLabel: t('workspace.saveNewName'),
      onCancel: closeRenameDialog,
      onConfirm: renameManaged,
    }) : null,
    renameTarget ? e(TextPromptDialog, {
      id: 'rename-entry',
      key: `${renameTarget.kind}:${renameTarget.path}`,
      title: renameTarget.kind === 'directory' ? t('workspace.renameFolder') : t('common.rename'),
      label: t('workspace.newName'),
      initialValue: renameTarget.path.split('/').at(-1) ?? '',
      confirmLabel: t('workspace.saveNewName'),
      note: manageNote,
      busy: manageBusy,
      onCancel: closeRenameEntryDialog,
      onConfirm: submitRenameEntry,
    }) : null,
    deleteTarget ? e(ConfirmDialog, {
      id: 'delete-entry',
      title: deleteTarget.kind === 'directory' ? t('workspace.deleteFolderTitle') : t('workspace.deleteFileTitle'),
      message: t('workspace.deleteBody', { path: deleteTarget.path }),
      confirmLabel: t('common.delete'),
      onCancel: closeDeleteConfirm,
      onConfirm: () => void confirmDeleteEntry(),
    }) : null,
    renderCommandPalette(),
    renderImportDialog(),
    importTitle ? e(TextPromptDialog, {
      id: 'import-title',
      title: t('home.importAsNew'),
      label: t('home.workName'),
      initialValue: '',
      confirmLabel: t('home.chooseSource'),
      note: importTitle.note,
      busy: importTitle.busy,
      onCancel: () => { if (!importTitle.busy) setImportTitle(null) },
      onConfirm: (title: string) => void submitImportTitle(title),
    }) : null,
    exportChapters ? e(ExportPreviewDialog, {
      chapters: exportChapters,
      title: currentWorkspace?.title || t('workspace.untitled'),
      busy: exporting,
      note: exportNote,
      onCancel: () => { setExportChapters(null); setExportNote('') },
      onExport: confirmExport,
    }) : null,
    archiveOpen ? e(ArchivePanel, {
      items: archives,
      invalid: archiveInvalid,
      busy: archiveBusy,
      note: archiveNote,
      editorDirty,
      onRestore: (item: ArchiveView) => void restoreArchived(item),
      onContinue: (item: ArchiveView) => void continueArchive(item),
      onClose: () => { if (!archiveBusy) setArchiveOpen(false) },
    }) : null,
    imagePreview ? e(ImagePreviewOverlay, { path: imagePreview.path, url: imagePreview.url, onClose: closeImagePreview }) : null,
    settingsOpen ? e(SettingsDialog, { ctx, writingScope, migrateWriting, progressScope, assistant: capabilityReady ? capabilityState.value.assistant : undefined, onClose: () => setSettingsOpen(false) }) : null,
    startupUpdate && !aboutOpen ? e('div', { className: 'update-toast', role: 'status' },
      e('span', { className: 'update-toast-text' }, t('about.toast', { version: startupUpdate.version })),
      e('button', {
        type: 'button',
        className: 'update-toast-action',
        onClick: () => { setStartupUpdate(null); setAboutOpen(true) },
      }, t('about.viewDetails')),
      e('button', {
        type: 'button',
        className: 'icon-button update-toast-close',
        'aria-label': t('about.dismissToast'),
        onClick: () => setStartupUpdate(null),
      }, '×'),
    ) : null,
    aboutOpen ? e(AboutUpdateDialog, { onClose: () => setAboutOpen(false) }) : null,
  )
}

type RegisterShellRootOptions = {
  writingScope: SettingsScope<WritingPreferences>
  migrateWriting: WritingMigration
  progressScope: WritingProgressScope
  hostThemeSync?: HostThemeSync
  registerRoot: (ctx: ShellContext, render: (props: unknown) => ReactNode) => void
}

// The renderer injects renderSlot into the root entry's props. The dock is a
// launcher rail hosted inside the top chrome (see .shell-extensions-dock in
// styles.ts): a reserved layout strip rather than a full-screen overlay, so
// collapsed launchers can never cover the composer. The rail stays
// click-through and each contributed component opts into pointer events;
// open panels position against their launcher via the --dsh-ext-* contract.
type RootSlotProps = { renderSlot?: (key: string, owner: Record<string, never>) => ReactNode }

function ExtensionsDock(props: { rootProps: unknown }) {
  const renderSlot = (props.rootProps as RootSlotProps | null | undefined)?.renderSlot
  return e('div', {
    className: 'shell-extensions-dock',
    'data-testid': 'shell-extensions-dock',
  }, renderSlot ? renderSlot(EXTENSIONS_SLOT, {}) : null)
}

export function registerShellRoot(ctx: Context, options: RegisterShellRootOptions): void {
  const client = ctx as ShellContext
  options.registerRoot(client, (props) => e(Root, {
    ctx: client,
    writingScope: options.writingScope,
    migrateWriting: options.migrateWriting,
    progressScope: options.progressScope,
    hostThemeSync: options.hostThemeSync,
    extensionsDock: e(ExtensionsDock, { rootProps: props }),
  }))
}

// re-exports so external spec files still see the surface area of the old monolith
export { isSuccessWorkbenchNote as _isSuccessWorkbenchNote, searchSkippedText as _searchSkippedText } from './shared.ts'
