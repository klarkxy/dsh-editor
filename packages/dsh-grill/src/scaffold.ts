import fs from 'node:fs/promises'
import path from 'node:path'
import { confinePath, PathConfineError, toPosixRelative } from './paths.ts'

export class ScaffoldError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_WORKSPACE' | 'READ_ONLY' | 'SYMLINK' | 'NOT_DIRECTORY' | 'CANCELLED' | 'IO',
  ) {
    super(message)
    this.name = 'ScaffoldError'
  }
}

export type ScaffoldResult = {
  root: string
  created: string[]
  skipped: string[]
}

export const SCAFFOLD_DIRECTORIES = ['正文', '大纲', '人物卡', '世界书'] as const

export const SCAFFOLD_FILES: Record<string, string> = {
  '项目总览.md': `# 项目总览

## 项目名称
## 作品形态
## 当前目标
## 核心体验
## 事实边界
## 已确认不写
`,
  '大纲/总纲.md': `# 总纲

## 长期欲望
## 核心矛盾
## 卷/章走向
## 未决问题
`,
  '人物卡/人物索引.md': `# 人物索引

| 名称 | 欲望 | 关系 | 知情边界 |
| --- | --- | --- | --- |
`,
  '世界书/设定总汇.md': `# 设定总汇

## 已确认
## 草稿
## 开放缺口
`,
}

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access' | string

export type ScaffoldOptions = {
  cwd: string
  target?: string
  mode?: SandboxMode
  workspaceRoot?: string
  signal?: AbortSignal
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ScaffoldError('cancelled', 'CANCELLED')
}

async function lstatOptional(abs: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.lstat(abs)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw new ScaffoldError('stat failed', 'IO')
  }
}

function assertLexicallyContained(root: string, target: string): void {
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathConfineError('path escapes workspace')
  }
}

/**
 * Verify every existing component from the sandbox root to `target`. The
 * canonical check catches junctions/reparse points that resolve outside the
 * root, while lstat makes links inside the root fail closed as well.
 */
async function assertSafeExistingPath(root: string, target: string, label: string, requireDirectory = false): Promise<void> {
  assertLexicallyContained(root, target)
  const rootState = await lstatOptional(root)
  if (!rootState) throw new ScaffoldError('workspace root does not exist', 'NO_WORKSPACE')
  if (rootState.isSymbolicLink()) throw new ScaffoldError('symlinked path components are not allowed', 'SYMLINK')
  if (!rootState.isDirectory()) throw new ScaffoldError('workspace root is not a directory', 'NOT_DIRECTORY')

  const relative = path.relative(root, target)
  const parts = relative ? relative.split(path.sep).filter(Boolean) : []
  let cursor = root
  let state = rootState
  for (let index = 0; index < parts.length; index++) {
    if (!state.isDirectory()) throw new ScaffoldError(`${label} is not a directory`, 'NOT_DIRECTORY')
    cursor = path.join(cursor, parts[index])
    state = await lstatOptional(cursor) as import('node:fs').Stats
    if (!state) throw new ScaffoldError(`${label} does not exist`, 'NO_WORKSPACE')
    if (state.isSymbolicLink()) throw new ScaffoldError('symlinked path components are not allowed', 'SYMLINK')
  }
  if (requireDirectory && !state.isDirectory()) throw new ScaffoldError(`${label} is not a directory`, 'NOT_DIRECTORY')

  let canonicalRoot: string
  let canonicalTarget: string
  try {
    canonicalRoot = await fs.realpath(root)
    canonicalTarget = await fs.realpath(target)
  } catch {
    throw new ScaffoldError('failed to resolve workspace path', 'IO')
  }
  assertLexicallyContained(canonicalRoot, canonicalTarget)
}

async function ensureSafeDirectory(root: string, target: string, label: string, signal?: AbortSignal): Promise<boolean> {
  assertLexicallyContained(root, target)
  const relative = path.relative(root, target)
  const parts = relative ? relative.split(path.sep).filter(Boolean) : []
  let cursor = root
  let created = false
  await assertSafeExistingPath(root, root, 'workspace root', true)

  for (const part of parts) {
    throwIfAborted(signal)
    const parent = cursor
    cursor = path.join(cursor, part)
    const state = await lstatOptional(cursor)
    if (state) {
      if (state.isSymbolicLink()) throw new ScaffoldError('symlinked path components are not allowed', 'SYMLINK')
      if (!state.isDirectory()) throw new ScaffoldError(`${label} is not a directory`, 'NOT_DIRECTORY')
    } else {
      await assertSafeExistingPath(root, parent, `${label} parent`, true)
      try {
        await fs.mkdir(cursor)
        created = true
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') throw new ScaffoldError(`failed to create ${label}`, 'IO')
      }
    }
    await assertSafeExistingPath(root, cursor, label, true)
  }
  return created
}

async function createSafeFile(root: string, target: string, body: string, label: string, signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal)
  const parent = path.dirname(target)
  await assertSafeExistingPath(root, parent, `${label} parent`, true)
  const existing = await lstatOptional(target)
  if (existing) {
    if (existing.isSymbolicLink()) throw new ScaffoldError('symlinked path components are not allowed', 'SYMLINK')
    return false
  }
  try {
    await fs.writeFile(target, body, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST') throw new ScaffoldError(`failed to write ${label}`, 'IO')
    const raced = await lstatOptional(target)
    if (raced?.isSymbolicLink()) throw new ScaffoldError('symlinked path components are not allowed', 'SYMLINK')
    if (raced) return false
    throw new ScaffoldError(`failed to write ${label}`, 'IO')
  }
  await assertSafeExistingPath(root, target, label)
  return true
}

/**
 * Create the reduced novel tree under the session workspace. Existing paths
 * are skipped and never overwritten. Directories use confined Node mkdir
 * because DSH `ctx.fs` has no mkdir.
 */
export async function scaffoldNovel(options: ScaffoldOptions): Promise<ScaffoldResult> {
  throwIfAborted(options.signal)
  const cwd = options.cwd?.trim() ?? ''
  if (!cwd) throw new ScaffoldError('live session workspace cwd is required', 'NO_WORKSPACE')

  const mode = options.mode ?? 'workspace-write'
  if (mode === 'read-only') {
    throw new ScaffoldError('sandbox is read-only', 'READ_ONLY')
  }

  const workspaceRoot = path.resolve(options.workspaceRoot || cwd)
  const cwdAbs = confinePath(workspaceRoot, path.relative(workspaceRoot, path.resolve(cwd)) || '.')
  await assertSafeExistingPath(workspaceRoot, cwdAbs, 'session cwd', true)

  const targetRel = options.target?.trim() ? options.target : '.'
  const rootAbs = confinePath(cwdAbs, targetRel)
  const rootRelToWorkspace = path.relative(workspaceRoot, rootAbs)
  if (rootRelToWorkspace.startsWith('..') || path.isAbsolute(rootRelToWorkspace)) {
    throw new PathConfineError('path escapes workspace')
  }

  const created: string[] = []
  const skipped: string[] = []

  const record = (abs: string, kind: 'created' | 'skipped') => {
    const rel = toPosixRelative(rootAbs, abs)
    if (kind === 'created') created.push(rel)
    else skipped.push(rel)
  }

  if (await ensureSafeDirectory(workspaceRoot, rootAbs, 'target', options.signal)) {
    record(rootAbs, 'created')
  } else {
    record(rootAbs, 'skipped')
  }

  for (const dir of SCAFFOLD_DIRECTORIES) {
    const abs = confinePath(rootAbs, dir)
    if (await ensureSafeDirectory(workspaceRoot, abs, dir, options.signal)) {
      record(abs, 'created')
    } else {
      record(abs, 'skipped')
    }
  }

  for (const [rel, body] of Object.entries(SCAFFOLD_FILES)) {
    const abs = confinePath(rootAbs, rel)
    if (await createSafeFile(workspaceRoot, abs, body, rel, options.signal)) {
      record(abs, 'created')
    } else {
      record(abs, 'skipped')
    }
  }

  created.sort()
  skipped.sort()
  return {
    root: toPosixRelative(cwdAbs, rootAbs),
    created,
    skipped,
  }
}
