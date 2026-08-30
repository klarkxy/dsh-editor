import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileSystemLike, FsDirEntryLike, FsInfoLike, FsPathInfoLike, FsTargetLike, FsWriteIntentLike, SandboxExecutionPolicyLike, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import { CHAPTER_STATUS_PATH, OverviewError, readChapterStatus, readProjectOverview, removeChapterStatus, restoreChapterStatus, setChapterStatus, migrateChapterStatus, type OverviewAccess } from './overview.ts'

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
    await fs.writeFile(target.targetKey, content, 'utf8')
    return { operation: before === null ? 'create' : 'update', version: (await this.stat(target))!.version, before, after: content }
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-overview-'))
  await fs.mkdir(path.join(root, '正文'), { recursive: true })
  await fs.mkdir(path.join(root, '大纲'), { recursive: true })
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

function access(mode = 'workspace-write'): OverviewAccess {
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

describe('project overview', () => {
  it('summarizes visible chapters and outlines in natural order', async () => {
    await write('正文/10.txt', '# 第十章\n\n正文十')
    await write('正文/2.md', '# 第二章\n\n正文二')
    await write('正文/空.md', '# 空章\n\n')
    await write('正文/.hidden.md', '# hidden')
    await write('大纲/总纲.md', '# 总纲\n\n主线')
    const overview = await readProjectOverview(access())
    expect(overview.chapters.map((chapter) => chapter.path)).toEqual(['正文/2.md', '正文/10.txt', '正文/空.md'])
    expect(overview.chapters.map((chapter) => [chapter.title, chapter.excerpt, chapter.empty, chapter.chars])).toEqual([
      ['第二章', '正文二', false, 7],
      ['第十章', '正文十', false, 7],
      ['空章', '', true, 3],
    ])
    expect(overview.outlines).toMatchObject([{ path: '大纲/总纲.md', title: '总纲', excerpt: '主线' }])
    expect(overview.totals).toEqual({ chapters: 3, chars: 17, byStatus: { draft: 3, revising: 0, final: 0 } })
    expect(overview.chapters.every((chapter) => typeof chapter.modifiedAt === 'string')).toBe(true)
  })

  it('creates, validates and prunes the status record with CAS', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    const first = await readProjectOverview(access())
    const changed = await setChapterStatus({ access: access(), path: '正文/001.md', status: 'revising', expectedStatusRevision: first.statusRevision })
    expect(changed.chapters[0]?.status).toBe('revising')
    expect(changed.statusRevision).toBeTruthy()
    await expect(setChapterStatus({ access: access(), path: '正文/001.md', status: 'final', expectedStatusRevision: first.statusRevision })).rejects.toMatchObject({ code: 'STALE' })
    await write(CHAPTER_STATUS_PATH, JSON.stringify({ version: 1, statuses: { '正文/不存在.md': 'final' } }))
    const repaired = await setChapterStatus({ access: access(), path: '正文/001.md', status: 'final', expectedStatusRevision: (await readProjectOverview(access())).statusRevision })
    expect(repaired.chapters[0]?.status).toBe('final')
    expect(JSON.parse(await fs.readFile(path.join(root, '.dsh-editor', 'chapter-status.json'), 'utf8')).statuses).toEqual({ '正文/001.md': 'final' })
  })

  it('does not create metadata for a missing draft and fails closed for malformed data', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    await setChapterStatus({ access: access(), path: '正文/001.md', status: 'draft', expectedStatusRevision: null })
    await expect(fs.stat(path.join(root, '.dsh-editor', 'chapter-status.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await write(CHAPTER_STATUS_PATH, '{not json')
    await expect(readProjectOverview(access())).rejects.toBeInstanceOf(OverviewError)
    await expect(setChapterStatus({ access: access(), path: '正文/001.md', status: 'final', expectedStatusRevision: 'anything' })).rejects.toMatchObject({ code: 'BLOCKED' })
    await expect(fs.readFile(path.join(root, '.dsh-editor', 'chapter-status.json'), 'utf8')).resolves.toBe('{not json')
  })

  it('rejects oversized metadata and never writes a 2001st status', async () => {
    await write(CHAPTER_STATUS_PATH, 'x'.repeat(2_000_001))
    await expect(readProjectOverview(access())).rejects.toMatchObject({ code: 'BLOCKED' })

    const statuses = Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [`正文/${String(index).padStart(4, '0')}.md`, 'final']))
    await write(CHAPTER_STATUS_PATH, `${JSON.stringify({ version: 1, statuses }, null, 2)}\n`)
    const before = await fs.readFile(path.join(root, '.dsh-editor', 'chapter-status.json'), 'utf8')
    await expect(restoreChapterStatus(access(), '正文/overflow.md', 'revising')).rejects.toMatchObject({ code: 'BLOCKED' })
    await expect(fs.readFile(path.join(root, '.dsh-editor', 'chapter-status.json'), 'utf8')).resolves.toBe(before)
  })

  it('moves, removes and restores only stored non-draft statuses', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    const initial = await readProjectOverview(access())
    await setChapterStatus({ access: access(), path: '正文/001.md', status: 'final', expectedStatusRevision: initial.statusRevision })
    await migrateChapterStatus(access(), '正文/001.md', '正文/第一卷/001.md')
    await removeChapterStatus(access(), '正文/第一卷/001.md')
    await restoreChapterStatus(access(), '正文/第一卷/001.md', 'revising')
    const stored = JSON.parse(await fs.readFile(path.join(root, '.dsh-editor', 'chapter-status.json'), 'utf8'))
    expect(stored.statuses).toEqual({ '正文/第一卷/001.md': 'revising' })
    await expect(readChapterStatus(access(), '正文/第一卷/001.md')).resolves.toBe('revising')
  })

  it('allows overview reads but rejects status writes in a read-only workspace', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    await expect(readProjectOverview(access('read-only'))).resolves.toMatchObject({ totals: { chapters: 1 } })
    await expect(setChapterStatus({ access: access('read-only'), path: '正文/001.md', status: 'final', expectedStatusRevision: null })).rejects.toMatchObject({ code: 'READ_ONLY' })
  })
})
