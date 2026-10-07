/** Protocol-independent split, merge, and rename file operations. */
import type { OperationRecovery } from '../contracts.ts'
import path from 'node:path'
import { createTextFile, FileOpError, findUniqueIndex, listDirStrict, readTextFile, writeTextFile, type WorkspaceFileContext } from 'dsh-manuscript/host-api'
import { LifecycleError, archiveDocument, type LifecycleAccess } from '../lifecycle/lifecycle.ts'
import { mkdirSafe as mkdirSafeWalk } from '../kit/entries.ts'

const PREVIEW_CHARS = 200
const HISTORY_DIRECTORY = '.dsh-editor/history'

export type ProposalRename = { from: string; to: string; version?: string }
export type SplitProposal = {
  kind: 'split'
  path: string
  anchor: string
  newPath: string
  targetVersion?: string
}
export type MergeProposal = {
  kind: 'merge'
  path: string
  sourcePath: string
  targetVersion?: string
  sourceVersion?: string
}
export type RenameOperation = ProposalRename & {
  assertAllowed?: () => void
  relocate: (access: LifecycleAccess, expectedVersion: string) => Promise<{ path: string; version: string }>
}
export type RenamesProposal = { kind: 'renames'; renames: RenameOperation[] }

export type SplitPlan = {
  kind: 'split'
  version: string
  before: string
  after: string
  headChars: number
  tailChars: number
}

export type MergePlan = {
  kind: 'merge'
  versions: { path: string; sourcePath: string }
  pathChars: number
  sourceChars: number
}

export type RenamesPlan = {
  kind: 'renames'
  versions: Record<string, string>
  entries: ProposalRename[]
}

export class ProposalOpsError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID' | 'STALE' | 'AMBIGUOUS' | 'EXISTS' | 'NOT_FOUND' | 'IO',
    options?: ErrorOptions,
    readonly recovery?: OperationRecovery,
  ) {
    super(message, options)
    this.name = 'ProposalOpsError'
  }
}

function findAnchor(text: string, anchor: string): number {
  return findUniqueIndex(text, anchor)
}

function assertGenerationBaseline(pathValue: string, actual: string, expected: string | undefined): void {
  if (expected !== undefined && actual !== expected) {
    throw new ProposalOpsError(`${pathValue} 已被修改`, 'STALE')
  }
}

function preview(value: string, limit: number): string {
  if (value.length <= limit) return value
  return value.slice(0, limit)
}

/**
 * 把 paths 列出的已存在文件原文写入 .dsh-editor/history/<timestamp>/<原相对路径>，
 * 作为 apply 后悔药。任一文件读/写失败抛 ProposalOpsError('IO') 中止。
 * 同一快照目录在一次 apply 调用内共享 timestamp，重复调用会得到不同时间戳。
 */
export async function snapshotProposalTargets(
  files: WorkspaceFileContext,
  paths: readonly string[],
): Promise<{ snapshotDir: string; saved: string[] }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotDir = `${HISTORY_DIRECTORY}/${stamp}`
  const saved: string[] = []
  for (const relative of paths) {
    let text: string
    try {
      const loaded = await readTextFile(files, relative)
      text = loaded.text
    } catch (error) {
      if (error instanceof FileOpError && error.code === 'NOT_FOUND') continue
      throw new ProposalOpsError(`快照 ${relative} 读取失败`, 'IO', { cause: error })
    }
    const destination = `${snapshotDir}/${relative}`
    try {
      await mkdirSafe(files.cwd, path.posix.dirname(destination))
      await createTextFile(files, destination, text)
    } catch (error) {
      throw new ProposalOpsError(`快照 ${relative} 写入失败`, 'IO', { cause: error })
    }
    saved.push(relative)
  }
  return { snapshotDir, saved }
}

/** 逐级 mkdir，且拒绝 symlink / 越界——参照 snapshot.ts 的 mkdirSafe。 */
export async function mkdirSafe(root: string, relative: string): Promise<void> {
  await mkdirSafeWalk(root, relative, (kind) => {
    if (kind === 'unsafe-root') return new ProposalOpsError('工作目录不安全', 'IO')
    if (kind === 'unsafe-dir') return new ProposalOpsError('快照目录不安全', 'IO')
    return new ProposalOpsError('快照目录越界', 'IO')
  })
}

/** split：读 path，校验 anchor 唯一、newPath 不存在，返回 200 字预览。 */
export async function prepareSplit(files: WorkspaceFileContext, proposal: SplitProposal): Promise<SplitPlan> {
  const loaded = await safeRead(files, proposal.path)
  assertGenerationBaseline(proposal.path, loaded.version, proposal.targetVersion)
  const anchorAt = findAnchor(loaded.text, proposal.anchor)
  if (anchorAt === -1) throw new ProposalOpsError(`split.anchor 在 ${proposal.path} 中未出现`, 'AMBIGUOUS')
  if (anchorAt === -2) throw new ProposalOpsError(`split.anchor 在 ${proposal.path} 中出现多次`, 'AMBIGUOUS')
  await listDirStrict(files, path.posix.dirname(proposal.newPath))
  await assertAbsent(files, proposal.newPath)
  const head = loaded.text.slice(0, anchorAt)
  const tail = loaded.text.slice(anchorAt)
  return {
    kind: 'split',
    version: loaded.version,
    before: preview(head, PREVIEW_CHARS),
    after: preview(tail, PREVIEW_CHARS),
    headChars: head.length,
    tailChars: tail.length,
  }
}

/** split apply：先快照 path，再重读校验 version + anchor 唯一性，写 head 回 path、tail 到 newPath。 */
export async function applySplit(
  files: WorkspaceFileContext,
  proposal: SplitProposal,
  expectedVersion: string,
): Promise<{ applied: [string, string]; snapshotDir: string }> {
  if (!expectedVersion) throw new ProposalOpsError('apply 需要 expectedVersions[path]', 'STALE')
  const { snapshotDir } = await snapshotProposalTargets(files, [proposal.path])
  const loaded = await safeRead(files, proposal.path)
  assertGenerationBaseline(proposal.path, loaded.version, proposal.targetVersion)
  if (loaded.version !== expectedVersion) throw new ProposalOpsError(`${proposal.path} 已被修改`, 'STALE')
  const anchorAt = findAnchor(loaded.text, proposal.anchor)
  if (anchorAt === -1) throw new ProposalOpsError(`split.anchor 在 ${proposal.path} 中已不存在`, 'AMBIGUOUS')
  if (anchorAt === -2) throw new ProposalOpsError(`split.anchor 在 ${proposal.path} 中出现多次`, 'AMBIGUOUS')
  await assertAbsent(files, proposal.newPath)
  const head = loaded.text.slice(0, anchorAt).trimEnd()
  const tail = loaded.text.slice(anchorAt)
  // Preserve the complete source until the second document is durable.
  await listDirStrict(files, path.posix.dirname(proposal.newPath))
  await createTextFile(files, proposal.newPath, tail)
  try {
    await writeTextFile(files, proposal.path, head, expectedVersion)
  } catch (error) {
    throw new ProposalOpsError('拆章未完成：后半稿已另存，原稿请核对后再处理。', 'IO', { cause: error }, {
      partial: true, appliedPaths: [proposal.newPath], recoveryPath: snapshotDir,
    })
  }
  return { applied: [proposal.path, proposal.newPath], snapshotDir }
}

/** merge：读两侧文件，回报各自 version 与字符数。 */
export async function prepareMerge(files: WorkspaceFileContext, proposal: MergeProposal): Promise<MergePlan> {
  const [pathLoaded, sourceLoaded] = await Promise.all([safeRead(files, proposal.path), safeRead(files, proposal.sourcePath)])
  assertGenerationBaseline(proposal.path, pathLoaded.version, proposal.targetVersion)
  assertGenerationBaseline(proposal.sourcePath, sourceLoaded.version, proposal.sourceVersion)
  return {
    kind: 'merge',
    versions: { path: pathLoaded.version, sourcePath: sourceLoaded.version },
    pathChars: pathLoaded.text.length,
    sourceChars: sourceLoaded.text.length,
  }
}

/** merge apply：先快照 path / sourcePath，再合并写回 path，然后 archiveDocument 归档 sourcePath。 */
export async function applyMerge(
  access: LifecycleAccess,
  proposal: MergeProposal,
  expectedVersions: { path?: string; sourcePath?: string } | undefined,
): Promise<{ applied: [string, string]; snapshotDir: string }> {
  const expectedPathVersion = expectedVersions?.path
  const expectedSourceVersion = expectedVersions?.sourcePath
  if (!expectedPathVersion || !expectedSourceVersion) throw new ProposalOpsError('apply 需要 path 与 sourcePath 的 expectedVersions', 'STALE')
  const { snapshotDir } = await snapshotProposalTargets(access.files, [proposal.path, proposal.sourcePath])
  const [pathLoaded, sourceLoaded] = await Promise.all([
    safeRead(access.files, proposal.path),
    safeRead(access.files, proposal.sourcePath),
  ])
  assertGenerationBaseline(proposal.path, pathLoaded.version, proposal.targetVersion)
  assertGenerationBaseline(proposal.sourcePath, sourceLoaded.version, proposal.sourceVersion)
  if (pathLoaded.version !== expectedPathVersion) throw new ProposalOpsError(`${proposal.path} 已被修改`, 'STALE')
  if (sourceLoaded.version !== expectedSourceVersion) throw new ProposalOpsError(`${proposal.sourcePath} 已被修改`, 'STALE')
  const merged = `${pathLoaded.text.trimEnd()}\n\n${sourceLoaded.text.trim()}\n`
  await writeTextFile(access.files, proposal.path, merged, expectedPathVersion)
  try {
    const archive = await archiveDocument({ access, path: proposal.sourcePath, expectedVersion: expectedSourceVersion })
    if (archive.state !== 'archived') throw new Error('source archive did not complete')
  } catch (error) {
    throw new ProposalOpsError('合章未完成：目标已写入，来源归档未完成，请先核对作品。', 'IO', { cause: error }, {
      partial: true, appliedPaths: [proposal.path], recoveryPath: error instanceof LifecycleError && error.recoveryPath ? error.recoveryPath : snapshotDir,
    })
  }
  return { applied: [proposal.path, proposal.sourcePath], snapshotDir }
}

/** Inspect destinations and source versions for already-adapted lifecycle actions. */
export async function prepareRenames(
  files: WorkspaceFileContext,
  proposal: RenamesProposal,
): Promise<RenamesPlan> {
  const versions: Record<string, string> = {}
  for (const entry of proposal.renames) {
    entry.assertAllowed?.()
    const targetDirectory = path.posix.dirname(entry.to)
    try {
      await listDirStrict(files, targetDirectory)
    } catch (error) {
      if (error instanceof FileOpError && error.code === 'NOT_FOUND') {
        throw new ProposalOpsError(`renames 项 ${entry.from} → ${entry.to} 的目标目录 ${targetDirectory} 不存在`, 'INVALID')
      }
      throw new ProposalOpsError(`读取 ${targetDirectory} 失败`, 'IO', { cause: error })
    }
    const loaded = await safeRead(files, entry.from)
    assertGenerationBaseline(entry.from, loaded.version, entry.version)
    versions[entry.from] = loaded.version
    await assertAbsent(files, entry.to)
  }
  return {
    kind: 'renames', versions,
    entries: proposal.renames.map(({ from, to, version }) => ({ from, to, ...(version === undefined ? {} : { version }) })),
  }
}

/** Snapshot first; stop at the first failed action and report the completed paths. */
export async function applyRenames(
  access: LifecycleAccess,
  proposal: RenamesProposal,
  expectedVersions: Record<string, string> | undefined,
): Promise<{ applied: string[]; failed?: { from: string; reason: string }; snapshotDir: string }> {
  const expected = expectedVersions ?? {}
  const { snapshotDir } = await snapshotProposalTargets(access.files, proposal.renames.map((entry) => entry.from))
  for (const entry of proposal.renames) {
    if (entry.version === undefined) continue
    const loaded = await safeRead(access.files, entry.from)
    assertGenerationBaseline(entry.from, loaded.version, entry.version)
  }
  const applied: string[] = []
  for (const entry of proposal.renames) {
    const version = expected[entry.from]
    if (!version) return { applied, failed: { from: entry.from, reason: '缺少 expectedVersions' }, snapshotDir }
    try {
      entry.assertAllowed?.()
      const result = await entry.relocate(access, version)
      applied.push(result.path)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { applied, failed: { from: entry.from, reason }, snapshotDir }
    }
  }
  return { applied, snapshotDir }
}

async function safeRead(files: WorkspaceFileContext, relative: string): Promise<{ text: string; version: string }> {
  try {
    return await readTextFile(files, relative)
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') {
      throw new ProposalOpsError(`${relative} 不存在`, 'NOT_FOUND', { cause: error })
    }
    if (error instanceof FileOpError && error.code === 'STALE') {
      throw new ProposalOpsError(`${relative} 已被修改`, 'STALE', { cause: error })
    }
    throw new ProposalOpsError(`读取 ${relative} 失败`, 'IO', { cause: error })
  }
}

async function assertAbsent(files: WorkspaceFileContext, relative: string): Promise<void> {
  try {
    await readTextFile(files, relative)
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') return
    throw new ProposalOpsError(`读取 ${relative} 失败`, 'IO', { cause: error })
  }
  throw new ProposalOpsError(`${relative} 已存在`, 'EXISTS')
}
