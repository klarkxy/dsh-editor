import { randomBytes } from 'node:crypto'
import path from 'node:path'
import {
  createTextFile,
  FileOpError,
  findUniqueIndex,
  listDirStrict,
  MAX_TEXT_BYTES,
  readTextFile,
  visibleTargetPath,
  writeTextFile,
} from 'dsh-manuscript/host-api'
import { mkdirSafe as mkdirSafeWalk } from '../kit/entries.ts'
import { archiveDocument, listArchives, moveDocument, restoreArchive } from '../lifecycle/lifecycle.ts'
import type { MemoryAccess } from '../memory/memory.ts'
import { applyCreate, prepareCreate } from '../proposals/planning-proposals.ts'
import { applySplit, snapshotProposalTargets } from '../proposals/proposal-ops.ts'
import {
  WRITING_CHANGE_MARKER,
  type WritingChangeEdit,
  type WritingChangeKind,
  type WritingChangeReceipt,
  type WritingChangeRecord,
  type WritingChangeRename,
} from './change-contracts.ts'

export type WritingChangeAccess = Pick<MemoryAccess, 'path' | 'rootKey' | 'mode' | 'files' | 'sessionId' | 'hasDraft'>

export type WritingChangeInput =
  | { kind: 'edit'; path: string; summary: string; edits: WritingChangeEdit[] }
  | { kind: 'create'; path: string; summary: string; text: string }
  | { kind: 'split'; path: string; summary: string; anchor: string; newPath: string }
  | { kind: 'merge'; path: string; summary: string; sourcePath: string }
  | { kind: 'renames'; summary: string; renames: WritingChangeRename[] }

export type WritingChangeOptions = {
  /** Injectable sleep for the draft race window; defaults to setTimeout. */
  wait?: (ms: number) => Promise<void>
  draftPollMs?: number
  draftTimeoutMs?: number
}

export class WritingChangeError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID' | 'STALE' | 'BLOCKED' | 'AMBIGUOUS' | 'EXISTS' | 'NOT_FOUND' | 'IO',
  ) {
    super(message)
    this.name = 'WritingChangeError'
  }
}

const HISTORY = '.dsh-editor/history/writing'
const ID = /^[a-f0-9]{32}$/
const MAX_EDITS = 50
const MAX_RENAMES = 50

type StoredRecord = WritingChangeRecord & { writing?: boolean }

function mkdirSafe(root: string, relative: string): Promise<void> {
  return mkdirSafeWalk(root, relative, (kind) => {
    if (kind === 'unsafe-root') return new WritingChangeError('工作目录不安全', 'IO')
    if (kind === 'unsafe-dir') return new WritingChangeError('写入记录目录不安全', 'IO')
    return new WritingChangeError('写入记录目录越界', 'IO')
  })
}

function recordPath(id: string): string {
  if (!ID.test(id)) throw new WritingChangeError('修改记录标识无效。', 'INVALID')
  return `${HISTORY}/${id}.json`
}

async function optionalFile(files: WritingChangeAccess['files'], relative: string) {
  try { return await readTextFile(files, relative) } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') return null
    throw error
  }
}

async function saveRecord(access: WritingChangeAccess, record: StoredRecord): Promise<void> {
  const text = JSON.stringify(record, null, 2)
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new WritingChangeError('修改记录过大。', 'INVALID')
  await mkdirSafe(access.path, HISTORY)
  const relative = recordPath(record.id)
  const existing = await optionalFile(access.files, relative)
  if (existing) await writeTextFile(access.files, relative, text, existing.version)
  else await createTextFile(access.files, relative, text)
}

function validateRecordShape(value: unknown, id: string): StoredRecord {
  const record = value as StoredRecord | null | undefined
  if (!record || record.version !== 1 || record.id !== id
    || typeof record.sessionId !== 'string' || typeof record.createdAt !== 'string'
    || typeof record.summary !== 'string'
    || !['edit', 'create', 'split', 'merge', 'renames'].includes(record.kind)
    || !['applied', 'undone'].includes(record.status)
    || !Array.isArray(record.files)
    || !record.files.every((file) => file && typeof file.path === 'string'
      && (file.before === null || typeof file.before === 'string')
      && (file.after === null || typeof file.after === 'string'))) {
    throw new WritingChangeError('修改历史格式无效。', 'IO')
  }
  return record
}

export function changeReceipt(record: WritingChangeRecord): WritingChangeReceipt {
  const paths = [...new Set(record.files.map((file) => file.path))]
  const count = record.kind === 'edit' ? (record.edits?.length ?? record.files.length)
    : record.kind === 'renames' ? (record.renames?.length ?? record.files.length)
    : record.files.length
  return {
    marker: WRITING_CHANGE_MARKER, version: 1, id: record.id, kind: record.kind,
    summary: record.summary, status: record.status, paths, count,
    ...(record.message ? { message: record.message } : {}),
  }
}

/** Read a journal record; recover a lost post-write receipt by comparing file contents. */
export async function getWritingChange(access: WritingChangeAccess, id: string): Promise<StoredRecord> {
  const file = await readTextFile(access.files, recordPath(id))
  let record: StoredRecord
  try { record = JSON.parse(file.text) } catch { throw new WritingChangeError('修改历史文件损坏。', 'IO') }
  record = validateRecordShape(record, id)
  if (!record.writing) return record
  // A process may have exited between the file writes and the final journal write.
  let complete = true
  for (const entry of record.files) {
    const current = await optionalFile(access.files, entry.path)
    if (entry.after === null ? current !== null : current?.text !== entry.after) { complete = false; break }
  }
  if (complete) return { ...record, writing: false }
  return { ...record, writing: false, message: '上次写入可能未完成，请核对文件后再试。' }
}

function assertWritable(access: WritingChangeAccess): void {
  if (access.mode === 'read-only' || access.files.policy.mode === 'read-only') {
    throw new WritingChangeError('作品只读，未写入修改。', 'BLOCKED')
  }
}

async function waitForClearDraft(access: WritingChangeAccess, relative: string, options: WritingChangeOptions): Promise<void> {
  if (!access.hasDraft(relative)) return
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const poll = options.draftPollMs ?? 200
  const timeout = options.draftTimeoutMs ?? 3_000
  let elapsed = 0
  while (elapsed < timeout) {
    await wait(poll)
    elapsed += poll
    if (!access.hasDraft(relative)) return
  }
  throw new WritingChangeError(`《${relative}》有未保存的修改，作者正在编辑，稍后再试。`, 'BLOCKED')
}

async function guardDrafts(access: WritingChangeAccess, paths: readonly string[], options: WritingChangeOptions): Promise<void> {
  for (const relative of [...new Set(paths)]) await waitForClearDraft(access, relative, options)
}

function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new WritingChangeError(`${label} 必须是非空字符串。`, 'INVALID')
  return value
}

export function parseWritingChange(value: unknown): WritingChangeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WritingChangeError('修改参数无效。', 'INVALID')
  const v = value as Record<string, unknown>
  const allowed = ['kind', 'path', 'summary', 'edits', 'text', 'anchor', 'newPath', 'sourcePath', 'renames']
  if (Object.keys(v).some((key) => !allowed.includes(key))) throw new WritingChangeError('修改参数包含未知字段。', 'INVALID')
  const kind = String(v.kind ?? '') as WritingChangeKind
  if (!['edit', 'create', 'split', 'merge', 'renames'].includes(kind)) throw new WritingChangeError('kind 必须是 edit、create、split、merge 或 renames。', 'INVALID')
  const summary = str(v.summary, 'summary').trim()
  const parseEdits = (raw: unknown): WritingChangeEdit[] => {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_EDITS) throw new WritingChangeError('edits 需要 1–50 项 { oldText, newText }。', 'INVALID')
    return raw.map((item): WritingChangeEdit => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new WritingChangeError('edits 项必须是对象。', 'INVALID')
      const entry = item as Record<string, unknown>
      if (Object.keys(entry).some((key) => !['oldText', 'newText'].includes(key))) throw new WritingChangeError('edits 项只能包含 oldText 和 newText。', 'INVALID')
      if (typeof entry.oldText !== 'string' || typeof entry.newText !== 'string') throw new WritingChangeError('edits 项需要 oldText 和 newText 字符串。', 'INVALID')
      if (entry.oldText === entry.newText) throw new WritingChangeError('替换前后内容相同，未写入。', 'INVALID')
      return { oldText: entry.oldText, newText: entry.newText }
    })
  }
  if (kind === 'edit') return { kind, path: visibleTargetPath(v.path), summary, edits: parseEdits(v.edits) }
  if (kind === 'create') return { kind, path: visibleTargetPath(v.path), summary, text: str(v.text, 'text') }
  if (kind === 'split') return { kind, path: visibleTargetPath(v.path), summary, anchor: str(v.anchor, 'anchor'), newPath: visibleTargetPath(v.newPath) }
  if (kind === 'merge') return { kind, path: visibleTargetPath(v.path), summary, sourcePath: visibleTargetPath(v.sourcePath) }
  const raw = v.renames
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_RENAMES) throw new WritingChangeError('renames 需要 1–50 项 { from, to }。', 'INVALID')
  const renames = raw.map((item): WritingChangeRename => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new WritingChangeError('renames 项必须是对象。', 'INVALID')
    const entry = item as Record<string, unknown>
    if (Object.keys(entry).some((key) => !['from', 'to'].includes(key))) throw new WritingChangeError('renames 项只能包含 from 和 to。', 'INVALID')
    return { from: visibleTargetPath(entry.from), to: visibleTargetPath(entry.to) }
  })
  if (new Set([...renames.map((r) => r.from), ...renames.map((r) => r.to)]).size !== renames.length * 2) throw new WritingChangeError('renames 中存在重复或冲突的路径。', 'INVALID')
  return { kind, summary, renames }
}

/** Apply every replacement to the current text; throws before touching anything on any invalid edit. */
export function applyEditsToText(text: string, edits: readonly WritingChangeEdit[]): string {
  if (edits.length === 1 && edits[0]!.oldText === '') {
    if (text.trim()) throw new WritingChangeError('oldText 为空只能填充当前为空的文件。', 'INVALID')
    return edits[0]!.newText
  }
  if (edits.some((edit) => edit.oldText === '')) throw new WritingChangeError('oldText 为空只能作为唯一一处修改填充空文件。', 'INVALID')
  const ranges = edits.map((edit, index) => {
    const at = findUniqueIndex(text, edit.oldText)
    if (at === -1) throw new WritingChangeError(`第 ${index + 1} 处原文在文件中找不到，请重新读取文件后再修改。`, 'STALE')
    if (at === -2) throw new WritingChangeError(`第 ${index + 1} 处原文在文件中出现多次，请提供更长的唯一片段。`, 'AMBIGUOUS')
    return { at, end: at + edit.oldText.length, edit }
  }).sort((a, b) => a.at - b.at)
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i]!.at < ranges[i - 1]!.end) throw new WritingChangeError('替换片段相互重叠，请合并为不重叠的修改。', 'INVALID')
  }
  let next = text
  for (const range of [...ranges].reverse()) {
    next = next.slice(0, range.at) + range.edit.newText + next.slice(range.end)
  }
  return next
}

function draftGuardPaths(input: WritingChangeInput): string[] {
  switch (input.kind) {
    case 'edit':
    case 'create': return [input.path]
    case 'split': return [input.path, input.newPath]
    case 'merge': return [input.path, input.sourcePath]
    case 'renames': return input.renames.flatMap((entry) => [entry.from, entry.to])
  }
}

export async function applyWritingChange(
  access: WritingChangeAccess,
  input: WritingChangeInput,
  options: WritingChangeOptions = {},
): Promise<{ record: StoredRecord; receipt: WritingChangeReceipt }> {
  assertWritable(access)
  await guardDrafts(access, draftGuardPaths(input), options)
  const record: StoredRecord = {
    version: 1, id: randomBytes(16).toString('hex'), sessionId: access.sessionId,
    createdAt: new Date().toISOString(), kind: input.kind, summary: input.summary,
    status: 'applied', files: [],
    ...(input.kind === 'edit' ? { edits: input.edits } : {}),
    ...(input.kind === 'renames' ? { renames: input.renames } : {}),
  }
  if (input.kind === 'edit') {
    const current = await readTextFile(access.files, input.path)
    const after = applyEditsToText(current.text, input.edits)
    record.files = [{ path: input.path, before: current.text, after }]
    record.writing = true
    await saveRecord(access, record)
    try {
      await writeTextFile(access.files, input.path, after, current.version)
    } catch (error) { throw await journalFailure(access, record, error) }
  } else if (input.kind === 'create') {
    const proposal = { kind: 'create' as const, path: input.path, text: input.text, targetPolicy: 'exclusive' as const }
    const prepared = await prepareCreate(access.files, proposal)
    record.files = [{ path: input.path, before: null, after: input.text }]
    record.writing = true
    await saveRecord(access, record)
    try {
      await applyCreate(access.files, proposal, prepared.version)
    } catch (error) { throw await journalFailure(access, record, error) }
  } else if (input.kind === 'split') {
    const current = await readTextFile(access.files, input.path)
    const anchorAt = findUniqueIndex(current.text, input.anchor)
    if (anchorAt === -1) throw new WritingChangeError(`anchor 在《${input.path}》中找不到，请重新读取文件后再修改。`, 'STALE')
    if (anchorAt === -2) throw new WritingChangeError(`anchor 在《${input.path}》中出现多次，请提供更长的唯一片段。`, 'AMBIGUOUS')
    const head = current.text.slice(0, anchorAt).trimEnd()
    const tail = current.text.slice(anchorAt)
    record.files = [
      { path: input.path, before: current.text, after: head },
      { path: input.newPath, before: null, after: tail },
    ]
    record.writing = true
    await saveRecord(access, record)
    try {
      await applySplit(access.files, { kind: 'split', path: input.path, anchor: input.anchor, newPath: input.newPath }, current.version)
    } catch (error) { throw await journalFailure(access, record, error) }
  } else if (input.kind === 'merge') {
    const [target, source] = await Promise.all([
      readTextFile(access.files, input.path),
      readTextFile(access.files, input.sourcePath),
    ])
    const merged = `${target.text.trimEnd()}\n\n${source.text.trim()}\n`
    record.files = [
      { path: input.path, before: target.text, after: merged },
      { path: input.sourcePath, before: source.text, after: null },
    ]
    record.writing = true
    await saveRecord(access, record)
    try {
      await snapshotProposalTargets(access.files, [input.path, input.sourcePath])
      await writeTextFile(access.files, input.path, merged, target.version)
      const archive = await archiveDocument({ access, path: input.sourcePath, expectedVersion: source.version })
      if (archive.state !== 'archived') throw new WritingChangeError('来源文件归档未完成，请检查作品后再试。', 'IO')
      record.archiveId = archive.archiveId
    } catch (error) { throw await journalFailure(access, record, error) }
  } else {
    const versions = new Map<string, { version: string; text: string }>()
    for (const entry of input.renames) {
      const targetDirectory = path.posix.dirname(entry.to)
      try { await listDirStrict(access.files, targetDirectory) } catch (error) {
        if (error instanceof FileOpError && error.code === 'NOT_FOUND') throw new WritingChangeError(`目标目录 ${targetDirectory} 不存在。`, 'INVALID')
        throw error
      }
      if (await optionalFile(access.files, entry.to)) throw new WritingChangeError(`目标文件《${entry.to}》已存在，未移动。`, 'EXISTS')
      const loaded = await readTextFile(access.files, entry.from)
      versions.set(entry.from, { version: loaded.version, text: loaded.text })
    }
    record.files = input.renames.flatMap((entry) => {
      const text = versions.get(entry.from)!.text
      return [
        { path: entry.from, before: text, after: null },
        { path: entry.to, before: null, after: text },
      ]
    })
    record.writing = true
    await saveRecord(access, record)
    try {
      await snapshotProposalTargets(access.files, input.renames.map((entry) => entry.from))
      const actual: WritingChangeRename[] = []
      for (const entry of input.renames) {
        const moved = await moveDocument({ access, path: entry.from, targetPath: entry.to, expectedVersion: versions.get(entry.from)!.version })
        actual.push({ from: entry.from, to: moved.path })
      }
      record.renames = actual
    } catch (error) { throw await journalFailure(access, record, error) }
  }
  record.writing = false
  await saveRecord(access, record)
  return { record, receipt: changeReceipt(record) }
}

async function journalFailure(access: WritingChangeAccess, record: StoredRecord, error: unknown): Promise<Error> {
  // Keep writing=true when a commit may have landed; get() recovers from file contents.
  record.message = error instanceof Error ? error.message : String(error)
  try { await saveRecord({ ...access, files: { ...access.files, signal: undefined } }, record) } catch { /* the pre-write journal remains the recovery source */ }
  return error instanceof Error ? error : new WritingChangeError(String(error), 'IO')
}

export async function undoWritingChange(
  access: WritingChangeAccess,
  id: string,
  options: WritingChangeOptions = {},
): Promise<{ record: StoredRecord; receipt: WritingChangeReceipt }> {
  assertWritable(access)
  const record = await getWritingChange(access, id)
  if (record.status === 'undone') return { record, receipt: changeReceipt(record) }
  await guardDrafts(access, record.files.map((file) => file.path), options)
  let message: string | undefined
  if (record.kind === 'edit') {
    const file = record.files[0]!
    const current = await optionalFile(access.files, file.path)
    if (!current) throw new WritingChangeError(`《${file.path}》已不存在，无法自动撤销。`, 'STALE')
    if (current.text === file.after) {
      await writeTextFile(access.files, file.path, file.before ?? '', current.version)
    } else {
      const edits = record.edits ?? []
      const reversible = edits.map((edit) => ({ at: findUniqueIndex(current.text, edit.newText), edit }))
      const applicable = reversible.filter((entry) => entry.at >= 0)
        .map((entry) => ({ at: entry.at, end: entry.at + entry.edit.newText.length, edit: entry.edit }))
        .sort((a, b) => a.at - b.at)
      const skipped = edits.length - applicable.length
      if (!applicable.length) throw new WritingChangeError('文件内容已变化，无法自动撤销。', 'BLOCKED')
      for (let i = 1; i < applicable.length; i += 1) {
        if (applicable[i]!.at < applicable[i - 1]!.end) throw new WritingChangeError('文件内容已变化，无法自动撤销。', 'BLOCKED')
      }
      let next = current.text
      for (const range of [...applicable].reverse()) {
        next = next.slice(0, range.at) + range.edit.oldText + next.slice(range.end)
      }
      await writeTextFile(access.files, file.path, next, current.version)
      if (skipped) message = `有 ${skipped} 处已被改动，未撤销。`
    }
  } else if (record.kind === 'create') {
    const file = record.files[0]!
    const current = await optionalFile(access.files, file.path)
    if (!current) throw new WritingChangeError(`《${file.path}》已不存在，请在归档中核对。`, 'STALE')
    if (current.text !== file.after) throw new WritingChangeError(`《${file.path}》内容已变化，无法自动撤销新建。`, 'BLOCKED')
    const archive = await archiveDocument({ access, path: file.path, expectedVersion: current.version })
    if (archive.state !== 'archived') throw new WritingChangeError('撤销归档未完成，请检查作品。', 'IO')
  } else if (record.kind === 'split') {
    const [head, tail] = record.files
    const current = await optionalFile(access.files, head!.path)
    const created = await optionalFile(access.files, tail!.path)
    if (!current || !created || current.text !== head!.after || created.text !== tail!.after) {
      throw new WritingChangeError('拆分后的文件已变化，无法自动撤销。', 'BLOCKED')
    }
    await writeTextFile(access.files, head!.path, head!.before ?? '', current.version)
    const archive = await archiveDocument({ access, path: tail!.path, expectedVersion: created.version })
    if (archive.state !== 'archived') throw new WritingChangeError('拆分文件归档未完成，请检查作品。', 'IO')
  } else if (record.kind === 'merge') {
    const [target, source] = record.files
    const current = await optionalFile(access.files, target!.path)
    const restored = await optionalFile(access.files, source!.path)
    if (!current || current.text !== target!.after || restored) {
      throw new WritingChangeError('合并后的文件已变化，无法自动撤销。', 'BLOCKED')
    }
    if (!record.archiveId) throw new WritingChangeError('缺少归档记录，无法自动撤销合并。', 'IO')
    const archive = (await listArchives(access)).items.find((item) => item.archiveId === record.archiveId)
    if (!archive || archive.state !== 'archived' || !archive.version) throw new WritingChangeError('归档记录已变化，无法自动撤销合并。', 'STALE')
    const restoredArchive = await restoreArchive({ access, archiveId: record.archiveId, expectedVersion: archive.version })
    if (restoredArchive.state !== 'restored') throw new WritingChangeError('来源文件恢复未完成，请检查作品。', 'IO')
    await writeTextFile(access.files, target!.path, target!.before ?? '', current.version)
  } else {
    const renames = record.renames ?? []
    let reversed = 0
    const skipped: string[] = []
    for (const entry of renames) {
      const moved = await optionalFile(access.files, entry.to)
      const original = await optionalFile(access.files, entry.from)
      if (moved && !original) {
        await moveDocument({ access, path: entry.to, targetPath: entry.from, expectedVersion: moved.version })
        reversed += 1
      } else skipped.push(entry.to)
    }
    if (!reversed) throw new WritingChangeError('文件已变化，没有可自动撤销的移动。', 'BLOCKED')
    if (skipped.length) message = `有 ${skipped.length} 个移动未撤销：${skipped.join('、')}。`
  }
  record.status = 'undone'
  record.message = message ?? '已撤销。'
  await saveRecord(access, record)
  return { record, receipt: changeReceipt(record) }
}
