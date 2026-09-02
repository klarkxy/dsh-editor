import fs from 'node:fs/promises'
import os from 'node:os'
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

/** 新建作品只预建正文目录;大纲/人物卡/世界书等由用户或搭档实际创建后再出现。 */
export const PROJECT_DIRECTORIES = ['正文'] as const
export const NOVEL_INDEX_DIRECTORY = '.dsh-editor'
export const NOVEL_INDEX_PATH = `${NOVEL_INDEX_DIRECTORY}/作品索引.md`

export type ProjectInitResult = { created: string[]; skipped: string[] }
export type ProjectInspection = { hasVisibleEntries: boolean; textFiles: string[] }

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

/** Default `文档/dsh-editor`. `DSH_EDITOR_PROJECTS_ROOT` isolates e2e from the real Documents folder. */
export function defaultProjectsRoot(): string {
  const override = process.env.DSH_EDITOR_PROJECTS_ROOT?.trim()
  if (override) return path.resolve(override)
  return path.join(os.homedir(), 'Documents', 'dsh-editor')
}

function projectHomeName(title: string): string {
  const name = title.trim()
  if (
    !name
    || name.length > 80
    || name.startsWith('.')
    || /[<>:"/\\|?*\u0000-\u001f]/.test(name)
    || /[. ]$/.test(name)
    || WINDOWS_DEVICE_NAME.test(name)
  ) throw new ProjectInitError('project name is invalid', 'INVALID_PATH')
  return name
}

export async function createProjectHome(input: {
  root: string
  title: string
  signal?: AbortSignal
}): Promise<{ path: string }> {
  throwIfAborted(input.signal)
  const name = projectHomeName(input.title)
  const parent = path.resolve(input.root)
  const target = path.join(parent, name)
  if (path.dirname(target) !== parent) throw new ProjectInitError('project name is invalid', 'INVALID_PATH')
  try {
    await fs.mkdir(parent, { recursive: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') throw new ProjectInitError('project folder is read-only', 'READ_ONLY', { cause: error })
    throw new ProjectInitError('failed to create project folder', 'IO', { cause: error })
  }
  throwIfAborted(input.signal)
  try {
    await fs.mkdir(target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new ProjectInitError('project folder already exists', 'EXISTS', { cause: error })
    if (code === 'EACCES' || code === 'EPERM') throw new ProjectInitError('project folder is read-only', 'READ_ONLY', { cause: error })
    throw new ProjectInitError('failed to create project folder', 'IO', { cause: error })
  }
  await assertDirectory(target, 'project folder')
  return { path: target }
}

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

export async function inspectProjectRoot(rootPath: string, signal?: AbortSignal): Promise<ProjectInspection> {
  throwIfAborted(signal)
  const root = path.resolve(rootPath)
  await assertDirectory(root, 'project folder')
  const queue = ['']
  const textFiles: string[] = []
  let hasVisibleEntries = false
  while (queue.length) {
    throwIfAborted(signal)
    const relativeDirectory = queue.shift()!
    const directory = relativeDirectory ? path.join(root, ...relativeDirectory.split('/')) : root
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      throw new ProjectInitError('failed to inspect project folder', 'IO', { cause: error })
    }
    for (const entry of entries) {
      if (!relativeDirectory && entry.name !== NOVEL_INDEX_DIRECTORY) hasVisibleEntries = true
      if (entry.name.startsWith('.')) continue
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isDirectory()) queue.push(relative)
      else if (entry.isFile() && /\.(?:md|txt)$/i.test(entry.name)) textFiles.push(relative)
    }
  }
  textFiles.sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }))
  return { hasVisibleEntries, textFiles }
}

export async function initializeProject(input: {
  root: string
  mode: string
  newProject?: boolean
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
