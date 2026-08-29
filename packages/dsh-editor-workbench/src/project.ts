import fs from 'node:fs/promises'
import path from 'node:path'

export class ProjectInitError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'SYMLINK' | 'NOT_DIRECTORY' | 'CANCELLED' | 'IO' | 'INVALID_PATH' | 'EXISTS',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ProjectInitError'
  }
}

export const PROJECT_DIRECTORIES = ['正文', '大纲', '人物卡', '世界书'] as const
export const NOVEL_INDEX_DIRECTORY = '.dsh-editor'
export const NOVEL_INDEX_PATH = `${NOVEL_INDEX_DIRECTORY}/作品索引.md`

export const PROJECT_FILES: Readonly<Record<string, string>> = {
  '项目总览.md': `# 项目总览

## 项目名称

## 核心构想

## 当前进度
`,
  '大纲/总纲.md': `# 总纲

## 故事主线

## 分卷与章节

## 待确认问题
`,
  '人物卡/人物索引.md': `# 人物索引

| 名称 | 身份 | 欲望 | 关系 | 知情边界 |
| --- | --- | --- | --- | --- |
`,
  '世界书/设定总汇.md': `# 设定总汇

## 已确认设定

## 暂定设定

## 连续性提醒
`,
}

export type ProjectInitResult = { created: string[]; skipped: string[] }

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProjectInitError('operation cancelled', 'CANCELLED')
}

async function lstatOptional(target: string): Promise<import('node:fs').Stats | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new ProjectInitError('failed to inspect project path', 'IO', { cause: error })
  }
}

async function assertDirectory(target: string, label: string): Promise<void> {
  const state = await lstatOptional(target)
  if (!state) throw new ProjectInitError(`${label} does not exist`, 'IO')
  if (state.isSymbolicLink()) throw new ProjectInitError(`${label} cannot be a symbolic link`, 'SYMLINK')
  if (!state.isDirectory()) throw new ProjectInitError(`${label} must be a directory`, 'NOT_DIRECTORY')
}

async function ensureDirectory(root: string, relative: string, signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal)
  await assertDirectory(root, 'project folder')
  let cursor = root
  let created = false
  for (const part of relative.split('/').filter(Boolean)) {
    cursor = path.join(cursor, part)
    const state = await lstatOptional(cursor)
    if (state) {
      if (state.isSymbolicLink()) throw new ProjectInitError(`${relative} cannot be a symbolic link`, 'SYMLINK')
      if (!state.isDirectory()) throw new ProjectInitError(`${relative} must be a directory`, 'NOT_DIRECTORY')
    } else {
      try {
        await fs.mkdir(cursor)
        created = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw new ProjectInitError(`failed to create ${relative}`, 'IO', { cause: error })
        }
      }
      await assertDirectory(cursor, relative)
    }
  }
  return created
}

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function manuscriptGroupName(relative: string): string {
  const normalized = relative.replace(/\\/g, '/')
  const match = /^正文\/([^/]+)$/.exec(normalized)
  const name = match?.[1] ?? ''
  if (
    !name
    || name !== name.trim()
    || name.length > 80
    || name.startsWith('.')
    || /[<>:"/\\|?*\u0000-\u001f]/.test(name)
    || /[. ]$/.test(name)
    || WINDOWS_DEVICE_NAME.test(name)
  ) throw new ProjectInitError('manuscript group name is invalid', 'INVALID_PATH')
  return name
}

/** Create one visible volume/part directly below 正文 without touching its contents. */
export async function createManuscriptGroup(input: {
  root: string
  mode: string
  relative: string
  signal?: AbortSignal
}): Promise<{ path: string }> {
  if (input.mode === 'read-only') throw new ProjectInitError('project folder is read-only', 'READ_ONLY')
  throwIfAborted(input.signal)
  const root = path.resolve(input.root)
  const name = manuscriptGroupName(input.relative)
  await assertDirectory(root, 'project folder')
  const manuscriptRoot = path.join(root, '正文')
  await assertDirectory(manuscriptRoot, 'manuscript folder')
  const target = path.join(manuscriptRoot, name)
  const state = await lstatOptional(target)
  if (state) {
    if (state.isSymbolicLink()) throw new ProjectInitError('manuscript group cannot be a symbolic link', 'SYMLINK')
    throw new ProjectInitError('manuscript group already exists', 'EXISTS')
  }
  try {
    await fs.mkdir(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ProjectInitError('manuscript group already exists', 'EXISTS', { cause: error })
    }
    throw new ProjectInitError('failed to create manuscript group', 'IO', { cause: error })
  }
  await assertDirectory(target, 'manuscript group')
  return { path: `正文/${name}` }
}

async function createFile(root: string, relative: string, text: string, signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal)
  const target = path.join(root, ...relative.split('/'))
  await assertDirectory(path.dirname(target), `${relative} parent`)
  const state = await lstatOptional(target)
  if (state) {
    if (state.isSymbolicLink()) throw new ProjectInitError(`${relative} cannot be a symbolic link`, 'SYMLINK')
    if (!state.isFile()) throw new ProjectInitError(`${relative} must be a regular file`, 'NOT_DIRECTORY')
    return false
  }
  try {
    await fs.writeFile(target, text, { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw new ProjectInitError(`failed to create ${relative}`, 'IO', { cause: error })
  }
}

async function containsMarkdown(directory: string, signal?: AbortSignal): Promise<boolean> {
  const queue = [directory]
  while (queue.length) {
    throwIfAborted(signal)
    const current = queue.shift()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (error) {
      throw new ProjectInitError('failed to inspect chapter folder', 'IO', { cause: error })
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new ProjectInitError('chapter folder cannot contain symbolic links', 'SYMLINK')
      if (entry.isDirectory()) queue.push(path.join(current, entry.name))
      if (entry.isFile() && /\.md$/i.test(entry.name)) return true
    }
  }
  return false
}

export async function initializeProject(input: {
  root: string
  mode: string
  newProject: boolean
  signal?: AbortSignal
}): Promise<ProjectInitResult> {
  if (input.mode === 'read-only') throw new ProjectInitError('project folder is read-only', 'READ_ONLY')
  throwIfAborted(input.signal)
  const root = path.resolve(input.root)
  await assertDirectory(root, 'project folder')
  const created: string[] = []
  const skipped: string[] = []
  const record = (relative: string, didCreate: boolean) => (didCreate ? created : skipped).push(relative)

  for (const directory of PROJECT_DIRECTORIES) {
    record(directory, await ensureDirectory(root, directory, input.signal))
  }
  for (const [relative, text] of Object.entries(PROJECT_FILES)) {
    record(relative, await createFile(root, relative, text, input.signal))
  }
  if (input.newProject) {
    const chapterRoot = path.join(root, '正文')
    if (await containsMarkdown(chapterRoot, input.signal)) skipped.push('正文/001.md')
    else record('正文/001.md', await createFile(root, '正文/001.md', '# 第一章\n\n', input.signal))
  }
  created.sort()
  skipped.sort()
  return { created, skipped }
}

export async function prepareNovelIndex(input: {
  root: string
  mode: string
  signal?: AbortSignal
}): Promise<ProjectInitResult> {
  if (input.mode === 'read-only') throw new ProjectInitError('project folder is read-only', 'READ_ONLY')
  throwIfAborted(input.signal)
  const root = path.resolve(input.root)
  await assertDirectory(root, 'project folder')
  const created: string[] = []
  const skipped: string[] = []
  const record = (relative: string, didCreate: boolean) => (didCreate ? created : skipped).push(relative)
  record(NOVEL_INDEX_DIRECTORY, await ensureDirectory(root, NOVEL_INDEX_DIRECTORY, input.signal))
  record(NOVEL_INDEX_PATH, await createFile(
    root,
    NOVEL_INDEX_PATH,
    '# 作品索引\n\n> 正在由 DSH Agent 初始化。\n',
    input.signal,
  ))
  return { created, skipped }
}
