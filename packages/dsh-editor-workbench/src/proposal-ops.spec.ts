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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
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
      path: '正文/001.md', anchor: '## x', newPath: '正文/001b.md',
    }).kind).toBe('split')
    expect(parseProposal({
      marker: 'dsh-editor.proposal', version: 1, kind: 'merge', summary: 's',
      path: '正文/001.md', sourcePath: '正文/001-补.md',
    }).kind).toBe('merge')
    expect(parseProposal({
      marker: 'dsh-editor.proposal', version: 1, kind: 'renames', summary: 's',
      renames: [{ from: '正文/001.md', to: '正文/001-改名.md' }],
    }).kind).toBe('renames')
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
    await expect(fs.stat(path.join(base, '.dsh-editor', 'archive'))).rejects.toMatchObject({ code: 'ENOENT' })
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
