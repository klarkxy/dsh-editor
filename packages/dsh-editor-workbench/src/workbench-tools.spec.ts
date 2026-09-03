/**
 * workbench-tools 的烟雾测试：覆盖工具工厂、参数校验、cwd 解析、execute 通路。
 * 走真实 fs（mkdtemp）+ stub resolver，验证 dsh-tools defineTool 集成正确。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSystemLike, FsDirEntryLike, FsInfoLike, FsPathInfoLike, FsTargetLike, FsWriteIntentLike, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import type { OverviewAccess } from './overview.ts'
import {
  createNovelOverviewTool,
  createNovelSetChapterStatusTool,
  createWorkbenchTools,
  NOVEL_CHAPTER_STATUS_TOOL_NAME,
  NOVEL_OVERVIEW_TOOL_NAME,
  WorkbenchToolError,
} from './workbench-tools.ts'

let base = ''
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wb-tools-'))
  await fs.mkdir(path.join(base, '正文'), { recursive: true })
  await fs.mkdir(path.join(base, '大纲'), { recursive: true })
})
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }) })

class NodeFileSystem implements FileSystemLike {
  constructor(private readonly root: string) {}
  async resolve(value: string, opts?: { cwd?: string }): Promise<FsTargetLike> {
    const base = opts?.cwd ?? this.root
    return { targetKey: path.resolve(base, value), displayPath: path.resolve(base, value) }
  }
  contains(parent: FsTargetLike, child: FsTargetLike): boolean {
    const relative = path.relative(parent.targetKey, child.targetKey)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
  async stat(target: FsTargetLike): Promise<FsInfoLike | undefined> {
    try {
      const value = await fs.stat(target.targetKey)
      return { type: value.isDirectory() ? 'directory' : value.isFile() ? 'file' : 'other', version: `${value.mtimeMs}:${value.size}`, size: value.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  async lstat(value: string, opts?: { cwd?: string }): Promise<FsPathInfoLike | undefined> {
    try {
      const target = path.resolve(opts?.cwd ?? this.root, value)
      const state = await fs.lstat(target)
      return { type: state.isSymbolicLink() ? 'symlink' : state.isDirectory() ? 'directory' : state.isFile() ? 'file' : 'other', version: `${state.mtimeMs}:${state.size}`, size: state.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  async readText(target: FsTargetLike): Promise<string> { return await fs.readFile(target.targetKey, 'utf8') }
  async listDir(target: FsTargetLike): Promise<FsDirEntryLike[]> {
    const entries = await fs.readdir(target.targetKey, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      target: { targetKey: path.join(target.targetKey, entry.name), displayPath: path.join(target.targetKey, entry.name) },
    }))
  }
  async writeText(target: FsTargetLike, content: string, expected?: FsWriteIntentLike): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    const before = await this.readText(target).catch(() => null)
    const current = await this.stat(target)
    if (expected?.kind === 'createIfAbsent' && current) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
    if (expected?.kind === 'replaceIfVersion' && current?.version !== expected.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    await fs.writeFile(target.targetKey, content, 'utf8')
    return { operation: before === null ? 'create' : 'update', version: (await this.stat(target))!.version, before, after: content }
  }
}

function access(): OverviewAccess {
  const files: WorkspaceFileContext = {
    fs: new NodeFileSystem(base),
    cwd: base,
    root: { targetKey: base, displayPath: base },
    policy: { mode: 'workspace-write', workspaceRoot: base },
  }
  return { path: base, rootKey: base, mode: 'workspace-write', files }
}

const execWith = (cwd?: string) => ({
  agent: cwd === undefined
    ? undefined
    : { session: { header: { cwd } } },
}) as unknown as Parameters<ReturnType<typeof createNovelOverviewTool>['execute']>[1]

describe('workbench tools', () => {
  it('createWorkbenchTools 返回两个本地注册名的工具', () => {
    const tools = createWorkbenchTools({ resolveAccess: vi.fn(async () => access()) }) as Array<{ name: string; description: string; output: { schema: unknown; render: unknown } }>
    expect(tools).toHaveLength(2)
    expect(tools.map((tool) => tool.name)).toEqual([NOVEL_OVERVIEW_TOOL_NAME, NOVEL_CHAPTER_STATUS_TOOL_NAME])
    expect(tools.every((tool) => tool.output.schema && typeof tool.output.render === 'function')).toBe(true)
  })

  it('novel_overview 在没有 cwd 时抛 UNREADABLE', async () => {
    const tool = createNovelOverviewTool({ resolveAccess: vi.fn(async () => access()) })
    await expect(tool.execute({}, execWith(undefined))).rejects.toBeInstanceOf(WorkbenchToolError)
  })

  it('novel_overview.execute 返回符合 schema 的 overview', async () => {
    await fs.writeFile(path.join(base, '正文', '001.md'), '# 第一章\n\n正文一', 'utf8')
    const tool = createNovelOverviewTool({ resolveAccess: vi.fn(async () => access()) })
    const value = (await tool.execute({}, execWith(base))) as { version: number; chapters: Array<{ path: string }>; totals: { chapters: number } }
    expect(value.version).toBe(1)
    expect(value.chapters.map((c) => c.path)).toEqual(['正文/001.md'])
    expect(value.totals.chapters).toBe(1)
    // schema 不允许 null 字段；此处确认 modifiedAt 是 string 或 undefined，没有 null
    for (const chapter of value.chapters) {
      expect(chapter).not.toHaveProperty('modifiedAt', null)
    }
  })

  it('novel_set_chapter_status 校验 path / status 格式', async () => {
    const tool = createNovelSetChapterStatusTool({ resolveAccess: vi.fn(async () => access()) })
    await expect(tool.execute({ path: '元数据/001.md', status: 'draft' }, execWith(base))).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(tool.execute({ path: '正文/001.md', status: 'archived' }, execWith(base))).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  })

  it('novel_set_chapter_status.execute 成功设置状态并返回 totals', async () => {
    await fs.writeFile(path.join(base, '正文', '001.md'), '# 第一章\n\n正文', 'utf8')
    const tool = createNovelSetChapterStatusTool({ resolveAccess: vi.fn(async () => access()) })
    const value = (await tool.execute({ path: '正文/001.md', status: 'final' }, execWith(base))) as { version: number; path: string; status: string; totals: { chapters: number; byStatus: { draft: number; revising: number; final: number } } }
    expect(value.version).toBe(1)
    expect(value.path).toBe('正文/001.md')
    expect(value.status).toBe('final')
    expect(value.totals.byStatus.final).toBe(1)
  })
})
