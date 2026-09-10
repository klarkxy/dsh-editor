import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { createTextFile, FileOpError, listDirStrict, MAX_TEXT_BYTES, readProjectRules, readTextFile, writeTextFile, type WorkspaceFileContext } from 'dsh-manuscript/host-api'
import { archiveDocument, prepareArchiveDocument, type LifecycleAccess } from './lifecycle.ts'
import { ProposalOpsError } from './proposal-ops.ts'
import { mkdirSafe as mkdirSafeWalk } from './kit/entries.ts'
import { parseProjectContextEnvelope } from './contracts.ts'
import type { MemoryChange, MemoryChangeSummary, MemoryEvidence, MemoryUpdate, MemoryUpdateReceipt } from './memory-contracts.ts'

function mkdirSafe(root: string, relative: string): Promise<void> {
  return mkdirSafeWalk(root, relative, (kind) => {
    if (kind === 'unsafe-root') return new ProposalOpsError('工作目录不安全', 'IO')
    if (kind === 'unsafe-dir') return new ProposalOpsError('快照目录不安全', 'IO')
    return new ProposalOpsError('快照目录越界', 'IO')
  })
}

const HISTORY = '.dsh-editor/history/memory'
const ID = /^[a-f0-9]{64}$/
type MessageEvent = { type: string; data: { id?: string; source?: { kind?: string }; content?: Array<{ type: string; text?: string }> } }
export type MemoryAccess = LifecycleAccess & {
  sessionId: string
  events: readonly MessageEvent[]
  hasDraft: (path: string) => boolean
}
type StoredRecord = MemoryChange & { writing?: boolean; archiveId?: string }

export class MemoryError extends Error {
  constructor(message: string, readonly code: 'INVALID' | 'STALE' | 'BLOCKED' | 'IO') { super(message) }
}

export function memoryTarget(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\\') || /[\u0000-\u001f<>:"|?*]/.test(value)) throw new MemoryError('维护目标必须是项目内 Markdown 文件。', 'INVALID')
  if (/^agents\.md$/i.test(value)) return value
  const parts = value.split('/')
  if (!['世界书', '人物卡'].includes(parts[0] ?? '') || parts.length < 2 || !/\.md$/i.test(value)
    || parts.some(part => !part || part.startsWith('.') || /[. ]$/.test(part))) throw new MemoryError('只能维护根规则文件、世界书和人物卡。', 'INVALID')
  return value
}

export function parseMemoryUpdate(value: unknown): MemoryUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MemoryError('维护参数无效。', 'INVALID')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['path', 'operation', 'summary', 'expectedVersion', 'category', 'certainty', 'evidence', 'text', 'oldText', 'newText'].includes(k))) throw new MemoryError('维护参数包含未知字段。', 'INVALID')
  const target = memoryTarget(v.path)
  if (!['create', 'append', 'edit'].includes(String(v.operation)) || !['rule', 'fact'].includes(String(v.category))
    || !['explicit', 'uncertain'].includes(String(v.certainty)) || typeof v.summary !== 'string' || !v.summary.trim()
    || !(v.expectedVersion === null || typeof v.expectedVersion === 'string' && v.expectedVersion.length > 0)) throw new MemoryError('维护需要操作、说明、确定性和预期版本。', 'INVALID')
  if ((v.category === 'rule') !== /^agents\.md$/i.test(target)) throw new MemoryError('规则只写入 AGENTS.md；作品事实只写入世界书或人物卡。', 'INVALID')
  if (v.operation === 'create' && v.expectedVersion !== null) throw new MemoryError('新建文件的预期版本必须为 null。', 'INVALID')
  if (v.operation !== 'create' && !v.expectedVersion) throw new MemoryError('编辑前必须读取目标文件版本。', 'INVALID')
  if (v.operation === 'edit') {
    if (typeof v.oldText !== 'string' || typeof v.newText !== 'string' || v.oldText === v.newText) throw new MemoryError('修订需要唯一原文和修改后内容。', 'INVALID')
  } else if (typeof v.text !== 'string' || !v.text.trim()) throw new MemoryError('新增内容不能为空。', 'INVALID')
  if (!Array.isArray(v.evidence) || v.evidence.length < 1 || v.evidence.length > 8) throw new MemoryError('请提供 1–8 项原文依据。', 'INVALID')
  const evidence = v.evidence.map((raw): MemoryEvidence => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.quote !== 'string' || !raw.quote.trim()) throw new MemoryError('来源需要非空原文引用。', 'INVALID')
    if (raw.kind === 'user' && typeof raw.messageId === 'string' && raw.messageId) return { kind: 'user', messageId: raw.messageId, quote: raw.quote }
    if (raw.kind === 'file' && typeof raw.path === 'string' && /^(正文|世界书|人物卡)\/.+\.(md|txt)$/i.test(raw.path)
      && !raw.path.includes('\\') && !raw.path.split('/').some((p: string) => !p || p.startsWith('.')) && typeof raw.version === 'string' && raw.version) {
      return { kind: 'file', path: raw.path, version: raw.version, quote: raw.quote }
    }
    throw new MemoryError('依据须来自当前会话用户消息或已保存的正文、世界书、人物卡。', 'INVALID')
  })
  if (v.category === 'rule' && evidence.some(e => e.kind !== 'user')) throw new MemoryError('项目规则必须来自作者明确要求，不能从正文推断。', 'INVALID')
  return { path: target, operation: v.operation as MemoryUpdate['operation'], category: v.category as MemoryUpdate['category'], certainty: v.certainty as MemoryUpdate['certainty'], summary: v.summary.trim(), expectedVersion: v.expectedVersion as string | null, evidence,
    ...(v.operation === 'edit' ? { oldText: v.oldText as string, newText: v.newText as string } : { text: v.text as string }) }
}

function userMessages(events: readonly MessageEvent[]) {
  return events.filter(e => e.type === 'user/message' && e.data.source?.kind === 'user' && typeof e.data.id === 'string')
}
function messageText(event: MessageEvent): string {
  const text = (event.data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
  return parseProjectContextEnvelope(text)?.user_request ?? text
}
async function verifyEvidence(access: MemoryAccess, evidence: MemoryEvidence[]): Promise<MemoryEvidence[]> {
  const users = userMessages(access.events)
  const normalized: MemoryEvidence[] = []
  for (const item of evidence) {
    access.files.signal?.throwIfAborted()
    if (item.kind === 'file') {
      const file = await readTextFile(access.files, item.path)
      if (file.version !== item.version || !file.text.includes(item.quote)) throw new MemoryError(`来源已变化或引用不匹配：${item.path}`, 'STALE')
      normalized.push(item)
    } else {
      const message = item.messageId === 'current' ? users.at(-1) : users.find(e => e.data.id === item.messageId)
      if (!message || !messageText(message).includes(item.quote)) throw new MemoryError('用户消息来源不存在或原文不匹配。', 'STALE')
      normalized.push({ ...item, messageId: message.data.id! })
    }
  }
  return normalized
}
async function optionalFile(files: WorkspaceFileContext, relative: string) {
  try { return await readTextFile(files, relative) } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') return null
    throw error
  }
}
function recordPath(id: string): string {
  if (!ID.test(id)) throw new MemoryError('维护记录标识无效。', 'INVALID')
  return `${HISTORY}/${id}.json`
}
function summary(record: MemoryChange): MemoryChangeSummary {
  return { id: record.id, path: record.path, summary: record.summary, status: record.status, createdAt: record.createdAt, ...(record.message ? { message: record.message } : {}) }
}
export function memoryReceipt(record: MemoryChange): MemoryUpdateReceipt { return { marker: 'dsh-editor.memory-update', version: 1, ...summary(record) } }
async function saveRecord(access: MemoryAccess, record: StoredRecord): Promise<void> {
  const text = JSON.stringify(record, null, 2)
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new MemoryError('维护记录过大，请拆分为更小的条目更新。', 'INVALID')
  await mkdirSafe(access.path, HISTORY)
  const relative = recordPath(record.id)
  const existing = await optionalFile(access.files, relative)
  if (existing) await writeTextFile(access.files, relative, text, existing.version)
  else await createTextFile(access.files, relative, text)
}
export async function getMemoryChange(access: MemoryAccess, id: string): Promise<StoredRecord> {
  const file = await readTextFile(access.files, recordPath(id))
  let record: StoredRecord
  try { record = JSON.parse(file.text) } catch { throw new MemoryError('维护历史文件损坏。', 'IO') }
  if (!record || record.version !== 1 || record.id !== id || typeof record.after !== 'string' || !(record.before === null || typeof record.before === 'string')
    || typeof record.sessionId !== 'string' || typeof record.createdAt !== 'string' || !['pending', 'applied', 'stale', 'failed', 'undone'].includes(record.status)) throw new MemoryError('维护历史格式无效。', 'IO')
  const update = parseMemoryUpdate(record.update)
  if (memoryTarget(record.path) !== update.path) throw new MemoryError('维护历史目标不一致。', 'IO')
  // A process may exit between the file commit and the final journal write.
  if (record.writing && !record.archiveOnApply) {
    const current = await optionalFile(access.files, record.path)
    if (current?.text === record.after) return { ...record, writing: false, status: 'applied', appliedVersion: current.version, message: '已核实文件内容，恢复维护回执。' }
  }
  if (record.writing && record.archiveOnApply) return { ...record, status: 'pending', message: '归档撤销有未完成回执，确认后继续恢复。' }
  return record
}
export async function listMemoryChanges(access: MemoryAccess): Promise<{ items: MemoryChangeSummary[] }> {
  let entries
  try { entries = await listDirStrict(access.files, HISTORY) } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') return { items: [] }
    throw error
  }
  const records: StoredRecord[] = []
  for (const entry of entries) {
    if (entry.type !== 'file' || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue
    records.push(await getMemoryChange(access, entry.name.slice(0, -5)))
  }
  const completedUndos = new Set(records.filter(r => r.undoOf && ['applied', 'undone'].includes(r.status)).map(r => r.undoOf))
  const items = records.map(r => summary(completedUndos.has(r.id) ? { ...r, status: 'undone' } : r))
  return { items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)) }
}
function assertWritable(access: MemoryAccess) {
  access.files.signal?.throwIfAborted()
  if (access.mode === 'read-only' || access.files.policy.mode === 'read-only') throw new MemoryError('作品只读，未写入维护内容。', 'BLOCKED')
}
async function canonicalTarget(access: MemoryAccess, target: string): Promise<string> {
  if (!/^agents\.md$/i.test(target)) return target
  return (await readProjectRules(access.files)).path
}
function addedContent(update: MemoryUpdate): string {
  const text = update.text!.trim()
  if (update.category === 'rule') return text
  const citations = update.evidence.map(e => e.kind === 'file'
    ? `> 来源：[${e.path}](${e.path})；原文：${e.quote.replace(/\r?\n/g, ' ')}`
    : `> 来源：作者消息 ${e.messageId}；原文：${e.quote.replace(/\r?\n/g, ' ')}`)
  return `${text}\n\n${citations.join('\n')}`
}
function updatedText(before: string | null, update: MemoryUpdate): string {
  if (update.operation === 'edit') {
    if (update.oldText === '' && before !== null && !before.trim()) return update.newText!
    if (before === null || before.split(update.oldText!).length !== 2) throw new MemoryError('待修改原文不存在或不唯一。', 'STALE')
    return before.replace(update.oldText!, () => update.newText!)
  }
  const added = addedContent(update)
  if (before === null) return `${added}\n`
  if (before.includes(update.text!.trim())) return before
  const newline = before.includes('\r\n') ? '\r\n' : '\n'
  return `${before}${before.endsWith(newline) ? newline : newline + newline}${added.replace(/\r?\n/g, newline)}${newline}`
}
function failure(error: unknown): { status: 'stale' | 'failed'; message: string } {
  return { status: error instanceof MemoryError && error.code === 'STALE' || error instanceof FileOpError && ['STALE', 'EXISTS'].includes(error.code) ? 'stale' : 'failed', message: error instanceof Error ? error.message : '维护写入失败。' }
}

/** Caller owns the existing workspace write queue. Never acquire it recursively here. */
export async function updateMemory(access: MemoryAccess, input: unknown): Promise<MemoryUpdateReceipt> {
  assertWritable(access)
  const update = parseMemoryUpdate(input)
  update.path = await canonicalTarget(access, update.path)
  update.evidence = await verifyEvidence(access, update.evidence)
  // Exact retries reuse the record; a newly observed target version creates a new attempt after a stale result.
  const { summary: _summary, ...identity } = update
  const id = createHash('sha256').update(JSON.stringify({ session: access.sessionId, ...identity })).digest('hex')
  const existing = await optionalFile(access.files, recordPath(id))
  if (existing) return memoryReceipt(await getMemoryChange(access, id))
  const current = await optionalFile(access.files, update.path)
  const base: StoredRecord = { version: 1, id, path: update.path, summary: update.summary, sessionId: access.sessionId, createdAt: new Date().toISOString(), status: 'pending', update, before: current?.text ?? null, after: '' }
  if ((current?.version ?? null) !== update.expectedVersion || update.operation === 'create' && current) {
    base.status = 'stale'; base.after = current?.text ?? ''; base.message = '目标版本已变化，请重新读取后维护。'
    await saveRecord(access, base); return memoryReceipt(base)
  }
  base.after = updatedText(base.before, update)
  if (Buffer.byteLength(base.after) > MAX_TEXT_BYTES) throw new MemoryError('目标资料过大，请拆分为独立条目。', 'INVALID')
  base.message = update.operation === 'edit' ? '修订已有内容，需要作者确认。' : update.certainty === 'uncertain' ? '依据或含义存在歧义，需要作者确认。' : undefined
  if (access.hasDraft(base.path)) base.message = '目标有未保存草稿；保存或放弃草稿后再确认。'
  await saveRecord(access, base)
  if (base.message) return memoryReceipt(base)
  return commitMemory(access, base)
}

async function commitMemory(access: MemoryAccess, record: StoredRecord): Promise<MemoryUpdateReceipt> {
  assertWritable(access)
  try {
    const target = await canonicalTarget(access, record.path)
    if (target !== record.path) throw new MemoryError('规则文件名已变化，请重新读取。', 'STALE')
    if (access.hasDraft(record.path)) throw new MemoryError('目标有未保存草稿，未写入。', 'BLOCKED')
    if (!record.undoOf) await verifyEvidence(access, record.update.evidence)
    const current = await optionalFile(access.files, record.path)
    if (!(record.archiveOnApply && record.writing && record.archiveId) && ((current?.version ?? null) !== record.update.expectedVersion || (current?.text ?? null) !== record.before)) throw new MemoryError('目标已变化，请重新检查差异。', 'STALE')
    await mkdirSafe(access.path, path.posix.dirname(record.path))
    if (record.archiveOnApply) record.archiveId ??= randomUUID()
    record.writing = true
    await saveRecord(access, record)
    access.files.signal?.throwIfAborted()
    if (record.archiveOnApply) {
      await prepareArchiveDocument({ access, path: record.path, expectedVersion: record.update.expectedVersion!, archiveId: record.archiveId })
      const archived = await archiveDocument({ access, archiveId: record.archiveId })
      if (archived.state !== 'archived') throw new MemoryError('归档未完成，请查看归档恢复入口。', 'IO')
      record.archiveId = archived.archiveId
      record.status = 'undone'
    } else {
      const written = current
        ? await writeTextFile(access.files, record.path, record.after, current.version)
        : await createTextFile(access.files, record.path, record.after)
      const verified = await readTextFile(access.files, record.path)
      if (verified.version !== written.version || verified.text !== record.after) throw new MemoryError('写入后内容发生变化，请检查文件。', 'STALE')
      record.appliedVersion = written.version
      record.status = 'applied'
    }
    record.writing = false
    record.message = record.undoOf ? '已撤销该次维护。' : '已写入并核实。'
    await saveRecord(access, record)
    if (record.undoOf) {
      const original = await getMemoryChange(access, record.undoOf)
      original.status = 'undone'; original.message = '该次维护已撤销。'
      await saveRecord(access, original)
    }
    return memoryReceipt(record)
  } catch (error) {
    // A transient failure after the target commit (e.g. Win32 ReplaceFileW EIO) must not
    // report failure for a change that actually landed; recover from the file itself.
    if (record.appliedVersion && !record.archiveOnApply) {
      const committed = await optionalFile({ ...access.files, signal: undefined }, record.path).catch(() => null)
      if (committed?.text === record.after) {
        record.writing = false
        record.appliedVersion = committed.version
        record.status = 'applied'
        record.message = '回执保存出现瞬时错误；已核实文件内容并恢复为维护成功。'
        try { await saveRecord({ ...access, files: { ...access.files, signal: undefined } }, record) } catch { /* the target file itself is the recovery source */ }
        return memoryReceipt(record)
      }
    }
    if (record.appliedVersion || record.archiveId) record.writing = true
    Object.assign(record, failure(error))
    // Keep writing=true if a commit may have occurred; recovery reads compare the actual file.
    try { await saveRecord({ ...access, files: { ...access.files, signal: undefined } }, record) } catch { /* the pre-write journal remains the recovery source */ }
    return memoryReceipt(record)
  }
}
export async function applyMemoryChange(access: MemoryAccess, id: string): Promise<MemoryUpdateReceipt> {
  const record = await getMemoryChange(access, id)
  if (record.status !== 'pending') return memoryReceipt(record)
  return commitMemory(access, record)
}
export async function undoMemoryChange(access: MemoryAccess, id: string): Promise<MemoryUpdateReceipt> {
  assertWritable(access)
  const original = await getMemoryChange(access, id)
  if (original.status === 'undone') return memoryReceipt(original)
  if (original.status !== 'applied') throw new MemoryError('只有已写入的维护可以撤销。', 'BLOCKED')
  // Recover the two journal commits around undo before depending on the now possibly archived target.
  const prior = (await listMemoryChanges(access)).items
  for (const item of prior) {
    if (item.id === id || item.path !== original.path) continue
    const undo = await getMemoryChange(access, item.id)
    if (undo.undoOf !== id) continue
    if (undo.writing && undo.archiveOnApply) return commitMemory(access, undo)
    if (undo.status === 'applied' || undo.status === 'undone') { original.status = 'undone'; await saveRecord(access, original); return memoryReceipt(original) }
  }
  const current = await optionalFile(access.files, original.path)
  if (!current) throw new MemoryError('文件已不存在，请检查归档或恢复记录。', 'STALE')
  const undoId = createHash('sha256').update(`undo:${id}:${current.version}`).digest('hex')
  const found = await optionalFile(access.files, recordPath(undoId))
  if (found) return memoryReceipt(await getMemoryChange(access, undoId))
  const record: StoredRecord = {
    ...original, id: undoId, undoOf: original.id, createdAt: new Date().toISOString(), status: 'pending', summary: `撤销：${original.summary}`,
    before: current.text, after: original.before ?? '', appliedVersion: undefined, writing: false,
    archiveOnApply: original.before === null,
    update: { ...original.update, operation: 'edit', expectedVersion: current.version, oldText: current.text, newText: original.before ?? '', text: undefined },
    message: '撤销后的内容将恢复到该次维护之前；新建文件将归档。',
  }
  // A no-op append may have had before===after. Keep an ordinary undo receipt without an invalid edit.
  if (record.before === record.after) { original.status = 'undone'; await saveRecord(access, original); return memoryReceipt(original) }
  await saveRecord(access, record)
  if (current.version !== original.appliedVersion || access.hasDraft(original.path)) {
    record.message = '维护后文件又有修改或未保存草稿，请检查恢复差异后确认。'
    await saveRecord(access, record); return memoryReceipt(record)
  }
  return commitMemory(access, record)
}
