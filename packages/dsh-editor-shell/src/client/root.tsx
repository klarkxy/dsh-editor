import { useRootDesktop } from './root-desktop.ts'
import type { SnapshotResponse } from 'dsh-editor-workbench/contracts'
import { RootFileDialogs, RootTreeCreateDialog } from './root-file-dialogs.tsx'
import { useRootWorkspaces, collectWorkspaceFiles } from './root-workspaces.tsx'
import { useRootDocuments } from './root-documents.ts'
import { useRootFileActions } from './root-file-actions.ts'
import { useWorkbenchLayout } from '../app/shell/use-workbench-layout.ts'
import { Workbench } from '../app/shell/workbench.tsx'
import { Topbar } from '../app/shell/topbar.tsx'
import { AuxRail, ReferencePanel } from '../app/shell/aux-rail.tsx'
import { FilesRail } from '../app/files/files-rail.tsx'
import { useSurface } from './plugin-surfaces.tsx'
import { Button as DshButton, Notice } from '../ui/index.ts'
import { ChatIcon } from '../ui/icons.tsx'

import { registerEditorWorkspaceShortcuts } from './official-shortcuts.ts'
import { OfficialSurfaceProvider, OfficialOverlays, type OfficialRootProps } from './official-surfaces.tsx'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope, SessionFace, SessionId } from '../dsh-compat.ts'
import { normalizeAuthorMemory, normalizeAuthorPreferences } from '../author-preferences.ts'
import { documentDirectory, exportDirectoryOf, isManuscriptChapterPath, normalizeProjectDirectory, sortChapterPaths, sortDocumentPaths } from '../project-files.ts'
import { EXTENSIONS_SLOT, PLUGINS_SETTINGS_SLOT, SIDEBAR_TOOLS_SLOT, ZHIHU_SETTINGS_SLOT } from '../root-registration.ts'
import { matchRegistryShortcut, registryPaletteItems, type ShellCommandRegistry, type ShellProposalCardProps, type ShellRange, type ShellToolSeatContext } from '../seats.ts'
import { writingPreferences, writingTypography, type WritingMigration, type WritingPreferences } from '../writing-settings.tsx'
import { redesignedStyles } from '../styles.ts'
import { componentStyles, officialResourceStyles, responsiveStyles } from '../design-system/styles.ts'
import { tokenStyles } from '../design-system/tokens.ts'
import { collectStyles, defineStyles } from '../design-system/layers.ts'
import { type ShellContext, type WorkspaceOpenState, proposalAppliedNavigation } from './shared.ts'
import { useTransientSuccessNote } from './transient-note.ts'
import { ShellErrorBoundary, useObservable } from './components.tsx'
import { BoundProposalCard, CenterOverlays, ChatColumn, EditorColumn, SidebarTools } from './root-columns.tsx'
import { HomeScreen } from './root-home.tsx'
import { CrossIcon } from './icons.tsx'
import { ConfirmDialog } from './dialogs.tsx'
import { PluginWorkspace } from './plugins-page.tsx'
import { SettingsDialog, type SettingsRenderSlot } from './settings.tsx'
import type { SettingsTab } from '../model/settings.ts'
import { useTheme } from './theme.tsx'
import { WindowControls } from './window-controls.tsx'
import type { HostThemeSync } from '../model/theme.ts'

import { isMarkdownChapterPath } from '../chapter-ops-view.ts'

import { featureEnabled } from '../capabilities.ts'
import { useShellCapabilities } from './capabilities.ts'
import { CommandPalette } from './command-palette.tsx'
import { Select as HostSelect } from './select.tsx'
import { ActivityDots, Button as HostButton, Dialog as HostDialog, Input as HostInput, TextArea as HostTextArea, ShellUiProvider, radixThemesStyles, useChromeMotion } from './ui/index.ts'
import { Button as ThemesButton, Callout, Flex, IconButton, Text } from '@radix-ui/themes'
import { windowBridge } from '../model/window-controls.ts'
import { replaceOutcomeForIdentity, searchIdentity, type ReplaceOutcome, type SearchReplaceReport, type SearchScope } from '../model/search-panel.ts'
import { PinnedPane } from './pinned-pane.tsx'
import { canPinPath, storedPinnedPath, validatePinnedPath } from '../pinned-pane-view.ts'
import { collectDocuments, ExportPreviewDialog } from './export-dialog.tsx'
import { downloadExport } from '../model/export-dialog.ts'
import { prepareExport, type ChapterExport, type ExportFormat } from '../export.ts'
import { HistoryPanel } from './history-dialog.tsx'
import { t, useLocale } from '../i18n/index.ts'

const HOST_UI_OWNER = { Select: HostSelect, Dialog: HostDialog, Button: HostButton, Input: HostInput, TextArea: HostTextArea }

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
  const session = useObservable(ctx.uiWorkspace.current)
  const current = session?.sessionId
  const selectedWorkspace = workspaces.items.find((workspace) => current && workspace.sessionIds.includes(current))
    ?? workspaces.items.find((workspace) => workspace.path === (current ? sessions.byId[current]?.cwd : undefined))
  const [workspaceOpen, setWorkspaceOpen] = useState<WorkspaceOpenState>({ kind: 'idle' })
  const workspaceSession = useObservable(ctx.uiWorkspace.workspace)
  const fileSessionId = workspaceOpen.kind === 'ready' ? workspaceSession?.sessionId : undefined
  const fileSession: SessionFace | undefined = workspaceOpen.kind === 'ready' ? workspaceSession : undefined
  const fileSessionIdRef = useRef<SessionId | undefined>(fileSessionId)
  fileSessionIdRef.current = fileSessionId
  const openWorkspaceId = workspaceOpen.kind === 'ready' ? workspaceOpen.workspaceId : undefined
  const currentWorkspace = workspaceOpen.kind === 'ready'
    ? workspaces.items.find((workspace) => workspace.workspaceId === workspaceOpen.workspaceId) ?? selectedWorkspace
    : selectedWorkspace
  const [path, setPath] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [workbenchNote, setWorkbenchNote] = useState('')
  const [treeRevision, setTreeRevision] = useState(0)
  const [treeExpansionPath, setTreeExpansionPath] = useState('')
  const [contentRevision, setContentRevision] = useState(0)
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [officialPreviewOpen, setOfficialPreviewOpen] = useState(false)
  const [previewViewport, setPreviewViewport] = useState(() => globalThis.innerWidth)
  useEffect(() => {
    const resized = () => setPreviewViewport(globalThis.innerWidth)
    globalThis.addEventListener('resize', resized)
    return () => globalThis.removeEventListener('resize', resized)
  }, [])
  useEffect(() => {
    const source = (ctx as unknown as { layout: { panelInfo: { getSnapshot(): { activePanelId: string | null }; subscribe(fn: () => void): () => void } } }).layout.panelInfo
    const update = () => setPluginsOpen(source.getSnapshot().activePanelId === 'plugins')
    update()
    return source.subscribe(update)
  }, [ctx])
  useEffect(() => {
    const source = (ctx as unknown as { layout: { presentation: { getSnapshot(): { shown: boolean }; subscribe(fn: () => void): () => void } } }).layout.presentation
    const update = () => setOfficialPreviewOpen(source.getSnapshot().shown)
    update()
    return source.subscribe(update)
  }, [ctx])
  const [assistantDraftDirty, setAssistantDraftDirty] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState<{ resolve(value: boolean): void } | null>(null)
  const canLeaveAssistantDraft = async (): Promise<boolean> => {
    if (!assistantDraftDirty) return true
    return await new Promise<boolean>((resolve) => setLeaveConfirm({ resolve }))
  }
  const resolveLeaveConfirm = (value: boolean) => {
    leaveConfirm?.resolve(value)
    setLeaveConfirm(null)
  }
  const workspaceReady = workspaceOpen.kind === 'ready' && Boolean(fileSession)
  const workbench = useWorkbenchLayout({ ctx, fileSession, workspaceId: openWorkspaceId, workspaceReady })
  const { layout } = workbench
  const focusMode = layout.focus
  const sidebarVisible = workbench.filesVisible
  const assistantVisible = workbench.auxVisible
  /* 钉住的文稿路径仍是作者偏好（pinned-width 随旧钉住列一起退役，钉住预览
     由辅助栏「资料」页签承载，宽度统一走 assistant-width）。 */
  const [pinnedPath, setPinnedPath] = useState<string | null>(() => storedPinnedPath('dsh-editor.layout.pinned-path'))
  useEffect(() => {
    try {
      if (pinnedPath) globalThis.localStorage?.setItem('dsh-editor.layout.pinned-path', pinnedPath)
      else globalThis.localStorage?.removeItem('dsh-editor.layout.pinned-path')
    } catch { /* 视图偏好只尽力保存。 */ }
  }, [pinnedPath])
  /* 官方 rightbar/资源预览是系统动作：打开/关闭都不写作者偏好。 */
  useEffect(() => {
    if (officialPreviewOpen) workbench.openRightbarPreview()
    else workbench.closeRightbarPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officialPreviewOpen])
  const sidebarToolEntries = useSurface(ctx, SIDEBAR_TOOLS_SLOT).entries
  const documents = useRootDocuments({ ctx, fileSession, path, setPath, setWorkbenchNote,
    setTreeRevision, setContentRevision, pinnedPath, openWorkspaceId })
  const {
    editorDirty, setEditorDirty, editorDirtyRef, editorHandleRef, latestDocRef,
    saveEditorBeforeAction, openDocument, onEditorHandle, onEditorSaved, reveal,
    historyOpen, setHistoryOpen, snapshots, snapshotBusy,
    rollbackTarget, setRollbackTarget, commitSnapshot, requestRollback, confirmRollback,
  } = documents
  const chapterFiles = useMemo(() => sortChapterPaths(files), [files])
  const fileActions = useRootFileActions({ ctx, fileSession, workspaceOpen, path, setPath, editorDirty, editorDirtyRef,
    chapterFiles, openDocument, setWorkbenchNote, setTreeRevision, setContentRevision,
    setTreeExpansionPath, saveEditorBeforeAction, openWorkspaceId })
  const {
    createNote, fileMenu, openImagePreview, openFileMenu, beginChapterSplit,
    moveTreeEntry, onTreeCreateFile, onTreeCreateFolder, onEditorCreate,
  } = fileActions
  const workspaceActions = useRootWorkspaces({ ctx, workspaces, selectedWorkspace, currentWorkspace, session, fileSession,
    workspaceOpen, setWorkspaceOpen, setPath, setWorkbenchNote,
    saveEditorBeforeAction, canLeaveAssistantDraft, setAssistantDraftDirty,
    /* 旧的 setFocusMode(false) 语义＝退出专注；保持 Dispatch 形状以兼容既有调用点。 */
    setFocusMode: (next: boolean | ((current: boolean) => boolean)) => {
      const value = typeof next === 'function' ? next(layout.focus) : next
      if (value) workbench.enterFocus()
      else workbench.exitFocus()
    } })
  const {
    homeNote, openingWorkspace, workspaceMenuOpen, setWorkspaceMenuOpen,
    manualWorkspaceMode, newProject, pathFallbackInput, pathFallbackForm,
    workspaceMenuTrigger, workspaceMenuYields, removeRecentTarget, setRemoveRecentTarget,
    openRegisteredWorkspace, continuePendingWorkspaceIntent, cancelPendingWorkspaceIntent,
    relocateWorkspace, requestRemoveRecent, confirmRemoveRecent, startWorkspaceFromPicker,
    closePathFallback, closeWorkspaceChrome, leaveToHome, switchToWorkspace,
    startNewProject, openAnotherWorkspace, renderNewProjectDialog, renderImportDialog,
  } = workspaceActions
  const writingSnapshot = useObservable(writingScope)
  const writing = writingPreferences(writingSnapshot, globalThis.localStorage)
  const expireWorkbenchNote = useCallback((note: string) => {
    setWorkbenchNote((current) => current === note ? '' : current)
  }, [])
  useTransientSuccessNote(workbenchNote, expireWorkbenchNote)
  const [chatFocusNonce, setChatFocusNonce] = useState(0)
  const [theme, setTheme] = useTheme(undefined, hostThemeSync)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('project')
  const [searchReplaceBusy, setSearchReplaceBusy] = useState(false)
  const [searchReplaceReport, setSearchReplaceReport] = useState<SearchReplaceReport | null>(null)
  const searchContextIdentity = fileSessionId
    ? searchIdentity({ sessionId: fileSessionId, revision: treeRevision, query: searchQuery, scope: searchScope, activePath: path })
    : ''
  const searchContextRef = useRef(searchContextIdentity)
  searchContextRef.current = searchContextIdentity
  useEffect(() => setSearchReplaceReport(null), [searchContextIdentity])
  const [highlightPath, setHighlightPath] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState('')
  const [exportChapters, setExportChapters] = useState<ChapterExport[] | null>(null)
  const { startupUpdate, setStartupUpdate } = useRootDesktop(editorHandleRef)
  useEffect(() => () => leaveConfirm?.resolve(false), [leaveConfirm])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openPlugins = () => {
    setSettingsOpen(false)
    ;(ctx as unknown as { layout: { selectPanel(id: string | null): void } }).layout.selectPanel('plugins')
  }
  const closePlugins = () => {
    ;(ctx as unknown as { layout: { selectPanel(id: string | null): void } }).layout.selectPanel(null)
  }
  const [settingsFocusTab, setSettingsFocusTab] = useState<SettingsTab | undefined>()
  const openSettings = useCallback((tab?: SettingsTab) => {
    setSettingsFocusTab(tab)
    setSettingsOpen(true)
  }, [])
  const seatContextRef = useRef<ShellToolSeatContext | null>(null)
  /* 工作区 <main> 的句柄。 */
  const shellMainRef = useRef<HTMLElement | null>(null)
  const pinValidatedSession = useRef<string | undefined>()
  const homeCardOpen = useChromeMotion('card', 0)
  const homeCardNew = useChromeMotion('card', 0.05)
  useEffect(() => { document.title = 'DSH Editor' }, [])
  const officialActionRef = useRef<Record<string, () => void>>({})
  officialActionRef.current = {
    'toggle-sidebar': () => workbench.setFilesOpen(!workbench.layout.files.open),
    'new-window': () => windowBridge()?.newWindow?.(),
    'palette': () => setPaletteOpen(value => !value),
    'settings': () => { void openSettings() },
    'toggle-assistant': () => workbench.setAuxOpen(!workbench.layout.aux.open),
    'toggle-focus': () => workbench.toggleFocus(),
    'focus-assistant': () => {
      if (!assistantEnabled) return
      workbench.focusPartner()
      setChatFocusNonce(value => value + 1)
    },
    'search': () => {
      if (workspaceOpen.kind !== 'ready') return
      workbench.setFilesOpen(true)
      setSearchOpen(true)
    },
    'toggle-typewriter': () => { void writingScope.set('typewriter', !writing.typewriter) },
    'toggle-focus-paragraph': () => { void writingScope.set('focusParagraph', !writing.focusParagraph) },
  }
  useEffect(() => {
    const toggle = () => officialActionRef.current['toggle-sidebar']?.()
    globalThis.addEventListener('dsh-editor:official-layout', toggle)
    return () => globalThis.removeEventListener('dsh-editor:official-layout', toggle)
  }, [])
  const shortcutEnabled = useRef({ pluginsOpen, session: Boolean(session) })
  shortcutEnabled.current = { pluginsOpen, session: Boolean(session) }
  useEffect(() => registerEditorWorkspaceShortcuts(
    (ctx as unknown as { shortcuts: Parameters<typeof registerEditorWorkspaceShortcuts>[0] }).shortcuts,
    Object.fromEntries(Object.keys(officialActionRef.current).map(key => [key, () => officialActionRef.current[key]?.()])),
    action => !shortcutEnabled.current.pluginsOpen && (['settings', 'new-window', 'palette'].includes(action) || shortcutEnabled.current.session),
  ), [ctx])
  useEffect(() => {
    const hotkey = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      if (pluginsOpen) return
      if (document.querySelector('[aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
      /* 窄屏抽屉由 Radix Drawer(Dialog)处理自己的 Esc 关闭；菜单/下拉打开时
         也让位给它们自己的 Esc 处理。 */
      if (event.key === 'Escape') return
      if (event.repeat) return
      const command = matchRegistryShortcut(commands.list(), event)
      if (!command) return
      if (command.when === 'workspace' && (!session || workspaceOpen.kind !== 'ready')) return
      const seat = seatContextRef.current
      if (!seat || command.enabled?.(seat) === false) return
      event.preventDefault()
      workbench.exitFocus()
      setPaletteOpen(false)
      if (command.when === 'workspace') seat.revealSidebar()
      command.run(seat)
    }
    globalThis.addEventListener('keydown', hotkey, true)
    return () => globalThis.removeEventListener('keydown', hotkey, true)
  }, [pluginsOpen, assistantEnabled, commands, path, session?.sessionId, workbench, workspaceOpen.kind, writing.typewriter, writing.focusParagraph])
  useEffect(() => {
    if (!chatFocusNonce || !assistantVisible || layout.aux.tab !== 'partner' || focusMode || !assistantEnabled) return
    globalThis.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus(), 0)
  }, [assistantEnabled, assistantVisible, chatFocusNonce, focusMode, layout.aux.tab])
  useEffect(() => {
    if (!openWorkspaceId) setPath('')
    setFiles([]); setWorkbenchNote(''); setTreeExpansionPath('')
    setSearchOpen(false); setHighlightPath(null); setExportChapters(null); setExportNote('')
  }, [openWorkspaceId])
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
  const openSearchPanel = () => {
    if (!fileSession) return
    workbench.setFilesOpen(true)
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
  const refreshSeat = useCallback((scope: 'tree' | 'content' | 'overview') => {
    // The overview panel owns its data and observes the existing tree/content revisions.
    if (scope === 'content') setContentRevision((value) => value + 1)
    else setTreeRevision((value) => value + 1)
  }, [])
  const toggleSeatPin = useCallback((target: string) => {
    setPinnedPath((current) => {
      const next = current === target ? null : target
      if (next) workbench.model.pinReference()
      return next
    })
  }, [workbench.model])
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
    revealSidebar: () => workbench.model.revealTools(),
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
  }), [fileSession?.sessionId, path, editorDirty, treeRevision, contentRevision, locale, openSeatDocument, refreshAppliedPath, workbench.model, refreshSeat, toggleSeatPin, pinnedPath, BoundSeatProposalCard])
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
        workbench.exitFocus()
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
  const onAppliedChat = refreshAppliedPath
  /* 侧栏搜索命中/替换后的刷新：均经保存 gate 或内容修订，供 memo 化的侧栏列复用。 */
  const onSearchReplaced = useCallback((sourceSessionId: string, paths: string[]) => {
    if (fileSessionIdRef.current !== sourceSessionId) return
    const activePath = latestDocRef.current.path
    if (!paths.includes(activePath)) return
    const navigation = proposalAppliedNavigation(activePath, activePath, editorDirtyRef.current)
    if (navigation.refreshContent) setContentRevision((old) => old + 1)
  }, [])
  const onSearchReplaceOutcomeChange = useCallback((identity: string, outcome: ReplaceOutcome | null) => {
    if (searchContextRef.current !== identity) return
    setSearchReplaceReport(outcome ? { identity, outcome } : null)
  }, [])
  const onSearchRequestOpen = useCallback(() => setSearchOpen(true), [])
  const onSearchRequestClose = useCallback(() => setSearchOpen(false), [])
  const configureChatModel = useCallback(() => openSettings('models'), [openSettings])
  const onCommitSnapshot = useCallback(() => { void commitSnapshot() }, [fileSession, snapshotBusy])
  const onRequestRollback = useCallback((snapshot: SnapshotResponse) => requestRollback(snapshot), [snapshotBusy])
  const openHistoryPanel = useCallback(() => {
    closeWorkspaceChrome()
    setPaletteOpen(false)
    if (!fileSession) return
    setHistoryOpen(true)
  }, [fileSession])
  /* 作者偏好/记忆/排版：由真实输入 memo，身份稳定，子列 memo 才能生效。 */
  const authorPreferences = useMemo(() => normalizeAuthorPreferences(writing.authorPreferences), [writing.authorPreferences])
  const authorMemory = useMemo(() => normalizeAuthorMemory(writing.authorMemory), [writing.authorMemory])
  const typography = useMemo(
    () => writingTypography(writing),
    [writing.fontSize, writing.lineHeight, writing.fontFamily, writing.paragraphSpacing, writing.paperWidth, writing.firstLineIndent, writing.centerSectionMarks],
  )
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
  /* 命令面板:复用 useTheme / openSettings / startWorkspaceFromPicker /
     startNewProject / openDocument / setFocusMode 全部已有的回调,palette
     本身只负责"按下执行"的分发。文件列表来自已加载好的 files 状态(已经
     是排过序的 .md/.txt),不另外发 RPC。 */
  const renderCommandPalette = () => <CommandPalette
    open={paletteOpen}
    hotkeysEnabled={false}
    onOpenChange={setPaletteOpen}
    theme={theme}
    onThemeChange={setTheme}
    onOpenWorkspace={() => { if (fileSession) { void openAnotherWorkspace() } else { void startWorkspaceFromPicker() } }}
    onNewProject={() => { void startNewProject() }}
    onOpenSettings={() => openSettings()}
    onOpenPlugins={openPlugins}
    onToggleFocus={() => workbench.toggleFocus()}
    onOpenDocument={(target: string) => openDocument(target)}
    onOpenSearch={() => openSearchPanel()}
    registryCommands={registryCommands}
    onExport={() => { void exportDocuments() }}
    onOpenHistory={() => openHistoryPanel()}
    onSplitAtCursor={() => beginChapterSplit(path, 'cursor')}
    canSplitAtCursor={Boolean(fileSession) && !editorDirty && isMarkdownChapterPath(path)}
    onToggleTypewriter={() => { void writingScope.set('typewriter', !writing.typewriter) }}
    onToggleFocusParagraph={() => { void writingScope.set('focusParagraph', !writing.focusParagraph) }}
    typewriter={writing.typewriter}
    focusParagraph={writing.focusParagraph}
    onPinCurrent={() => { if (canPinPath(path)) { setPinnedPath(path); workbench.pinReference() } }}
    canPinCurrent={Boolean(fileSession) && canPinPath(path)}
    onUnpin={() => setPinnedPath(null)}
    pinnedPath={pinnedPath}
    hasWorkspace={Boolean(fileSession)}
    focusMode={focusMode}
    files={files}
    onCreateFile={() => onTreeCreateFile('')}
    activePath={path} />

  const chatSession = session ?? fileSession

  if (workspaceOpen.kind === 'checking' || !fileSession || workspaceOpen.kind !== 'ready') {
    return (
      <ShellUiProvider theme={theme}>
        <PluginWorkspace open={pluginsOpen} ctx={ctx} renderSlot={renderSlot} plugins={pluginsSettings} zhihu={zhihuSettings}
          sessionId={session?.sessionId} hasWorkspace={Boolean(fileSession)} onClose={closePlugins}>
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
            commands={commands}
            writingScope={writingScope}
            migrateWriting={migrateWriting}
            assistant={capabilityReady ? featureEnabled(capabilityState.value, 'assistant') : undefined}
            focusTab={settingsFocusTab}
            renderSlot={renderSlot}
            onClose={() => setSettingsOpen(false)} />}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSettings={openSettings} onOpenPlugins={openPlugins} />
      </PluginWorkspace>
      </ShellUiProvider>
    );
  }

  const sidebarColumn = <FilesRail
      ctx={ctx}
      sessionId={fileSession.sessionId}
      searchOpen={searchOpen}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchScope={searchScope}
      onSearchScopeChange={setSearchScope}
      replaceOutcome={replaceOutcomeForIdentity(searchReplaceReport, searchContextIdentity)}
      onReplaceOutcomeChange={onSearchReplaceOutcomeChange}
      replaceBusy={searchReplaceBusy}
      onReplaceBusyChange={setSearchReplaceBusy}
      onSearchRequestOpen={onSearchRequestOpen}
      onSearchRequestClose={onSearchRequestClose}
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
      menuTargetPath={fileMenu?.path}
      onOpen={openDocument}
      onPreviewImage={openImagePreview}
      onFileMenu={openFileMenu}
      onCreateFile={onTreeCreateFile}
      onCreateFolder={onTreeCreateFolder}
      onMove={moveTreeEntry} />

  /* 面包屑的「切换章节」列同目录兄弟文档；无打开文档时面包屑隐藏。 */
  const breadcrumb = path
    ? {
        path,
        siblings: files.filter((candidate) => documentDirectory(candidate) === documentDirectory(path)),
      }
    : null

  /* 辅助栏三页签（§2.2）：搭档＝原 Chat 列；资料＝钉住文稿 + 官方 rightbar 槽位
     + 钉住/预览切换；工具＝SIDEBAR_TOOLS_SLOT 贡献。 */
  const auxRailNode = <AuxRail
    tab={layout.aux.tab}
    onTabChange={workbench.selectAuxTab}
    hasTools={sidebarToolEntries.length > 0}
    partner={
      capabilityState.kind === 'error'
        ? <Notice
            tone="danger"
            title={t('capabilities.loadFailed', { error: capabilityState.message })}
            action={<DshButton variant="secondary" size="sm" onClick={shellCapabilities.retry}>{t('capabilities.retry')}</DshButton>} />
        : !capabilityReady
          ? <Notice tone="info" title={t('capabilities.loading')} />
          : assistantEnabled && chatSession
            ? <ChatColumn
                ctx={ctx}
                chatSession={chatSession}
                workspaceId={currentWorkspace?.workspaceId}
                activePath={path}
                authorPreferences={authorPreferences}
                authorMemory={authorMemory}
                renderSlot={renderSlot}
                hidden={!assistantVisible || layout.aux.tab !== 'partner'}
                overlay={false}
                onConfigure={configureChatModel}
                onDraftDirtyChange={setAssistantDraftDirty}
                onWritten={refreshWrittenPath}
                onApplied={onAppliedChat}
                onHide={() => workbench.setAuxOpen(false)} />
            : <Notice tone="info" title={t('aux.partnerDisabled')} />
    }
    reference={<ReferencePanel
      pinnedPath={pinnedPath}
      previewOpen={officialPreviewOpen}
      onPreviewOpenChange={(open) => {
        const layoutService = (ctx as unknown as { layout: { openRightbar(track: boolean, fullscreen: boolean): void; closeRightbar(): void } }).layout
        if (open) layoutService.openRightbar(false, false)
        else layoutService.closeRightbar()
      }}
      pinned={pinnedPath ? <PinnedPane
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
        }} /> : null}
      preview={<div data-dsh-plugin-surface="" className="dsh-aux-rightbar-slot">
        {renderSlot?.('rightbar', {
          width: Math.min(680, previewViewport), viewportWidth: previewViewport, canShow: !pluginsOpen,
        })}
      </div>} />}
    tools={<SidebarTools renderSlot={renderSlot} seatContext={seatContext} />} />

  return (
    <ShellUiProvider theme={theme}>
        <PluginWorkspace open={pluginsOpen} ctx={ctx} renderSlot={renderSlot} plugins={pluginsSettings} zhihu={zhihuSettings}
          sessionId={session?.sessionId} hasWorkspace={Boolean(fileSession)} onClose={closePlugins}>
      <main
        className={`shell layout-shell${focusMode ? ' focus-mode' : ''}`}
        ref={shellMainRef}
        style={{ minWidth: 0 }}>
        <Topbar
          currentWorkspace={currentWorkspace}
          workspaces={workspaces.items}
          openingWorkspace={openingWorkspace}
          newProjectBusy={Boolean(newProject)}
          exporting={exporting}
          onSwitchWorkspace={(workspaceId) => void switchToWorkspace(workspaceId)}
          onOpenAnotherWorkspace={() => void openAnotherWorkspace()}
          onNewProject={() => void startNewProject()}
          onExportDocuments={() => void exportDocuments()}
          onLeaveHome={() => void leaveToHome()}
          workspaceMenuOpen={workspaceMenuOpen}
          onWorkspaceMenuOpenChange={(open: boolean) => { if (open) workspaceMenuYields.current = false; setWorkspaceMenuOpen(open) }}
          onWorkspaceMenuYield={() => { workspaceMenuYields.current = true }}
          menuTriggerRef={workspaceMenuTrigger}
          menuYieldsRef={workspaceMenuYields}
          breadcrumb={breadcrumb}
          onOpenDocument={(target: string) => openDocument(target)}
          filesVisible={sidebarVisible}
          auxVisible={assistantVisible}
          focus={focusMode}
          onToggleFiles={() => workbench.setFilesOpen(!layout.files.open)}
          onToggleAux={() => workbench.setAuxOpen(!layout.aux.open)}
          onToggleFocus={() => workbench.toggleFocus()}
          onOpenPalette={() => setPaletteOpen(true)}
          extensionsDock={extensionsDock}
          windowControls={<WindowControls />}
          onOpenSettings={() => openSettings()}
          onOpenPlugins={openPlugins} />
        <Workbench
          layout={workbench}
          files={sidebarColumn}
          aux={auxRailNode}
          launcher={!assistantVisible && !focusMode && capabilityReady && assistantEnabled ? <DshButton
            variant="secondary"
            className="dsh-launcher"
            icon={<ChatIcon />}
            aria-label={t('workspace.openAssistant')}
            aria-expanded={false}
            data-testid="dsh-shell-launcher"
            onClick={() => { workbench.focusPartner(); setChatFocusNonce((value) => value + 1) }}>
            {t('workspace.assistant')}
          </DshButton> : null}
          paper={<>
            <EditorColumn
              ctx={ctx}
              fileSession={fileSession}
              path={path}
              files={isManuscriptChapterPath(path) ? chapterFiles : files}
              referenceFiles={files}
              referenceRevision={treeRevision}
              onOpenReference={openDocument}
              onPinReference={(target: string | null) => {
                setPinnedPath(target)
                /* 钉住＝作者行为：开辅助栏并切到「资料」（§2 切换来源 2）。 */
                if (target) workbench.pinReference()
              }}
              onCreate={onEditorCreate}
              onHandle={onEditorHandle}
              contentRevision={contentRevision}
              onDirtyChange={setEditorDirty}
              reveal={reveal}
              completionPreference={writing.completion}
              completionDelayMs={writing.completionDelayMs}
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
        </>}
        />
        <ConfirmDialog
          open={Boolean(leaveConfirm)}
          id="leave-assistant-draft"
          title={t('chat.discardDraftTitle')}
          message={t('chat.leaveDraftBody')}
          confirmLabel={t('chat.discardAndContinue')}
          onCancel={() => resolveLeaveConfirm(false)}
          onConfirm={() => resolveLeaveConfirm(true)} />
        <RootTreeCreateDialog actions={fileActions} />
        <ConfirmDialog
          open={Boolean(rollbackTarget)}
          id="snapshot-rollback"
          title={t('workspace.rollbackTitle')}
          message={t('workspace.rollbackBody', { label: rollbackTarget?.label ?? rollbackTarget?.createdAt ?? '' })}
          confirmLabel={t('workspace.rollback')}
          onCancel={() => setRollbackTarget(null)}
          onConfirm={() => void confirmRollback()} />
        {renderNewProjectDialog()}
        <RootFileDialogs
          actions={fileActions} ctx={ctx} fileSession={fileSession} files={files}
          editorHandleRef={editorHandleRef} path={path} chapterFiles={chapterFiles}
          pinnedPath={pinnedPath} setPinnedPath={setPinnedPath} exportDocuments={exportDocuments}
          openDocument={openDocument} />
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
            onSaveVersion={onCommitSnapshot}
            onClose={() => { if (!snapshotBusy) setHistoryOpen(false) }} />
        </ShellErrorBoundary>
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
        <SettingsDialog
          sessionId={chatSession?.sessionId}
          open={settingsOpen}
          ctx={ctx}
          commands={commands}
          writingScope={writingScope}
          migrateWriting={migrateWriting}
          assistant={capabilityReady ? featureEnabled(capabilityState.value, 'assistant') : undefined}
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
              <CrossIcon size={14} />
            </IconButton>
          </Flex>
        </Callout.Root> : null}
      </main>
    </PluginWorkspace>
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
type RootSlotProps = OfficialRootProps

export function ExtensionsDock(props: { rootProps: unknown }) {
  const renderSlot = (props.rootProps as RootSlotProps | null | undefined)?.renderSlot
  return (
    <div className="shell-extensions-dock" data-testid="shell-extensions-dock">
      <div data-dsh-plugin-surface="" style={{ display: 'contents' }}>
        {renderSlot ? renderSlot(EXTENSIONS_SLOT, HOST_UI_OWNER) : null}
      </div>
    </div>
  );
}

/* 样式一次注入 document.head（镜像面板包的 injectStyles 模式）：50KB 常量字符串
   不再作为 React 子节点参与每次渲染的 diff。注册即注入，早于 root 首次渲染，无 FOUC；
   去重标记保证 effect 重跑不会重复插入。 */
function injectShellStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  /* design-system-spec §4：旧样式整体进 legacy 层（保持原有先后次序），
     token 定义进 dsh.tokens 层，层序声明由 collectStyles 统一输出。 */
  defineStyles('legacy', 'radix-themes', radixThemesStyles)
  defineStyles('legacy', 'shell-legacy', redesignedStyles)
  defineStyles('legacy', 'yuangao-components', componentStyles)
  defineStyles('legacy', 'yuangao-responsive', responsiveStyles)
  defineStyles('legacy', 'yuangao-official-resource', officialResourceStyles)
  defineStyles('dsh.tokens', 'yuangao-tokens', tokenStyles)
  const css = collectStyles()
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
    <OfficialSurfaceProvider value={{ ...props as OfficialRootProps, shortcuts: (client as unknown as { shortcuts: import('@deepseek-ai/dsh-client-shortcuts/client').Shortcuts }).shortcuts }}>
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
    <OfficialOverlays {...props as OfficialRootProps} />
    </OfficialSurfaceProvider>
  </ShellErrorBoundary>)
}

// re-exports so external spec files still see the surface area of the old monolith
export { workspaceResumeExcludedIds } from './root-workspaces.tsx'
export { isSuccessWorkbenchNote as _isSuccessWorkbenchNote, searchSkippedText as _searchSkippedText } from './shared.ts'
