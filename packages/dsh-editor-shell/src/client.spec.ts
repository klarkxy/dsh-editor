import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
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
} from './client.ts'

const rootSource = () => readFileSync(new URL('./client/root.ts', import.meta.url), 'utf8')
const initGuideSource = () => readFileSync(new URL('./init-guide.ts', import.meta.url), 'utf8')

describe('shell manuscript RPC safety', () => {
  it('keeps browser-native prompt and confirm out of the workbench UI', () => {
    const source = rootSource()
    expect(source).not.toContain('globalThis.prompt')
    expect(source).not.toContain('globalThis.confirm')
  })

  it('creates 新建 in 文档/dsh-editor via an in-app name dialog, and only uses the directory picker for 打开作品', () => {
    const source = rootSource()
    expect(source).toContain("onClick: () => void startWorkspaceFromPicker()")
    expect(source).toContain("onClick: () => void startNewProject()")
    expect(source).not.toContain("startWorkspaceFromPicker('create')")
    expect(source).toContain("'project.createHome'")
    expect(source).toContain('ctx.workspaces.pickDirectory()')
    expect(source).toContain("setManualWorkspaceMode('existing')")
    expect(source).not.toContain("setManualWorkspaceMode(intent === 'create' ? 'new' : 'existing')")
    expect(source).not.toContain('showWorkspacePath(')
  })

  it('opens an existing work even when import or restore status cannot be verified', () => {
    const source = rootSource()
    expect(source).not.toContain('作品中的导入状态无法验证')
    expect(source).not.toContain('作品中的恢复状态无法验证')
  })

  it('allows only the app-owned metadata directory when checking a new empty project', () => {
    expect(hasVisibleWorkspaceEntries([])).toBe(false)
    expect(hasVisibleWorkspaceEntries([{ name: '.dsh-editor' }])).toBe(false)
    expect(hasVisibleWorkspaceEntries([{ name: '.git' }])).toBe(true)
    expect(hasVisibleWorkspaceEntries([{ name: '.env' }])).toBe(true)
    expect(hasVisibleWorkspaceEntries([{ name: '.dsh-editor' }, { name: '已有正文.md' }])).toBe(true)
  })

  it('opens only supported visible text files and never probes an image as the first document', () => {
    expect(supportedWorkspaceTextPaths(['封面.jpg', '正文/001.md', '资料/说明.txt', '.dsh-editor/作品索引.md', '图/分镜.PNG']))
      .toEqual(['正文/001.md', '资料/说明.txt'])
  })

  it('accepts relocation only when a readable manuscript file can be identified', () => {
    expect(hasRelocatableManuscriptFiles([])).toBe(false)
    expect(hasRelocatableManuscriptFiles(['项目总览.md', '人物卡/主角.md'])).toBe(false)
    expect(hasRelocatableManuscriptFiles(['正文/001.md'])).toBe(true)
    expect(hasRelocatableManuscriptFiles(['正文/第一卷/001.txt'])).toBe(true)
    expect(relocationFailureMessage(false)).toContain('原作品入口已保留')
    expect(relocationFailureMessage(false)).not.toContain('未能自动移除')
    expect(relocationFailureMessage(true)).toContain('新位置入口未能自动移除')
  })

  it('triggers the index run from the init guide card via the shared init-guide module', () => {
    const root = rootSource()
    expect(root).not.toMatch(/(?:function|const)\s+triggerExistingIndex\b/)
    const guide = initGuideSource()
    expect(guide).toMatch(/export async function startExploreInit\b/)
    /* 索引由 novel_index_write 直写落盘，不再预建 stub、不经提案确认。 */
    expect(guide).not.toContain('project.prepareIndex')
    expect(guide).toContain('buildNovelIndexPrompt()')
  })

  it('auto-triggers the index after the interview when a proposal landed and the session goes idle', () => {
    /* 纯函数 + chat.ts 端到端调用必须都到位:init-guide.ts 暴露判定,
     * chat.ts 在 effect 里调用 startExploreInit。 */
    const guide = initGuideSource()
    expect(guide).toMatch(/export function shouldAutoIndexAfterInterview\b/)
    expect(guide).toMatch(/export type AutoIndexInputs\b/)

    const chatSource = readFileSync(new URL('./client/chat.ts', import.meta.url), 'utf8')
    expect(chatSource).toContain('startExploreInit(ctx, session.sessionId)')
    expect(chatSource).toContain('shouldAutoIndexAfterInterview')
    expect(chatSource).toContain('autoIndexTriggeredRef')
    expect(chatSource).toContain('appliedDuringInterviewRef')
    expect(chatSource).toMatch(/onApplied:\s*handleApplied/)
    /* 触发只看 running 刚停下,避免在用户继续聊时抢跑 */
    expect(chatSource).toMatch(/runningJustStopped/)
    expect(chatSource).toMatch(/prevRunningRef\.current === true && !snapshot\.running/)
  })

  it('keeps open and create as explicit flows without requiring the browse-only directory API', () => {
    const source = rootSource()
    const pickedStart = source.indexOf('const openPickedWorkspace = async')
    const pickedEnd = source.indexOf('useEffect(() => {', pickedStart)
    const pickedFlow = source.slice(pickedStart, pickedEnd)
    expect(pickedFlow).not.toContain('ctx.workspaces.listDirectory(')
    expect(pickedFlow).toContain('createFlowWorkspace(ctx, path)')
    expect(pickedFlow.indexOf('inspectRegisteredWorkspace(ctx, registration.workspace.path)'))
      .toBeLessThan(pickedFlow.indexOf('connectUsableWorkspaceSession(ctx, registration.workspace.workspaceId)'))
    expect(pickedFlow).toContain("if (intent === 'create') await prepareNewWorkspace(pending, sessionId)")
    expect(pickedFlow).toContain("else await prepareExistingWorkspace(pending, sessionId)")

    const existingStart = source.indexOf('const prepareExistingWorkspace = async')
    const newStart = source.indexOf('const prepareNewWorkspace = async', existingStart)
    const openStart = source.indexOf('const openRegisteredWorkspace = async', newStart)
    const existingFlow = source.slice(existingStart, newStart)
    const newFlow = source.slice(newStart, openStart)
    expect(newFlow.indexOf('collectWorkspaceFiles(ctx, sessionId)')).toBeLessThan(newFlow.indexOf("'project.init'"))
    expect(newFlow.indexOf('collectWorkspaceFiles(ctx, sessionId)')).toBeGreaterThanOrEqual(0)
    expect(newFlow).toContain("intent: 'open'")
    expect(newFlow).toContain('new workspace folder contains unrelated files')
    expect(newFlow).not.toContain('new workspace initialization created no readable chapter')
    expect(newFlow).toContain('await finishWorkspaceOpen(pending, sessionId, initialPath)')
    expect(source).toContain('if (!initialPath) return undefined')
    const finishFlow = source.slice(source.indexOf('const finishWorkspaceOpen = async'), existingStart)
    expect(finishFlow).toContain('ctx.sessions.open(resumableConversationId(')
    const registeredFlow = source.slice(openStart, source.indexOf('const continuePendingWorkspaceIntent = async', openStart))
    expect(registeredFlow).toContain('connectUsableWorkspaceSession(ctx, current.workspaceId, sessionId)')
  })

  it('does not treat a dead session as a missing manuscript file, and reconnects before giving up', () => {
    expect(isSessionMissing({
      ok: false,
      error: { code: 'session-not-found', message: 'session is not live', details: { sessionId: 's1' } },
    })).toBe(true)
    expect(isSessionMissing({
      ok: false,
      error: { code: 'internal', message: 'request failed', details: {} },
    })).toBe(false)
    expect(errorMessage({
      ok: false,
      error: { code: 'session-not-found', message: 'session is not live', details: { sessionId: 's1' } },
    })).toBe('作品会话已失效，请重试。')
    expect(workspaceOpenFailureMessage(new Error('session is not live'))).toBe('作品会话未能建立，请重试。')
    expect(workspaceOpenFailureMessage(new Error('workspace has no supported text files'))).toContain('没有找到')
    const source = rootSource()
    expect(source).toContain('await ctx.workspaces.archiveSession(first)')
    expect(source).toContain('const second = await ctx.workspaces.connectWorkspace(workspaceId)')
  })

  it('claims automatic startup resume once so returning home stays on the project list', () => {
    const guard = { current: false }
    expect(claimInitialWorkspaceResume(guard)).toBe(true)
    expect(guard.current).toBe(true)
    expect(claimInitialWorkspaceResume(guard)).toBe(false)
  })

  it('resumes the most recently updated non-blank conversation when a workspace opens', () => {
    const byId = {
      's-old': { blank: false, updatedAt: 100 },
      's-recent': { blank: false, updatedAt: 300 },
      's-blank': { blank: true, updatedAt: 400 },
      's-archived': { blank: false, updatedAt: 500 },
    }
    expect(resumableConversationId({
      sessionIds: ['s-old', 's-recent', 's-blank', 's-archived', 's-new'],
      byId,
      archivedIds: ['s-archived'],
      fallback: 's-new',
    })).toBe('s-recent')
    /* 没有可恢复的会话（全新作品 / 只有空白会话）时保持打开连接得到的会话 */
    expect(resumableConversationId({ sessionIds: ['s-blank'], byId, archivedIds: [], fallback: 's-new' })).toBe('s-new')
    expect(resumableConversationId({ sessionIds: [], byId: {}, archivedIds: [], fallback: 's-new' })).toBe('s-new')
    const finish = rootSource().slice(rootSource().indexOf('const finishWorkspaceOpen = async'))
    expect(finish).toContain('ctx.sessions.open(resumableConversationId(')
  })

  it('creates files and folders from any directory through the generic tree actions', () => {
    const root = rootSource()
    expect(root).toContain("openTreeCreate('file', '')")
    expect(root).toContain("openTreeCreate('folder', '')")
    expect(root).toContain("onCreateFile: (directory: string) => openTreeCreate('file', directory)")
    expect(root).toContain("onCreateFolder: (directory: string) => openTreeCreate('folder', directory)")
    expect(root).toContain("'directory.create'")
    /* 文件名无扩展名时按 .md 创建 */
    expect(root).toContain("`${name}.md`")
    const sidebar = readFileSync(new URL('./client/sidebar.ts', import.meta.url), 'utf8')
    /* 每个目录行都有新建文件/文件夹操作，不再有 正文 专用入口 */
    expect(sidebar).toContain('中新建文件')
    expect(sidebar).toContain('中新建文件夹')
    expect(sidebar).not.toContain('中新建章节')
    expect(sidebar).not.toContain('新建卷/部')
    expect(root).not.toContain('新建资料')
  })

  it('commits with the current time as the message and rolls back in place with confirmation', () => {
    expect(snapshotTimeLabel(new Date(2025, 0, 5, 9, 7).getTime())).toBe('2025-01-05 09:07')
    const root = rootSource()
    expect(root).toContain("'snapshot.create'")
    expect(root).toContain("'snapshot.rollback'")
    expect(root).toContain("'snapshot.list'")
    expect(root).toContain('已回滚到')
    /* 回滚前要求先保存当前文档，且有确认框 */
    expect(root).toContain('请先保存当前文档，再回滚。')
    expect(root.indexOf('requestRollback')).toBeGreaterThanOrEqual(0)
  })

  it('sorts every tree level as a plain directory tree: directories first, then by name', () => {
    const entries = [
      { name: '项目总览.md', type: 'file' as const },
      { name: '世界书', type: 'directory' as const },
      { name: '封面.jpg', type: 'file' as const },
      { name: '正文', type: 'directory' as const },
      { name: '第10章.md', type: 'file' as const },
      { name: '第2章.md', type: 'file' as const },
    ]
    expect(orderTreeEntries(entries).map((entry) => entry.name))
      .toEqual(['世界书', '正文', '第2章.md', '第10章.md', '封面.jpg', '项目总览.md'])
    expect(treeRowPadding(0)).toBe(12)
    expect(treeRowPadding(1)).toBe(24)
  })

  it('renders every real directory in the tree and hides only dot-prefixed entries', () => {
    // 预设分组(大纲/人物卡/世界书/正文)已移除:目录被实际创建后自然出现在树里。
    const root = [
      { name: '大纲', type: 'directory' as const },
      { name: '正文', type: 'directory' as const },
      { name: '.dsh-editor', type: 'directory' as const },
      { name: '项目总览.md', type: 'file' as const },
    ]
    const filterRoot = (entries: typeof root) => entries.filter((item) => !item.name.startsWith('.'))
    expect(filterRoot(root).map((item) => item.name)).toEqual(['大纲', '正文', '项目总览.md'])

    const sidebarSource = readFileSync(new URL('./client/sidebar.ts', import.meta.url), 'utf8')
    expect(sidebarSource).not.toContain('STATIC_GROUPS')
    expect(sidebarSource).not.toContain('isManagedGroupName')
  })

  it('opens a clean applied file, expands its manuscript ancestors, and preserves dirty buffers', () => {
    expect(treeExpansionPaths('正文/第二卷/003.md')).toEqual(['正文', '正文/第二卷'])
    expect(treeExpansionPaths('项目总览.md')).toEqual([])
    expect(proposalAppliedNavigation('正文/003.md', '', false)).toEqual({
      openPath: '正文/003.md',
      expandPath: '正文/003.md',
      refreshContent: false,
    })
    expect(proposalAppliedNavigation('正文/003.md', '正文/003.md', false).refreshContent).toBe(true)
    expect(proposalAppliedNavigation('正文/004.md', '正文/003.md', true)).toEqual({
      expandPath: '正文/004.md',
      refreshContent: false,
    })
  })

  it('hides valid worldbook YAML from the paper and leaves invalid metadata untouched', () => {
    const source = '---\r\ntriggers: ["港口"]\r\nenabled: true\r\npriority: 8\r\n---\r\n# 港口规则\r\n\r\n正文'
    const projection = worldbookPaperProjection('世界书/港口规则.md', source)
    expect(projection.text).toBe('# 港口规则\r\n\r\n正文')
    expect(projection.text).not.toContain('triggers:')
    const updated = replaceWorldbookPaperText('世界书/港口规则.md', source, '# 港口规则\r\n\r\n新正文')
    expect(updated.slice(0, projection.offset)).toBe(source.slice(0, projection.offset))
    expect(updated).toContain('priority: 8')
    expect(updated.endsWith('新正文')).toBe(true)

    const invalid = '---\ntriggers: ???\n---\n# 需要修复'
    expect(worldbookPaperProjection('世界书/损坏.md', invalid)).toEqual({ text: invalid, offset: 0 })
  })

  it('drops snapshot, import, export, shortcut, worldbook, and search affordances from the workbench UI', () => {
    const source = rootSource()
    // Snapshots
    expect(source).not.toContain('function SnapshotDialog(')
    expect(source).not.toContain('function SnapshotLibraryDialog(')
    expect(source).not.toContain('openSnapshotLibrary')
    expect(source).not.toContain('作品快照')
    expect(source).not.toMatch(/workspace-menu-actions[\s\S]{0,1800}作品快照/)
    // Imports
    expect(source).not.toContain('function ImportDialog(')
    expect(source).not.toContain('renderImportDialog')
    expect(source).not.toContain('applyImportFlow')
    expect(source).not.toContain('selectImportSource')
    // Exports
    expect(source).not.toContain('function ExportPreviewDialog(')
    expect(source).not.toContain('exportNovel')
    expect(source).not.toContain('confirmExport')
    expect(source).not.toContain('导出 Markdown')
    expect(source).not.toContain('导出 TXT')
    // Shortcuts dialog
    expect(source).not.toContain('function ShortcutDialog(')
    // Worldbook settings panel
    expect(source).not.toContain('function WorldbookSettings(')
    // Full-text search panel
    expect(source).not.toContain('function SearchPanel(')
    // Archive UI
    expect(source).not.toContain('className: \'archive-panel\'')
    expect(source).not.toContain('archiveManaged')
    expect(source).not.toContain('className: \'index-status\'')
  })

  it('owns the settings dialog itself and drops the upstream DSH settings delegation', () => {
    const source = rootSource()
    expect(source).not.toContain("renderSlot('sidebar.settings'")
    expect(source).toContain('SettingsDialog')
    expect(source).toContain('SettingsTrigger')
    expect(source).not.toContain('ModelSetup')
    expect(source).not.toContain("view === 'settings'")
    expect(source).not.toContain('settings-shell')
  })

  it('uses a workspace dropdown instead of overlapping 作品/切换 controls, and keeps the cover on the empty chapter', () => {
    const source = rootSource()
    const sidebarSource = readFileSync(new URL('./client/sidebar.ts', import.meta.url), 'utf8')
    const componentsSource = readFileSync(new URL('./client/components.ts', import.meta.url), 'utf8')
    const styleSource = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8')
    expect(source).not.toContain("className: 'workbench-brand'")
    expect(source).toContain("className: 'workspace-chrome'")
    expect(source).not.toContain("className: 'project-switcher'")
    expect(styleSource).not.toContain('workbench-brand')
    expect(styleSource).not.toContain('.project-switcher select')
    expect(source).toContain("className: 'workspace-menu'")
    expect(source).toContain("aria-label': '切换作品'")
    expect(source).toContain("aria-label': '作品菜单'")
    expect(source).toContain("'aria-controls': 'workspace-actions'")
    // File context menu keeps rename, drops move/archive
    expect(sidebarSource).toContain("className: 'file-context-menu'")
    expect(sidebarSource).toContain("role: 'menuitem'")
    expect(sidebarSource).toContain("aria-label': '文档操作'")
    expect(sidebarSource).not.toContain('onArchive:')
    expect(sidebarSource).not.toContain('onMove:')
    expect(source).not.toContain('onArchive:')
    expect(source).not.toContain('onMove:')
    expect(source).not.toContain('确认归档')
    expect(source).not.toContain("openManageAction(fileMenu.path, 'archive')")
    expect(source).not.toContain("openManageAction(fileMenu.path, 'move')")
    expect(source).not.toContain("e('small', null, '文档管理')")
    expect(source).not.toContain("className: 'tree-manage'")
    expect(styleSource).not.toContain('tree-manage')
    // Topbar
    expect(source).toContain("onClick: () => void openAnotherWorkspace()")
    expect(source).toContain("onClick: () => void startNewProject()")
    expect(source).toContain("aria-label': '返回作品列表'")
    expect(source).not.toContain('workspace-home-button')
    expect(source).not.toContain('workspace-view-controls')
    expect(source).not.toContain("target === 'paper' ? '稿纸'")
    expect(source).toContain("label: '空白稿纸'")
    // Stage icons live in components.ts
    expect(componentsSource).toContain("function PaperStage(")
    expect(componentsSource).toContain("function DeepSeekWhaleMark(")
    expect(source).toContain("e('span', { 'aria-hidden': 'true' }, e(DeepSeekWhaleMark))")
  })

  it('keeps manuscript state on a workspace-scoped file session while chat follows the current conversation', () => {
    const source = rootSource()
    expect(source).toContain("const fileSessionId = workspaceOpen.kind === 'ready' ? workspaceOpen.sessionId : undefined")
    expect(source).toContain('}, [openWorkspaceId])')
    expect(source).toContain('ctx, session: fileSession, path, files')
    expect(source).toContain('session: chatSession')
    expect(source).toContain('sessionId: fileSession.sessionId')
  })

  it('drops superseded or cross-session async responses', () => {
    const gate = new LatestRequestGate()
    const first = gate.begin('session-a')
    expect(gate.isCurrent(first)).toBe(true)
    const newer = gate.begin('session-a')
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(newer)).toBe(true)
    gate.setScope('session-b')
    expect(gate.isCurrent(newer)).toBe(false)
  })

  it('clamps both panel resize directions to their accessible bounds', () => {
    expect(clampPanelWidth(120, 196, 420)).toBe(196)
    expect(clampPanelWidth(520, 196, 420)).toBe(420)
    expect(resizedPanelWidth('left', 248, 32, 196, 420)).toBe(280)
    expect(resizedPanelWidth('right', 384, 32, 300, 560)).toBe(352)
    expect(resizedPanelWidth('right', 384, -500, 300, 560)).toBe(560)
  })

  it('maps workspace shortcuts without stealing modified variants', () => {
    const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({
      key: value, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra,
    })
    expect(workspaceShortcut(key('b'))).toBe('toggle-sidebar')
    expect(workspaceShortcut(key('j'))).toBe('toggle-assistant')
    expect(workspaceShortcut(key('\\'))).toBe('toggle-focus')
    expect(workspaceShortcut(key('l'))).toBe('focus-assistant')
    expect(workspaceShortcut(key(',', { ctrlKey: false, metaKey: true }))).toBe('settings')
    expect(workspaceShortcut(key('[', { ctrlKey: false, altKey: true, code: 'BracketLeft' }))).toBe('previous-chapter')
    expect(workspaceShortcut(key('b', { shiftKey: true }))).toBeNull()
  })

  it('sends chat on plain Enter but preserves newlines and IME composition', () => {
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    expect(shouldSubmitComposer({ key: 'a', shiftKey: false })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: false })).toBe(true)
    expect(canSubmitComposer({ draft: '写下去', connected: false, removed: false })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: true })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: false, outgoingState: 'sending' })).toBe(false)
    expect(canSubmitComposer({ draft: '重试', connected: true, removed: false, outgoingState: 'failed' })).toBe(true)
  })

  it('keeps a successful result unchanged', async () => {
    await expect(safeRpcCall(async () => ({ ok: true, value: { entries: [] } }))).resolves.toEqual({
      ok: true,
      value: { entries: [] },
    })
  })

  it('folds a rejected tree request into a renderable Host failure', async () => {
    await expect(safeRpcCall(async () => { throw new Error('invalid wire result') })).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'invalid wire result', details: {} },
    })
  })

  it('still treats remapped stale writes as conflicts', () => {
    const result = { ok: false as const, error: { code: 'bad-request', message: 'file changed on disk' } }
    expect(isStaleFailure(result)).toBe(true)
    expect(errorMessage(result)).toBe('磁盘文件已经变化。')
  })

  it('explains structure creation failures without exposing Host details', () => {
    expect(errorMessage({ ok: false, error: { code: 'directory-exists', message: 'manuscript group already exists' } })).toBe('同名文件或目录已经存在。')
    expect(errorMessage({ ok: false, error: { code: 'directory-unreadable', message: 'project folder is read-only' } })).toBe('当前文件无法写入，请检查目录权限。')
    expect(errorMessage({ ok: false, error: { code: 'workspace-invalid-path', message: 'manuscript group name is invalid' } })).toBe('名称或路径不符合规则。')
  })

  it('uses the Host-created flag instead of a possibly stale workspace list', async () => {
    const workspace = { workspaceId: 'workspace-1', path: 'D:\\novel', title: 'novel', sessionIds: [], createdAt: '', updatedAt: '' }
    const createHost = vi.fn(async () => ({ result: { ok: true as const, value: { workspace, created: true } } }))
    const createProjection = vi.fn(async () => workspace)
    const result = await createFlowWorkspace({
      connection: { api: { workspace: { create: createHost } } },
      workspaces: { create: createProjection },
    } as never, 'D:\\novel')

    expect(result).toEqual({ workspace, created: true })
    expect(createHost).toHaveBeenCalledWith({ path: 'D:\\novel' })
    expect(createProjection).toHaveBeenCalledWith({ path: 'D:\\novel' })
  })

  it('removes a newly registered workspace if the local projection cannot adopt it', async () => {
    const workspace = { workspaceId: 'workspace-2', path: 'D:\\target', title: 'target', sessionIds: [], createdAt: '', updatedAt: '' }
    const removeHost = vi.fn(async () => ({ result: { ok: true as const, value: { deleted: true as const } } }))
    await expect(createFlowWorkspace({
      connection: { api: { workspace: {
        create: async () => ({ result: { ok: true as const, value: { workspace, created: true } } }),
        delete: removeHost,
      } } },
      workspaces: { create: async () => { throw new Error('projection failed') } },
    } as never, 'D:\\target')).rejects.toThrow('projection failed')

    expect(removeHost).toHaveBeenCalledWith({ workspaceId: 'workspace-2' })
  })

  it('reports when projection rollback cannot remove the new Host registration', async () => {
    const workspace = { workspaceId: 'workspace-3', path: 'D:\\blocked', title: 'blocked', sessionIds: [], createdAt: '', updatedAt: '' }
    await expect(createFlowWorkspace({
      connection: { api: { workspace: {
        create: async () => ({ result: { ok: true as const, value: { workspace, created: true } } }),
        delete: async () => ({ result: { ok: false as const, error: { code: 'internal', message: 'delete failed', details: {} } } }),
      } } },
      workspaces: { create: async () => { throw new Error('projection failed') } },
    } as never, 'D:\\blocked')).rejects.toThrow('registration could not be removed')
  })

  it('routes split/merge/renames proposals to the workbench channel and keeps edit/create on /manuscript', async () => {
    const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
    const okPrepare = (value: unknown) => async () => ({ ok: true, value })
    const okApply = (value: unknown) => async () => ({ ok: true, value })
    const connection = {
      rpc: {
        call: (channel: string, endpoint: string, payload: unknown) => {
          calls.push({ channel, endpoint, payload })
          if (endpoint === 'proposal.prepare') {
            if ((payload as { kind: string }).kind === 'split') {
              return Promise.resolve({ ok: true, value: { kind: 'split', version: 'v1', before: '前面', after: '后面', headChars: 100, tailChars: 200 } })
            }
            if ((payload as { kind: string }).kind === 'merge') {
              return Promise.resolve({ ok: true, value: { kind: 'merge', versions: { path: 'vA', sourcePath: 'vB' }, pathChars: 300, sourceChars: 150 } })
            }
            if ((payload as { kind: string }).kind === 'renames') {
              return Promise.resolve({ ok: true, value: { kind: 'renames', versions: { '正文/001.md': 'v1' }, entries: [{ from: '正文/001.md', to: '正文/序章.md' }] } })
            }
          }
          return Promise.resolve({ ok: true, value: { path: 'x', version: 'v' } })
        },
      },
    } as never
    const baseProps = (proposal: unknown) => ({
      ctx: { connection } as never,
      sessionId: 's1',
      proposal: proposal as never,
      onApplied: () => {},
    })
    const { buildExpectedVersions } = await import('./client/chat.ts')
    /* split:workbench prepare,只校验 path 一项 version */
    const splitProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'split', path: '正文/001.md', summary: '拆', anchor: '### 转折', newPath: '正文/002.md' } as never
    const splitPrepared = { kind: 'split', version: 'v1', before: '', after: '', headChars: 0, tailChars: 0 } as never
    expect(buildExpectedVersions(splitProposal, splitPrepared)).toEqual({ '正文/001.md': 'v1' })
    /* merge:workbench prepare,目标+来源都按真实文件路径校验 */
    const mergeProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'merge', path: '正文/001.md', summary: '合', sourcePath: '正文/002.md' } as never
    const mergePrepared = { kind: 'merge', versions: { path: 'vA', sourcePath: 'vB' }, pathChars: 0, sourceChars: 0 } as never
    expect(buildExpectedVersions(mergeProposal, mergePrepared)).toEqual({ '正文/001.md': 'vA', '正文/002.md': 'vB' })
    /* renames:每条 from→to 都校验 */
    const renamesProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'renames', summary: '改名', renames: [{ from: '正文/001.md', to: '正文/序章.md' }] } as never
    const renamesPrepared = { kind: 'renames', versions: { '正文/001.md': 'v1' }, entries: [{ from: '正文/001.md', to: '正文/序章.md' }] } as never
    expect(buildExpectedVersions(renamesProposal, renamesPrepared)).toEqual({ '正文/001.md': 'v1' })
    /* edit/create 仍然走 /manuscript 通道 */
    expect(buildExpectedVersions({ kind: 'edit', path: 'a.md', oldText: 'o', newText: 'n' } as never, { kind: 'edit', version: 'v1', before: 'o', after: 'n' } as never)).toBeUndefined()

    /* 源码断言:workbench 新端点必须真的被 chat.ts 路由,避免被某次重构回退到 /manuscript。 */
    const chatSource = readFileSync(new URL('./client/chat.ts', import.meta.url), 'utf8')
    expect(chatSource).toMatch(/WORKBENCH_RPC_CHANNEL[\s\S]{0,400}proposal\.prepare/)
    expect(chatSource).toMatch(/WORKBENCH_RPC_CHANNEL[\s\S]{0,400}proposal\.apply/)
    expect(chatSource).toContain("expectedVersions")
    expect(chatSource).toMatch(/proposal\.kind === 'split'/)
    expect(chatSource).toMatch(/proposal\.kind === 'merge'/)
    expect(chatSource).toMatch(/proposal\.kind === 'renames'/)
  })

  it('threads the writing-progress scope into the shell root while the daily-goal UI stays shelved', () => {
    const source = rootSource()
    /* root.ts 必须真正接住 progressScope,而不是定义后不用 */
    expect(source).toContain('progressScope: WritingProgressScope')
    expect(source).toMatch(/progressScope\s*[,:]\s*options\.progressScope/)
    /* 每日目标封存:侧栏 chip 与设置页 fieldset 都不渲染,静默基线记录保留 */
    expect(source).not.toContain('writing-progress-chip')
    expect(source).not.toContain('progressChipProps(')
    expect(source).toMatch(/nextBaselines\(/)
    expect(source).toContain("localDateKey(new Date())")
    const settingsSource = readFileSync(new URL('./writing-settings.ts', import.meta.url), 'utf8')
    expect(settingsSource).not.toContain("from './writing-progress-settings.tsx'")
    expect(settingsSource).not.toContain('e(WritingProgressSettings')
    /* 作者侧写不对作者暴露设置入口 */
    expect(settingsSource).not.toContain('作者侧写（记忆）')
    expect(settingsSource).not.toContain('保存作者侧写')
  })
})
