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

async function assertNotSymlink(abs: string): Promise<void> {
  let st
  try {
    st = await fs.lstat(abs)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    throw new ScaffoldError('stat failed', 'IO')
  }
  if (st.isSymbolicLink()) {
    throw new ScaffoldError('symlinked path components are not allowed', 'SYMLINK')
  }
}

async function assertContainedExisting(abs: string, label: string): Promise<void> {
  await assertNotSymlink(abs)
  let st
  try {
    st = await fs.lstat(abs)
  } catch {
    throw new ScaffoldError(`${label} does not exist`, 'NO_WORKSPACE')
  }
  if (st.isSymbolicLink()) throw new ScaffoldError('symlinked path components are not allowed', 'SYMLINK')
  if (!st.isDirectory()) throw new ScaffoldError(`${label} is not a directory`, 'NOT_DIRECTORY')
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
  await assertContainedExisting(cwdAbs, 'session cwd')
  await assertContainedExisting(workspaceRoot, 'workspace root')

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

  await assertNotSymlink(rootAbs)
  try {
    const st = await fs.lstat(rootAbs)
    if (st.isSymbolicLink()) throw new ScaffoldError('symlinked path components are not allowed', 'SYMLINK')
    if (!st.isDirectory()) throw new ScaffoldError('target is not a directory', 'NOT_DIRECTORY')
    record(rootAbs, 'skipped')
  } catch (error) {
    if (error instanceof ScaffoldError || error instanceof PathConfineError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw new ScaffoldError('stat failed', 'IO')
    throwIfAborted(options.signal)
    await fs.mkdir(rootAbs, { recursive: true })
    record(rootAbs, 'created')
  }

  for (const dir of SCAFFOLD_DIRECTORIES) {
    throwIfAborted(options.signal)
    const abs = confinePath(rootAbs, dir)
    await assertNotSymlink(abs)
    try {
      const st = await fs.lstat(abs)
      if (st.isSymbolicLink()) throw new ScaffoldError('symlinked path components are not allowed', 'SYMLINK')
      if (!st.isDirectory()) throw new ScaffoldError(`${dir} exists and is not a directory`, 'NOT_DIRECTORY')
      record(abs, 'skipped')
    } catch (error) {
      if (error instanceof ScaffoldError || error instanceof PathConfineError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw new ScaffoldError('stat failed', 'IO')
      await fs.mkdir(abs, { recursive: false })
      record(abs, 'created')
    }
  }

  for (const [rel, body] of Object.entries(SCAFFOLD_FILES)) {
    throwIfAborted(options.signal)
    const abs = confinePath(rootAbs, rel)
    await assertNotSymlink(abs)
    try {
      await fs.writeFile(abs, body, { encoding: 'utf8', flag: 'wx' })
      record(abs, 'created')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        record(abs, 'skipped')
        continue
      }
      throw new ScaffoldError(`failed to write ${rel}`, 'IO')
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
