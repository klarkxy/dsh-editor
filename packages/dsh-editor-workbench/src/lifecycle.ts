import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTextFile, FileOpError, listDirStrict, normalizeWorkspaceRelative, readTextFile, writeTextFile } from 'dsh-manuscript/host-api'
import { syncChapterStatusPaths } from './chapter-status.ts'
import { mkdirSafe as mkdirSafeWalk, RESERVED_NAME, validateEntryName } from './kit/entries.ts'
import { moveChecked } from './kit/move.ts'
import type { LifecycleAccess } from './kit/access.ts'
import {
  LifecycleError,
  loadedDocument,
  lstatOptional,
  safeAbsentFile,
  safeDirectory,
  safeExistingFile,
  safeRoot,
  type LoadedText,
} from 'dsh-editor-workspace-kit'

export type { LifecycleAccess } from './kit/access.ts'
export { validateEntryName } from './kit/entries.ts'
export { moveNoReplace, moveNonWindowsNoReplace, moveWindowsNoReplace } from './kit/move.ts'
export { LifecycleError, loadedDocument, safeAbsentFile, safeExistingFile }

export const ARCHIVE_DIRECTORY = '.dsh-editor/archive'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const RECORD_DIRECTORY = /^\d{8}T\d{6}-[0-9a-f-]{36}$/i

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

export type ArchiveView = {
  archiveId: string
  path: string
  createdAt: string
  bytes: number
  state: 'archived' | 'pending-archive' | 'pending-restore' | 'restored' | 'blocked'
  version?: string
  message?: string
  metadataWarning?: string
}

export type ArchiveListView = {
  items: ArchiveView[]
  invalid: number
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

const STATUS_SYNC_WARNING = '章节已变更，但作品进度没有同步；请重新设置章节状态。'

async function syncStatusAfterMove(access: LifecycleAccess, from: string, to: string | null): Promise<string | undefined> {
  try {
    await syncChapterStatusPaths(access, from, to)
    return undefined
  } catch {
    return STATUS_SYNC_WARNING
  }
}

async function archivedWithStatus(access: LifecycleAccess, stored: StoredManifest): Promise<ArchiveView> {
  const view = await viewArchive(access, stored)
  const metadataWarning = await syncStatusAfterMove(access, stored.manifest.originalPath, null)
  return metadataWarning ? { ...view, metadataWarning } : view
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

async function mkdirSafe(root: string, relative: string): Promise<void> {
  await mkdirSafeWalk(root, relative, (kind) => {
    if (kind === 'unsafe-root') return new LifecycleError('workspace root is unsafe', 'BLOCKED')
    if (kind === 'unsafe-dir') return new LifecycleError('archive directory is unsafe', 'BLOCKED')
    return new LifecycleError('archive directory escapes workspace', 'BLOCKED')
  }, { normalize: true })
}


async function optionalLoaded(access: LifecycleAccess, relative: string): Promise<LoadedText | undefined> {
  try {
    return await loadedDocument(access, relative)
  } catch (error) {
    if (error instanceof LifecycleError && error.code === 'NOT_FOUND') return undefined
    return undefinedIfFileMissing(error)
  }
}

function undefinedIfFileMissing(error: unknown): undefined {
  if (error instanceof FileOpError && error.code === 'NOT_FOUND') return undefined
  throw error
}

export async function renameDocument(input: {
  access: LifecycleAccess
  path: string
  newName: string
  expectedVersion: string
}): Promise<{ path: string; version: string; metadataWarning?: string }> {
  const source = authorPath(input.path)
  const extension = path.posix.extname(source)
  const filename = safeNewName(input.newName, extension)
  const parent = path.posix.dirname(source)
  const target = parent === '.' ? filename : `${parent}/${filename}`
  if (source.normalize('NFC').toLocaleLowerCase() === target.normalize('NFC').toLocaleLowerCase()) {
    throw new LifecycleError('case-only or unchanged rename is not supported', 'INVALID_PATH')
  }
  const moved = await moveChecked({ access: input.access, source, target, expectedVersion: input.expectedVersion })
  const metadataWarning = await syncStatusAfterMove(input.access, source, target)
  return { path: target, version: moved.version, ...(metadataWarning ? { metadataWarning } : {}) }
}

export async function moveManuscriptDocument(input: {
  access: LifecycleAccess
  path: string
  targetDirectory: string
  expectedVersion: string
}): Promise<{ path: string; version: string; metadataWarning?: string }> {
  const source = manuscriptDocument(input.path)
  const directory = manuscriptDirectory(input.targetDirectory)
  const sourceDirectory = path.posix.dirname(source)
  if (sourceDirectory.normalize('NFC').toLocaleLowerCase() === directory.normalize('NFC').toLocaleLowerCase()) {
    throw new LifecycleError('document is already in that manuscript directory', 'INVALID_PATH')
  }
  const target = `${directory}/${path.posix.basename(source)}`
  const moved = await moveChecked({ access: input.access, source, target, expectedVersion: input.expectedVersion })
  const metadataWarning = await syncStatusAfterMove(input.access, source, target)
  return { path: target, version: moved.version, ...(metadataWarning ? { metadataWarning } : {}) }
}

function entryPath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new LifecycleError('entry path is required', 'INVALID_PATH')
  let relative: string
  try {
    relative = normalizeWorkspaceRelative(value)
  } catch (error) {
    throw new LifecycleError('entry path is invalid', 'INVALID_PATH', { cause: error })
  }
  if (relative !== value.replace(/\\/g, '/')
    || relative === '.'
    || relative.split('/').some((part) => part.startsWith('.'))) {
    throw new LifecycleError('entry path is invalid', 'INVALID_PATH')
  }
  return relative
}

function entryDirectory(value: string): string {
  if (typeof value !== 'string') throw new LifecycleError('target directory is required', 'INVALID_PATH')
  if (value === '' || value === '.') return '.'
  let relative: string
  try {
    relative = normalizeWorkspaceRelative(value)
  } catch (error) {
    throw new LifecycleError('target directory is invalid', 'INVALID_PATH', { cause: error })
  }
  if (relative !== value.replace(/\\/g, '/')
    || relative.split('/').some((part) => part.startsWith('.'))) {
    throw new LifecycleError('target directory is invalid', 'INVALID_PATH')
  }
  return relative
}

function splitPosixName(name: string): { stem: string; ext: string } {
  const ext = path.posix.extname(name)
  return { stem: name.slice(0, name.length - ext.length), ext }
}

function joinPosix(parent: string, name: string): string {
  return parent === '.' ? name : `${parent}/${name}`
}

async function resolveExistingEntry(
  root: string,
  relative: string,
): Promise<{ absolute: string; type: 'file' | 'directory' }> {
  const canonicalRoot = await safeRoot(root)
  const normalized = normalizeWorkspaceRelative(relative)
  let cursor = path.resolve(root)
  const parts = normalized === '.' ? [] : normalized.split('/')
  for (let index = 0; index < parts.length; index++) {
    cursor = path.join(cursor, parts[index]!)
    const state = await lstatOptional(cursor)
    if (!state) throw new LifecycleError('entry was not found', 'NOT_FOUND')
    if (state.isSymbolicLink()) throw new LifecycleError('symbolic links are not supported', 'BLOCKED')
    if (index === parts.length - 1) {
      if (state.isFile()) return { absolute: cursor, type: 'file' }
      if (state.isDirectory()) return { absolute: cursor, type: 'directory' }
      throw new LifecycleError('entry is not a regular file or directory', 'BLOCKED')
    }
    if (!state.isDirectory()) throw new LifecycleError('parent path is not a directory', 'BLOCKED')
    const canonical = await fs.realpath(cursor)
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new LifecycleError('path escapes workspace', 'BLOCKED')
    }
  }
  throw new LifecycleError('entry was not found', 'NOT_FOUND')
}

async function copyDirectoryRecursive(src: string, dest: string, workspaceRoot: string): Promise<void> {
  const canonicalWorkspace = await fs.realpath(workspaceRoot)
  await fs.mkdir(dest, { recursive: false })
  let entries
  try {
    entries = await fs.readdir(src, { withFileTypes: true })
  } catch (error) {
    throw new LifecycleError('directory read failed', 'IO', { cause: error })
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new LifecycleError('symbolic links are not supported', 'BLOCKED')
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      const subCanonical = await fs.realpath(srcPath)
      if (subCanonical !== canonicalWorkspace && !subCanonical.startsWith(`${canonicalWorkspace}${path.sep}`)) {
        throw new LifecycleError('path escapes workspace', 'BLOCKED')
      }
      await copyDirectoryRecursive(srcPath, destPath, workspaceRoot)
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath)
    } else {
      throw new LifecycleError('unsupported entry type', 'BLOCKED')
    }
  }
}

async function findAvailableCopyTarget(parentAbsolute: string, sourceName: string): Promise<{ absolute: string; name: string }> {
  const { stem, ext } = splitPosixName(sourceName)
  for (let n = 1; n < 10_000; n++) {
    const name = n === 1 ? sourceName : `${stem} ${n}${ext}`
    const target = path.join(parentAbsolute, name)
    const state = await lstatOptional(target)
    if (!state) return { absolute: target, name }
  }
  throw new LifecycleError('too many name conflicts', 'EXISTS')
}

async function noReplaceRename(source: string, target: string, access: LifecycleAccess): Promise<void> {
  const move = access.moveNoReplace
  if (move) {
    try {
      await move(source, target, access.files.signal)
      return
    } catch (error) {
      if (error instanceof LifecycleError) throw error
      throw new LifecycleError('move failed', 'IO', { cause: error })
    }
  }
  const existing = await lstatOptional(target)
  if (existing) throw new LifecycleError('destination already exists', 'EXISTS')
  try {
    await fs.rename(source, target)
  } catch (error) {
    const post = await lstatOptional(target)
    if (post) throw new LifecycleError('destination already exists', 'EXISTS', { cause: error })
    const srcState = await lstatOptional(source)
    if (!srcState) throw new LifecycleError('source was not found', 'NOT_FOUND', { cause: error })
    throw new LifecycleError('move failed', 'IO', { cause: error })
  }
}

export async function copyEntry(input: {
  access: LifecycleAccess
  path: string
  targetDir: string
}): Promise<{ path: string }> {
  assertWritable(input.access)
  const source = entryPath(input.path)
  const directory = entryDirectory(input.targetDir)
  const sourceEntry = await resolveExistingEntry(input.access.path, source)
  const targetDirAbsolute = await safeDirectory(input.access.path, directory)
  if (sourceEntry.type === 'directory') {
    const sourceCanonical = await fs.realpath(sourceEntry.absolute)
    const targetDirCanonical = await fs.realpath(targetDirAbsolute)
    if (sourceCanonical === targetDirCanonical
      || targetDirCanonical.startsWith(`${sourceCanonical}${path.sep}`)) {
      throw new LifecycleError('cannot copy a directory into itself', 'INVALID_PATH')
    }
  }
  const sourceName = path.posix.basename(source)
  const { absolute: targetAbsolute, name: targetName } = await findAvailableCopyTarget(targetDirAbsolute, sourceName)
  if (sourceEntry.type === 'file') {
    await fs.copyFile(sourceEntry.absolute, targetAbsolute)
  } else {
    await copyDirectoryRecursive(sourceEntry.absolute, targetAbsolute, input.access.path)
  }
  return { path: joinPosix(directory, targetName) }
}

export async function moveEntry(input: {
  access: LifecycleAccess
  path: string
  targetDir: string
}): Promise<{ path: string }> {
  assertWritable(input.access)
  const source = entryPath(input.path)
  const directory = entryDirectory(input.targetDir)
  const sourceEntry = await resolveExistingEntry(input.access.path, source)
  const targetDirAbsolute = await safeDirectory(input.access.path, directory)
  const sourceDirectory = path.posix.dirname(source)
  if (sourceDirectory.normalize('NFC').toLocaleLowerCase() === directory.normalize('NFC').toLocaleLowerCase()) {
    throw new LifecycleError('entry is already in that directory', 'INVALID_PATH')
  }
  if (sourceEntry.type === 'directory') {
    const sourceCanonical = await fs.realpath(sourceEntry.absolute)
    const targetDirCanonical = await fs.realpath(targetDirAbsolute)
    if (sourceCanonical === targetDirCanonical
      || targetDirCanonical.startsWith(`${sourceCanonical}${path.sep}`)) {
      throw new LifecycleError('cannot move a directory into itself', 'INVALID_PATH')
    }
  }
  const targetAbsolute = path.join(targetDirAbsolute, path.posix.basename(source))
  const existing = await lstatOptional(targetAbsolute)
  if (existing) throw new LifecycleError('destination already exists', 'EXISTS')
  await noReplaceRename(sourceEntry.absolute, targetAbsolute, input.access)
  const target = joinPosix(directory, path.posix.basename(source))
  const metadataWarning = await syncStatusAfterMove(input.access, source, target)
  return { path: target, ...(metadataWarning ? { metadataWarning } : {}) }
}

export async function deleteEntry(input: {
  access: LifecycleAccess
  path: string
}): Promise<{ path: string }> {
  assertWritable(input.access)
  const source = entryPath(input.path)
  const sourceEntry = await resolveExistingEntry(input.access.path, source)
  await fs.rm(sourceEntry.absolute, { recursive: true, force: false })
  const metadataWarning = await syncStatusAfterMove(input.access, source, null)
  return { path: source, ...(metadataWarning ? { metadataWarning } : {}) }
}

export async function renameEntry(input: {
  access: LifecycleAccess
  path: string
  name: string
}): Promise<{ path: string }> {
  assertWritable(input.access)
  const source = entryPath(input.path)
  const newName = validateEntryName(input.name)
  const sourceEntry = await resolveExistingEntry(input.access.path, source)
  const parentRelative = path.posix.dirname(source)
  const targetRelative = joinPosix(parentRelative, newName)
  if (source.normalize('NFC').toLocaleLowerCase() === targetRelative.normalize('NFC').toLocaleLowerCase()) {
    throw new LifecycleError('case-only or unchanged rename is not supported', 'INVALID_PATH')
  }
  const parentAbsolute = await safeDirectory(input.access.path, parentRelative)
  const targetAbsolute = path.join(parentAbsolute, newName)
  await noReplaceRename(sourceEntry.absolute, targetAbsolute, input.access)
  const metadataWarning = await syncStatusAfterMove(input.access, source, targetRelative)
  return { path: targetRelative, ...(metadataWarning ? { metadataWarning } : {}) }
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

/** Persist an identified archive intent before moving any content; retries reuse the same manifest. */
export async function prepareArchiveDocument(input: { access: LifecycleAccess; path: string; expectedVersion: string; archiveId?: string }): Promise<ArchiveView> {
  assertWritable(input.access)
  if (input.archiveId) {
    if (!UUID_V4.test(input.archiveId)) throw new LifecycleError('archive id is invalid', 'INVALID_PATH')
    const existing = (await archiveRecords(input.access)).records.find(record => record.manifest.archiveId === input.archiveId)
    if (existing) {
      if (existing.manifest.originalPath !== authorPath(input.path) || existing.manifest.originalVersion !== input.expectedVersion) throw new LifecycleError('archive intent does not match source', 'STALE')
      return await viewArchive(input.access, existing)
    }
  }
    const originalPath = authorPath(input.path ?? '')
    const source = await loadedDocument(input.access, originalPath)
    if (!input.expectedVersion || source.version !== input.expectedVersion) throw new LifecycleError('source document changed', 'STALE')
    const archiveId = input.archiveId ?? randomUUID()
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
    return await viewArchive(input.access, { manifest, version: created.version })
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
    if (stored.manifest.state !== 'moving') {
      const current = await viewArchive(input.access, stored)
      if (current.state === 'archived' && stored.manifest.originalPath.startsWith('正文/')) {
        return current
      }
      return current
    }
  } else {
    const prepared = await prepareArchiveDocument({ access: input.access, path: input.path ?? '', expectedVersion: input.expectedVersion ?? '' })
    stored = await findArchive(input.access, prepared.archiveId)
  }

  const current = await viewArchive(input.access, stored)
  if (current.state === 'archived') {
    stored = await writeManifest(input.access, stored, 'archived')
    return await archivedWithStatus(input.access, stored)
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
  return await archivedWithStatus(input.access, stored)
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
