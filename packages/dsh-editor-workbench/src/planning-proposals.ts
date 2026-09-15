/** Author-approved file creation and field-scoped chapter planning proposals. */
import {
  WRITING_V2_CREATE,
  createTextFile, FileOpError, isWritingV2Create, listDirStrict, MAX_TEXT_BYTES, normalizeWorkspaceRelative,
  parentRelative, readTextFile, writeTextFile, type WorkspaceFileContext,
} from 'dsh-manuscript/host-api'
import { applyChapterMeta, CHAPTER_STATE_KEYS, parseChapterMeta, validateChapterMeta, type ChapterStateFields } from './chapter-meta.ts'
import type { ProposalPayload, ProposalCreatePlan, ProposalChapterMetaPlan, ProposalFileApplied } from './contracts.ts'
import { mkdirSafe, validateDirectorySegment, validateEntryName } from './kit/entries.ts'
import { ProposalOpsError, snapshotProposalTargets } from './proposal-ops.ts'

export type PlanningProposal = Extract<ProposalPayload, { kind: 'create' | 'chapter_plan' | 'chapter_summary' }>
export type ChapterProposal = Exclude<PlanningProposal, { kind: 'create' }>
export type PlanningCreateProposal = Extract<PlanningProposal, { kind: 'create' }> & {
  writingV2?: typeof WRITING_V2_CREATE
}

export function isPlanningKind(kind: unknown): boolean {
  return kind === 'create' || kind === 'chapter_plan' || kind === 'chapter_summary'
}

export function parsePlanningProposal(value: unknown): PlanningProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProposalOpsError('提案必须是对象', 'INVALID')
  const row = value as Record<string, unknown>
  if (row.marker !== 'dsh-editor.proposal' || row.version !== 1 || !isPlanningKind(row.kind)) throw new ProposalOpsError('提案类型或版本无效', 'INVALID')
  if (typeof row.path !== 'string' || typeof row.summary !== 'string' || !row.summary.trim()) throw new ProposalOpsError('提案需要目标路径和说明', 'INVALID')
  const raw = row.path.replace(/\\/g, '/')
  if (raw.split('/').some((part) => !part || part.startsWith('.'))) throw new ProposalOpsError('提案只能修改作品中的可见文件', 'INVALID')
  const path = normalizeWorkspaceRelative(raw)
  if (!/\.md$/i.test(path)) throw new ProposalOpsError('提案目标必须是 Markdown 文件', 'INVALID')
  const common = { marker: 'dsh-editor.proposal' as const, version: 1 as const, path, summary: row.summary.trim() }
  if (row.kind === 'create') {
    if (typeof row.text !== 'string' || !row.text) throw new ProposalOpsError('新文件内容不能为空', 'INVALID')
    if (new TextEncoder().encode(row.text).length > MAX_TEXT_BYTES) throw new FileOpError('file too large', 'TOO_LARGE')
    const parts = path.split('/')
    parts.slice(0, -1).forEach(validateDirectorySegment)
    validateEntryName(parts[parts.length - 1]!)
    return { ...common, kind: 'create', text: row.text }
  }
  if (!/^正文\/.+\.md$/i.test(path)) throw new ProposalOpsError('章纲和章末小结只能关联正文目录中的章节', 'INVALID')
  if (typeof row.sourceVersion !== 'string' || !row.sourceVersion.trim() || row.sourceVersion.length > 512) throw new ProposalOpsError('请先读取章节，并提供读取回执中的 sourceVersion', 'INVALID')
  const sourceVersion = row.sourceVersion.trim()
  if (row.kind === 'chapter_plan') {
    if ('state' in row || !Array.isArray(row.beats) || row.beats.some((beat) => typeof beat !== 'string')) throw new ProposalOpsError('章纲提案只能包含 beats 字段', 'INVALID')
    const beats = (row.beats as string[]).map((beat) => beat.trim())
    const issues = validateChapterMeta({ beats })
    if (issues.length) throw new ProposalOpsError(issues.join('；'), 'INVALID')
    return { ...common, kind: 'chapter_plan', sourceVersion, beats }
  }
  if ('beats' in row || !row.state || typeof row.state !== 'object' || Array.isArray(row.state)) throw new ProposalOpsError('章末小结提案只能包含 state 字段', 'INVALID')
  const state: ChapterStateFields = {}
  for (const [key, text] of Object.entries(row.state)) {
    if (!(CHAPTER_STATE_KEYS as readonly string[]).includes(key) || typeof text !== 'string') throw new ProposalOpsError('章末小结字段无效', 'INVALID')
    state[key as keyof ChapterStateFields] = text.trim()
  }
  const issues = validateChapterMeta({ state })
  if (issues.length) throw new ProposalOpsError(issues.join('；'), 'INVALID')
  return { ...common, kind: 'chapter_summary', sourceVersion, state }
}

function assertWritable(files: WorkspaceFileContext): void {
  files.signal?.throwIfAborted()
  if (files.policy.mode === 'read-only') throw new FileOpError('作品目录为只读，无法应用提案', 'DENIED')
}

/** Inspect all existing ancestors through the confined provider without creating anything. */
async function missingParents(files: WorkspaceFileContext, target: string): Promise<string[]> {
  await listDirStrict(files, '.')
  const parent = parentRelative(target)
  if (parent === '.') return []
  const missing: string[] = []
  const parts = parent.split('/')
  let absent = false
  for (let i = 0; i < parts.length; i++) {
    files.signal?.throwIfAborted()
    const relative = parts.slice(0, i + 1).join('/')
    if (!absent) {
      try { await listDirStrict(files, relative) }
      catch (error) {
        if (!(error instanceof FileOpError) || error.code !== 'NOT_FOUND') throw error
        absent = true
      }
    }
    if (absent) missing.push(relative)
  }
  return missing
}

export async function prepareCreate(files: WorkspaceFileContext, proposal: PlanningCreateProposal): Promise<ProposalCreatePlan> {
  assertWritable(files)
  const missingDirectories = await missingParents(files, proposal.path)
  let version = ''
  if (!missingDirectories.length) {
    try {
      const current = await readTextFile(files, proposal.path)
      if (isWritingV2Create(proposal)) throw new ProposalOpsError('目标文件已存在，请改用修改提案', 'EXISTS')
      if (current.text.trim()) throw new ProposalOpsError('目标文件已有内容，请改用修改提案', 'EXISTS')
      version = current.version
    } catch (error) {
      if (!(error instanceof FileOpError) || error.code !== 'NOT_FOUND') throw error
    }
  }
  return { kind: 'create', applicable: true, version, missingDirectories }
}

export async function applyCreate(files: WorkspaceFileContext, proposal: PlanningCreateProposal, expectedVersion: string | undefined): Promise<ProposalFileApplied> {
  assertWritable(files)
  if (typeof expectedVersion !== 'string') throw new ProposalOpsError('请先核对创建提案', 'STALE')
  const prepared = await prepareCreate(files, proposal)
  if (prepared.version !== expectedVersion) throw new ProposalOpsError('目标文件已变化，请重新核对提案', 'STALE')
  if (prepared.version) {
    if (isWritingV2Create(proposal)) throw new ProposalOpsError('目标文件已存在，请改用修改提案', 'EXISTS')
    const result = await writeTextFile(files, proposal.path, proposal.text, prepared.version)
    return { path: proposal.path, version: result.version, operation: 'create' }
  }
  try {
    if (prepared.missingDirectories.length) {
      await mkdirSafe(files.cwd, parentRelative(proposal.path), () => new FileOpError('目标目录不安全，不能创建文件', 'SYMLINK'))
    }
    files.signal?.throwIfAborted()
    const result = await createTextFile(files, proposal.path, proposal.text)
    return { path: proposal.path, version: result.version, operation: 'create' }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    // Empty directories may remain. Recheck reads the target again and will not
    // replay a create whose reply was lost after the file had already landed.
    throw new FileOpError('创建未能完成，部分目录可能已建立；请重新核对目标文件后重试。', error instanceof FileOpError ? error.code : 'IO', { cause: error })
  }
}

const LABELS: Record<keyof ChapterStateFields, string> = { now: '此刻', where: '地点', knows: '已知', ended: '已了结', open: '未了结' }
function fieldPreview(kind: ChapterProposal['kind'], fields: { beats?: string[]; state?: ChapterStateFields }): string {
  if (kind === 'chapter_plan') return (fields.beats ?? []).map((beat, index) => `${index + 1}. ${beat}`).join('\n')
  return CHAPTER_STATE_KEYS.filter((key) => fields.state?.[key]).map((key) => `${LABELS[key]}：${fields.state![key]}`).join('\n')
}

async function chapterChange(files: WorkspaceFileContext, proposal: ChapterProposal) {
  const current = await readTextFile(files, proposal.path)
  if (current.version !== proposal.sourceVersion) throw new ProposalOpsError('章节在生成提案后已变化，请让搭档重新读取并生成', 'STALE')
  const metadata = parseChapterMeta(current.text)
  if (metadata === undefined) throw new ProposalOpsError('章节文件头未闭合，请先修复后重试', 'INVALID')
  const patch = proposal.kind === 'chapter_plan' ? { beats: proposal.beats } : { state: proposal.state }
  const next = applyChapterMeta(current.text, patch)
  return { current, next, before: fieldPreview(proposal.kind, metadata ?? {}), after: fieldPreview(proposal.kind, patch) }
}

export async function prepareChapterMeta(files: WorkspaceFileContext, proposal: ChapterProposal): Promise<ProposalChapterMetaPlan> {
  assertWritable(files)
  const { current, before, after } = await chapterChange(files, proposal)
  return { kind: proposal.kind, version: current.version, before, after }
}

export async function applyChapterProposal(files: WorkspaceFileContext, proposal: ChapterProposal, expectedVersion: string | undefined): Promise<ProposalFileApplied> {
  assertWritable(files)
  if (!expectedVersion || expectedVersion !== proposal.sourceVersion) throw new ProposalOpsError('请重新核对章节提案', 'STALE')
  const { current, next } = await chapterChange(files, proposal)
  if (next === current.text) return { path: proposal.path, version: current.version, operation: 'edit' }
  await snapshotProposalTargets(files, [proposal.path])
  const result = await writeTextFile(files, proposal.path, next, expectedVersion)
  return { path: proposal.path, version: result.version, operation: 'edit' }
}
