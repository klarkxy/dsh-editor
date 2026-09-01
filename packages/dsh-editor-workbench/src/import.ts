import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTextFile, FileOpError, listDirStrict, normalizeWorkspaceRelative, readTextFile, writeTextFile, type WorkspaceFileContext } from 'dsh-manuscript/host-api'

export const IMPORT_RECEIPT_PATH = '.dsh-editor-import.json'
const MAX_FILES = 2_000
const MAX_TOTAL_BYTES = 100_000_000
export type ImportAccess = { path: string; rootKey: string; mode: string; files: WorkspaceFileContext }
export type ImportFile = { source: string; target: string; version: string; bytes: number; sha256: string }
type ImportReceipt = { version: 1; receiptId: string; state: 'copying' | 'cleaning' | 'complete'; probeToken: string; sourceRootKey: string; targetRootKey: string; files: ImportFile[] }
type StoredReceipt = { receipt: ImportReceipt; version: string }
export type ImportProbe = { state: 'none' | 'ready' | 'blocked' | 'recoverable' | 'complete'; token?: string; receiptId?: string; files: number; bytes: number; skipped: Array<{ path: string; reason: 'hidden' | 'symlink' | 'other' | 'nonText' }>; preview: string[]; message?: string }
export class ImportError extends Error {
  constructor(message: string, readonly code: 'READ_ONLY' | 'TARGET_NOT_EMPTY' | 'NESTED' | 'BLOCKED' | 'STALE' | 'CLEANUP_BLOCKED' | 'IO') { super(message); this.name = 'ImportError' }
}

function hash(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }
function bytes(text: string): number { return new TextEncoder().encode(text).byteLength }
function token(source: ImportAccess, target: ImportAccess, files: readonly ImportFile[]): string { return hash(JSON.stringify({ version: 1, source: source.rootKey, target: target.rootKey, files })) }
function hidden(relative: string): boolean { return relative.split('/').some((part) => part.startsWith('.')) }
function nested(a: string, b: string): boolean { const rel = path.relative(a, b); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) }
function targetPath(relative: string): string { return `正文/${relative.replace(/\.txt$/i, '.md')}` }
function normal(value: string): string { return value.split(path.sep).join('/') }
function summary(receipt: ImportReceipt, state: ImportProbe['state']): ImportProbe { return { state, receiptId: receipt.receiptId, files: receipt.files.length, bytes: receipt.files.reduce((sum, file) => sum + file.bytes, 0), skipped: [], preview: receipt.files.slice(0, 12).map((file) => file.target) } }

async function assertRoot(root: string): Promise<void> {
  const state = await fs.lstat(root)
  if (state.isSymbolicLink() || !state.isDirectory()) throw new ImportError('workspace root is not a safe directory', 'BLOCKED')
}
function validReceiptFile(file: unknown, seen: Set<string>): file is ImportFile {
  if (!file || typeof file !== 'object') return false
  const item = file as Partial<ImportFile>
  if (typeof item.source !== 'string' || typeof item.target !== 'string' || typeof item.version !== 'string' || !item.version || typeof item.bytes !== 'number' || !Number.isInteger(item.bytes) || item.bytes < 0 || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) return false
  try {
    if (normalizeWorkspaceRelative(item.source) !== item.source || normalizeWorkspaceRelative(item.target) !== item.target || hidden(item.source) || hidden(item.target) || !item.target.startsWith('正文/')) return false
  } catch { return false }
  const key = item.target.normalize('NFC').toLocaleLowerCase()
  if (seen.has(key)) return false
  seen.add(key)
  return true
}
async function safeNode(root: string, relative: string): Promise<string> {
  const normalized = normalizeWorkspaceRelative(relative)
  const target = path.resolve(root, ...normalized.split('/'))
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new ImportError('cleanup path escapes target', 'CLEANUP_BLOCKED')
  const canonicalRoot = await fs.realpath(root)
  let cursor = root
  for (const part of normalized.split('/')) {
    cursor = path.join(cursor, part)
    const state = await fs.lstat(cursor)
    if (state.isSymbolicLink()) throw new ImportError('cleanup path contains a symlink or junction', 'CLEANUP_BLOCKED')
    if (cursor !== target && !state.isDirectory()) throw new ImportError('cleanup parent is not a directory', 'CLEANUP_BLOCKED')
  }
  const parent = await fs.realpath(path.dirname(target))
  if (parent !== canonicalRoot && !parent.startsWith(`${canonicalRoot}${path.sep}`)) throw new ImportError('cleanup path escapes target', 'CLEANUP_BLOCKED')
  return target
}
async function readReceipt(target: ImportAccess): Promise<StoredReceipt | undefined> {
  try {
    const loaded = await readTextFile(target.files, IMPORT_RECEIPT_PATH)
    const value = JSON.parse(loaded.text) as Partial<ImportReceipt>
    if (value.version !== 1 || typeof value.receiptId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.receiptId) || (value.state !== 'copying' && value.state !== 'cleaning' && value.state !== 'complete') || typeof value.probeToken !== 'string' || !/^[0-9a-f]{64}$/.test(value.probeToken) || typeof value.sourceRootKey !== 'string' || !value.sourceRootKey || typeof value.targetRootKey !== 'string' || value.targetRootKey !== target.rootKey || !Array.isArray(value.files)) return undefined
    const seen = new Set<string>()
    if (!value.files.every((file) => validReceiptFile(file, seen))) return undefined
    return { receipt: value as ImportReceipt, version: loaded.version }
  } catch (error) {
    if (error instanceof FileOpError || error instanceof SyntaxError) return undefined
    throw error
  }
}
async function storeReceipt(target: ImportAccess, receipt: ImportReceipt, version?: string): Promise<string> {
  const text = JSON.stringify(receipt)
  return version ? (await writeTextFile(target.files, IMPORT_RECEIPT_PATH, text, version)).version : (await createTextFile(target.files, IMPORT_RECEIPT_PATH, text)).version
}

async function walk(source: ImportAccess): Promise<{ files: ImportFile[]; skipped: ImportProbe['skipped'] }> {
  await assertRoot(source.path)
  const files: ImportFile[] = []; const skipped: ImportProbe['skipped'] = []; const targets = new Map<string, string>(); const queue = ['']; let total = 0
  while (queue.length) {
    const relativeDir = queue.shift()!
    const entries = await listDirStrict(source.files, relativeDir || '.')
    for (const entry of entries) {
      const relative = normal(path.join(relativeDir, entry.name))
      if (hidden(relative)) { skipped.push({ path: relative, reason: 'hidden' }); continue }
      if (entry.type === 'directory') { queue.push(relative); continue }
      if (entry.type !== 'file' || !/\.(md|txt)$/i.test(entry.name)) { skipped.push({ path: relative, reason: 'other' }); continue }
      let loaded
      try { loaded = await readTextFile(source.files, relative) } catch (error) {
        if (error instanceof FileOpError && (error.code === 'NOT_TEXT' || error.code === 'IO')) { skipped.push({ path: relative, reason: 'nonText' }); continue }
        throw error
      }
      const size = bytes(loaded.text)
      if (size > 2_000_000) throw new ImportError(`${relative} exceeds 2 MB`, 'BLOCKED')
      total += size
      if (files.length + 1 > MAX_FILES || total > MAX_TOTAL_BYTES) throw new ImportError('import exceeds its bounded file or byte limit', 'BLOCKED')
      const target = targetPath(relative); const folded = target.normalize('NFC').toLocaleLowerCase()
      if (targets.has(folded)) throw new ImportError(`${relative} conflicts with ${targets.get(folded)}`, 'BLOCKED')
      targets.set(folded, relative); files.push({ source: relative, target, version: loaded.version, bytes: size, sha256: hash(loaded.text) })
    }
  }
  return { files: files.sort((a, b) => a.target.localeCompare(b.target)), skipped }
}
async function emptyTarget(target: ImportAccess): Promise<boolean> { await assertRoot(target.path); return (await listDirStrict(target.files, '.')).length === 0 }
async function mkdirSafe(root: string, relative: string): Promise<void> {
  let cursor = root
  for (const part of relative.split('/').filter(Boolean)) {
    cursor = path.join(cursor, part)
    try { await fs.mkdir(cursor) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const state = await fs.lstat(cursor)
    if (state.isSymbolicLink() || !state.isDirectory()) throw new ImportError('target contains an unsafe directory component', 'BLOCKED')
  }
}

export async function probeImport(input: { target: ImportAccess; source?: ImportAccess }): Promise<ImportProbe> {
  const receipt = await readReceipt(input.target)
  if (!input.source) return receipt ? { ...summary(receipt.receipt, receipt.receipt.state === 'complete' ? 'complete' : 'recoverable'), message: receipt.receipt.state === 'cleaning' ? 'cleaning' : undefined } : { state: 'none', files: 0, bytes: 0, skipped: [], preview: [] }
  if (input.target.mode === 'read-only') return { state: 'blocked', files: 0, bytes: 0, skipped: [], preview: [], message: '目标目录不可写' }
  if (nested(path.resolve(input.source.path), path.resolve(input.target.path)) || nested(path.resolve(input.target.path), path.resolve(input.source.path))) return { state: 'blocked', files: 0, bytes: 0, skipped: [], preview: [], message: '源目录与目标目录不能相同或互相嵌套' }
  if (receipt?.receipt.state === 'complete') return summary(receipt.receipt, 'complete')
  if (receipt?.receipt.state === 'cleaning') return { ...summary(receipt.receipt, 'recoverable'), message: '清理尚未完成，请继续清理。' }
  if (!receipt && !await emptyTarget(input.target)) return { state: 'blocked', files: 0, bytes: 0, skipped: [], preview: [], message: '目标目录必须为空' }
  const scanned = await walk(input.source)
  if (!scanned.files.length) return { state: 'blocked', files: 0, bytes: 0, skipped: scanned.skipped, preview: [], message: '源目录没有可导入的 Markdown 或 TXT 文件' }
  if (receipt && (receipt.receipt.sourceRootKey !== input.source.rootKey || receipt.receipt.targetRootKey !== input.target.rootKey || receipt.receipt.probeToken !== token(input.source, input.target, scanned.files) || JSON.stringify(receipt.receipt.files) !== JSON.stringify(scanned.files))) {
    return { state: 'blocked', files: scanned.files.length, bytes: scanned.files.reduce((sum, file) => sum + file.bytes, 0), skipped: scanned.skipped, preview: scanned.files.slice(0, 12).map((file) => file.target), message: '源目录已变化，未完成导入只能清理' }
  }
  return { state: 'ready', token: token(input.source, input.target, scanned.files), files: scanned.files.length, bytes: scanned.files.reduce((sum, file) => sum + file.bytes, 0), skipped: scanned.skipped, preview: scanned.files.slice(0, 12).map((file) => file.target) }
}

export async function applyImport(input: { source: ImportAccess; target: ImportAccess; token: string }): Promise<{ imported: number; skipped: number }> {
  const initial = await probeImport(input)
  if (initial.state !== 'ready' || initial.token !== input.token) throw new ImportError('source or target changed; probe again before importing', 'STALE')
  const scanned = await walk(input.source)
  if (token(input.source, input.target, scanned.files) !== input.token) throw new ImportError('source changed during reprobe', 'STALE')
  let stored = await readReceipt(input.target)
  if (stored && stored.receipt.state !== 'copying') throw new ImportError('only an interrupted copy can continue', 'BLOCKED')
  if (!stored) {
    if (!await emptyTarget(input.target)) throw new ImportError('target changed after probe', 'STALE')
    const receipt: ImportReceipt = { version: 1, receiptId: randomUUID(), state: 'copying', probeToken: input.token, sourceRootKey: input.source.rootKey, targetRootKey: input.target.rootKey, files: scanned.files }
    stored = { receipt, version: await storeReceipt(input.target, receipt) }
  }
  if (stored.receipt.probeToken !== input.token || stored.receipt.sourceRootKey !== input.source.rootKey || stored.receipt.targetRootKey !== input.target.rootKey || JSON.stringify(stored.receipt.files) !== JSON.stringify(scanned.files)) throw new ImportError('source no longer matches the interrupted import receipt', 'STALE')
  let imported = 0; let skipped = 0
  for (const file of stored.receipt.files) {
    try {
      const current = await readTextFile(input.target.files, file.target)
      if (hash(current.text) === file.sha256) { skipped++; continue }
      throw new ImportError(`${file.target} changed after interrupted import`, 'STALE')
    } catch (error) {
      if (!(error instanceof FileOpError && error.code === 'NOT_FOUND')) throw error
    }
    const current = await readTextFile(input.source.files, file.source)
    if (current.version !== file.version || hash(current.text) !== file.sha256) throw new ImportError('source changed; clean the interrupted import before retrying', 'STALE')
    await mkdirSafe(input.target.path, path.posix.dirname(file.target))
    await createTextFile(input.target.files, file.target, current.text)
    imported++
  }
  await storeReceipt(input.target, { ...stored.receipt, state: 'complete' }, stored.version)
  return { imported, skipped }
}

export async function cleanupImport(input: { target: ImportAccess; receiptId: string }): Promise<{ removed: number }> {
  const stored = await readReceipt(input.target)
  if (!stored || stored.receipt.state === 'complete') throw new ImportError('only an interrupted import can be cleaned', 'BLOCKED')
  if (!input.receiptId || stored.receipt.receiptId !== input.receiptId) throw new ImportError('import receipt identity does not match', 'CLEANUP_BLOCKED')
  if (input.target.mode === 'read-only') throw new ImportError('target directory is read-only', 'READ_ONLY')
  for (const file of stored.receipt.files) {
    try { if (hash((await readTextFile(input.target.files, file.target)).text) !== file.sha256) throw new ImportError('an imported file changed; cleanup stopped without deleting anything', 'CLEANUP_BLOCKED') } catch (error) { if (!(error instanceof FileOpError && error.code === 'NOT_FOUND')) throw error }
  }
  const cleaningVersion = await storeReceipt(input.target, { ...stored.receipt, state: 'cleaning' }, stored.version)
  let removed = 0
  for (const file of [...stored.receipt.files].reverse()) {
    try {
      const current = await readTextFile(input.target.files, file.target)
      if (hash(current.text) !== file.sha256) throw new ImportError('an imported file changed during cleanup', 'CLEANUP_BLOCKED')
      await fs.unlink(await safeNode(input.target.path, file.target)); removed++
    } catch (error) { if (!(error instanceof FileOpError && error.code === 'NOT_FOUND') && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const directories = [...new Set(stored.receipt.files.map((file) => path.posix.dirname(file.target)).filter((dir) => dir !== '.'))].sort((a, b) => b.length - a.length)
  for (const directory of directories) { try { await fs.rmdir(await safeNode(input.target.path, directory)) } catch { /* preserve user content */ } }
  const receipt = await readReceipt(input.target)
  if (!receipt || receipt.version !== cleaningVersion || receipt.receipt.state !== 'cleaning') throw new ImportError('import receipt changed during cleanup', 'CLEANUP_BLOCKED')
  await fs.unlink(await safeNode(input.target.path, IMPORT_RECEIPT_PATH))
  return { removed }
}
