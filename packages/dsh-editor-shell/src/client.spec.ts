import { describe, expect, it, vi } from 'vitest'
import { zh } from './i18n/index.ts'
import {
  canSubmitComposer,
  claimInitialWorkspaceResume,
  consumeInitialWorkspaceResume,
  clampPanelWidth,
  createFlowWorkspace,
  errorMessage,
  hasRelocatableManuscriptFiles,
  hasVisibleWorkspaceEntries,
  inject,
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
  treeExpansionPaths,
  treeRevealDirectories,
  treeRowPadding,
  worldbookPaperProjection,
  workspaceOpenFailureMessage,
  workspaceShortcut,
  conversationChatSource,
  bindOfficialConversation,
} from './client.ts'
import { isObservableSource } from './client/components.tsx'
import { firstOpenDocumentPath, isVisibleTextPath } from './project-files.ts'
import { partialApplyDetails } from './client/shared.ts'
import { appendRegistryCommands } from './client/command-palette.tsx'
import { createCommandRegistry, matchRegistryShortcut, registryPaletteItems, type ShellToolSeatContext } from './seats.ts'


describe('shell client inject', () => {
  it('declares every Remote face the renderer reads through ctx.remote', () => {
    expect(inject).toEqual([
      'slots', 'sessions', 'workspaces', 'connection', 'settingsScope', 'settingsSchema', 'remote',
      'remote.session', 'remote.settings', 'remote.credentials', 'remote.llm', 'remote.directoryPicker', 'remote.agentPresets',
      'uiSession', 'locale',
    ])
  })
})

describe('shell manuscript RPC safety', () => {
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
    expect(hasRelocatableManuscriptFiles(['封面.jpg', '.dsh-editor/作品索引.md'])).toBe(false)
    expect(hasRelocatableManuscriptFiles(['项目总览.md', '人物卡/主角.md'])).toBe(true)
    expect(hasRelocatableManuscriptFiles(['正文/001.md'])).toBe(true)
    expect(hasRelocatableManuscriptFiles(['正文/第一卷/001.txt'])).toBe(true)
    expect(hasRelocatableManuscriptFiles(['资料/说明.txt'])).toBe(true)
    expect(firstOpenDocumentPath(['文档/guide.md'])).toBe('文档/guide.md')
    expect(firstOpenDocumentPath(['guide.md'])).toBe('guide.md')
    expect(firstOpenDocumentPath(['AGENTS.md'])).toBeUndefined()
    expect(firstOpenDocumentPath(['.dsh-editor/作品索引.md'])).toBeUndefined()
    expect(firstOpenDocumentPath(['文档/.hidden.md'])).toBeUndefined()
    expect(relocationFailureMessage(false)).toContain('原作品入口已保留')
    expect(relocationFailureMessage(false)).not.toContain('未能自动移除')
    expect(relocationFailureMessage(true)).toContain('新位置入口未能自动移除')
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
  })

  it('claims automatic startup resume once so returning home stays on the project list', () => {
    const guard = { current: false }
    expect(claimInitialWorkspaceResume(guard)).toBe(true)
    expect(guard.current).toBe(true)
    expect(claimInitialWorkspaceResume(guard)).toBe(false)
  })

  it('consumes startup resume after a successful home leave so the first return stays on home', () => {
    const openedFromPicker = { current: false }
    consumeInitialWorkspaceResume(openedFromPicker)
    expect(openedFromPicker.current).toBe(true)
    expect(claimInitialWorkspaceResume(openedFromPicker)).toBe(false)
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
  })

  it('commits with the current time as the message and rolls back in place with confirmation', () => {
    expect(snapshotTimeLabel(new Date(2025, 0, 5, 9, 7).getTime())).toBe('2025-01-05 09:07')
    expect(zh['note.rolledBack']).toBe('已回滚到 {label}；回滚前的状态已自动保存为新版本。')
    expect(zh['note.saveBeforeRollback']).toBe('请先保存当前文档，再回滚。')
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

  it('treats success status notes as transient and rejects invalid tree drops', () => {
    expect(isSuccessWorkbenchNote('已移动到 废稿/1.1坠落后的第一夜')).toBe(true)
    expect(isSuccessWorkbenchNote('已删除 正文/001.md')).toBe(true)
    expect(isSuccessWorkbenchNote('已复制 大纲/总纲.md')).toBe(true)
    expect(isSuccessWorkbenchNote('已复制到 废稿/总纲.md')).toBe(true)
    expect(isSuccessWorkbenchNote('已剪切 正文/卷一')).toBe(true)
    expect(isSuccessWorkbenchNote('已保存。')).toBe(true)
    expect(isSuccessWorkbenchNote('Moved to archive/ch1.md')).toBe(true)
    expect(isSuccessWorkbenchNote('Deleted 正文/001.md')).toBe(true)
    expect(isSuccessWorkbenchNote('Saved.')).toBe(true)
    expect(isSuccessWorkbenchNote('请先保存当前文档，再剪切它所在的文件或目录。')).toBe(false)
    expect(isSuccessWorkbenchNote('保存未能完成，已留在当前位置。')).toBe(false)
    expect(treeParentPath('废稿/1.1坠落后的第一夜')).toBe('废稿')
    expect(treeParentPath('001.md')).toBe('')
    expect(treeDropDirectory('directory', '废稿')).toBe('废稿')
    expect(treeDropDirectory('file', '正文/001.md')).toBe('正文')
    expect(treeMoveTargetDir('')).toBe('.')
    expect(canMoveTreeEntry('正文/001.md', '废稿')).toBe(true)
    expect(canMoveTreeEntry('正文/001.md', '正文')).toBe(false)
    expect(canMoveTreeEntry('正文/卷一', '正文/卷一')).toBe(false)
    expect(canMoveTreeEntry('正文/卷一', '正文/卷一/深层')).toBe(false)
    expect(canMoveTreeEntry('正文/卷一', '.')).toBe(true)
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

  })

  it('opens a clean applied file, expands its manuscript ancestors, and preserves dirty buffers', () => {
    expect(treeExpansionPaths('正文/第二卷/003.md')).toEqual(['正文', '正文/第二卷'])
    expect(treeExpansionPaths('人物卡/林见.md')).toEqual(['人物卡'])
    expect(treeExpansionPaths('世界书/港口/规则.md')).toEqual(['世界书', '世界书/港口'])
    expect(treeExpansionPaths('笔记/卷一/003.md')).toEqual(['笔记', '笔记/卷一'])
    expect(treeExpansionPaths('资料/说明.txt')).toEqual(['资料'])
    expect(treeExpansionPaths('人物卡')).toEqual(['人物卡'])
    expect(treeExpansionPaths('世界书')).toEqual(['世界书'])
    expect(treeExpansionPaths('正文')).toEqual(['正文'])
    expect(treeExpansionPaths('大纲')).toEqual(['大纲'])
    expect(treeExpansionPaths('项目总览.md')).toEqual([])
    expect(treeExpansionPaths('.dsh-editor/作品索引.md')).toEqual([])
    expect(treeExpansionPaths('../secret.md')).toEqual([])
    expect(treeExpansionPaths('/abs/file.md')).toEqual([])
    expect(treeRevealDirectories('', '正文/006新的开始.md')).toEqual(['正文'])
    expect(treeRevealDirectories('资料/说明.md', '正文/006新的开始.md')).toEqual(['资料', '正文'])
    expect(proposalAppliedNavigation('正文/003.md', '', false)).toEqual({
      openPath: '正文/003.md',
      expandPath: '正文/003.md',
      refreshContent: false,
    })
    expect(proposalAppliedNavigation('资料/说明.md', '', false)).toEqual({
      openPath: '资料/说明.md',
      expandPath: '资料/说明.md',
      refreshContent: false,
    })
    expect(proposalAppliedNavigation('项目总览.md', '', false)).toEqual({
      openPath: '项目总览.md',
      refreshContent: false,
    })
    expect(proposalAppliedNavigation('正文/003.md', '正文/003.md', false).refreshContent).toBe(true)
    expect(proposalAppliedNavigation('正文/004.md', '正文/003.md', true)).toEqual({
      expandPath: '正文/004.md',
      refreshContent: false,
    })
    expect(proposalAppliedNavigation('笔记/备忘.md', '项目总览.md', true)).toEqual({
      expandPath: '笔记/备忘.md',
      refreshContent: false,
    })
    expect(memoryAppliedNavigation('人物卡/林舟.md', '正文/001.md', false)).toEqual({ refreshContent: false })
    expect(memoryAppliedNavigation('正文/001.md', '正文/001.md', false)).toEqual({ refreshContent: true })
    expect(memoryAppliedNavigation('正文/001.md', '正文/001.md', true)).toEqual({ refreshContent: false })
    expect(memoryAppliedNavigation('人物卡/林舟.md', '正文/001.md', false)).not.toHaveProperty('openPath')
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

  it('keeps new/open/search/export generic and does not clear the save gate', () => {
    expect(zh['search.manuscriptOnly']).toBe('当前目录')
    expect(zh['search.wholeWork']).toBe('整个作品')
    expect(zh['editor.writeFirstChapter']).toBe('写第一篇')
    expect(zh['editor.newChapter']).toBe('新建文档')
    expect(zh['chapterOps.split']).toBe('拆章…')
    expect(isVisibleTextPath('文档/guide.md')).toBe(true)
    expect(isVisibleTextPath('guide.md')).toBe(true)
    expect(isVisibleTextPath('.dsh-editor/作品索引.md')).toBe(false)
    expect(isVisibleTextPath('文档/.hidden.md')).toBe(false)
  })

  it('yields Ctrl+Shift+O to the overlay plugin', () => {
    expect(workspaceShortcut({ key: 'o', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull()
  })

  it('opens a registered command from the palette and Ctrl+Shift+L', () => {
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

  it('recomputes registry palette enablement when seatContext activePath updates', () => {
    const documentRun = vi.fn()
    const manuscriptRun = vi.fn()
    const registry = createCommandRegistry()
    registry.register({
      id: 'proofread-document',
      group: 'writing',
      label: { zh: '校对当前文档', en: 'Proofread current document' },
      when: 'workspace',
      enabled: (context) => Boolean(context.activePath),
      run: documentRun,
    })
    registry.register({
      id: 'proofread-manuscript',
      group: 'writing',
      label: { zh: '校对全书', en: 'Proofread manuscript' },
      when: 'workspace',
      run: manuscriptRun,
    })
    const seatRef: { current: ShellToolSeatContext } = {
      current: {
        sessionId: 's1',
        activePath: '',
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
      },
    }
    const proxy = new Proxy({} as ShellToolSeatContext, {
      get(_target, prop) {
        return Reflect.get(seatRef.current, prop)
      },
    })
    const project = (hasWorkspace: boolean) => registryPaletteItems(registry.list(), 'zh', proxy, hasWorkspace)
    const byId = (items: ReturnType<typeof project>) => Object.fromEntries(items.map((item) => [item.id, item]))

    const empty = byId(project(true))
    expect(empty['proofread-document']?.disabled).toBe(true)
    expect(empty['proofread-manuscript']?.disabled).toBe(false)

    seatRef.current = { ...seatRef.current, activePath: '正文/001.md' }
    const opened = byId(project(true))
    expect(opened['proofread-document']?.disabled).toBe(false)
    expect(opened['proofread-manuscript']?.disabled).toBe(false)
    opened['proofread-document']?.run()
    expect(documentRun).toHaveBeenCalledWith(proxy)
    expect(seatRef.current.activePath).toBe('正文/001.md')

    seatRef.current = { ...seatRef.current, activePath: '' }
    const afterClose = byId(project(true))
    expect(afterClose['proofread-document']?.disabled).toBe(true)
    expect(afterClose['proofread-manuscript']?.disabled).toBe(false)
    afterClose['proofread-document']?.run()
    expect(documentRun).toHaveBeenCalledTimes(1)

    const noWorkspace = byId(project(false))
    expect(noWorkspace['proofread-document']?.disabled).toBe(true)
    expect(noWorkspace['proofread-manuscript']?.disabled).toBe(true)
  })

  it('leaves character and worldbook cards to the cards plugin seats and registry commands', () => {
    expect(workspaceShortcut({ key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull()
    expect(workspaceShortcut({ key: 'w', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull()
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
    expect(workspaceShortcut(key('[', { ctrlKey: false, altKey: true, code: 'BracketLeft' }))).toBeNull()
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
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: false, keyCode: 229 })).toBe(false)
    expect(shouldSubmitComposer({ key: 'a', shiftKey: false })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: false })).toBe(true)
    expect(canSubmitComposer({ draft: '写下去', connected: false, removed: false })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: true })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: false, outgoingState: 'sending' })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: false, outgoingState: 'accepted' })).toBe(false)
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

  it('routes create and chapter metadata proposals to the workbench channel and keeps edit on /manuscript', async () => {
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
    const { buildExpectedVersions } = await import('./client/chat.tsx')
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
    /* create 与章纲/章末小结走 workbench prepare,按 prepare 观察到的版本校验目标文件 */
    const createProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'create', path: '大纲/总纲.md', summary: '新建大纲', text: '# 总纲' } as never
    expect(buildExpectedVersions(createProposal, { kind: 'create', applicable: true, version: '', missingDirectories: ['大纲'] } as never))
      .toEqual({ '大纲/总纲.md': '' })
    const planProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'chapter_plan', path: '正文/001.md', summary: '章纲', sourceVersion: 'v9', beats: ['码头'] } as never
    expect(buildExpectedVersions(planProposal, { kind: 'chapter_plan', version: 'v9', before: '', after: '1. 码头' } as never))
      .toEqual({ '正文/001.md': 'v9' })
    const summaryProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'chapter_summary', path: '正文/001.md', summary: '小结', sourceVersion: 'v9', state: { now: '黄昏' } } as never
    expect(buildExpectedVersions(summaryProposal, { kind: 'chapter_summary', version: 'v9', before: '', after: '此刻：黄昏' } as never))
      .toEqual({ '正文/001.md': 'v9' })
    /* edit 仍然走 /manuscript 通道 */
    expect(buildExpectedVersions({ kind: 'edit', path: 'a.md', oldText: 'o', newText: 'n' } as never, { kind: 'edit', version: 'v1', before: 'o', after: 'n' } as never)).toBeUndefined()
  })

  it('shows V2 basis metadata on the confirmation card, reruns prepare on fingerprint change, and keeps stale regenerate-only', async () => {
    const { proposalBasisItems, proposalFingerprint, proposalTargetBaselines } = await import('./client/chat.tsx')
    const v2 = {
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新',
      targetVersion: 'v7',
      basis: [{ path: '大纲/总纲.md', version: 'v1', label: '总纲' }],
    }
    expect(proposalTargetBaselines(v2 as never)).toEqual([{ path: 'notes/a.md', version: 'v7' }])
    expect(proposalBasisItems(v2 as never)).toEqual([{ path: '大纲/总纲.md', version: 'v1', label: '总纲' }])
    expect(proposalFingerprint(v2 as never)).toContain('target|notes/a.md|v7')
    expect(proposalFingerprint(v2 as never)).toContain('大纲/总纲.md|v1|总纲')
    expect(proposalFingerprint({ ...v2, targetVersion: 'v8' } as never))
      .not.toBe(proposalFingerprint(v2 as never))
    expect(proposalFingerprint({ ...v2, basis: [{ path: '大纲/总纲.md', version: 'v2', label: '总纲' }] } as never))
      .not.toBe(proposalFingerprint(v2 as never))
    expect(zh['chat.proposalBasis']).toBe('参考')
    expect(zh['chat.proposalTarget']).toBe('将改动的文件')
    expect(proposalBasisItems({
      marker: 'dsh-editor.proposal', version: 1, kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新',
    } as never)).toEqual([])
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
