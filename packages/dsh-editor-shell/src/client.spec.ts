import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { zh } from './i18n/index.ts'
import {
  canSubmitComposer,
  claimInitialWorkspaceResume,
  clampPanelWidth,
  createFlowWorkspace,
  errorMessage,
  hasRelocatableManuscriptFiles,
  hasVisibleWorkspaceEntries,
  inject,
  isSessionMissing,
  isStaleFailure,
  isSuccessWorkbenchNote,
  isWorldbookPath,
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
  startupResumeWorkspace,
  supportedWorkspaceTextPaths,
  treeExpansionPaths,
  treeRowPadding,
  worldbookPaperProjection,
  workspaceOpenFailureMessage,
  workspaceShortcut,
  conversationChatSource,
  bindOfficialConversation,
} from './client.ts'
import { isObservableSource } from './client/components.ts'
import { partialApplyDetails } from './client/shared.ts'
import { appendRegistryCommands } from './client/command-palette.tsx'
import { createCommandRegistry, matchRegistryShortcut, registryPaletteItems, type ShellToolSeatContext } from './seats.ts'

const rootSource = () => readFileSync(new URL('./client/root.ts', import.meta.url), 'utf8')
const initGuideSource = () => readFileSync(new URL('./init-guide.ts', import.meta.url), 'utf8')

describe('shell client inject', () => {
  it('declares every Remote face the renderer reads through ctx.remote', () => {
    expect(inject).toEqual([
      'slots', 'sessions', 'workspaces', 'connection', 'settingsScope', 'settingsSchema', 'remote',
      'remote.session', 'remote.settings', 'remote.credentials', 'remote.llm', 'remote.directoryPicker',
      'uiSession',
    ])
  })
})

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
    expect(source).toContain('ctx.uiWorkspace.pickDirectory()')
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
    expect(source).toContain('const second = await ctx.uiWorkspace.connectWorkspace(workspaceId)')
  })

  it('claims automatic startup resume once so returning home stays on the project list', () => {
    const guard = { current: false }
    expect(claimInitialWorkspaceResume(guard)).toBe(true)
    expect(guard.current).toBe(true)
    expect(claimInitialWorkspaceResume(guard)).toBe(false)
  })

  it('resumes the selected workspace or the most recently updated one', () => {
    const older = { workspaceId: 'a', path: '/a', title: 'A', sessionIds: [], createdAt: '', updatedAt: '2026-01-01T00:00:00.000Z' }
    const newer = { workspaceId: 'b', path: '/b', title: 'B', sessionIds: [], createdAt: '', updatedAt: '2026-06-01T00:00:00.000Z' }
    expect(startupResumeWorkspace([])).toBeUndefined()
    expect(startupResumeWorkspace([older, newer])).toEqual(newer)
    expect(startupResumeWorkspace([older, newer], older)).toEqual(older)
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
    /* 顶栏的 ＋文件 / ＋文件夹 已撤掉,改由右键菜单统一入口。 */
    expect(root).not.toContain("openTreeCreate('file', '')")
    expect(root).not.toContain("openTreeCreate('folder', '')")
    expect(root).not.toContain('＋文件')
    expect(root).not.toContain('＋文件夹')
    expect(root).toContain("onCreateFile: (directory: string) => openTreeCreate('file', directory)")
    expect(root).toContain("onCreateFolder: (directory: string) => openTreeCreate('folder', directory)")
    expect(root).toContain("'directory.create'")
    /* 文件名无扩展名时按 .md 创建 */
    expect(root).toContain("`${name}.md`")
    const sidebar = readFileSync(new URL('./client/sidebar.ts', import.meta.url), 'utf8')
    /* 每个目录行都有新建文件/文件夹操作，不再有 正文 专用入口 */
    expect(sidebar).toContain("t('sidebar.newFileIn'")
    expect(sidebar).toContain("t('sidebar.newFolderIn'")
    expect(zh['sidebar.newFileIn']).toBe('在 {name} 中新建文件')
    expect(zh['sidebar.newFolderIn']).toBe('在 {name} 中新建文件夹')
    expect(sidebar).not.toContain('中新建章节')
    expect(sidebar).not.toContain('新建卷/部')
    expect(root).not.toContain('新建资料')
  })

  it('exposes copy/cut/paste/delete/rename through the tree right-click menu', () => {
    const sidebar = readFileSync(new URL('./client/sidebar.ts', import.meta.url), 'utf8')
    const root = rootSource()
    /* FileContextMenu props 必须以独立 onXxx 形式提供 */
    expect(sidebar).toMatch(/onCopy\(\)/)
    expect(sidebar).toMatch(/onCut\(\)/)
    expect(sidebar).toMatch(/onPaste\(\)/)
    expect(sidebar).toMatch(/onDelete\(\)/)
    expect(sidebar).toMatch(/onCreateFile\(\)/)
    expect(sidebar).toMatch(/onCreateFolder\(\)/)
    expect(sidebar).toMatch(/onRename\(\)/)
    expect(sidebar).toMatch(/onArchive\(\)/)
    expect(sidebar).toMatch(/onClose\(\)/)
    expect(sidebar).toMatch(/onSplit\(\)/)
    expect(sidebar).toMatch(/onMergePrevious\(\)/)
    expect(sidebar).toMatch(/onMergeNext\(\)/)
    expect(sidebar).toMatch(/onPin\(\)/)
    expect(sidebar).toMatch(/onUnpin\(\)/)
    expect(sidebar).toContain("t('pin.beside')")
    expect(sidebar).toContain("t('pin.unpin')")
    expect(sidebar).toContain("t('chapterOps.split')")
    expect(sidebar).toContain("t('chapterOps.mergePrevious')")
    expect(sidebar).toContain("t('chapterOps.mergeNext')")
    expect(zh['chapterOps.split']).toBe('拆章…')
    expect(zh['chapterOps.mergePrevious']).toBe('合并到上一章')
    expect(zh['chapterOps.mergeNext']).toBe('与下一章合并')
    expect(sidebar).toContain('canPaste:')
    expect(sidebar).toContain("'data-danger': 'true'")
    /* 树行/容器/根菜单都走同一条 onFileMenu 回调 */
    expect(sidebar).toMatch(/onContextMenu[\s\S]{0,200}onFileMenu\('directory', child/)
    expect(sidebar).toMatch(/onContextMenu[\s\S]{0,200}onFileMenu\('file', child/)
    /* root.ts 必须真的挂上剪贴板状态机和 workbench 端点 */
    expect(root).toContain('ChapterOpsLayer')
    expect(root).toContain('onSplitAtCursor')
    expect(root).toMatch(/const \[clipboard, setClipboard\]\s*=\s*useState/)
    expect(root).toContain("'entry.copy'")
    expect(root).toContain("'entry.move'")
    expect(root).toContain("'entry.delete'")
    expect(root).toContain("'entry.rename'")
    /* 删除时关闭正在编辑的文档,避免悬空 path。 */
    expect(root).toMatch(/setDeleteTarget[\s\S]{0,400}if \(target\.kind === 'file' && path === target\.path\) setPath\(''\)/)
  })

  it('shows an independent about/update dialog backed by the desktop bridge', () => {
    const about = readFileSync(new URL('./client/about-dialog.tsx', import.meta.url), 'utf8')
    const bridge = readFileSync(new URL('./client/window-controls.tsx', import.meta.url), 'utf8')
    const root = rootSource()
    /* 桌面端暴露的方法都按可选形式收口,shell 不依赖其存在 */
    expect(bridge).toContain('getAppInfo?(): Promise<{ name: string; version: string; platform: string; portable: boolean }>')
    expect(bridge).toContain('checkForUpdate?(): Promise<UpdateCheckResult>')
    expect(bridge).toContain('getStartupUpdate?(): Promise<UpdateCheckResult>')
    /* 一键下载/安装同样按可选方法收口 */
    expect(bridge).toContain('downloadUpdate?(asset: UpdateAsset): Promise<{ path: string }>')
    expect(bridge).toContain('cancelUpdateDownload?(): Promise<void>')
    expect(bridge).toContain("installUpdate?(path: string): Promise<'restarting' | 'revealed'>")
    expect(bridge).toContain('onUpdateProgress?(listener: (progress: UpdateProgress) => void): () => void')
    expect(bridge).toMatch(/status:\s*'latest'\s*\|\s*'update-available'\s*\|\s*'error'/)
    /* 弹窗自身按 status 分流,并依赖 getAppInfo / checkForUpdate */
    expect(about).toContain('getAppInfo')
    expect(about).toContain('checkForUpdate')
    expect(about).toContain("'latest'")
    expect(about).toContain("'update-available'")
    expect(about).toContain("'error'")
    expect(about).toMatch(/result\.status === 'latest'/)
    expect(about).toMatch(/result\.status === 'update-available'/)
    expect(about).toMatch(/result\.status === 'error'/)
    expect(about).toContain('openExternal')
    expect(about).toContain('useDialogReturnFocus')
    /* root.ts 入口:两个 chrome 都挂 AboutTrigger,aboutOpen 渲染 AboutUpdateDialog */
    expect(root).toContain('AboutUpdateDialog')
    expect(root).toContain('AboutTrigger')
    expect(root).toMatch(/const \[aboutOpen, setAboutOpen\]\s*=\s*useState\(false\)/)
    expect(root).toContain('aria-haspopup')
    expect(root).toContain("t('about.triggerAria')")
    expect(zh['about.triggerAria']).toBe('关于与更新')
  })

  it('surfaces the startup update check as a dismissible toast', () => {
    const root = rootSource()
    /* 挂载后经桥拉取主进程后台检查的缓存结果,仅 update-available 时提示 */
    expect(root).toContain('getStartupUpdate')
    expect(root).toMatch(/const \[startupUpdate, setStartupUpdate\]\s*=\s*useState/)
    expect(root).toMatch(/result\.status !== 'update-available'/)
    /* toast 可关闭,"查看详情" 关掉 toast 并打开关于/更新弹窗 */
    expect(root).toContain('update-toast')
    expect(root).toContain("t('about.toast'")
    expect(root).toContain("t('about.dismissToast')")
    expect(zh['about.toast']).toBe('发现新版本 {version}')
    expect(zh['about.dismissToast']).toBe('关闭更新提示')
    expect(root).toMatch(/setStartupUpdate\(null\); setAboutOpen\(true\)/)
  })

  it('commits with the current time as the message and rolls back in place with confirmation', () => {
    expect(snapshotTimeLabel(new Date(2025, 0, 5, 9, 7).getTime())).toBe('2025-01-05 09:07')
    const root = rootSource()
    expect(root).toContain("'snapshot.create'")
    expect(root).toContain("'snapshot.rollback'")
    expect(root).toContain("'snapshot.list'")
    expect(root).toContain("t('note.rolledBack'")
    expect(zh['note.rolledBack']).toBe('已回滚到 {label}；回滚前的状态已自动保存为新提交。')
    /* 回滚前要求先保存当前文档，且有确认框 */
    expect(root).toContain("t('note.saveBeforeRollback')")
    expect(zh['note.saveBeforeRollback']).toBe('请先保存当前文档，再回滚。')
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
    expect(treeExpansionPaths('人物卡/林见.md')).toEqual(['人物卡'])
    expect(treeExpansionPaths('世界书/港口/规则.md')).toEqual(['世界书', '世界书/港口'])
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
    expect(isWorldbookPath('世界书/港口规则.md')).toBe(true)
    expect(isWorldbookPath('世界书/子目录/海关.md')).toBe(true)
    expect(isWorldbookPath('正文/001.md')).toBe(false)
    expect(isWorldbookPath('世界书/港口.txt')).toBe(false)
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

  it('hides closed chapter frontmatter from the paper and leaves TXT or unclosed headers visible', () => {
    const source = '---\nbeats: [码头]\n---\n# 第三章\n正文'
    const projection = worldbookPaperProjection('正文/001.md', source)
    expect(projection.text).toBe('# 第三章\n正文')
    expect(projection.text).not.toContain('beats:')
    const updated = replaceWorldbookPaperText('正文/001.md', source, '# 第三章\n新正文')
    expect(updated.slice(0, projection.offset)).toBe(source.slice(0, projection.offset))
    expect(updated).toContain('beats:')
    expect(updated.endsWith('# 第三章\n新正文')).toBe(true)

    const unclosed = '---\nbeats: [码头]\n正文'
    expect(worldbookPaperProjection('正文/001.md', unclosed)).toEqual({ text: unclosed, offset: 0 })
    expect(worldbookPaperProjection('正文/001.txt', source)).toEqual({ text: source, offset: 0 })
  })

  it('restores search, import, export, and archive affordances without snapshot-library or shortcut dialogs', () => {
    const source = rootSource()
    const search = readFileSync(new URL('./client/search-panel.ts', import.meta.url), 'utf8')
    const exportDialog = readFileSync(new URL('./client/export-dialog.ts', import.meta.url), 'utf8')
    const importDialog = readFileSync(new URL('./client/import-dialog.ts', import.meta.url), 'utf8')
    const archive = readFileSync(new URL('./client/archive.ts', import.meta.url), 'utf8')
    const palette = readFileSync(new URL('./client/command-palette.tsx', import.meta.url), 'utf8')
    // Snapshots library remains out of scope
    expect(source).not.toContain('function SnapshotDialog(')
    expect(source).not.toContain('function SnapshotLibraryDialog(')
    expect(source).not.toContain('openSnapshotLibrary')
    expect(source).not.toContain('作品快照')
    expect(source).not.toMatch(/workspace-menu-actions[\s\S]{0,1800}作品快照/)
    // Shortcut dialog remains out of scope
    expect(source).not.toContain('function ShortcutDialog(')
    expect(source).not.toContain('className: \'index-status\'')
    // Restored modules
    expect(search).toContain('function SearchPanel(')
    expect(source).toContain('SearchPanel')
    expect(source).toContain('openSearchPanel')
    expect(importDialog).toContain('function ImportDialog(')
    expect(source).toContain('renderImportDialog')
    expect(source).toContain('applyImportFlow')
    expect(source).toContain('selectImportSource')
    expect(exportDialog).toContain('function ExportPreviewDialog(')
    expect(source).toContain('exportNovel')
    expect(source).toContain('confirmExport')
    expect(source).toContain("t('workspace.exportMarkdown')")
    expect(source).toContain("t('workspace.exportTxt')")
    expect(zh['workspace.exportMarkdown']).toBe('导出 Markdown')
    expect(zh['workspace.exportTxt']).toBe('导出 TXT')
    expect(archive).toContain("className: 'file-dialog archive-panel'")
    expect(source).toContain('archiveManaged')
    expect(palette).toContain("t('command.search')")
    expect(palette).toContain("t('command.export')")
    expect(palette).toContain("t('command.importWork')")
    expect(palette).toContain("t('command.archived')")
    expect(palette).toContain('cmd.split-at-cursor')
    expect(palette).toContain('cmd.pin-current')
    expect(palette).toContain('cmd.unpin')
    expect(palette).toContain("t('chapterOps.splitAtCursor')")
    expect(palette).toContain("t('pin.current')")
    expect(palette).toContain("t('pin.unpin')")
    expect(zh['chapterOps.splitAtCursor']).toBe('在光标处拆章')
    expect(zh['command.search']).toBe('全文搜索')
    expect(zh['command.export']).toBe('导出全文')
    expect(zh['command.importWork']).toBe('导入作品')
    expect(zh['command.archived']).toBe('已归档')
  })

  it('keeps tree chapter-status glyphs from cached overview and yields Ctrl+Shift+O to the overlay plugin', () => {
    const source = rootSource()
    const palette = readFileSync(new URL('./client/command-palette.tsx', import.meta.url), 'utf8')
    const statusView = readFileSync(new URL('./chapter-status-view.ts', import.meta.url), 'utf8')
    expect(source).toContain('CENTER_OVERLAYS_SLOT')
    expect(source).toContain('chapterStatuses: buildChapterStatusMap(overview)')
    expect(source).toContain('progress.record')
    expect(source).not.toContain('OverviewPanel')
    expect(source).not.toContain('openOverviewPanel')
    expect(source).not.toContain('chapter.statusSet')
    expect(statusView).toContain("t('status.draft')")
    expect(statusView).toContain("t('status.revising')")
    expect(statusView).toContain("t('status.final')")
    expect(zh['status.draft']).toBe('草稿')
    expect(zh['status.revising']).toBe('修订中')
    expect(zh['status.final']).toBe('已定稿')
    expect(palette).not.toContain("t('command.overview')")
    expect(workspaceShortcut({ key: 'o', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull()
  })

  it('opens a registered command from the palette and Ctrl+Shift+L', () => {
    const source = rootSource()
    const palette = readFileSync(new URL('./client/command-palette.tsx', import.meta.url), 'utf8')
    expect(source).toContain('matchRegistryShortcut')
    expect(source).toContain('registryPaletteItems')
    expect(source).toContain('SIDEBAR_TOOLS_SLOT')
    expect(readFileSync(new URL('./seats.ts', import.meta.url), 'utf8')).toContain("from 'dsh-editor-seats'")
    expect(readFileSync(new URL('../../dsh-editor-seats/src/index.ts', import.meta.url), 'utf8')).toContain("'dsh-editor.sidebar.tools'")
    expect(readFileSync(new URL('../../dsh-editor-seats/src/index.ts', import.meta.url), 'utf8')).toContain("'dsh-editor.center.overlays'")
    expect(source).not.toContain('ProofreadPanel')
    expect(source).not.toContain('openProofreadPanel')
    expect(palette).toContain('appendRegistryCommands')
    expect(palette).not.toContain("t('command.proofreadDoc')")
    expect(workspaceShortcut({ key: 'l', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull()

    const run = vi.fn()
    const registry = createCommandRegistry()
    registry.register({
      id: 'proofread-document',
      group: 'writing',
      label: { zh: '校对当前文档', en: 'Proofread current document' },
      hint: { zh: 'Ctrl+Shift+L · 标点、错别字、敏感词、重复与口癖', en: 'Ctrl+Shift+L' },
      shortcut: { key: 'l', ctrl: true, shift: true },
      when: 'workspace',
      run,
    })
    const event = { key: 'l', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }
    const matched = matchRegistryShortcut(registry.list(), event)
    expect(matched?.id).toBe('proofread-document')
    const context = {
      sessionId: 's1',
      activePath: '正文/001.md',
      editorDirty: false,
      treeRevision: 0,
      contentRevision: 0,
      locale: 'zh',
      openDocument: vi.fn(),
      onApplied: vi.fn(),
      note: vi.fn(),
      revealSidebar: vi.fn(),
      refresh: vi.fn(),
      expandTreePath: vi.fn(),
      highlightTreePath: vi.fn(),
      pinnedPath: null,
      togglePin: vi.fn(),
      ProposalCard: () => null,
    } satisfies ShellToolSeatContext
    const items = registryPaletteItems(registry.list(), 'zh', context, true)
    const groups = appendRegistryCommands([
      { id: 'workspace', heading: '作品', items: [] },
      { id: 'writing', heading: '写作', items: [{ id: 'cmd.search', label: '全文搜索', icon: null, run: () => {} }] },
      { id: 'view', heading: '视图', items: [] },
    ], items)
    expect(groups.find((group) => group.id === 'writing')?.items.map((item) => item.id)).toEqual(['cmd.search', 'proofread-document'])
    expect(groups.find((group) => group.id === 'writing')?.items.at(-1)?.label).toBe('校对当前文档')
    groups.find((group) => group.id === 'writing')?.items.at(-1)?.run()
    expect(run).toHaveBeenCalledWith(context)
    expect(context.revealSidebar).toHaveBeenCalled()
  })

  it('leaves character and worldbook cards to the cards plugin seats and registry commands', () => {
    const source = rootSource()
    const seats = readFileSync(new URL('../../dsh-editor-seats/src/index.ts', import.meta.url), 'utf8')
    const palette = readFileSync(new URL('./client/command-palette.tsx', import.meta.url), 'utf8')
    const pinned = readFileSync(new URL('./client/pinned-pane.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('CardsPanel')
    expect(source).not.toContain('openCardsPanel')
    expect(source).toContain('highlightTreePath')
    expect(seats).toContain('highlightTreePath')
    expect(seats).toContain('togglePin')
    expect(pinned).toContain('CARDS_RPC_CHANNEL')
    expect(pinned).toContain('cards.list')
    expect(palette).not.toContain('cmd.cards')
    expect(palette).not.toContain('cmd.worldbook')
    expect(palette).toContain('keywords: item.keywords')
    expect(workspaceShortcut({ key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull()
    expect(workspaceShortcut({ key: 'w', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull()
  })

  it('leaves novel_memory_update rows to the message-card registry', () => {
    const chatSource = readFileSync(new URL('./client/chat.ts', import.meta.url), 'utf8')
    const clientSource = readFileSync(new URL('./client.ts', import.meta.url), 'utf8')
    const seats = readFileSync(new URL('../../dsh-editor-seats/src/index.ts', import.meta.url), 'utf8')
    expect(chatSource).not.toContain('MemoryUpdateCard')
    expect(chatSource).not.toContain('./memory-card.ts')
    expect(chatSource).toContain('MESSAGE_CARDS_SERVICE')
    expect(chatSource).toContain('messageCards?.subscribe')
    expect(chatSource).toContain('messageCards?.get(row.toolName)')
    expect(clientSource).toContain('createMessageCardRegistry')
    expect(clientSource).toContain('MESSAGE_CARDS_SERVICE')
    expect(seats).toContain("export const MESSAGE_CARDS_SERVICE = 'dshEditorMessageCards'")
    expect(seats).toContain('createMessageCardRegistry')
  })

  it('reveals search hits through EditorCoreHandle.revealRange and drops the __cmView escape hatch', () => {
    const editor = readFileSync(new URL('./client/editor.ts', import.meta.url), 'utf8')
    expect(editor).toContain('handle.revealRange(reveal.start, reveal.end)')
    expect(editor).not.toContain('__cmView')
    expect(editor).not.toContain('paperRevealRange')
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
    expect(source).toContain("t('workspace.switch')")
    expect(source).toContain("t('workspace.menu')")
    expect(zh['workspace.switch']).toBe('切换作品')
    expect(zh['workspace.menu']).toBe('作品菜单')
    expect(source).toContain("'aria-controls': 'workspace-actions'")
    // File context menu keeps rename and archive, drops move
    expect(sidebarSource).toContain("className: 'file-context-menu'")
    expect(sidebarSource).toContain("role: 'menuitem'")
    expect(sidebarSource).toContain("t('sidebar.fileActions')")
    expect(sidebarSource).toContain('onArchive()')
    expect(sidebarSource).toContain("t('common.archive')")
    expect(zh['sidebar.fileActions']).toBe('文档操作')
    expect(zh['common.archive']).toBe('归档')
    expect(sidebarSource).not.toContain('onMove:')
    expect(source).toContain('onArchive:')
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
    expect(source).toContain("t('workspace.backHome')")
    expect(zh['workspace.backHome']).toBe('返回作品列表')
    expect(source).not.toContain('workspace-home-button')
    expect(source).not.toContain('workspace-view-controls')
    expect(source).not.toContain("target === 'paper' ? '稿纸'")
    expect(source).toContain("t('home.blankPaper')")
    expect(zh['home.blankPaper']).toBe('空白稿纸')
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

  it('builds the workspace grid from pinnedLayoutColumns so a fourth pin track can sit beside the manuscript', () => {
    const source = rootSource()
    const styleSource = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8')
    expect(source).toContain('pinnedLayoutColumns({')
    expect(source).toContain('dsh-editor.layout.pinned-path')
    expect(source).toContain('dsh-editor.layout.pinned-width')
    expect(source).toContain('PinnedPane')
    expect(source).not.toContain("assistantVisible ? `7px ${assistantWidth}px` : '',")
    expect(styleSource).toContain('.pinned-pane')
    expect(styleSource).toContain('.pinned-open')
    // 中栏 overlay 只靠座位合同的 data 属性布局：插件根元素落到稿纸格并把稿纸藏起来（稿纸根带内联 display，须 !important），
    // Shell 样式里不得再出现具体插件的 class 名；钉住的侧栏永远不受 overlay 影响。
    expect(styleSource).toMatch(/\.center-overlays \[data-dsh-center-overlay\] \{ grid-row: 2;/)
    expect(styleSource).toMatch(/:has\(> \.center-overlays \[data-dsh-center-overlay\]\) > \.editor,\s*\.shell\.layout-shell:has\(> \.center-overlays \[data-dsh-center-overlay\]\) > \.empty-paper \{ display: none !important; \}/)
    expect(styleSource).not.toMatch(/overview-panel|cards-detail/)
    expect(styleSource).not.toMatch(/data-dsh-center-overlay\]\) > \.pinned-pane/)
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
    expect(workspaceShortcut(key('f', { shiftKey: true }))).toBe('search')
    expect(workspaceShortcut(key('o', { shiftKey: true }))).toBeNull()
    expect(workspaceShortcut(key('l', { shiftKey: true }))).toBeNull()
    expect(workspaceShortcut(key('c', { shiftKey: true }))).toBeNull()
    expect(workspaceShortcut(key('w', { shiftKey: true }))).toBeNull()
    expect(workspaceShortcut(key('t', { altKey: true }))).toBe('toggle-typewriter')
    expect(workspaceShortcut(key('p', { altKey: true }))).toBe('toggle-focus-paragraph')
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

  it('surfaces Host partial-write details with recovery locations', () => {
    const result = {
      ok: false as const,
      error: {
        code: 'internal',
        message: 'apply interrupted',
        details: { partial: true, appliedPaths: ['正文/01.md', '正文/02.md'], recoveryPath: 'D:\\novel\\.dsh-editor\\stage\\apply-1', safetySnapshotId: 'snap-9' },
      },
    }
    expect(partialApplyDetails(result)).toEqual({
      partial: true,
      appliedPaths: ['正文/01.md', '正文/02.md'],
      recoveryPath: 'D:\\novel\\.dsh-editor\\stage\\apply-1',
      safetySnapshotId: 'snap-9',
    })
    const message = errorMessage(result)
    expect(message).toContain('涉及 正文/01.md、正文/02.md')
    expect(message).toContain('恢复文件在 D:\\novel\\.dsh-editor\\stage\\apply-1')
    expect(message).toContain('安全快照 snap-9')
    expect(message).not.toContain('未写入')
  })

  it('treats ordinary failures as non-partial', () => {
    expect(partialApplyDetails({ ok: false, error: { code: 'internal', message: 'io', details: {} } })).toBeNull()
    expect(partialApplyDetails({ ok: false, error: { code: 'internal', message: 'io', details: { partial: false } } })).toBeNull()
    expect(partialApplyDetails({ ok: true, value: {} })).toBeNull()
  })

  it('explains structure creation failures without exposing Host details', () => {
    expect(errorMessage({ ok: false, error: { code: 'directory-exists', message: 'manuscript group already exists' } })).toBe('同名文件或目录已经存在。')
    expect(errorMessage({ ok: false, error: { code: 'directory-unreadable', message: 'project folder is read-only' } })).toBe('当前文件无法写入，请检查目录权限。')
    expect(errorMessage({ ok: false, error: { code: 'workspace-invalid-path', message: 'manuscript group name is invalid' } })).toBe('名称或路径不符合规则。')
  })

  it('registers a workspace through the controller and does not call Host remotes', async () => {
    const workspace = { workspaceId: 'workspace-1', path: 'D:\\novel', title: 'novel', sessionIds: [], createdAt: '', updatedAt: '' }
    const createProjection = vi.fn(async () => workspace)
    const result = await createFlowWorkspace({
      workspaces: { create: createProjection, delete: vi.fn() },
    } as never, 'D:\\novel')

    expect(result).toEqual({ workspace, created: true })
    expect(createProjection).toHaveBeenCalledWith({ path: 'D:\\novel' })
  })

  it('does not delete when workspace create itself fails', async () => {
    const remove = vi.fn()
    await expect(createFlowWorkspace({
      workspaces: { create: async () => { throw new Error('projection failed') }, delete: remove },
    } as never, 'D:\\target')).rejects.toThrow('projection failed')

    expect(remove).not.toHaveBeenCalled()
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

  it('threads the writing-progress scope into the shell root and renders the sidebar search box', () => {
    const source = rootSource()
    /* root.ts 必须真正接住 progressScope,而不是定义后不用 */
    expect(source).toContain('progressScope: WritingProgressScope')
    expect(source).toMatch(/progressScope\s*[,:]\s*options\.progressScope/)
    expect(source).toContain('side-search')
    expect(source).toContain('setSearchSubmitTick')
    expect(source).not.toContain('writing-progress-chip')
    expect(source).toMatch(/nextBaselines\(/)
    expect(source).toContain("localDateKey(new Date())")
    expect(source).toContain('progress.record')
    expect(source).toContain('PROGRESS_RECORD_DEBOUNCE_MS')
    const settingsSource = readFileSync(new URL('./writing-settings.ts', import.meta.url), 'utf8')
    expect(settingsSource).toContain("from './writing-progress-settings.tsx'")
    expect(settingsSource).toContain('e(WritingProgressSettings')
    const styleSource = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8')
    expect(styleSource).toMatch(/\.side-search\b/)
    /* 作者侧写不对作者暴露设置入口 */
    expect(settingsSource).not.toContain('作者侧写（记忆）')
    expect(settingsSource).not.toContain('保存作者侧写')
  })

  it('renders chapter status badges in the file tree from cached overview data', () => {
    const sidebarSource = readFileSync(new URL('./client/sidebar.ts', import.meta.url), 'utf8')
    expect(sidebarSource).toContain('chapter-status')
    expect(sidebarSource).toContain('chapterStatuses')
    expect(sidebarSource).toContain('chapterStatusLabel(chapterStatus)')
    expect(sidebarSource).toContain('chapterStatusGlyph(chapterStatus)')
    expect(sidebarSource).toContain('isChapterDocumentPath(child)')
    const styleSource = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8')
    expect(styleSource).toMatch(/\.chapter-status\b/)
    expect(styleSource).toMatch(/\.chapter-status\.draft\b/)
    expect(styleSource).toMatch(/\.chapter-status\.revising\b/)
    expect(styleSource).toMatch(/\.chapter-status\.final\b/)
  })

  it('exposes paper typography settings, EditorCore props, and recoverable conversation archive', () => {
    const settingsSource = readFileSync(new URL('./writing-settings.ts', import.meta.url), 'utf8')
    const editorSource = readFileSync(new URL('./client/editor.ts', import.meta.url), 'utf8')
    const chatSource = readFileSync(new URL('./client/chat.ts', import.meta.url), 'utf8')
    const palette = readFileSync(new URL('./client/command-palette.tsx', import.meta.url), 'utf8')
    const styleSource = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8')
    expect(settingsSource).toContain("t('writing.paper')")
    expect(settingsSource).toContain("t('writing.typewriter')")
    expect(settingsSource).toContain("t('writing.focusParagraph')")
    expect(zh['writing.paper']).toBe('稿纸与排版')
    expect(zh['writing.typewriter']).toBe('打字机滚动')
    expect(zh['writing.focusParagraph']).toBe('聚焦当前段落')
    expect(settingsSource).toContain("name: 'paper-font-family'")
    expect(settingsSource).toContain("name: 'paper-width'")
    expect(editorSource).toContain('typewriter')
    expect(editorSource).toContain('focusParagraph')
    expect(editorSource).toContain('typography')
    expect(editorSource).toContain('paper-experience-toggles')
    expect(chatSource).toContain("t('chat.archivedConversations')")
    expect(chatSource).toContain("t('chat.conversationActions')")
    expect(chatSource).toContain("t('chat.deleteTitle')")
    expect(zh['chat.archivedConversations']).toBe('已归档对话')
    expect(zh['chat.conversationActions']).toBe('对话操作')
    expect(zh['chat.deleteTitle']).toBe('删除这段对话？')
    expect(zh['sidebar.search']).toBe('搜索')
    const sidebarSearch = readFileSync(new URL('./client/root.ts', import.meta.url), 'utf8')
    expect(sidebarSearch).toContain("t('search.placeholder')")
    expect(palette).toContain("t('command.typewriterHint')")
    expect(palette).toContain("t('command.focusParaHint')")
    expect(zh['command.typewriterHint']).toContain('Ctrl+Alt+T')
    expect(zh['command.focusParaHint']).toContain('Ctrl+Alt+P')
    expect(styleSource).toContain('var(--paper-font-family, var(--font-serif))')
    expect(styleSource).toMatch(/\.archived-conversations\b/)
  })

  it('reads chat rows from official conversation when present and stays empty without it', () => {
    const empty = conversationChatSource({}, 'sess-1')
    expect(empty.getSnapshot().legacy?.nodes).toEqual([])
    expect(empty.getSnapshot()).toBe(empty.getSnapshot())
    const target = { getSnapshot: () => ({ legacy: { nodes: [{ kind: 'user', seq: 1, content: [] }], partial: null, runningCalls: [] } }), subscribe: () => () => {} }
    const present = conversationChatSource({
      uiConversation: { binding: () => ({ target: () => target }) },
    }, 'sess-1')
    expect(present.getSnapshot().legacy?.nodes).toHaveLength(1)
    const viaGet = conversationChatSource({
      get: (name: string) => name === 'uiConversation' ? { binding: () => ({ target: () => target }) } : undefined,
    }, 'sess-1')
    expect(viaGet.getSnapshot().legacy?.nodes).toHaveLength(1)
    const rawTopLevel = { nodes: [{ kind: 'assistant', seq: 2, blocks: [] }], partial: null, runningCalls: [] }
    const topLevel = conversationChatSource({
      uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => rawTopLevel, subscribe: () => () => {} }) }) },
    }, 'sess-1')
    expect(topLevel.getSnapshot().legacy?.nodes).toEqual([{ kind: 'assistant', seq: 2, blocks: [] }])
    expect(topLevel.getSnapshot()).toBe(topLevel.getSnapshot())
    const broken = conversationChatSource({
      uiConversation: { binding: () => { throw new Error('uiConversation.binding: unknown session') } },
    }, 'sess-1')
    expect(broken.getSnapshot().legacy?.nodes).toEqual([])
    vi.useFakeTimers()
    const delayed: { uiConversation?: { binding(): { target(): typeof target } } } = {}
    const late = conversationChatSource(delayed, 'sess-1')
    let ticks = 0
    const stop = late.subscribe(() => { ticks += 1 })
    expect(late.getSnapshot().legacy?.nodes).toEqual([])
    delayed.uiConversation = { binding: () => ({ target: () => target }) }
    vi.advanceTimersByTime(50)
    expect(ticks).toBeGreaterThan(0)
    expect(late.getSnapshot().legacy?.nodes).toHaveLength(1)
    stop()
    vi.useRealTimers()
    expect(isObservableSource({ getSnapshot: () => 1, subscribe: () => () => {} })).toBe(true)
    expect(isObservableSource({ sessionId: 's1' })).toBe(false)
    expect(rootSource()).toContain('e(ShellErrorBoundary, { key: chatSession.sessionId }, e(Chat,')
  })

  it('binds official conversation from a child fiber and exposes it to later chat sources', () => {
    const target = { getSnapshot: () => ({ legacy: { nodes: [{ kind: 'user', seq: 4, content: [] }], partial: null, runningCalls: [] } }), subscribe: () => () => {} }
    const inner = { uiConversation: { binding: () => ({ target: () => target }) } }
    let dispose = () => {}
    bindOfficialConversation({
      inject(_deps, apply) {
        dispose = apply(inner) ?? (() => {})
      },
    })
    const bound = conversationChatSource({}, 'sess-1')
    expect(bound.getSnapshot().legacy?.nodes).toHaveLength(1)
    dispose()
    expect(conversationChatSource({}, 'sess-1').getSnapshot().legacy?.nodes).toEqual([])
  })
})
