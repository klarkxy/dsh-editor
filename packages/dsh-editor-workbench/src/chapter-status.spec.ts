import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileSystemLike, FsDirEntryLike, FsInfoLike, FsPathInfoLike, FsTargetLike, FsWriteIntentLike, SandboxExecutionPolicyLike, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import { CHAPTER_STATUS_PATH, ChapterStatusError, setChapterStatus, syncChapterStatusPaths } from './chapter-status.ts'
import { readProjectOverview, type OverviewAccess } from './overview.ts'
import { deleteEntry, moveEntry, renameDocument, renameEntry, type LifecycleAccess } from './lifecycle.ts'
import { readTextFile } from 'dsh-manuscript/host-api'

let root = ''

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

  async writeText(target: FsTargetLike, content: string, expected?: FsWriteIntentLike, _signal?: AbortSignal, _policy?: SandboxExecutionPolicyLike): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    const before = await this.readText(target).catch(() => null)
    const current = await this.stat(target)
    if (expected?.kind === 'createIfAbsent' && current) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
    if (expected?.kind === 'replaceIfVersion' && current?.version !== expected.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    await fs.mkdir(path.dirname(target.targetKey), { recursive: true })
    await fs.writeFile(target.targetKey, content, 'utf8')
    return { operation: before === null ? 'create' : 'update', version: (await this.stat(target))!.version, before, after: content }
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-chapter-status-'))
  await fs.mkdir(path.join(root, '正文'), { recursive: true })
  await fs.mkdir(path.join(root, '大纲'), { recursive: true })
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

function access(mode = 'workspace-write'): OverviewAccess & LifecycleAccess {
  const fileSystem = new NodeFileSystem(root)
  const files: WorkspaceFileContext = {
    fs: fileSystem,
    cwd: root,
    root: { targetKey: root, displayPath: root },
    policy: { mode: mode as 'workspace-write' | 'read-only', workspaceRoot: root },
  }
  return { path: root, rootKey: root, mode, files }
}

async function write(relative: string, text: string): Promise<void> {
  const target = path.join(root, ...relative.split('/'))
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, text, 'utf8')
}

describe('chapter status', () => {
  it('sets and reads a stored status, omitting draft from the sidecar', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    await expect(setChapterStatus({ access: access(), path: '正文/001.md', status: 'draft' })).resolves.toEqual({ path: '正文/001.md', status: 'draft' })
    await expect(fs.stat(path.join(root, '.dsh-editor', 'chapter-status.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(setChapterStatus({ access: access(), path: '正文/001.md', status: 'revising' })).resolves.toEqual({ path: '正文/001.md', status: 'revising' })
    await expect(readProjectOverview(access())).resolves.toMatchObject({
      chapters: [expect.objectContaining({ path: '正文/001.md', status: 'revising' })],
      totals: { byStatus: { draft: 0, revising: 1, final: 0 } },
    })
    expect(JSON.parse(await fs.readFile(path.join(root, '.dsh-editor', 'chapter-status.json'), 'utf8'))).toEqual({
      version: 1,
      statuses: { '正文/001.md': 'revising' },
    })
    await expect(setChapterStatus({ access: access(), path: '正文/001.md', status: 'final' })).resolves.toEqual({ path: '正文/001.md', status: 'final' })
    await expect(setChapterStatus({ access: access(), path: '正文/001.md', status: 'draft' })).resolves.toEqual({ path: '正文/001.md', status: 'draft' })
    expect(JSON.parse(await fs.readFile(path.join(root, '.dsh-editor', 'chapter-status.json'), 'utf8')).statuses).toEqual({})
  })

  it('fail-opens a corrupt sidecar and still writes a replacement', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    await write(CHAPTER_STATUS_PATH, '{not json')
    await expect(readProjectOverview(access())).resolves.toMatchObject({ chapters: [expect.objectContaining({ status: 'draft' })] })
    await expect(setChapterStatus({ access: access(), path: '正文/001.md', status: 'final' })).resolves.toEqual({ path: '正文/001.md', status: 'final' })
    expect(JSON.parse(await fs.readFile(path.join(root, '.dsh-editor', 'chapter-status.json'), 'utf8')).statuses).toEqual({ '正文/001.md': 'final' })
  })

  it('rejects an invalid status', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    await expect(setChapterStatus({ access: access(), path: '正文/001.md', status: 'done' })).rejects.toMatchObject({ name: 'ChapterStatusError', code: 'INVALID_PATH' })
    await expect(setChapterStatus({ access: access(), path: '正文/001.md', status: 1 })).rejects.toBeInstanceOf(ChapterStatusError)
  })

  it('rejects unknown paths that are not under 正文', async () => {
    await write('大纲/总纲.md', '# 总纲\n\n主线')
    await write('正文/001.md', '# 第一章\n\n正文')
    await expect(setChapterStatus({ access: access(), path: '大纲/总纲.md', status: 'final' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(setChapterStatus({ access: access(), path: '正文/不存在.md', status: 'final' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(setChapterStatus({ access: access(), path: '../escape.md', status: 'final' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(fs.stat(path.join(root, '.dsh-editor', 'chapter-status.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects status writes in a read-only workspace', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    await expect(setChapterStatus({ access: access('read-only'), path: '正文/001.md', status: 'final' })).rejects.toMatchObject({ code: 'READ_ONLY' })
  })

  it('remaps keys on rename, move, and delete so stale paths do not stick', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    await write('正文/卷二/002.md', '# 第二章\n\n后文')
    await setChapterStatus({ access: access(), path: '正文/001.md', status: 'revising' })
    await setChapterStatus({ access: access(), path: '正文/卷二/002.md', status: 'final' })
    const source = await readTextFile(access().files, '正文/001.md')
    await expect(renameDocument({ access: access(), path: '正文/001.md', newName: '序章', expectedVersion: source.version })).resolves.toMatchObject({ path: '正文/序章.md' })
    await expect(readProjectOverview(access())).resolves.toMatchObject({
      chapters: expect.arrayContaining([
        expect.objectContaining({ path: '正文/序章.md', status: 'revising' }),
        expect.objectContaining({ path: '正文/卷二/002.md', status: 'final' }),
      ]),
    })
    await expect(renameEntry({ access: access(), path: '正文/卷二', name: '第一卷' })).resolves.toEqual({ path: '正文/第一卷' })
    await expect(readProjectOverview(access())).resolves.toMatchObject({
      chapters: expect.arrayContaining([expect.objectContaining({ path: '正文/第一卷/002.md', status: 'final' })]),
    })
    await expect(moveEntry({ access: access(), path: '正文/序章.md', targetDir: '大纲' })).resolves.toEqual({ path: '大纲/序章.md' })
    await expect(deleteEntry({ access: access(), path: '正文/第一卷' })).resolves.toEqual({ path: '正文/第一卷' })
    expect(JSON.parse(await fs.readFile(path.join(root, '.dsh-editor', 'chapter-status.json'), 'utf8')).statuses).toEqual({})
    await syncChapterStatusPaths(access(), '正文/幽灵.md', null)
  })
})
