import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceFileContext } from './files.ts'
import { createTextFile, FileOpError, listDirStrict, readTextFile, writeTextFile } from './files.ts'
import { normalizeWorkspaceRelative } from './paths.ts'

export const ARCHIVE_DIRECTORY = '.dsh-editor/archive'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const RECORD_DIRECTORY = /^\d{8}T\d{6}-[0-9a-f-]{36}$/i
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export type LifecycleAccess = {
  path: string
  rootKey: string
  mode: string
  files: WorkspaceFileContext
  moveNoReplace?: (source: string, target: string, signal?: AbortSignal) => Promise<void>
}

type ArchiveState = 'moving' | 'archived' | 'restoring' | 'restored'
type ArchiveManifest = {
  version: 1
  archiveId: string
  recordDirectory: string
  rootKey: string
  state: ArchiveState
  originalPath: string
  payloadPath: string
  createdAt: string
  originalVersion: string
  bytes: number
  sha256: string
  restoredAt?: string
  recordHash: string
}

type StoredManifest = { manifest: ArchiveManifest; version: string }
type LoadedText = { text: string; version: string; bytes: number; sha256: string }

export type ArchiveView = {
  archiveId: string
  path: string
  createdAt: string
  bytes: number
  state: 'archived' | 'pending-archive' | 'pending-restore' | 'restored' | 'blocked'
  version?: string
  message?: string
}

export type ArchiveListView = {
  items: ArchiveView[]
  invalid: number
}

export class LifecycleError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'INVALID_PATH' | 'NOT_FOUND' | 'EXISTS' | 'STALE' | 'BLOCKED' | 'UNSUPPORTED' | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LifecycleError'
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function normal(value: string): string {
  return value.split(path.sep).join('/')
}

function assertWritable(access: LifecycleAccess): void {
  if (access.mode === 'read-only') throw new LifecycleError('workspace is read-only', 'READ_ONLY')
}

function authorPath(value: string): string {
  let relative: string
  try {
    relative = normalizeWorkspaceRelative(value)
  } catch (error) {
    throw new LifecycleError('document path is invalid', 'INVALID_PATH', { cause: error })
  }
  if (relative !== value.replace(/\\/g, '/')
    || relative === '.'
    || relative.split('/').some((part) => part.startsWith('.'))
    || !/\.(md|txt)$/i.test(relative)) {
    throw new LifecycleError('only visible Markdown or TXT documents can be managed', 'INVALID_PATH')
  }
  return relative
}

function safeNewName(value: string, extension: string): string {
  if (typeof value !== 'string') throw new LifecycleError('new document name is invalid', 'INVALID_PATH')
  let name = value.trim()
  if (name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())) name = name.slice(0, -extension.length).trim()
  if (!name
    || name.startsWith('.')
    || name.length > 120
    || /[<>:"/\\|?*\u0000-\u001f]/.test(name)
    || /[. ]$/.test(name)
    || RESERVED_NAME.test(name)) {
    throw new LifecycleError('new document name is invalid', 'INVALID_PATH')
  }
  return `${name}${extension}`
}

function manuscriptDocument(value: string): string {
  const relative = authorPath(value)
  if (!relative.startsWith('正文/')) throw new LifecycleError('only manuscript documents can be moved', 'INVALID_PATH')
  return relative
}

function manuscriptDirectory(value: string): string {
  let relative: string
  try {
    relative = normalizeWorkspaceRelative(value)
  } catch (error) {
    throw new LifecycleError('manuscript directory is invalid', 'INVALID_PATH', { cause: error })
  }
  if (relative !== value.replace(/\\/g, '/')
    || (relative !== '正文' && !relative.startsWith('正文/'))
    || relative.split('/').some((part) => part.startsWith('.'))) {
    throw new LifecycleError('manuscript directory is invalid', 'INVALID_PATH')
  }
  return relative
}

function recordHash(value: Omit<ArchiveManifest, 'recordHash'>): string {
  return hash(JSON.stringify(value))
}

function withRecordHash(value: Omit<ArchiveManifest, 'recordHash'>): ArchiveManifest {
  return { ...value, recordHash: recordHash(value) }
}

async function lstatOptional(target: string): Promise<import('node:fs').Stats | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function safeRoot(root: string): Promise<string> {
  const absolute = path.resolve(root)
  const state = await fs.lstat(absolute)
  if (state.isSymbolicLink() || !state.isDirectory()) throw new LifecycleError('workspace root is unsafe', 'BLOCKED')
  return await fs.realpath(absolute)
}

async function safeDirectory(root: string, relative: string): Promise<string> {
  const canonicalRoot = await safeRoot(root)
  const normalized = normalizeWorkspaceRelative(relative)
  let cursor = path.resolve(root)
  if (normalized === '.') return cursor
  for (const part of normalized.split('/')) {
    cursor = path.join(cursor, part)
    const state = await lstatOptional(cursor)
    if (!state || state.isSymbolicLink() || !state.isDirectory()) {
      throw new LifecycleError('directory path is missing or unsafe', 'BLOCKED')
    }
    const canonical = await fs.realpath(cursor)
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new LifecycleError('directory path escapes workspace', 'BLOCKED')
    }
  }
  return cursor
}

async function safeExistingFile(root: string, relative: string): Promise<string | undefined> {
  const normalized = normalizeWorkspaceRelative(relative)
  const parent = await safeDirectory(root, path.posix.dirname(normalized))
  const target = path.join(parent, path.posix.basename(normalized))
  const state = await lstatOptional(target)
  if (!state) return undefined
  if (state.isSymbolicLink() || !state.isFile()) throw new LifecycleError('document path is not a safe regular file', 'BLOCKED')
  return target
}

async function safeAbsentFile(root: string, relative: string): Promise<string> {
  const normalized = normalizeWorkspaceRelative(relative)
  const parent = await safeDirectory(root, path.posix.dirname(normalized))
  const target = path.join(parent, path.posix.basename(normalized))
  const state = await lstatOptional(target)
  if (state) throw new LifecycleError('destination already exists', 'EXISTS')
  return target
}

async function mkdirSafe(root: string, relative: string): Promise<void> {
  const canonicalRoot = await safeRoot(root)
  let cursor = path.resolve(root)
  for (const part of normalizeWorkspaceRelative(relative).split('/').filter((item) => item !== '.')) {
    cursor = path.join(cursor, part)
    try {
      await fs.mkdir(cursor)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const state = await fs.lstat(cursor)
    if (state.isSymbolicLink() || !state.isDirectory()) throw new LifecycleError('archive directory is unsafe', 'BLOCKED')
    const canonical = await fs.realpath(cursor)
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new LifecycleError('archive directory escapes workspace', 'BLOCKED')
    }
  }
}

function minimalWindowsEnvironment(source: string, target: string): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: `${powershell};${path.join(systemRoot, 'System32')}`,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    DSH_MOVE_SOURCE: source,
    DSH_MOVE_TARGET: target,
  }
}

const MOVE_SCRIPT = `
try {
  [IO.File]::Move(
    [Environment]::GetEnvironmentVariable('DSH_MOVE_SOURCE'),
    [Environment]::GetEnvironmentVariable('DSH_MOVE_TARGET')
  )
  exit 0
} catch {
  $inner = $_.Exception.InnerException
  if ($inner -is [System.IO.IOException]) { exit 17 }
  if ($inner -is [System.UnauthorizedAccessException]) { exit 18 }
  exit 19
}`

export async function moveWindowsNoReplace(source: string, target: string, signal?: AbortSignal): Promise<void> {
  if (process.platform !== 'win32') throw new LifecycleError('safe file move is unavailable on this platform', 'UNSUPPORTED')
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', MOVE_SCRIPT], {
      env: minimalWindowsEnvironment(source, target),
      windowsHide: true,
      stdio: 'ignore',
    })
    let settled = false
    const timeout = globalThis.setTimeout(() => {
      child.kill()
      finish(new LifecycleError('safe file move timed out', 'IO'))
    }, 15_000)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => {
      child.kill()
      finish(new LifecycleError('file move was cancelled', 'IO'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.once('error', (error) => finish(new LifecycleError('safe file move could not start', 'UNSUPPORTED', { cause: error })))
    child.once('exit', (code) => {
      if (code === 0) finish()
      else if (code === 17) finish(new LifecycleError('source is missing or destination already exists', 'EXISTS'))
      else if (code === 18) finish(new LifecycleError('file move was denied', 'READ_ONLY'))
      else finish(new LifecycleError('safe file move failed', 'IO'))
    })
  })
}

async function loaded(access: LifecycleAccess, relative: string): Promise<LoadedText> {
  try {
    const value = await readTextFile(access.files, relative)
    return { ...value, bytes: byteSize(value.text), sha256: hash(value.text) }
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') throw new LifecycleError('document was not found', 'NOT_FOUND', { cause: error })
    throw error
  }
}

async function optionalLoaded(access: LifecycleAccess, relative: string): Promise<LoadedText | undefined> {
  try {
    return await loaded(access, relative)
  } catch (error) {
    if (error instanceof LifecycleError && error.code === 'NOT_FOUND') return undefined
    return undefinedIfFileMissing(error)
  }
}

function undefinedIfFileMissing(error: unknown): undefined {
  if (error instanceof FileOpError && error.code === 'NOT_FOUND') return undefined
  throw error
}

async function moveChecked(input: {
  access: LifecycleAccess
  source: string
  target: string
  expectedVersion: string
  expectedHash?: string
}): Promise<LoadedText> {
  assertWritable(input.access)
  const before = await loaded(input.access, input.source)
  if (!input.expectedVersion || before.version !== input.expectedVersion || (input.expectedHash && before.sha256 !== input.expectedHash)) {
    throw new LifecycleError('source document changed', 'STALE')
  }
  let source = await safeExistingFile(input.access.path, input.source)
  if (!source) throw new LifecycleError('source document was not found', 'NOT_FOUND')
  let target = await safeAbsentFile(input.access.path, input.target)
  const checked = await loaded(input.access, input.source)
  if (checked.version !== before.version || checked.sha256 !== before.sha256) throw new LifecycleError('source document changed', 'STALE')
  const sourceAgain = await safeExistingFile(input.access.path, input.source)
  const targetAgain = await safeAbsentFile(input.access.path, input.target)
  if (sourceAgain !== source || targetAgain !== target) throw new LifecycleError('file path changed during move', 'STALE')

  const move = input.access.moveNoReplace ?? moveWindowsNoReplace
  try {
    await move(source, target, input.access.files.signal)
  } catch (error) {
    const postSource = await safeExistingFile(input.access.path, input.source).catch(() => undefined)
    const postTarget = await safeExistingFile(input.access.path, input.target).catch(() => undefined)
    if (postSource || !postTarget) throw error
  }
  const afterSource = await safeExistingFile(input.access.path, input.source)
  const afterTarget = await safeExistingFile(input.access.path, input.target)
  if (afterSource || !afterTarget) throw new LifecycleError('file move result is ambiguous', 'BLOCKED')
  const after = await loaded(input.access, input.target)
  if (after.sha256 !== before.sha256 || after.bytes !== before.bytes) {
    try {
      if (!await safeExistingFile(input.access.path, input.source)) {
        await move(afterTarget, await safeAbsentFile(input.access.path, input.source), input.access.files.signal)
      }
    } catch {
      // Preserve both observed paths; never use a destructive fallback.
    }
    throw new LifecycleError('moved document identity changed', 'STALE')
  }
  return after
}

export async function renameDocument(input: {
  access: LifecycleAccess
  path: string
  newName: string
  expectedVersion: string
}): Promise<{ path: string; version: string }> {
  const source = authorPath(input.path)
  const extension = path.posix.extname(source)
  const filename = safeNewName(input.newName, extension)
  const parent = path.posix.dirname(source)
  const target = parent === '.' ? filename : `${parent}/${filename}`
  if (source.normalize('NFC').toLocaleLowerCase() === target.normalize('NFC').toLocaleLowerCase()) {
    throw new LifecycleError('case-only or unchanged rename is not supported', 'INVALID_PATH')
  }
  const moved = await moveChecked({ access: input.access, source, target, expectedVersion: input.expectedVersion })
  return { path: target, version: moved.version }
}

export async function moveManuscriptDocument(input: {
  access: LifecycleAccess
  path: string
  targetDirectory: string
  expectedVersion: string
}): Promise<{ path: string; version: string }> {
  const source = manuscriptDocument(input.path)
  const directory = manuscriptDirectory(input.targetDirectory)
  const sourceDirectory = path.posix.dirname(source)
  if (sourceDirectory.normalize('NFC').toLocaleLowerCase() === directory.normalize('NFC').toLocaleLowerCase()) {
    throw new LifecycleError('document is already in that manuscript directory', 'INVALID_PATH')
  }
  const target = `${directory}/${path.posix.basename(source)}`
  const moved = await moveChecked({ access: input.access, source, target, expectedVersion: input.expectedVersion })
  return { path: target, version: moved.version }
}

function manifestPath(recordDirectory: string): string {
  return `${ARCHIVE_DIRECTORY}/${recordDirectory}/manifest.json`
}

function parseManifest(value: unknown, access: LifecycleAccess, recordDirectory: string): ArchiveManifest {
  if (!value || typeof value !== 'object') throw new LifecycleError('archive manifest is invalid', 'BLOCKED')
  const item = value as Partial<ArchiveManifest>
  if (item.version !== 1
    || !UUID_V4.test(String(item.archiveId))
    || item.recordDirectory !== recordDirectory
    || !RECORD_DIRECTORY.test(recordDirectory)
    || item.rootKey !== access.rootKey
    || (item.state !== 'moving' && item.state !== 'archived' && item.state !== 'restoring' && item.state !== 'restored')
    || typeof item.createdAt !== 'string'
    || Number.isNaN(Date.parse(item.createdAt))
    || typeof item.originalVersion !== 'string'
    || !item.originalVersion
    || typeof item.bytes !== 'number'
    || !Number.isInteger(item.bytes)
    || item.bytes < 0
    || typeof item.sha256 !== 'string'
    || !SHA256.test(item.sha256)
    || typeof item.recordHash !== 'string'
    || !SHA256.test(item.recordHash)) {
    throw new LifecycleError('archive manifest is invalid', 'BLOCKED')
  }
  const originalPath = authorPath(String(item.originalPath))
  const payloadPath = normalizeWorkspaceRelative(String(item.payloadPath))
  if (payloadPath !== `${ARCHIVE_DIRECTORY}/${recordDirectory}/payload${path.posix.extname(originalPath)}`) {
    throw new LifecycleError('archive payload path is invalid', 'BLOCKED')
  }
  const manifest: ArchiveManifest = {
    version: 1,
    archiveId: item.archiveId!,
    recordDirectory,
    rootKey: item.rootKey,
    state: item.state,
    originalPath,
    payloadPath,
    createdAt: item.createdAt,
    originalVersion: item.originalVersion,
    bytes: item.bytes,
    sha256: item.sha256,
    ...(typeof item.restoredAt === 'string' ? { restoredAt: item.restoredAt } : {}),
    recordHash: item.recordHash,
  }
  const { recordHash: actual, ...withoutHash } = manifest
  if (recordHash(withoutHash) !== actual) throw new LifecycleError('archive manifest integrity check failed', 'BLOCKED')
  return manifest
}

async function readManifest(access: LifecycleAccess, recordDirectory: string): Promise<StoredManifest> {
  const stored = await readTextFile(access.files, manifestPath(recordDirectory))
  let parsed: unknown
  try {
    parsed = JSON.parse(stored.text)
  } catch (error) {
    throw new LifecycleError('archive manifest is invalid', 'BLOCKED', { cause: error })
  }
  return { manifest: parseManifest(parsed, access, recordDirectory), version: stored.version }
}

async function writeManifest(access: LifecycleAccess, stored: StoredManifest, state: ArchiveState): Promise<StoredManifest> {
  const { recordHash: _oldHash, ...current } = stored.manifest
  const manifest = withRecordHash({
    ...current,
    state,
    ...(state === 'restored' ? { restoredAt: new Date().toISOString() } : {}),
  })
  const result = await writeTextFile(access.files, manifestPath(manifest.recordDirectory), JSON.stringify(manifest), stored.version)
  return { manifest, version: result.version }
}

async function archiveRecords(access: LifecycleAccess): Promise<{ records: StoredManifest[]; invalid: number }> {
  let entries
  try {
    entries = await listDirStrict(access.files, ARCHIVE_DIRECTORY)
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') return { records: [], invalid: 0 }
    throw error
  }
  const records: StoredManifest[] = []
  let invalid = 0
  for (const entry of entries) {
    if (entry.type !== 'directory' || !RECORD_DIRECTORY.test(entry.name)) continue
    try {
      records.push(await readManifest(access, entry.name))
    } catch {
      // A malformed record is not trusted or advertised as restorable.
      invalid += 1
    }
  }
  return { records: records.sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt)), invalid }
}

async function findArchive(access: LifecycleAccess, archiveId: string): Promise<StoredManifest> {
  if (!UUID_V4.test(archiveId)) throw new LifecycleError('archive id is invalid', 'INVALID_PATH')
  const found = (await archiveRecords(access)).records.find((record) => record.manifest.archiveId === archiveId)
  if (!found) throw new LifecycleError('archive was not found', 'NOT_FOUND')
  return found
}

async function viewArchive(access: LifecycleAccess, stored: StoredManifest): Promise<ArchiveView> {
  const source = await optionalLoaded(access, stored.manifest.originalPath)
  const payload = await optionalLoaded(access, stored.manifest.payloadPath)
  const validSource = source && source.sha256 === stored.manifest.sha256 && source.bytes === stored.manifest.bytes
  const validPayload = payload && payload.sha256 === stored.manifest.sha256 && payload.bytes === stored.manifest.bytes
  const base = {
    archiveId: stored.manifest.archiveId,
    path: stored.manifest.originalPath,
    createdAt: stored.manifest.createdAt,
    bytes: stored.manifest.bytes,
  }
  if (payload && !validPayload) return { ...base, state: 'blocked', message: 'archive payload changed' }
  if (source && !payload && stored.manifest.state === 'moving') {
    return { ...base, state: validSource ? 'pending-archive' : 'blocked', ...(validSource ? { version: source.version } : { message: 'source document changed' }) }
  }
  if (payload && !source) {
    return { ...base, state: stored.manifest.state === 'restoring' ? 'pending-restore' : 'archived', version: payload.version }
  }
  if (source && !payload && (stored.manifest.state === 'restoring' || stored.manifest.state === 'restored')) {
    return { ...base, state: validSource ? 'restored' : 'blocked', ...(validSource ? { version: source.version } : { message: 'restored document changed' }) }
  }
  if (source && payload) return { ...base, state: 'blocked', message: 'both active and archived paths exist' }
  return { ...base, state: 'blocked', message: 'archive content is missing' }
}

export async function listArchives(access: LifecycleAccess): Promise<ArchiveListView> {
  const listed = await archiveRecords(access)
  return { items: await Promise.all(listed.records.map((record) => viewArchive(access, record))), invalid: listed.invalid }
}

function recordDirectory(createdAt: string, archiveId: string): string {
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')
  return `${stamp}-${archiveId}`
}

export async function archiveDocument(input: {
  access: LifecycleAccess
  path?: string
  expectedVersion?: string
  archiveId?: string
}): Promise<ArchiveView> {
  assertWritable(input.access)
  let stored: StoredManifest
  if (input.archiveId) {
    stored = await findArchive(input.access, input.archiveId)
    if (stored.manifest.state !== 'moving') return await viewArchive(input.access, stored)
  } else {
    const originalPath = authorPath(input.path ?? '')
    const source = await loaded(input.access, originalPath)
    if (!input.expectedVersion || source.version !== input.expectedVersion) throw new LifecycleError('source document changed', 'STALE')
    const archiveId = randomUUID()
    const createdAt = new Date().toISOString()
    const directory = recordDirectory(createdAt, archiveId)
    const payloadPath = `${ARCHIVE_DIRECTORY}/${directory}/payload${path.posix.extname(originalPath)}`
    await mkdirSafe(input.access.path, `${ARCHIVE_DIRECTORY}/${directory}`)
    const manifest = withRecordHash({
      version: 1,
      archiveId,
      recordDirectory: directory,
      rootKey: input.access.rootKey,
      state: 'moving',
      originalPath,
      payloadPath,
      createdAt,
      originalVersion: source.version,
      bytes: source.bytes,
      sha256: source.sha256,
    })
    const created = await createTextFile(input.access.files, manifestPath(directory), JSON.stringify(manifest))
    stored = { manifest, version: created.version }
  }

  const current = await viewArchive(input.access, stored)
  if (current.state === 'archived') {
    stored = await writeManifest(input.access, stored, 'archived')
    return await viewArchive(input.access, stored)
  }
  if (current.state !== 'pending-archive' || !current.version) return current
  await moveChecked({
    access: input.access,
    source: stored.manifest.originalPath,
    target: stored.manifest.payloadPath,
    expectedVersion: current.version,
    expectedHash: stored.manifest.sha256,
  })
  stored = await writeManifest(input.access, stored, 'archived')
  return await viewArchive(input.access, stored)
}

export async function restoreArchive(input: {
  access: LifecycleAccess
  archiveId: string
  expectedVersion?: string
}): Promise<ArchiveView> {
  assertWritable(input.access)
  let stored = await findArchive(input.access, input.archiveId)
  let current = await viewArchive(input.access, stored)
  if (current.state === 'restored') {
    if (stored.manifest.state !== 'restored') stored = await writeManifest(input.access, stored, 'restored')
    return await viewArchive(input.access, stored)
  }
  if (current.state !== 'archived' && current.state !== 'pending-restore') return current
  if (!current.version || !input.expectedVersion || current.version !== input.expectedVersion) {
    throw new LifecycleError('archive changed before restore', 'STALE')
  }
  if (stored.manifest.state !== 'restoring') stored = await writeManifest(input.access, stored, 'restoring')
  await moveChecked({
    access: input.access,
    source: stored.manifest.payloadPath,
    target: stored.manifest.originalPath,
    expectedVersion: current.version,
    expectedHash: stored.manifest.sha256,
  })
  stored = await writeManifest(input.access, stored, 'restored')
  current = await viewArchive(input.access, stored)
  return current
}
