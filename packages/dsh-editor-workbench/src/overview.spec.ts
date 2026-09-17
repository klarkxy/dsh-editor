import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileSystemLike, FsDirEntryLike, FsInfoLike, FsPathInfoLike, FsTargetLike, FsWriteIntentLike, SandboxExecutionPolicyLike, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import { readProjectOverview, type OverviewAccess } from './overview.ts'

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
  it('summarizes visible documents from the project root in natural order', async () => {
    await write('正文/10.txt', '# 第十章\n\n正文十')
    await write('正文/2.md', '# 第二章\n\n正文二')
    await write('正文/空.md', '# 空章\n\n')
    await write('正文/.hidden.md', '# hidden')
    await write('大纲/总纲.md', '# 总纲\n\n主线')
    await write('README.md', '# 根说明\n\n入口')
    await write('资料/说明.txt', '笔记正文')
    await write('.dsh-editor/秘密.md', '# 不该出现')
    await write('dist/out.md', '# 生成物')
    const overview = await readProjectOverview(access())
    expect(overview.chapters.map((chapter) => chapter.path)).toEqual([
      '大纲/总纲.md',
      '正文/2.md',
      '正文/10.txt',
      '正文/空.md',
      '资料/说明.txt',
      'README.md',
    ])
    expect(overview.chapters.map((chapter) => [chapter.title, chapter.excerpt, chapter.empty, chapter.chars])).toEqual([
      ['总纲', '主线', false, 5],
      ['第二章', '正文二', false, 7],
      ['第十章', '正文十', false, 7],
      ['空章', '', true, 3],
      ['说明', '笔记正文', false, 4],
      ['根说明', '入口', false, 6],
    ])
    expect(overview.outlines).toMatchObject([{ path: '大纲/总纲.md', title: '总纲', excerpt: '主线' }])
    expect(overview.totals).toEqual({ chapters: 6, chars: 32 })
    expect(overview.recentChapters).toHaveLength(5)
    expect(overview.recent?.path).toBeTruthy()
    expect(overview.chapters.every((chapter) => typeof chapter.modifiedAt === 'string')).toBe(true)
    expect(overview.chapters.some((chapter) => chapter.path.includes('.dsh-editor') || chapter.path.startsWith('dist/'))).toBe(false)
  })

  it('excludes chapter frontmatter from prose stats and fills meta', async () => {
    await write('正文/001.md', [
      '---',
      'beats:',
      '  - 码头等船',
      '  - 海关暗记',
      'state:',
      '  now: 第三日黄昏',
      '---',
      '# 第一章',
      '',
      '正文一',
      '',
    ].join('\n'))
    await write('正文/002.txt', '# 第二章\n\n正文二')
    const overview = await readProjectOverview(access())
    expect(overview.chapters[0]).toMatchObject({
      path: '正文/001.md',
      title: '第一章',
      excerpt: '正文一',
      empty: false,
      chars: 7,
      meta: { beats: 2, hasState: true },
    })
    expect(overview.chapters[1]).toMatchObject({
      path: '正文/002.txt',
      title: '第二章',
      chars: 7,
      meta: { beats: 0, hasState: false },
    })
    expect(overview.totals.chars).toBe(14)
  })

  it('excludes AGENTS.md and other assistant files from counts and the chapter list', async () => {
    await write('AGENTS.md', '# 规则\n\n不应计入作者字数的辅助说明')
    await write('CLAUDE.md', '# 其他规则\n\n同样隐藏')
    await write('正文/001.md', '# 第一章\n\n正文一')
    const overview = await readProjectOverview(access())
    expect(overview.chapters.map((chapter) => chapter.path)).toEqual(['正文/001.md'])
    expect(overview.totals).toEqual({ chapters: 1, chars: 7 })
    expect(overview.chapters.some((chapter) => /AGENTS|CLAUDE|GEMINI|COPILOT/i.test(chapter.path))).toBe(false)
  })

  it('allows overview reads in a read-only workspace', async () => {
    await write('正文/001.md', '# 第一章\n\n正文')
    await expect(readProjectOverview(access('read-only'))).resolves.toMatchObject({ totals: { chapters: 1 } })
  })
})
