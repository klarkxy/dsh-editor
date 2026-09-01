import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { authorFlowExamples, canSubmitComposer, clampPanelWidth, createDialogDirectory, createFlowWorkspace, errorMessage, isChapterDocumentPath, isStaleFailure, isSuccessWorkbenchNote, LatestRequestGate, orderTreeEntries, proposalAppliedNavigation, replaceWorldbookPaperText, resizedPanelWidth, safeRpcCall, searchSkippedText, shouldSubmitComposer, treeExpansionPaths, treeRowPadding, worldbookPaperProjection, workspaceShortcut } from './client.ts'

describe('shell manuscript RPC safety', () => {
  it('keeps browser-native prompt and confirm out of the workbench UI', () => {
    const source = readFileSync(new URL('./client.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('globalThis.prompt')
    expect(source).not.toContain('globalThis.confirm')
  })

  it('opens 打开作品 and 新建 through the host directory picker, and only shows a path form if the picker is unavailable', () => {
    const source = readFileSync(new URL('./client.ts', import.meta.url), 'utf8')
    expect(source).toContain("onClick: () => void startWorkspaceFromPicker(false)")
    expect(source).toContain("onClick: () => void startWorkspaceFromPicker(true)")
    expect(source).toContain('ctx.workspaces.pickDirectory()')
    expect(source).toContain("setManualWorkspaceMode(newProject ? 'new' : 'existing')")
    expect(source).not.toContain('showWorkspacePath(')
  })

  it('shows the actual create destination for every document kind', () => {
    expect(createDialogDirectory('chapter')).toBe('正文')
    expect(createDialogDirectory('chapter', '正文/第二卷')).toBe('正文/第二卷')
    expect(createDialogDirectory('outline')).toBe('大纲')
    expect(createDialogDirectory('character')).toBe('人物卡')
    expect(createDialogDirectory('world')).toBe('世界书')
  })

  it('keeps root files at root and aligns sibling file/directory depth', () => {
    const entries = [
      { name: '正文', type: 'directory' as const },
      { name: '项目总览.md', type: 'file' as const },
      { name: '世界书', type: 'directory' as const },
    ]
    expect(orderTreeEntries('', entries).map((entry) => entry.name)).toEqual(['项目总览.md', '正文', '世界书'])
    expect(orderTreeEntries('正文', entries)).toEqual(entries)
    expect(treeRowPadding(0)).toBe(14)
    expect(treeRowPadding(1)).toBe(28)
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

  it('uses chapter chrome only for manuscript documents and hides valid worldbook YAML from the paper', () => {
    expect(isChapterDocumentPath('正文/001.md')).toBe(true)
    expect(isChapterDocumentPath('正文/第二卷/003.txt')).toBe(true)
    expect(isChapterDocumentPath('世界书/港口规则.md')).toBe(false)
    expect(isChapterDocumentPath('项目总览.md')).toBe(false)

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

  it('keeps success notices green, exposes workbench snapshots, and delegates settings to DSH', () => {
    expect(isSuccessWorkbenchNote('已创建 正文/第二卷')).toBe(true)
    expect(isSuccessWorkbenchNote('请先保存当前文档。')).toBe(false)
    expect(searchSkippedText(1)).toBe('未搜索 1 个隐藏、生成、非文本或过大项目')
    const source = readFileSync(new URL('./client.ts', import.meta.url), 'utf8')
    const styleSource = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8').replace(/\s+/g, '')
    expect(styleSource).toContain('.layout-shell:has(.export-menu[open]){overflow:visible}')
    expect(styleSource).toContain(".export-menusummary::after{content:'';")
    expect(source).toContain("e('button', { type: 'button', disabled: exporting, onClick: () => void exportNovel('markdown') }, 'Markdown')")
    expect(source).toContain("e('button', { type: 'button', disabled: exporting, onClick: () => void exportNovel('text') }, 'TXT')")
    expect(source).toContain("exporting ? '导出中' : '导出全书'")
    expect(source).toContain("title: '把正文按章节顺序合并成一份 Markdown 或 TXT'")
    expect(source).toContain("title: '备份已保存的作品；恢复时生成新副本，不会覆盖当前作品'")
    expect(source).toContain('function SnapshotLibraryDialog(')
    expect(source).toContain('openSnapshotLibrary')
    expect(source).toMatch(/export-actions[\s\S]{0,700}作品快照/)
    expect(source).toContain("renderSlot('sidebar.settings', { wide: true })")
    expect(source).not.toContain('ModelSetup')
    expect(source).not.toContain("view === 'settings'")
    expect(source).not.toContain('settings-shell')
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

  it('offers the complete author flow as editable chat examples', () => {
    const examples = authorFlowExamples('正文/003 潮汐.md')
    expect(examples.map((item) => item.label)).toEqual(['从零规划', '建立人物卡', '编排十章', '生成正文'])
    expect(examples[2]?.prompt).toContain('前 10 章章纲')
    expect(examples[3]?.prompt).toContain('当前章节《003 潮汐》')
    expect(examples[3]?.prompt).toContain('至少 2000 字')
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
})
