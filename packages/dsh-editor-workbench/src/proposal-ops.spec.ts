import { WRITING_V2_CREATE } from 'dsh-manuscript/host-api'
import { applyChapterProposal, applyCreate, parsePlanningProposal, prepareChapterMeta, prepareCreate } from './planning-proposals.ts'
import { parseChapterMeta, stripChapterFrontmatter } from './chapter-meta.ts'
/**
 * 新提案 kind（split / merge / renames）的 prepare / apply 单元测试。
 * 走真实 fs（mkdtemp），不依赖 cordis host——只测 proposal-ops 自身的语义。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileSystemLike, FsDirEntryLike, FsInfoLike, FsPathInfoLike, FsTargetLike, FsWriteIntentLike, SandboxExecutionPolicyLike, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import { readTextFile } from 'dsh-manuscript/host-api'
import type { LifecycleAccess } from './lifecycle.ts'
import {
  applyMerge,
  applyRenames,
  applySplit,
  parseProposal,
  prepareMerge,
  prepareRenames,
  prepareSplit,
  ProposalOpsError,
  snapshotProposalTargets,
  type MergeProposal,
  type RenamesProposal,
  type SplitProposal,
} from './proposal-ops.ts'

let base = ''
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-proposal-ops-'))
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

function filesContext(): WorkspaceFileContext {
  return {
    fs: new NodeFileSystem(base),
    cwd: base,
    root: { targetKey: base, displayPath: base },
    policy: { mode: 'workspace-write', workspaceRoot: base },
  }
}

function lifecycleAccess(): LifecycleAccess {
  return { path: base, rootKey: base, mode: 'workspace-write', files: filesContext() }
}

async function writeText(relative: string, text: string): Promise<void> {
  const target = path.join(base, ...relative.split('/'))
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, text, 'utf8')
}

async function readRelative(relative: string): Promise<string> {
  return await fs.readFile(path.join(base, ...relative.split('/')), 'utf8')
}

async function listHistorySubdirs(): Promise<string[]> {
  const historyRoot = path.join(base, '.dsh-editor', 'history')
  try {
    return await fs.readdir(historyRoot)
  } catch (error) {
    // .dsh-editor 被文件堵死时 POSIX 报 ENOTDIR,Windows 报 ENOENT
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw error
  }
}

async function readHistoryFile(snapshotDir: string, originalRelative: string): Promise<string> {
  // snapshotDir 已经包含 .dsh-editor/history/ 前缀（proposal-ops 内部拼好的）
  return await fs.readFile(path.join(base, snapshotDir, ...originalRelative.split('/')), 'utf8')
}

function splitProposal(overrides: Partial<SplitProposal> = {}): SplitProposal {
  return {
    marker: 'dsh-editor.proposal',
    version: 1,
    kind: 'split',
    summary: '把第二章切成两半',
    path: '正文/002.md',
    anchor: '## 第二幕',
    newPath: '正文/002b.md',
    ...overrides,
  }
}

function mergeProposal(overrides: Partial<MergeProposal> = {}): MergeProposal {
  return {
    marker: 'dsh-editor.proposal',
    version: 1,
    kind: 'merge',
    summary: '把附录并回第十章',
    path: '正文/010.md',
    sourcePath: '正文/010-补.md',
    ...overrides,
  }
}

function renamesProposal(overrides: Partial<RenamesProposal> = {}): RenamesProposal {
  return {
    marker: 'dsh-editor.proposal',
    version: 1,
    kind: 'renames',
    summary: '把三章改成新章号',
    renames: [
      { from: '正文/001.md', to: '正文/001-改名.md' },
      { from: '正文/002.md', to: '正文/002-改名.md' },
    ],
    ...overrides,
  }
}

describe('parseProposal', () => {
  it('rejects edit / create kinds because they are handled by the manuscript channel', () => {
    expect(() => parseProposal({ marker: 'dsh-editor.proposal', version: 1, kind: 'edit', summary: 'x', path: '正文/001.md' }))
      .toThrow(ProposalOpsError)
    expect(() => parseProposal({ marker: 'dsh-editor.proposal', version: 1, kind: 'create', summary: 'x', path: '正文/001.md' }))
      .toThrow(ProposalOpsError)
  })

  it('rejects renames with overlapping paths', () => {
    expect(() => parseProposal({
      marker: 'dsh-editor.proposal',
      version: 1,
      kind: 'renames',
      summary: 'x',
      renames: [
        { from: '正文/001.md', to: '正文/002.md' },
        { from: '正文/002.md', to: '正文/003.md' },
      ],
    })).toThrow(/不能重叠/)
  })

  it('accepts a valid split / merge / renames payload', () => {
    expect(parseProposal({
      marker: 'dsh-editor.proposal', version: 1, kind: 'split', summary: 's',
      path: '正文/001.md', anchor: '## x', newPath: '正文/001b.md', targetVersion: 'v7',
    })).toEqual({
      marker: 'dsh-editor.proposal', version: 1, kind: 'split', summary: 's',
      path: '正文/001.md', anchor: '## x', newPath: '正文/001b.md',
    })
    expect(parseProposal({
      marker: 'dsh-editor.proposal', version: 1, kind: 'merge', summary: 's',
      path: '正文/001.md', sourcePath: '正文/001-补.md', targetVersion: 'v7', sourceVersion: 'v3',
    })).toEqual({
      marker: 'dsh-editor.proposal', version: 1, kind: 'merge', summary: 's',
      path: '正文/001.md', sourcePath: '正文/001-补.md',
    })
    expect(parseProposal({
      marker: 'dsh-editor.proposal', version: 1, kind: 'renames', summary: 's',
      renames: [{ from: '正文/001.md', to: '正文/001-改名.md', version: 'v7' }],
    })).toEqual({
      marker: 'dsh-editor.proposal', version: 1, kind: 'renames', summary: 's',
      renames: [{ from: '正文/001.md', to: '正文/001-改名.md' }],
    })
  })
})

describe('prepareSplit / applySplit', () => {
  it('returns preview + version when anchor is unique and newPath is absent', async () => {
    await writeText('正文/002.md', '第一幕开头\n## 第二幕\n第二幕内容')
    const plan = await prepareSplit(filesContext(), splitProposal())
    expect(plan.kind).toBe('split')
    expect(plan.version).toBeTruthy()
    expect(plan.before).toBe('第一幕开头\n')
    expect(plan.after).toBe('## 第二幕\n第二幕内容')
    expect(plan.headChars).toBe(6)
    expect(plan.tailChars).toBe('## 第二幕\n第二幕内容'.length)
  })

  it('rejects when the anchor is missing or ambiguous', async () => {
    await writeText('正文/002.md', '第一幕\n第二幕\n无 anchor')
    await expect(prepareSplit(filesContext(), splitProposal({ anchor: '## 找不到' }))).rejects.toMatchObject({ code: 'AMBIGUOUS' })
    await writeText('正文/002.md', '## 第二幕\n中间\n## 第二幕\n重复 anchor')
    await expect(prepareSplit(filesContext(), splitProposal())).rejects.toMatchObject({ code: 'AMBIGUOUS' })
  })

  it('rejects when the destination path already exists', async () => {
    await writeText('正文/002.md', '前\n## 第二幕\n后')
    await writeText('正文/002b.md', '已存在')
    await expect(prepareSplit(filesContext(), splitProposal())).rejects.toMatchObject({ code: 'EXISTS' })
  })

  it('applySplit writes head back to path and tail to newPath, snapshots path, and rejects stale version', async () => {
    await writeText('正文/002.md', '第一幕\n## 第二幕\n第二幕内容')
    const plan = await prepareSplit(filesContext(), splitProposal())
    const result = await applySplit(filesContext(), splitProposal(), plan.version)
    expect(result.applied).toEqual(['正文/002.md', '正文/002b.md'])
    expect(result.snapshotDir).toMatch(/^\.dsh-editor\/history\//)
    expect(await readRelative('正文/002.md')).toBe('第一幕')
    expect(await readRelative('正文/002b.md')).toBe('## 第二幕\n第二幕内容')
    // 快照里保存的是 apply 之前的原文
    expect(await readHistoryFile(result.snapshotDir, '正文/002.md')).toBe('第一幕\n## 第二幕\n第二幕内容')
    await expect(applySplit(filesContext(), splitProposal(), 'stale-version')).rejects.toMatchObject({ code: 'STALE' })
  })

  it('splits and merges visible TXT files in a custom directory', async () => {
    await writeText('notes/a.txt', '前\n## 第二幕\n后')
    await writeText('notes/b.txt', '附录')
    const split = await prepareSplit(filesContext(), splitProposal({
      path: 'notes/a.txt', newPath: 'notes/a2.txt',
    }))
    const splitResult = await applySplit(filesContext(), splitProposal({
      path: 'notes/a.txt', newPath: 'notes/a2.txt',
    }), split.version)
    expect(splitResult.applied).toEqual(['notes/a.txt', 'notes/a2.txt'])
    expect(await readRelative('notes/a.txt')).toBe('前')
    expect(await readRelative('notes/a2.txt')).toBe('## 第二幕\n后')
    const merge = await prepareMerge(filesContext(), mergeProposal({
      path: 'notes/a.txt', sourcePath: 'notes/b.txt',
    }))
    const mergeResult = await applyMerge(lifecycleAccess(), mergeProposal({
      path: 'notes/a.txt', sourcePath: 'notes/b.txt',
    }), merge.versions)
    expect(mergeResult.applied).toEqual(['notes/a.txt', 'notes/b.txt'])
    expect(await readRelative('notes/a.txt')).toBe('前\n\n附录\n')
  })
})

describe('prepareMerge / applyMerge', () => {
  it('reports versions and char counts for both files', async () => {
    await writeText('正文/010.md', '第十章主文')
    await writeText('正文/010-补.md', '附录内容')
    const plan = await prepareMerge(filesContext(), mergeProposal())
    expect(plan.kind).toBe('merge')
    expect(plan.pathChars).toBe('第十章主文'.length)
    expect(plan.sourceChars).toBe('附录内容'.length)
    expect(plan.versions.path).not.toBe('')
    expect(plan.versions.sourcePath).not.toBe('')
  })

  it('applyMerge concatenates text with a blank line, archives source, and fails on stale versions', async () => {
    await writeText('正文/010.md', '第十章主文\n\n')
    await writeText('正文/010-补.md', '附录内容')
    const plan = await prepareMerge(filesContext(), mergeProposal())
    const result = await applyMerge(lifecycleAccess(), mergeProposal(), plan.versions)
    expect(result.applied).toEqual(['正文/010.md', '正文/010-补.md'])
    expect(result.snapshotDir).toMatch(/^\.dsh-editor\/history\//)
    expect(await readRelative('正文/010.md')).toBe('第十章主文\n\n附录内容\n')
    // 源文件应被归档到 .dsh-editor/archive（正文下文件被移除）
    await expect(fs.stat(path.join(base, '正文/010-补.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    const archiveEntries = await fs.readdir(path.join(base, '.dsh-editor', 'archive'))
    expect(archiveEntries.length).toBe(1)
    // 快照覆盖两个目标
    expect(await readHistoryFile(result.snapshotDir, '正文/010.md')).toBe('第十章主文\n\n')
    expect(await readHistoryFile(result.snapshotDir, '正文/010-补.md')).toBe('附录内容')
  })

  it('applyMerge rejects missing or mismatched expected versions with STALE', async () => {
    await writeText('正文/010.md', '第十章主文')
    await writeText('正文/010-补.md', '附录内容')
    // 缺失 expectedVersions → STALE
    await expect(applyMerge(lifecycleAccess(), mergeProposal(), undefined)).rejects.toMatchObject({ code: 'STALE' })
    // 版本不一致 → STALE
    await expect(applyMerge(lifecycleAccess(), mergeProposal(), { path: 'wrong', sourcePath: 'also-wrong' })).rejects.toMatchObject({ code: 'STALE' })
  })
})

describe('prepareRenames / applyRenames', () => {
  it('prepares same-directory renames and accepts cross-directory pairs in 正文/', async () => {
    await writeText('正文/001.md', '一')
    await writeText('正文/002.md', '二')
    // 跨目录用例：建好源文件 + 目标目录（目标目录里不预先放同名文件，避免污染）
    await writeText('正文/第一部分/003.md', '三')
    await fs.mkdir(path.join(base, '正文/第二部分'), { recursive: true })
    const plan = await prepareRenames(filesContext(), renamesProposal())
    expect(plan.kind).toBe('renames')
    expect(Object.keys(plan.versions)).toEqual(['正文/001.md', '正文/002.md'])
    expect(plan.entries).toHaveLength(2)

    // 跨目录（basename 相同、双方都在 正文/ 之下、目标目录存在）→ 通过
    const crossPlan = await prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: '正文/第一部分/003.md', to: '正文/第二部分/003.md' }],
    }))
    expect(crossPlan.entries).toHaveLength(1)
  })

  it('rejects cross-directory renames that leave 正文/ or change basename', async () => {
    await writeText('正文/001.md', '一')
    // 目标越出 正文/ → INVALID
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: '正文/001.md', to: '大纲/001.md' }],
    }))).rejects.toMatchObject({ code: 'INVALID' })
    // 跨目录 + 改了文件名 → INVALID
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: '正文/第一部分/001.md', to: '正文/第二部分/002.md' }],
    }))).rejects.toMatchObject({ code: 'INVALID' })
    // 跨目录 + 目标目录不存在 → INVALID
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: '正文/001.md', to: '正文/不存在子目录/001.md' }],
    }))).rejects.toMatchObject({ code: 'INVALID' })
  })

  it('rejects when a target name is already taken', async () => {
    await writeText('正文/001.md', '一')
    await writeText('正文/001-改名.md', '已存在')
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: '正文/001.md', to: '正文/001-改名.md' }],
    }))).rejects.toMatchObject({ code: 'EXISTS' })
  })

  it('applyRenames renames in place and reports partial failure without rolling back prior successes', async () => {
    await writeText('正文/001.md', '一')
    await writeText('正文/002.md', '二')
    const plan = await prepareRenames(filesContext(), renamesProposal())
    // 让第二项缺 expectedVersion → 应在第一项成功之后报 failed
    const expected = { '正文/001.md': plan.versions['正文/001.md']! }
    const result = await applyRenames(lifecycleAccess(), renamesProposal(), expected)
    expect(result.applied).toEqual(['正文/001-改名.md'])
    expect(result.failed?.from).toBe('正文/002.md')
    expect(result.failed?.reason).toMatch(/expectedVersions|缺少/)
    // 第一项已落盘
    expect(await readRelative('正文/001-改名.md')).toBe('一')
    // 第二项保持原状
    expect(await readRelative('正文/002.md')).toBe('二')
  })

  it('applyRenames renames all entries when expected versions are all present', async () => {
    await writeText('正文/001.md', '一')
    await writeText('正文/002.md', '二')
    const plan = await prepareRenames(filesContext(), renamesProposal())
    const result = await applyRenames(lifecycleAccess(), renamesProposal(), plan.versions)
    expect(result.applied).toEqual(['正文/001-改名.md', '正文/002-改名.md'])
    expect(result.failed).toBeUndefined()
    expect(result.snapshotDir).toMatch(/^\.dsh-editor\/history\//)
    expect(await readRelative('正文/001-改名.md')).toBe('一')
    expect(await readRelative('正文/002-改名.md')).toBe('二')
    await expect(fs.stat(path.join(base, '正文/001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    // 快照保存了两个 from 的原文
    expect(await readHistoryFile(result.snapshotDir, '正文/001.md')).toBe('一')
    expect(await readHistoryFile(result.snapshotDir, '正文/002.md')).toBe('二')
  })

  it('applyRenames moves cross-directory entries in 正文/ and snapshots every from', async () => {
    await writeText('正文/第一部分/001.md', '第一章正文')
    await writeText('正文/第一部分/002.md', '第二章正文')
    await writeText('正文/第二部分/003.md', '占位')
    const plan = await prepareRenames(filesContext(), renamesProposal({
      renames: [
        { from: '正文/第一部分/001.md', to: '正文/第二部分/001.md' },
        { from: '正文/第一部分/002.md', to: '正文/第二部分/002.md' },
      ],
    }))
    const result = await applyRenames(lifecycleAccess(), renamesProposal({
      renames: [
        { from: '正文/第一部分/001.md', to: '正文/第二部分/001.md' },
        { from: '正文/第一部分/002.md', to: '正文/第二部分/002.md' },
      ],
    }), plan.versions)
    expect(result.applied).toEqual(['正文/第二部分/001.md', '正文/第二部分/002.md'])
    expect(result.failed).toBeUndefined()
    expect(await readRelative('正文/第二部分/001.md')).toBe('第一章正文')
    expect(await readRelative('正文/第二部分/002.md')).toBe('第二章正文')
    await expect(fs.stat(path.join(base, '正文/第一部分/001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(base, '正文/第一部分/002.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    // 占位文件应保留（moveManuscriptDocument 要求目标文件不存在 → 移动后会落在空目录或被同名覆盖；
    // 这里 003.md 还在 第二部分，001.md/002.md 是新增落点，003.md 不受影响）
    expect(await readRelative('正文/第二部分/003.md')).toBe('占位')
    // 快照覆盖所有 from
    expect(await readHistoryFile(result.snapshotDir, '正文/第一部分/001.md')).toBe('第一章正文')
    expect(await readHistoryFile(result.snapshotDir, '正文/第一部分/002.md')).toBe('第二章正文')
  })

  it('applyRenames reports failed when cross-directory basename changes or escapes 正文/', async () => {
    // 跨目录 + 改文件名 → apply 端守门（prepare 也会抛 INVALID，这里直接用 readTextFile 拿 version）
    await writeText('正文/第一部分/001.md', '一')
    const { version } = await readTextFile(filesContext(), '正文/第一部分/001.md')
    const result = await applyRenames(lifecycleAccess(), renamesProposal({
      renames: [{ from: '正文/第一部分/001.md', to: '正文/第二部分/002.md' }],
    }), { '正文/第一部分/001.md': version })
    expect(result.applied).toEqual([])
    expect(result.failed?.from).toBe('正文/第一部分/001.md')
    expect(result.failed?.reason).toMatch(/跨目录|文件名/)
    // 源文件应保持原状
    expect(await readRelative('正文/第一部分/001.md')).toBe('一')

    // 跨目录 + 越出 正文/ → apply 端守门
    await writeText('正文/001.md', '一')
    const { version: v2 } = await readTextFile(filesContext(), '正文/001.md')
    const result2 = await applyRenames(lifecycleAccess(), renamesProposal({
      renames: [{ from: '正文/001.md', to: '大纲/001.md' }],
    }), { '正文/001.md': v2 })
    expect(result2.applied).toEqual([])
    expect(result2.failed?.from).toBe('正文/001.md')
    expect(result2.failed?.reason).toMatch(/跨目录|正文/)
    expect(await readRelative('正文/001.md')).toBe('一')
  })

  it('generic V2 renames move between ordinary directories, including root, nested, TXT, and rename+move', async () => {
    await writeText('notes.md', 'root')
    await writeText('notes/nested/a.txt', 'nested')
    await writeText('drafts/keep.md', 'keep')
    await fs.mkdir(path.join(base, 'archive'), { recursive: true })
    const plan = await prepareRenames(filesContext(), renamesProposal({
      renames: [
        { from: 'notes.md', to: 'drafts/intro.md' },
        { from: 'notes/nested/a.txt', to: 'archive/renamed.txt' },
      ],
    }), 'generic')
    expect(Object.keys(plan.versions)).toEqual(['notes.md', 'notes/nested/a.txt'])
    const result = await applyRenames(lifecycleAccess(), renamesProposal({
      renames: [
        { from: 'notes.md', to: 'drafts/intro.md' },
        { from: 'notes/nested/a.txt', to: 'archive/renamed.txt' },
      ],
    }), plan.versions, 'generic')
    expect(result.applied).toEqual(['drafts/intro.md', 'archive/renamed.txt'])
    expect(result.failed).toBeUndefined()
    expect(await readRelative('drafts/intro.md')).toBe('root')
    expect(await readRelative('archive/renamed.txt')).toBe('nested')
    await expect(fs.stat(path.join(base, 'notes.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(base, 'notes/nested/a.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readRelative('drafts/keep.md')).toBe('keep')
    expect(await readHistoryFile(result.snapshotDir, 'notes.md')).toBe('root')
  })

  it('generic V2 renames keep stale, missing parents, generated, and no-replace checks', async () => {
    await writeText('notes/a.md', '一')
    await writeText('drafts/taken.md', 'occupied')
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: 'notes/a.md', to: 'missing/b.md' }],
    }), 'generic')).rejects.toMatchObject({ code: 'INVALID' })
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: 'notes/a.md', to: 'drafts/taken.md' }],
    }), 'generic')).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: 'notes/a.md', to: 'dist/out.md' }],
    }), 'generic')).rejects.toMatchObject({ code: 'INVALID' })
    const plan = await prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: 'notes/a.md', to: 'drafts/moved.md' }],
    }), 'generic')
    const stale = await applyRenames(lifecycleAccess(), renamesProposal({
      renames: [{ from: 'notes/a.md', to: 'drafts/moved.md' }],
    }), { 'notes/a.md': 'stale-version' }, 'generic')
    expect(stale.applied).toEqual([])
    expect(stale.failed?.from).toBe('notes/a.md')
    expect(await readRelative('notes/a.md')).toBe('一')
    expect(plan.versions['notes/a.md']).toBeTruthy()
  })

  it('legacy V1 renames still refuse leaving 正文/ or changing basename across directories', async () => {
    await writeText('正文/001.md', '一')
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: '正文/001.md', to: '大纲/001.md' }],
    }))).rejects.toMatchObject({ code: 'INVALID' })
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: '正文/001.md', to: 'notes/renamed.md' }],
    }), 'legacy')).rejects.toMatchObject({ code: 'INVALID' })
    expect(() => parseProposal({
      marker: 'dsh-editor.proposal', version: 1, kind: 'renames', summary: 'x',
      renames: [{ from: 'notes/a.txt', to: 'notes/b.txt' }],
    })).toThrow(/Markdown/)
  })

  it('routes generic renames through moveDocument and never uses versionless moveEntry', async () => {
    const source = await fs.readFile(new URL('./proposal-ops.ts', import.meta.url), 'utf8')
    expect(source).toContain('moveDocument')
    expect(source).toContain("mode === 'generic'")
    expect(source).toContain('expectedVersion: version')
    expect(source).not.toMatch(/moveEntry\s*\(/)
    const rpc = await fs.readFile(new URL('./rpc/proposal.ts', import.meta.url), 'utf8')
    expect(rpc).toContain("prepareRenames(files, legacy, 'generic')")
    expect(rpc).toContain("applyRenames(op, legacy, expectedVersions, 'generic')")
    expect(rpc).toMatch(/'proposal\.apply':\s*\{\s*mutation:\s*true/)
  })
})

describe('snapshotProposalTargets', () => {
  it('writes every existing file under .dsh-editor/history/<timestamp>/<相对路径>', async () => {
    await writeText('正文/001.md', '一')
    await writeText('大纲/总纲.md', '总纲内容')
    const before = await listHistorySubdirs()
    const result = await snapshotProposalTargets(filesContext(), ['正文/001.md', '大纲/总纲.md', '正文/不存在.md'])
    expect(result.saved).toEqual(['正文/001.md', '大纲/总纲.md'])
    expect(result.snapshotDir).toMatch(/^\.dsh-editor\/history\//)
    // 新增了一个历史子目录
    const after = await listHistorySubdirs()
    expect(after.length).toBe(before.length + 1)
    expect(after).toContain(result.snapshotDir.replace(/^\.dsh-editor\/history\//, ''))
    expect(await readHistoryFile(result.snapshotDir, '正文/001.md')).toBe('一')
    expect(await readHistoryFile(result.snapshotDir, '大纲/总纲.md')).toBe('总纲内容')
  })

  it('throws ProposalOpsError(IO) and does not write anything when snapshot cannot be created', async () => {
    await writeText('正文/001.md', '一')
    // 把 .dsh-editor 变成普通文件，让 mkdirSafe 失败
    await fs.writeFile(path.join(base, '.dsh-editor'), 'block', 'utf8')
    await expect(snapshotProposalTargets(filesContext(), ['正文/001.md'])).rejects.toMatchObject({ code: 'IO' })
    // 不应产生任何历史目录
    const entries = await listHistorySubdirs()
    expect(entries).toEqual([])
  })
})

describe('apply aborts when snapshot cannot be created', () => {
  it('applySplit throws IO and does not write when the history directory cannot be created', async () => {
    await writeText('正文/002.md', '第一幕\n## 第二幕\n第二幕内容')
    const plan = await prepareSplit(filesContext(), splitProposal())
    await fs.writeFile(path.join(base, '.dsh-editor'), 'block', 'utf8')
    await expect(applySplit(filesContext(), splitProposal(), plan.version)).rejects.toMatchObject({ code: 'IO' })
    // 原文必须保持不变
    expect(await readRelative('正文/002.md')).toBe('第一幕\n## 第二幕\n第二幕内容')
    await expect(fs.stat(path.join(base, '正文/002b.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('applyMerge throws IO and does not write when the history directory cannot be created', async () => {
    await writeText('正文/010.md', '第十章主文')
    await writeText('正文/010-补.md', '附录内容')
    const plan = await prepareMerge(filesContext(), mergeProposal())
    await fs.writeFile(path.join(base, '.dsh-editor'), 'block', 'utf8')
    await expect(applyMerge(lifecycleAccess(), mergeProposal(), plan.versions)).rejects.toMatchObject({ code: 'IO' })
    expect(await readRelative('正文/010.md')).toBe('第十章主文')
    expect(await readRelative('正文/010-补.md')).toBe('附录内容')
    // .dsh-editor 是文件时,POSIX stat 其内部报 ENOTDIR,Windows 报 ENOENT
    await expect(fs.stat(path.join(base, '.dsh-editor', 'archive'))).rejects.toThrowError(/ENOENT|ENOTDIR/)
  })

  it('applyRenames throws IO and does not rename when the history directory cannot be created', async () => {
    await writeText('正文/001.md', '一')
    const plan = await prepareRenames(filesContext(), renamesProposal({
      renames: [{ from: '正文/001.md', to: '正文/001-改名.md' }],
    }))
    await fs.writeFile(path.join(base, '.dsh-editor'), 'block', 'utf8')
    await expect(applyRenames(lifecycleAccess(), renamesProposal({
      renames: [{ from: '正文/001.md', to: '正文/001-改名.md' }],
    }), plan.versions)).rejects.toMatchObject({ code: 'IO' })
    // 原文应保持不变
    expect(await readRelative('正文/001.md')).toBe('一')
    await expect(fs.stat(path.join(base, '正文/001-改名.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

it('rejects missing split parents before truncating any source', async () => {
  await writeText('正文/002.md', '前\n## 第二幕\n后')
  const proposal = splitProposal({ newPath: '正文/missing/b.md' })
  await expect(prepareSplit(filesContext(), proposal)).rejects.toThrow()
  const version = (await readTextFile(filesContext(), proposal.path)).version
  await expect(applySplit(filesContext(), proposal, version)).rejects.toThrow()
  expect(await readRelative(proposal.path)).toBe('前\n## 第二幕\n后')
})
it('preserves the complete source if creating the split tail fails', async () => {
  await writeText('正文/002.md', '前\n## 第二幕\n后')
  const files = filesContext(), proposal = splitProposal()
  const prepared = await prepareSplit(files, proposal)
  const write = files.fs.writeText.bind(files.fs)
  files.fs.writeText = async (...args) => { if(args[0].targetKey.endsWith('002b.md')) throw new Error('disk full'); return write(...args) }
  await expect(applySplit(files, proposal, prepared.version)).rejects.toThrow()
  expect(await readRelative(proposal.path)).toBe('前\n## 第二幕\n后')
})
it('reports partial split and keeps the tail if the source write fails', async () => {
  await writeText('正文/002.md', '前\n## 第二幕\n后')
  const files = filesContext(), proposal = splitProposal()
  const prepared = await prepareSplit(files, proposal)
  const write = files.fs.writeText.bind(files.fs)
  files.fs.writeText = async (...args) => { if(args[0].targetKey === path.join(base,proposal.path)) throw new Error('write denied'); return write(...args) }
  await expect(applySplit(files, proposal, prepared.version)).rejects.toMatchObject({recovery:{partial:true,appliedPaths:[proposal.newPath]}})
  expect(await readRelative(proposal.path)).toBe('前\n## 第二幕\n后')
  expect(await readRelative(proposal.newPath)).toBe('## 第二幕\n后')
})
it('reports the committed target when source archiving fails during merge', async () => {
  await writeText('正文/010.md', 'target')
  await writeText('正文/010-补.md', 'source')
  const files = filesContext(), proposal = mergeProposal()
  const prepared = await prepareMerge(files,proposal)
  const access: LifecycleAccess = {path:base,rootKey:base,mode:'workspace-write',files,moveNoReplace:async()=>{throw new Error('move denied')}}
  await expect(applyMerge(access,proposal,prepared.versions)).rejects.toMatchObject({recovery:{partial:true,appliedPaths:[proposal.path]}})
  expect(await readRelative(proposal.path)).toBe('target\n\nsource\n')
  expect(await readRelative(proposal.sourcePath)).toBe('source')
})


describe('V2 generation baselines on split/merge/renames', () => {
  it('rejects split/merge/renames when the target moved from v7 to v8 before prepare', async () => {
    await writeText('正文/002.md', '第一幕\n## 第二幕\n后')
    const splitV7 = (await readTextFile(filesContext(), '正文/002.md')).version
    await writeText('正文/002.md', '第一幕改了\n## 第二幕\n后')
    await expect(prepareSplit(filesContext(), splitProposal({ targetVersion: splitV7 }))).rejects.toMatchObject({ code: 'STALE' })

    await writeText('正文/010.md', '第十章主文')
    await writeText('正文/010-补.md', '附录内容')
    const mergeTargetV7 = (await readTextFile(filesContext(), '正文/010.md')).version
    const mergeSourceV7 = (await readTextFile(filesContext(), '正文/010-补.md')).version
    await writeText('正文/010.md', '第十章主文改了')
    await expect(prepareMerge(filesContext(), mergeProposal({
      targetVersion: mergeTargetV7,
      sourceVersion: mergeSourceV7,
    }))).rejects.toMatchObject({ code: 'STALE' })
    await writeText('正文/010.md', '第十章主文')
    await writeText('正文/010-补.md', '附录改了')
    await expect(prepareMerge(filesContext(), mergeProposal({
      targetVersion: (await readTextFile(filesContext(), '正文/010.md')).version,
      sourceVersion: mergeSourceV7,
    }))).rejects.toMatchObject({ code: 'STALE' })

    await writeText('正文/001.md', '一')
    await writeText('正文/002.md', '二')
    const renameV7 = (await readTextFile(filesContext(), '正文/001.md')).version
    await writeText('正文/001.md', '一改了')
    await expect(prepareRenames(filesContext(), renamesProposal({
      renames: [
        { from: '正文/001.md', to: '正文/001-改名.md', version: renameV7 },
        { from: '正文/002.md', to: '正文/002-改名.md', version: (await readTextFile(filesContext(), '正文/002.md')).version },
      ],
    }))).rejects.toMatchObject({ code: 'STALE' })
  })

  it('applies unchanged V2 split/merge/renames and rejects a target change between prepare and apply', async () => {
    await writeText('正文/002.md', '第一幕\n## 第二幕\n后')
    const splitVersion = (await readTextFile(filesContext(), '正文/002.md')).version
    const split = splitProposal({ targetVersion: splitVersion })
    const splitPlan = await prepareSplit(filesContext(), split)
    expect(splitPlan.version).toBe(splitVersion)
    const splitApplied = await applySplit(filesContext(), split, splitPlan.version)
    expect(splitApplied.applied).toEqual(['正文/002.md', '正文/002b.md'])

    await writeText('正文/010.md', '第十章主文')
    await writeText('正文/010-补.md', '附录内容')
    const merge = mergeProposal({
      targetVersion: (await readTextFile(filesContext(), '正文/010.md')).version,
      sourceVersion: (await readTextFile(filesContext(), '正文/010-补.md')).version,
    })
    const mergePlan = await prepareMerge(filesContext(), merge)
    const mergeApplied = await applyMerge(lifecycleAccess(), merge, mergePlan.versions)
    expect(mergeApplied.applied).toEqual(['正文/010.md', '正文/010-补.md'])

    await writeText('正文/003.md', '三')
    const renameVersion = (await readTextFile(filesContext(), '正文/003.md')).version
    const rename = { marker: 'dsh-editor.proposal' as const, version: 1 as const, kind: 'renames' as const, summary: '改名', renames: [{ from: '正文/003.md', to: '正文/003-改名.md', version: renameVersion }] }
    const renamePlan = await prepareRenames(filesContext(), rename)
    const renameApplied = await applyRenames(lifecycleAccess(), rename, renamePlan.versions)
    expect(renameApplied.applied).toEqual(['正文/003-改名.md'])

    await writeText('正文/004.md', '四\n## 第二幕\n尾')
    const racedVersion = (await readTextFile(filesContext(), '正文/004.md')).version
    const raced = splitProposal({ path: '正文/004.md', newPath: '正文/004b.md', targetVersion: racedVersion })
    const racedPlan = await prepareSplit(filesContext(), raced)
    await writeText('正文/004.md', '四改了\n## 第二幕\n尾')
    const racedCurrent = (await readTextFile(filesContext(), '正文/004.md')).version
    await expect(applySplit(filesContext(), raced, racedPlan.version)).rejects.toMatchObject({ code: 'STALE' })
    await expect(applySplit(filesContext(), raced, racedCurrent)).rejects.toMatchObject({ code: 'STALE' })
    expect(await readRelative('正文/004.md')).toBe('四改了\n## 第二幕\n尾')

    await writeText('正文/011.md', '目标')
    await writeText('正文/011-补.md', '来源')
    const mergeRace = mergeProposal({
      path: '正文/011.md',
      sourcePath: '正文/011-补.md',
      targetVersion: (await readTextFile(filesContext(), '正文/011.md')).version,
      sourceVersion: (await readTextFile(filesContext(), '正文/011-补.md')).version,
    })
    const mergeRacePlan = await prepareMerge(filesContext(), mergeRace)
    await writeText('正文/011.md', '目标改了')
    const mergeCurrent = (await readTextFile(filesContext(), '正文/011.md')).version
    await expect(applyMerge(lifecycleAccess(), mergeRace, mergeRacePlan.versions)).rejects.toMatchObject({ code: 'STALE' })
    await expect(applyMerge(lifecycleAccess(), mergeRace, {
      path: mergeCurrent,
      sourcePath: mergeRacePlan.versions.sourcePath,
    })).rejects.toMatchObject({ code: 'STALE' })
    expect(await readRelative('正文/011.md')).toBe('目标改了')

    await writeText('正文/005.md', '五')
    const renameRaceVersion = (await readTextFile(filesContext(), '正文/005.md')).version
    const renameRace = {
      marker: 'dsh-editor.proposal' as const,
      version: 1 as const,
      kind: 'renames' as const,
      summary: '改名',
      renames: [{ from: '正文/005.md', to: '正文/005-改名.md', version: renameRaceVersion }],
    }
    const renameRacePlan = await prepareRenames(filesContext(), renameRace)
    await writeText('正文/005.md', '五改了')
    const renameCurrent = (await readTextFile(filesContext(), '正文/005.md')).version
    await expect(applyRenames(lifecycleAccess(), renameRace, renameRacePlan.versions)).rejects.toMatchObject({ code: 'STALE' })
    await expect(applyRenames(lifecycleAccess(), renameRace, { '正文/005.md': renameCurrent })).rejects.toMatchObject({ code: 'STALE' })
    expect(await readRelative('正文/005.md')).toBe('五改了')
  })
})

describe('author planning proposals', () => {
  const create = (pathValue: string, text = '# 内容\n') => ({ marker: 'dsh-editor.proposal' as const, version: 1 as const, kind: 'create' as const, summary: '创建资料', path: pathValue, text })

  it('previews missing ancestors without writing, then creates a nested file in one apply', async () => {
    const files = filesContext()
    const proposal = create('人物卡/主角/沈砚.md')
    expect(await prepareCreate(files, proposal)).toEqual({ kind: 'create', applicable: true, version: '', missingDirectories: ['人物卡', '人物卡/主角'] })
    await expect(fs.stat(path.join(base, '人物卡'))).rejects.toMatchObject({ code: 'ENOENT' })
    const receipt = await applyCreate(files, proposal, '')
    expect(receipt).toMatchObject({ path: proposal.path, operation: 'create' })
    expect(await readRelative(proposal.path)).toBe(proposal.text)
    await expect(applyCreate(files, proposal, '')).rejects.toMatchObject({ code: 'EXISTS' })
  })

  it('refuses a blocked parent and permits retry of the same proposal after the parent is repaired', async () => {
    const files = filesContext()
    const proposal = create('世界书/城市.md')
    await fs.writeFile(path.join(base, '世界书'), 'blocking file')
    await expect(prepareCreate(files, proposal)).rejects.toMatchObject({ code: 'NOT_DIRECTORY' })
    await fs.unlink(path.join(base, '世界书'))
    await applyCreate(files, proposal, (await prepareCreate(files, proposal)).version)
    expect(await readRelative(proposal.path)).toBe(proposal.text)
  })

  it('V2 exclusive create refuses an existing empty file and a TOCTOU create', async () => {
    const files = filesContext()
    await writeText('正文/占位.md', ' ')
    const empty = { marker: 'dsh-editor.proposal' as const, version: 1 as const, kind: 'create' as const, summary: '创建资料', path: '正文/占位.md', text: '# 内容\n', writingV2: WRITING_V2_CREATE }
    await expect(prepareCreate(files, empty)).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(applyCreate(files, empty, '')).rejects.toMatchObject({ code: 'EXISTS' })
    expect(await readRelative(empty.path)).toBe(' ')

    const absent = { ...empty, path: '正文/新章.md' }
    const prepared = await prepareCreate(files, absent)
    expect(prepared).toEqual({ kind: 'create', applicable: true, version: '', missingDirectories: [] })
    await writeText(absent.path, '作者刚写的正文')
    await expect(applyCreate(files, absent, prepared.version)).rejects.toMatchObject({ code: 'EXISTS' })
    expect(await readRelative(absent.path)).toBe('作者刚写的正文')
  })

  it('pins empty-file versions and refuses files created or edited after preview', async () => {
    const files = filesContext()
    const proposal = create('正文/占位.md')
    const absent = await prepareCreate(files, proposal)
    await writeText(proposal.path, ' ')
    await expect(applyCreate(files, proposal, absent.version)).rejects.toMatchObject({ code: 'STALE' })
    const blank = await prepareCreate(files, proposal)
    await writeText(proposal.path, '作者刚写的正文')
    await expect(applyCreate(files, proposal, blank.version)).rejects.toMatchObject({ code: 'EXISTS' })
    expect(await readRelative(proposal.path)).toBe('作者刚写的正文')
  })

  it('does not create directories in read-only workspaces or follow a replaced symlink parent', async () => {
    const files = filesContext()
    const proposal = create('人物卡/沈砚.md')
    await expect(applyCreate({ ...files, policy: { ...files.policy, mode: 'read-only' } }, proposal, '')).rejects.toMatchObject({ code: 'DENIED' })
    await expect(fs.stat(path.join(base, '人物卡'))).rejects.toMatchObject({ code: 'ENOENT' })
    await prepareCreate(files, proposal)
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-proposal-outside-'))
    try {
      await fs.symlink(outside, path.join(base, '人物卡'), process.platform === 'win32' ? 'junction' : 'dir')
      await expect(applyCreate(files, proposal, '')).rejects.toMatchObject({ code: 'SYMLINK' })
      await expect(fs.stat(path.join(outside, '沈砚.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.unlink(path.join(base, '人物卡'))
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('applies plan and summary independently while preserving body and unrelated frontmatter', async () => {
    const files = filesContext()
    const target = '正文/001.md'
    const body = '# 第一章\n\n作者正文：铜钱。\n'
    await writeText(target, '---\ncustom: keep-me\nstate:\n  now: 旧状态\n---\n' + body)
    const source = await readTextFile(files, target)
    const proposal = { marker: 'dsh-editor.proposal' as const, version: 1 as const, kind: 'chapter_plan' as const, summary: '采用章纲', path: target, sourceVersion: source.version, beats: ['下山', '吃面'] }
    const preview = await prepareChapterMeta(files, proposal)
    expect(preview).toMatchObject({ before: '', after: '1. 下山\n2. 吃面' })
    expect(await readRelative(target)).toBe(source.text)
    await applyChapterProposal(files, proposal, preview.version)
    const planned = await readTextFile(files, target)
    expect(parseChapterMeta(planned.text)).toMatchObject({ beats: ['下山', '吃面'], state: { now: '旧状态' } })
    expect(stripChapterFrontmatter(planned.text)).toBe(body)
    expect(planned.text).toContain('custom: keep-me')
    const summary = { marker: proposal.marker, version: proposal.version, kind: 'chapter_summary' as const, summary: '记录实际结尾', path: target, sourceVersion: planned.version, state: { now: '读信', open: '师叔下落' } }
    const prepared = await prepareChapterMeta(files, summary)
    expect(prepared.after).toContain('未了结：师叔下落')
    await applyChapterProposal(files, summary, prepared.version)
    const final = await readRelative(target)
    expect(parseChapterMeta(final)).toEqual({ beats: ['下山', '吃面'], state: summary.state })
    expect(final).toContain('custom: keep-me')
    expect(stripChapterFrontmatter(final)).toBe(body)
  })

  it('rejects a summary generated from old text before preview and after preview', async () => {
    const files = filesContext()
    const target = '正文/001.md'
    await writeText(target, '# 第一章\n旧正文')
    const source = await readTextFile(files, target)
    const proposal = { marker: 'dsh-editor.proposal' as const, version: 1 as const, kind: 'chapter_summary' as const, summary: '小结', path: target, sourceVersion: source.version, state: { now: '旧结尾' } }
    const prepared = await prepareChapterMeta(files, proposal)
    const updated = '# 第一章\n作者已改变本章结局，不能采用旧总结。'
    await writeText(target, updated)
    await expect(prepareChapterMeta(files, proposal)).rejects.toMatchObject({ code: 'STALE' })
    await expect(applyChapterProposal(files, proposal, prepared.version)).rejects.toMatchObject({ code: 'STALE' })
    expect(await readRelative(target)).toBe(updated)
  })

  it('validates chapter target, source version, field boundaries and limits before IO', () => {
    const baseProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'chapter_plan', path: '正文/001.md', summary: '章纲', sourceVersion: 'v1', beats: ['出山'] }
    expect(parsePlanningProposal(baseProposal)).toMatchObject({ kind: 'chapter_plan', beats: ['出山'] })
    for (const patch of [{ path: '../正文/001.md' }, { path: '大纲/001.md' }, { sourceVersion: '' }, { beats: ['x'.repeat(121)] }, { state: {} }]) {
      expect(() => parsePlanningProposal({ ...baseProposal, ...patch })).toThrow()
    }
    expect(() => parsePlanningProposal({ ...create('.dsh-editor/secret.md') })).toThrow()
    expect(() => parsePlanningProposal({ marker: 'dsh-editor.proposal', version: 1, kind: 'chapter_summary', path: '正文/001.md', summary: '小结', sourceVersion: 'v1', state: { extra: '不能改任意字段' } })).toThrow()
  })
})


it('recovers the same create proposal after directory creation but before a failed file write', async () => {
  const files = filesContext()
  const proposal = { marker: 'dsh-editor.proposal' as const, version: 1 as const, kind: 'create' as const, path: '资料/第一卷/大纲.md', text: '# 大纲', summary: '创建大纲' }
  const write = files.fs.writeText.bind(files.fs)
  files.fs.writeText = async () => { throw Object.assign(new Error('injected failure'), { code: 'FS_PERMISSION_DENIED' }) }
  await expect(applyCreate(files, proposal, '')).rejects.toMatchObject({ code: 'DENIED', message: expect.stringContaining('部分目录可能已建立') })
  expect((await fs.stat(path.join(base, '资料/第一卷'))).isDirectory()).toBe(true)
  await expect(fs.stat(path.join(base, proposal.path))).rejects.toMatchObject({ code: 'ENOENT' })
  files.fs.writeText = write
  const retried = await prepareCreate(files, proposal)
  expect(retried.missingDirectories).toEqual([])
  await applyCreate(files, proposal, retried.version)
  expect(await readRelative(proposal.path)).toBe(proposal.text)
})

it('does not replay a create after a reply is lost following the actual file write', async () => {
  const files = filesContext()
  const proposal = { marker: 'dsh-editor.proposal' as const, version: 1 as const, kind: 'create' as const, path: '世界书/城市.md', text: '# 城市', summary: '创建城市设定' }
  const write = files.fs.writeText.bind(files.fs)
  let writes = 0
  files.fs.writeText = async (...args) => { writes++; await write(...args); throw new Error('reply lost') }
  await expect(applyCreate(files, proposal, '')).rejects.toMatchObject({ code: 'IO' })
  await expect(prepareCreate(files, proposal)).rejects.toMatchObject({ code: 'EXISTS' })
  await expect(applyCreate(files, proposal, '')).rejects.toMatchObject({ code: 'EXISTS' })
  expect(writes).toBe(1)
  expect(await readRelative(proposal.path)).toBe(proposal.text)
})
