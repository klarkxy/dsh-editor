import type { OperationRecovery } from './contracts.ts'
/**
 * 新提案 kind（split / merge / renames）的 prepare / apply 实现。
 *
 * 设计说明：
 *   - 复用了与 import / context 一致的 readTextFile / writeTextFile /
 *     createTextFile；archive / rename 则需 LifecycleAccess，
 *     统一在 dispatch 层（src/index.ts）解析好 access 传入。
 *   - split：anchor 必须在 path 文件中恰好出现一次；newPath 必须不存在；
 *     apply 时先重读校验 version + anchor 唯一性，再把 head 写回 path、
 *     tail 落到 newPath。before/after 是各 200 字预览。
 *   - merge：合并文本 = path.trimEnd() + '\n\n' + source.trim() + '\n'；
 *     写回 path 后用 archiveDocument 归档 sourcePath。
 *   - renames：
 *       * V1 legacy：同目录用 renameDocument；跨目录要求 basename 相同且
 *         from / to 都在 正文/ 之下，落到 moveManuscriptDocument。
 *       * V2 generic：任意普通目录间可同时改名+移动，目标父目录必须已存在、
 *         no-replace，落到带 expectedVersion 的 moveDocument；不可用无版本
 *         moveEntry。外层 RPC mutation 持有 workspace write queue。
 *   - apply 之前会先用 snapshotProposalTargets 把目标文件原文写入
 *     .dsh-editor/history/<timestamp>/<原相对路径> 作为统一后悔药；
 *     任一快照失败抛 ProposalOpsError('IO') 中止本次 apply。
 *   - 抛 ProposalOpsError，dispatch 层在 mapEditorFilesError 里映射为
 *     WorkbenchRpcResult；不直接抛 FileOpError / LifecycleError 以避免
 *     误把它们当文件层问题上报。
 *   - edit / create 仍走内核 manuscript 通道，parseProposal 收到这两种
 *     kind 直接抛 INVALID（INVALID 不是 INVALID_PATH 命名冲突）。
 */
import path from 'node:path'
import { createTextFile, FileOpError, findUniqueIndex, listDirStrict, readTextFile, writeTextFile, type WorkspaceFileContext } from 'dsh-manuscript/host-api'
import { LifecycleError, archiveDocument, moveDocument, moveManuscriptDocument, renameDocument, type LifecycleAccess } from './lifecycle.ts'
import { mkdirSafe as mkdirSafeWalk } from './kit/entries.ts'

const PROPOSAL_MARKER = 'dsh-editor.proposal'
const PROPOSAL_VERSION = 1
const PROPOSAL_KINDS = ['split', 'merge', 'renames'] as const
const PREVIEW_CHARS = 200
const MAX_RENAMES = 50
const HISTORY_DIRECTORY = '.dsh-editor/history'
const MANUSCRIPT_ROOT = '正文/'
const GENERATED_DIRECTORIES = new Set(['build', 'coverage', 'dist', 'node_modules', 'out', 'target'])

export type RenamesMode = 'legacy' | 'generic'

export type ProposalKind = (typeof PROPOSAL_KINDS)[number]
export type ProposalRename = { from: string; to: string; version?: string }

export type SplitProposal = {
  marker: typeof PROPOSAL_MARKER
  version: typeof PROPOSAL_VERSION
  kind: 'split'
  summary: string
  path: string
  anchor: string
  newPath: string
  targetVersion?: string
}

export type MergeProposal = {
  marker: typeof PROPOSAL_MARKER
  version: typeof PROPOSAL_VERSION
  kind: 'merge'
  summary: string
  path: string
  sourcePath: string
  targetVersion?: string
  sourceVersion?: string
}

export type RenamesProposal = {
  marker: typeof PROPOSAL_MARKER
  version: typeof PROPOSAL_VERSION
  kind: 'renames'
  summary: string
  renames: ProposalRename[]
}

export type Proposal = SplitProposal | MergeProposal | RenamesProposal

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

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  return value.replace(/\\/g, '/')
}

function isMarkdownRelative(value: string): boolean {
  if (!value || value.startsWith('/') || /^[a-z]:/i.test(value) || value.includes('\0') || value.includes(':')) return false
  if (value.split('/').includes('..') || value.split('/').some((part) => part.startsWith('.'))) return false
  return /\.md$/i.test(value)
}

function isVisibleTextRelative(value: string): boolean {
  if (!value || value.startsWith('/') || /^[a-z]:/i.test(value) || value.includes('\0') || value.includes(':')) return false
  const parts = value.split('/')
  if (parts.includes('..') || parts.some((part) => part.startsWith('.'))) return false
  if (parts.some((part) => GENERATED_DIRECTORIES.has(part.toLocaleLowerCase()))) return false
  return /\.(md|txt)$/i.test(value)
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

function isManuscriptPath(value: string): boolean {
  return value === MANUSCRIPT_ROOT.slice(0, -1) || value.startsWith(MANUSCRIPT_ROOT)
}

function crossDirectoryEligible(from: string, to: string): boolean {
  return path.posix.basename(from) === path.posix.basename(to)
    && isManuscriptPath(from)
    && isManuscriptPath(to)
}

/** 解析并校验请求中的 proposal。edit / create 不归 workbench 处理：报 INVALID。 */
export function parseProposal(value: unknown): Proposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProposalOpsError('proposal 必须是非数组对象', 'INVALID')
  }
  const row = value as Record<string, unknown>
  if (row.marker !== PROPOSAL_MARKER) throw new ProposalOpsError(`proposal.marker 必须是 ${PROPOSAL_MARKER}`, 'INVALID')
  if (row.version !== PROPOSAL_VERSION) throw new ProposalOpsError(`proposal.version 必须是 ${PROPOSAL_VERSION}`, 'INVALID')
  const summary = cleanString(row.summary)
  if (!summary) throw new ProposalOpsError('proposal.summary 是必填摘要', 'INVALID')
  const kind = row.kind
  if (typeof kind !== 'string' || !(PROPOSAL_KINDS as readonly string[]).includes(kind)) {
    throw new ProposalOpsError(`proposal.kind 必须是 ${PROPOSAL_KINDS.join(' / ')}；edit / create 请走 manuscript 通道`, 'INVALID')
  }
  if (kind === 'split') {
    const pathValue = normalizePath(row.path)
    const newPath = normalizePath(row.newPath)
    const anchor = typeof row.anchor === 'string' ? row.anchor : ''
    if (!isMarkdownRelative(pathValue)) throw new ProposalOpsError('split.path 必须是项目相对 Markdown 路径', 'INVALID')
    if (!isMarkdownRelative(newPath)) throw new ProposalOpsError('split.newPath 必须是项目相对 Markdown 路径', 'INVALID')
    if (newPath === pathValue) throw new ProposalOpsError('split.newPath 不能与 path 相同', 'INVALID')
    if (!anchor.trim()) throw new ProposalOpsError('split.anchor 必填', 'INVALID')
    return { marker: PROPOSAL_MARKER, version: PROPOSAL_VERSION, kind: 'split', summary, path: pathValue, anchor, newPath }
  }
  if (kind === 'merge') {
    const pathValue = normalizePath(row.path)
    const sourcePath = normalizePath(row.sourcePath)
    if (!isMarkdownRelative(pathValue)) throw new ProposalOpsError('merge.path 必须是项目相对 Markdown 路径', 'INVALID')
    if (!isMarkdownRelative(sourcePath)) throw new ProposalOpsError('merge.sourcePath 必须是项目相对 Markdown 路径', 'INVALID')
    if (sourcePath === pathValue) throw new ProposalOpsError('merge.sourcePath 不能与 path 相同', 'INVALID')
    return { marker: PROPOSAL_MARKER, version: PROPOSAL_VERSION, kind: 'merge', summary, path: pathValue, sourcePath }
  }
  // renames
  if (!Array.isArray(row.renames)) throw new ProposalOpsError('renames.renames 必须是数组', 'INVALID')
  if (row.renames.length < 1 || row.renames.length > MAX_RENAMES) {
    throw new ProposalOpsError(`renames.renames 需要 1-${MAX_RENAMES} 项`, 'INVALID')
  }
  const entries: ProposalRename[] = []
  const seen = new Set<string>()
  for (const entry of row.renames) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ProposalOpsError('renames 项必须为对象', 'INVALID')
    const from = normalizePath((entry as Record<string, unknown>).from)
    const to = normalizePath((entry as Record<string, unknown>).to)
    if (!isMarkdownRelative(from) || !isMarkdownRelative(to)) {
      throw new ProposalOpsError('renames 项必须为项目相对 Markdown 路径', 'INVALID')
    }
    if (from === to) throw new ProposalOpsError(`renames 项 ${from} 不能原地改名`, 'INVALID')
    if (seen.has(from) || seen.has(to)) throw new ProposalOpsError('renames 项不能重叠', 'INVALID')
    seen.add(from)
    seen.add(to)
    entries.push({ from, to })
  }
  return { marker: PROPOSAL_MARKER, version: PROPOSAL_VERSION, kind: 'renames', summary, renames: entries }
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

/**
 * renames prepare：legacy 同目录 / 正文内同名跨目录；generic 任意普通目录、可同时改名。
 * 目标父目录必须已存在。逐项校验 from 存在、to 不存在。
 */
export async function prepareRenames(
  files: WorkspaceFileContext,
  proposal: RenamesProposal,
  mode: RenamesMode = 'legacy',
): Promise<RenamesPlan> {
  const versions: Record<string, string> = {}
  for (const entry of proposal.renames) {
    if (mode === 'generic' && (!isVisibleTextRelative(entry.from) || !isVisibleTextRelative(entry.to))) {
      throw new ProposalOpsError(
        `renames 项 ${entry.from} → ${entry.to} 必须是可见的项目相对 Markdown 或 TXT，且不能指向隐藏或生成目录`,
        'INVALID',
      )
    }
    const sameDir = path.posix.dirname(entry.from) === path.posix.dirname(entry.to)
    if (!sameDir) {
      if (mode === 'legacy' && !crossDirectoryEligible(entry.from, entry.to)) {
        throw new ProposalOpsError(
          `renames 项 ${entry.from} → ${entry.to} 跨目录需满足：文件名相同且双方都在 ${MANUSCRIPT_ROOT} 之下`,
          'INVALID',
        )
      }
      const targetDirectory = path.posix.dirname(entry.to)
      try {
        await listDirStrict(files, targetDirectory)
      } catch (error) {
        if (error instanceof FileOpError && error.code === 'NOT_FOUND') {
          throw new ProposalOpsError(`renames 项 ${entry.from} → ${entry.to} 的目标目录 ${targetDirectory} 不存在`, 'INVALID')
        }
        throw new ProposalOpsError(`读取 ${targetDirectory} 失败`, 'IO', { cause: error })
      }
    }
    const loaded = await safeRead(files, entry.from)
    assertGenerationBaseline(entry.from, loaded.version, entry.version)
    versions[entry.from] = loaded.version
    await assertAbsent(files, entry.to)
  }
  return { kind: 'renames', versions, entries: proposal.renames }
}

/**
 * renames apply：先快照所有 from。legacy 同目录用 renameDocument，正文内跨目录用
 * moveManuscriptDocument；generic 一律走带 expectedVersion 的 moveDocument。
 * 任一项失败立即回报已成功的路径与失败项，不回滚。
 */
export async function applyRenames(
  access: LifecycleAccess,
  proposal: RenamesProposal,
  expectedVersions: Record<string, string> | undefined,
  mode: RenamesMode = 'legacy',
): Promise<{ applied: string[]; failed?: { from: string; reason: string }; snapshotDir: string }> {
  const expected = expectedVersions ?? {}
  const froms = proposal.renames.map((entry) => entry.from)
  const { snapshotDir } = await snapshotProposalTargets(access.files, froms)
  for (const entry of proposal.renames) {
    if (entry.version === undefined) continue
    const loaded = await safeRead(access.files, entry.from)
    assertGenerationBaseline(entry.from, loaded.version, entry.version)
  }
  const applied: string[] = []
  for (const entry of proposal.renames) {
    const version = expected[entry.from]
    if (!version) return { applied, failed: { from: entry.from, reason: '缺少 expectedVersions' }, snapshotDir }
    if (mode === 'generic') {
      try {
        const result = await moveDocument({ access, path: entry.from, targetPath: entry.to, expectedVersion: version })
        applied.push(result.path)
        continue
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return { applied, failed: { from: entry.from, reason }, snapshotDir }
      }
    }
    const sameDir = path.posix.dirname(entry.from) === path.posix.dirname(entry.to)
    if (sameDir) {
      try {
        const result = await renameDocument({ access, path: entry.from, newName: path.posix.basename(entry.to), expectedVersion: version })
        applied.push(result.path)
        continue
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return { applied, failed: { from: entry.from, reason }, snapshotDir }
      }
    }
    if (!crossDirectoryEligible(entry.from, entry.to)) {
      return { applied, failed: { from: entry.from, reason: `跨目录改名需满足：文件名相同且双方都在 ${MANUSCRIPT_ROOT} 之下` }, snapshotDir }
    }
    try {
      const result = await moveManuscriptDocument({ access, path: entry.from, targetDirectory: path.posix.dirname(entry.to), expectedVersion: version })
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
