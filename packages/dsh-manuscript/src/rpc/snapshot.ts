import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceFileContext } from './files.ts'
import { createTextFile, FileOpError, listDirStrict, readTextFile, writeTextFile } from './files.ts'
import { normalizeWorkspaceRelative } from './paths.ts'

export const SNAPSHOT_DIRECTORY = '.dsh-editor/snapshots'
export const RESTORE_RECEIPT_PATH = '.dsh-editor-restore.json'
const MAX_FILE_BYTES = 2_000_000
const MAX_FILES = 2_000
const MAX_TOTAL_BYTES = 100_000_000
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const GENERATED_DIRECTORIES = new Set(['build', 'coverage', 'dist', 'node_modules', 'out', 'target'])

export type SnapshotAccess = {
  path: string
  rootKey: string
  mode: string
  files: WorkspaceFileContext
}

type SnapshotFile = { path: string; bytes: number; sha256: string }
type ScannedFile = SnapshotFile & { version: string; text: string }
type ExcludedFile = { path: string; reason: 'hidden' | 'generated' | 'other' }
type SnapshotManifest = {
  version: 1
  snapshotId: string
  label?: string
  createdAt: string
  files: SnapshotFile[]
  excluded: ExcludedFile[]
  totalBytes: number
  manifestHash: string
}
type LoadedSnapshot = SnapshotManifest & { payload: Array<SnapshotFile & { text: string }> }
type RestoreReceipt = {
  version: 1
  receiptId: string
  state: 'copying' | 'cleaning' | 'complete'
  sourceRootKey: string
  targetRootKey: string
  snapshotId: string
  probeToken: string
  files: SnapshotFile[]
}

export type SnapshotView = {
  snapshotId: string
  label?: string
  createdAt: string
  files: number
  bytes: number
  excluded: number
}

export type RestoreProbe = {
  state: 'none' | 'ready' | 'blocked' | 'recoverable' | 'complete'
  token?: string
  receiptId?: string
  snapshotId?: string
  files: number
  bytes: number
  excluded: ExcludedFile[]
  preview: string[]
  message?: string
}

export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'BLOCKED' | 'STALE' | 'CLEANUP_BLOCKED' | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SnapshotError'
  }
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function byteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function normal(value: string): string {
  return value.split(path.sep).join('/')
}

function hidden(value: string): boolean {
  return value.split('/').some((part) => part.startsWith('.'))
}

function generated(value: string): boolean {
  return value.split('/').some((part) => GENERATED_DIRECTORIES.has(part.toLocaleLowerCase()))
}

function validPayloadPath(value: unknown): value is string {
  if (typeof value !== 'string' || hidden(value) || generated(value) || !/\.(md|txt)$/i.test(value)) return false
  try {
    return normalizeWorkspaceRelative(value) === value
  } catch {
    return false
  }
}

function validateFileList(value: unknown): SnapshotFile[] {
  if (!Array.isArray(value) || value.length > MAX_FILES) throw new SnapshotError('snapshot file list is invalid', 'BLOCKED')
  const seen = new Set<string>()
  let total = 0
  const files: SnapshotFile[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') throw new SnapshotError('snapshot file list is invalid', 'BLOCKED')
    const item = candidate as Partial<SnapshotFile>
    if (!validPayloadPath(item.path)
      || typeof item.bytes !== 'number'
      || !Number.isInteger(item.bytes)
      || item.bytes < 0
      || item.bytes > MAX_FILE_BYTES
      || typeof item.sha256 !== 'string'
      || !SHA256.test(item.sha256)) {
      throw new SnapshotError('snapshot file list is invalid', 'BLOCKED')
    }
    const key = item.path.normalize('NFC').toLocaleLowerCase()
    if (seen.has(key)) throw new SnapshotError('snapshot contains conflicting paths', 'BLOCKED')
    seen.add(key)
    total += item.bytes
    if (total > MAX_TOTAL_BYTES) throw new SnapshotError('snapshot exceeds its byte limit', 'BLOCKED')
    files.push({ path: item.path, bytes: item.bytes, sha256: item.sha256 })
  }
  return files
}

function manifestHash(value: Omit<SnapshotManifest, 'manifestHash'>): string {
  return hash(JSON.stringify(value))
}

function snapshotRelative(snapshotId: string): string {
  if (!UUID_V4.test(snapshotId)) throw new SnapshotError('snapshot id is invalid', 'BLOCKED')
  return `${SNAPSHOT_DIRECTORY}/${snapshotId}`
}

function nested(left: string, right: string): boolean {
  const relative = path.relative(path.resolve(left), path.resolve(right))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function lstatOptional(target: string): Promise<import('node:fs').Stats | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function assertSafeRoot(root: string): Promise<string> {
  const resolved = path.resolve(root)
  const state = await fs.lstat(resolved)
  if (state.isSymbolicLink() || !state.isDirectory()) throw new SnapshotError('workspace root is unsafe', 'BLOCKED')
  return await fs.realpath(resolved)
}

async function mkdirSafe(root: string, relative: string): Promise<void> {
  const canonicalRoot = await assertSafeRoot(root)
  let cursor = path.resolve(root)
  for (const part of normalizeWorkspaceRelative(relative).split('/').filter((item) => item !== '.')) {
    cursor = path.join(cursor, part)
    try {
      await fs.mkdir(cursor)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const state = await fs.lstat(cursor)
    if (state.isSymbolicLink() || !state.isDirectory()) throw new SnapshotError('directory path is unsafe', 'BLOCKED')
    const canonical = await fs.realpath(cursor)
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new SnapshotError('directory path escapes workspace', 'BLOCKED')
    }
  }
}

async function safeExistingFile(root: string, relative: string): Promise<string | undefined> {
  const normalized = normalizeWorkspaceRelative(relative)
  const canonicalRoot = await assertSafeRoot(root)
  let cursor = path.resolve(root)
  const parts = normalized.split('/')
  for (let index = 0; index < parts.length; index++) {
    cursor = path.join(cursor, parts[index]!)
    const state = await lstatOptional(cursor)
    if (!state) return undefined
    if (state.isSymbolicLink()) throw new SnapshotError('cleanup path contains a link', 'CLEANUP_BLOCKED')
    if (index < parts.length - 1 && !state.isDirectory()) {
      throw new SnapshotError('cleanup parent is not a directory', 'CLEANUP_BLOCKED')
    }
    if (index === parts.length - 1 && !state.isFile()) {
      throw new SnapshotError('cleanup target is not a regular file', 'CLEANUP_BLOCKED')
    }
  }
  const canonicalParent = await fs.realpath(path.dirname(cursor))
  if (canonicalParent !== canonicalRoot && !canonicalParent.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new SnapshotError('cleanup path escapes workspace', 'CLEANUP_BLOCKED')
  }
  return cursor
}

async function safeExistingDirectory(root: string, relative: string): Promise<string | undefined> {
  const normalized = normalizeWorkspaceRelative(relative)
  const canonicalRoot = await assertSafeRoot(root)
  let cursor = path.resolve(root)
  for (const part of normalized.split('/')) {
    cursor = path.join(cursor, part)
    const state = await lstatOptional(cursor)
    if (!state) return undefined
    if (state.isSymbolicLink() || !state.isDirectory()) {
      throw new SnapshotError('cleanup directory is unsafe', 'CLEANUP_BLOCKED')
    }
    const canonical = await fs.realpath(cursor)
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new SnapshotError('cleanup directory escapes workspace', 'CLEANUP_BLOCKED')
    }
  }
  return cursor
}

async function removeEmptyParents(root: string, files: readonly SnapshotFile[]): Promise<void> {
  const directories = new Set<string>()
  for (const file of files) {
    let current = path.posix.dirname(file.path)
    while (current !== '.') {
      directories.add(current)
      current = path.posix.dirname(current)
    }
  }
  for (const relative of [...directories].sort((a, b) => b.split('/').length - a.split('/').length)) {
    const target = await safeExistingDirectory(root, relative)
    if (!target) continue
    try {
      await fs.rmdir(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error
    }
  }
}

async function assertTargetContainsOnlyRestore(target: SnapshotAccess, files: readonly SnapshotFile[]): Promise<void> {
  const allowedFiles = new Set(files.map((file) => file.path))
  const allowedDirectories = new Set<string>()
  for (const file of files) {
    let current = path.posix.dirname(file.path)
    while (current !== '.') {
      allowedDirectories.add(current)
      current = path.posix.dirname(current)
    }
  }
  const queue = ['']
  while (queue.length) {
    const directory = queue.shift()!
    for (const entry of await listDirStrict(target.files, directory || '.')) {
      const relative = normal(path.join(directory, entry.name))
      if (relative === RESTORE_RECEIPT_PATH && entry.type === 'file') continue
      if (entry.type === 'directory' && allowedDirectories.has(relative)) {
        queue.push(relative)
        continue
      }
      if (entry.type === 'file' && allowedFiles.has(relative)) continue
      throw new SnapshotError('restore target contains an unexpected path', 'STALE')
    }
  }
}

async function scan(access: SnapshotAccess): Promise<{ files: ScannedFile[]; excluded: ExcludedFile[] }> {
  await assertSafeRoot(access.path)
  const files: ScannedFile[] = []
  const excluded: ExcludedFile[] = []
  const queue = ['']
  let total = 0
  while (queue.length) {
    const directory = queue.shift()!
    const entries = await listDirStrict(access.files, directory || '.')
    for (const entry of entries) {
      const relative = normal(path.join(directory, entry.name))
      if (hidden(relative)) {
        excluded.push({ path: relative, reason: 'hidden' })
        continue
      }
      if (generated(relative)) {
        excluded.push({ path: relative, reason: 'generated' })
        continue
      }
      if (entry.type === 'directory') {
        queue.push(relative)
        continue
      }
      if (entry.type !== 'file' || !/\.(md|txt)$/i.test(entry.name)) {
        excluded.push({ path: relative, reason: 'other' })
        continue
      }
      const loaded = await readTextFile(access.files, relative)
      const bytes = byteSize(loaded.text)
      if (bytes > MAX_FILE_BYTES) throw new SnapshotError(`${relative} exceeds 2 MB`, 'BLOCKED')
      total += bytes
      if (files.length + 1 > MAX_FILES || total > MAX_TOTAL_BYTES) {
        throw new SnapshotError('snapshot exceeds its file or byte limit', 'BLOCKED')
      }
      files.push({ path: relative, version: loaded.version, bytes, sha256: hash(loaded.text), text: loaded.text })
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  excluded.sort((left, right) => left.path.localeCompare(right.path))
  return { files, excluded }
}

function scanIdentity(files: readonly ScannedFile[]): string {
  return JSON.stringify(files.map(({ text: _text, ...file }) => file))
}

async function loadSnapshotAt(
  source: SnapshotAccess,
  base: string,
  expectedId: string,
  includePayload = true,
): Promise<LoadedSnapshot> {
  let parsed: unknown
  try {
    parsed = JSON.parse((await readTextFile(source.files, `${base}/manifest.json`)).text)
  } catch (error) {
    if (error instanceof SyntaxError) throw new SnapshotError('snapshot manifest is invalid', 'BLOCKED')
    throw error
  }
  if (!parsed || typeof parsed !== 'object') throw new SnapshotError('snapshot manifest is invalid', 'BLOCKED')
  const value = parsed as Partial<SnapshotManifest>
  if (value.version !== 1
    || value.snapshotId !== expectedId
    || typeof value.createdAt !== 'string'
    || Number.isNaN(Date.parse(value.createdAt))
    || (value.label !== undefined && (typeof value.label !== 'string' || value.label.length > 120))
    || !Array.isArray(value.excluded)
    || typeof value.totalBytes !== 'number'
    || !Number.isInteger(value.totalBytes)
    || typeof value.manifestHash !== 'string'
    || !SHA256.test(value.manifestHash)) {
    throw new SnapshotError('snapshot manifest is invalid', 'BLOCKED')
  }
  const files = validateFileList(value.files)
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  if (totalBytes !== value.totalBytes) throw new SnapshotError('snapshot byte total is invalid', 'BLOCKED')
  const withoutHash: Omit<SnapshotManifest, 'manifestHash'> = {
    version: 1,
    snapshotId: expectedId,
    ...(value.label === undefined ? {} : { label: value.label }),
    createdAt: value.createdAt,
    files,
    excluded: value.excluded as ExcludedFile[],
    totalBytes,
  }
  if (manifestHash(withoutHash) !== value.manifestHash) throw new SnapshotError('snapshot manifest hash is invalid', 'BLOCKED')
  const payload: LoadedSnapshot['payload'] = []
  if (includePayload) {
    for (const file of files) {
      const text = (await readTextFile(source.files, `${base}/files/${file.path}`)).text
      if (byteSize(text) !== file.bytes || hash(text) !== file.sha256) {
        throw new SnapshotError('snapshot payload is invalid', 'BLOCKED')
      }
      payload.push({ ...file, text })
    }
  }
  return { ...withoutHash, manifestHash: value.manifestHash, payload }
}

async function loadSnapshot(source: SnapshotAccess, snapshotId: string): Promise<LoadedSnapshot> {
  return await loadSnapshotAt(source, snapshotRelative(snapshotId), snapshotId)
}

function restoreToken(source: SnapshotAccess, target: SnapshotAccess, snapshot: SnapshotManifest): string {
  return hash(JSON.stringify({
    version: 1,
    sourceRootKey: source.rootKey,
    targetRootKey: target.rootKey,
    snapshotId: snapshot.snapshotId,
    manifestHash: snapshot.manifestHash,
    files: snapshot.files,
  }))
}

async function readRestore(target: SnapshotAccess): Promise<{ receipt: RestoreReceipt; version: string } | undefined> {
  let loaded
  try {
    loaded = await readTextFile(target.files, RESTORE_RECEIPT_PATH)
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(loaded.text)
  } catch {
    throw new SnapshotError('restore receipt is invalid', 'BLOCKED')
  }
  if (!parsed || typeof parsed !== 'object') throw new SnapshotError('restore receipt is invalid', 'BLOCKED')
  const value = parsed as Partial<RestoreReceipt>
  if (value.version !== 1
    || !UUID_V4.test(String(value.receiptId))
    || (value.state !== 'copying' && value.state !== 'cleaning' && value.state !== 'complete')
    || typeof value.sourceRootKey !== 'string'
    || !value.sourceRootKey
    || value.targetRootKey !== target.rootKey
    || !UUID_V4.test(String(value.snapshotId))
    || typeof value.probeToken !== 'string'
    || !SHA256.test(value.probeToken)) {
    throw new SnapshotError('restore receipt is invalid for this workspace', 'BLOCKED')
  }
  return {
    receipt: {
      version: 1,
      receiptId: value.receiptId!,
      state: value.state,
      sourceRootKey: value.sourceRootKey,
      targetRootKey: value.targetRootKey,
      snapshotId: value.snapshotId!,
      probeToken: value.probeToken,
      files: validateFileList(value.files),
    },
    version: loaded.version,
  }
}

function summary(
  state: RestoreProbe['state'],
  files: readonly SnapshotFile[],
  excluded: ExcludedFile[] = [],
  extra: Partial<RestoreProbe> = {},
): RestoreProbe {
  return {
    state,
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    excluded,
    preview: files.slice(0, 12).map((file) => file.path),
    ...extra,
  }
}

export async function listSnapshots(source: SnapshotAccess): Promise<SnapshotView[]> {
  try {
    const entries = await listDirStrict(source.files, SNAPSHOT_DIRECTORY)
    const snapshots: SnapshotView[] = []
    for (const entry of entries) {
      if (entry.type !== 'directory' || !UUID_V4.test(entry.name)) continue
      try {
        const snapshot = await loadSnapshotAt(source, snapshotRelative(entry.name), entry.name, false)
        snapshots.push({
          snapshotId: snapshot.snapshotId,
          ...(snapshot.label === undefined ? {} : { label: snapshot.label }),
          createdAt: snapshot.createdAt,
          files: snapshot.files.length,
          bytes: snapshot.totalBytes,
          excluded: snapshot.excluded.length,
        })
      } catch {
        // Corrupt and incomplete directories are never advertised as snapshots.
      }
    }
    return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') return []
    throw error
  }
}

export async function createSnapshot(
  source: SnapshotAccess,
  label?: string,
): Promise<SnapshotView> {
  if (source.mode === 'read-only') throw new SnapshotError('workspace is read-only', 'READ_ONLY')
  const normalizedLabel = label?.trim()
  if (normalizedLabel && normalizedLabel.length > 120) throw new SnapshotError('snapshot label is too long', 'BLOCKED')
  const first = await scan(source)
  const second = await scan(source)
  if (scanIdentity(first.files) !== scanIdentity(second.files)) {
    throw new SnapshotError('workspace changed while snapshotting', 'STALE')
  }
  if (!second.files.length) throw new SnapshotError('no eligible novel text to snapshot', 'BLOCKED')

  const snapshotId = randomUUID()
  const createdAt = new Date().toISOString()
  const stage = `${SNAPSHOT_DIRECTORY}/.creating-${snapshotId}`
  const published = snapshotRelative(snapshotId)
  await mkdirSafe(source.path, `${stage}/files`)
  for (const file of second.files) {
    await mkdirSafe(source.path, path.posix.dirname(`${stage}/files/${file.path}`))
    await createTextFile(source.files, `${stage}/files/${file.path}`, file.text)
  }
  const files = second.files.map(({ text: _text, version: _version, ...file }) => file)
  const base: Omit<SnapshotManifest, 'manifestHash'> = {
    version: 1,
    snapshotId,
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
    createdAt,
    files,
    excluded: second.excluded,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  }
  const manifest: SnapshotManifest = { ...base, manifestHash: manifestHash(base) }
  await createTextFile(source.files, `${stage}/manifest.json`, JSON.stringify(manifest))
  await loadSnapshotAt(source, stage, snapshotId)
  await mkdirSafe(source.path, stage)
  if (await lstatOptional(path.join(source.path, ...published.split('/')))) {
    throw new SnapshotError('snapshot destination already exists', 'STALE')
  }
  await fs.rename(
    path.join(source.path, ...stage.split('/')),
    path.join(source.path, ...published.split('/')),
  )
  return {
    snapshotId,
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
    createdAt,
    files: files.length,
    bytes: manifest.totalBytes,
    excluded: second.excluded.length,
  }
}

export async function restoreProbe(input: {
  source?: SnapshotAccess
  target: SnapshotAccess
  snapshotId?: string
}): Promise<RestoreProbe> {
  const stored = await readRestore(input.target)
  if (!input.source) {
    if (!stored) return summary('none', [])
    const state = stored.receipt.state === 'complete' ? 'complete' : 'recoverable'
    return summary(state, stored.receipt.files, [], {
      receiptId: stored.receipt.receiptId,
      snapshotId: stored.receipt.snapshotId,
      message: stored.receipt.state,
    })
  }
  if (input.target.mode === 'read-only') return summary('blocked', [], [], { message: '目标目录不可写' })
  const sourceRoot = await assertSafeRoot(input.source.path)
  const targetRoot = await assertSafeRoot(input.target.path)
  if (nested(sourceRoot, targetRoot) || nested(targetRoot, sourceRoot)) {
    return summary('blocked', [], [], { message: '源作品与目标目录不能相同或互相嵌套' })
  }
  if (!stored && (await listDirStrict(input.target.files, '.')).length !== 0) {
    return summary('blocked', [], [], { message: '目标目录必须为空' })
  }
  if (stored?.receipt.state === 'cleaning') {
    return summary('recoverable', stored.receipt.files, [], {
      receiptId: stored.receipt.receiptId,
      snapshotId: stored.receipt.snapshotId,
      message: '清理尚未完成',
    })
  }
  const snapshot = await loadSnapshot(input.source, input.snapshotId ?? '')
  const token = restoreToken(input.source, input.target, snapshot)
  if (stored && (stored.receipt.sourceRootKey !== input.source.rootKey
    || stored.receipt.snapshotId !== snapshot.snapshotId
    || stored.receipt.probeToken !== token
    || JSON.stringify(stored.receipt.files) !== JSON.stringify(snapshot.files))) {
    return summary('blocked', snapshot.files, snapshot.excluded, { message: '快照与未完成恢复不匹配' })
  }
  if (stored?.receipt.state === 'complete') {
    return summary('complete', snapshot.files, snapshot.excluded, {
      token,
      receiptId: stored.receipt.receiptId,
      snapshotId: snapshot.snapshotId,
    })
  }
  return summary('ready', snapshot.files, snapshot.excluded, {
    token,
    receiptId: stored?.receipt.receiptId,
    snapshotId: snapshot.snapshotId,
  })
}

export async function restoreApply(input: {
  source: SnapshotAccess
  target: SnapshotAccess
  snapshotId: string
  token: string
}): Promise<{ restored: number; skipped: number; complete: true }> {
  const probe = await restoreProbe(input)
  if (probe.state === 'complete' && probe.token === input.token) {
    return { restored: 0, skipped: probe.files, complete: true }
  }
  if (probe.state !== 'ready' || probe.token !== input.token) {
    throw new SnapshotError('restore source or target changed', 'STALE')
  }
  const snapshot = await loadSnapshot(input.source, input.snapshotId)
  if (restoreToken(input.source, input.target, snapshot) !== input.token) {
    throw new SnapshotError('snapshot changed after preview', 'STALE')
  }
  let stored = await readRestore(input.target)
  if (!stored) {
    if ((await listDirStrict(input.target.files, '.')).length !== 0) {
      throw new SnapshotError('target changed after preview', 'STALE')
    }
    const receipt: RestoreReceipt = {
      version: 1,
      receiptId: randomUUID(),
      state: 'copying',
      sourceRootKey: input.source.rootKey,
      targetRootKey: input.target.rootKey,
      snapshotId: snapshot.snapshotId,
      probeToken: input.token,
      files: snapshot.files,
    }
    stored = {
      receipt,
      version: (await createTextFile(input.target.files, RESTORE_RECEIPT_PATH, JSON.stringify(receipt))).version,
    }
  }
  let restored = 0
  let skipped = 0
  for (const file of snapshot.payload) {
    try {
      const current = await readTextFile(input.target.files, file.path)
      if (byteSize(current.text) !== file.bytes || hash(current.text) !== file.sha256) {
        throw new SnapshotError('a restored file changed', 'STALE')
      }
      skipped++
      continue
    } catch (error) {
      if (!(error instanceof FileOpError && error.code === 'NOT_FOUND')) throw error
    }
    await mkdirSafe(input.target.path, path.posix.dirname(file.path))
    await createTextFile(input.target.files, file.path, file.text)
    restored++
  }
  for (const file of stored.receipt.files) {
    const current = await readTextFile(input.target.files, file.path)
    if (byteSize(current.text) !== file.bytes || hash(current.text) !== file.sha256) {
      throw new SnapshotError('restored file verification failed', 'STALE')
    }
  }
  await assertTargetContainsOnlyRestore(input.target, stored.receipt.files)
  const latest = await readRestore(input.target)
  if (!latest
    || latest.version !== stored.version
    || latest.receipt.receiptId !== stored.receipt.receiptId
    || latest.receipt.state !== 'copying') {
    throw new SnapshotError('restore receipt changed', 'STALE')
  }
  await writeTextFile(
    input.target.files,
    RESTORE_RECEIPT_PATH,
    JSON.stringify({ ...stored.receipt, state: 'complete' }),
    stored.version,
  )
  return { restored, skipped, complete: true }
}

export async function restoreCleanup(input: {
  target: SnapshotAccess
  receiptId: string
}): Promise<{ removed: number }> {
  if (input.target.mode === 'read-only') throw new SnapshotError('target is read-only', 'READ_ONLY')
  let stored = await readRestore(input.target)
  if (!stored
    || stored.receipt.state === 'complete'
    || stored.receipt.receiptId !== input.receiptId) {
    throw new SnapshotError('restore cleanup is not available', 'CLEANUP_BLOCKED')
  }
  if (stored.receipt.state === 'copying') {
    for (const file of stored.receipt.files) {
      const absolute = await safeExistingFile(input.target.path, file.path)
      if (!absolute) continue
      const current = await readTextFile(input.target.files, file.path)
      if (byteSize(current.text) !== file.bytes || hash(current.text) !== file.sha256) {
        throw new SnapshotError('a restored file changed', 'CLEANUP_BLOCKED')
      }
    }
    const cleaning = { ...stored.receipt, state: 'cleaning' as const }
    stored = {
      receipt: cleaning,
      version: (await writeTextFile(
        input.target.files,
        RESTORE_RECEIPT_PATH,
        JSON.stringify(cleaning),
        stored.version,
      )).version,
    }
  }
  let removed = 0
  for (const file of [...stored.receipt.files].reverse()) {
    const absolute = await safeExistingFile(input.target.path, file.path)
    if (!absolute) continue
    const current = await readTextFile(input.target.files, file.path)
    if (byteSize(current.text) !== file.bytes || hash(current.text) !== file.sha256) {
      throw new SnapshotError('a restored file changed during cleanup', 'CLEANUP_BLOCKED')
    }
    const checkedAgain = await safeExistingFile(input.target.path, file.path)
    if (checkedAgain !== absolute) throw new SnapshotError('cleanup path changed', 'CLEANUP_BLOCKED')
    await fs.unlink(absolute)
    removed++
  }
  await removeEmptyParents(input.target.path, stored.receipt.files)
  const latest = await readRestore(input.target)
  if (!latest
    || latest.version !== stored.version
    || latest.receipt.receiptId !== stored.receipt.receiptId
    || latest.receipt.state !== 'cleaning') {
    throw new SnapshotError('restore receipt changed', 'CLEANUP_BLOCKED')
  }
  const receiptAbsolute = await safeExistingFile(input.target.path, RESTORE_RECEIPT_PATH)
  if (!receiptAbsolute) throw new SnapshotError('restore receipt disappeared', 'CLEANUP_BLOCKED')
  await fs.unlink(receiptAbsolute)
  return { removed }
}
