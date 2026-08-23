import fs from 'node:fs/promises'
import path from 'node:path'
import { confinePath, PathConfineError, toPosixRelative } from './paths.ts'

export const PROPOSALS_REL = '.dsh-editor/proposals.json'

export type ProposalKind = 'patch' | 'replace' | 'append'

export type ProposalSegment = {
  old_text: string
  new_text: string
}

export type Proposal = {
  id: string
  path: string
  kind: ProposalKind
  segments: ProposalSegment[]
  body?: string
  createdAt: number
}

export type ProposalStore = {
  version: 1
  proposals: Proposal[]
}

export class ProposalError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'NOT_UNIQUE' | 'OVERLAP' | 'EMPTY' | 'FORBIDDEN' | 'READ_ONLY' | 'NO_WORKSPACE' | 'IO',
  ) {
    super(message)
    this.name = 'ProposalError'
  }
}

const CANON_PREFIXES = ['人物卡/', '世界书/']

export function normalizeRel(relative: string): string {
  return relative.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

export type ProposalLane = 'prose' | 'character' | 'world'

export function assertCanonPath(relative: string): string {
  return assertLanePath(relative, 'prose')
}

export function assertLanePath(relative: string, lane: ProposalLane): string {
  const rel = normalizeRel(relative)
  if (!rel || rel === '.') throw new ProposalError('path is required', 'EMPTY')
  const isCard = rel === '人物卡' || rel.startsWith('人物卡/')
  const isWorld = rel === '世界书' || rel.startsWith('世界书/')
  if (lane === 'character') {
    if (!isCard || rel === '人物卡') throw new ProposalError('人物卡提案必须落在 人物卡/*.md', 'FORBIDDEN')
    return rel
  }
  if (lane === 'world') {
    if (!isWorld || rel === '世界书') throw new ProposalError('世界书提案必须落在 世界书/*.md', 'FORBIDDEN')
    return rel
  }
  if (CANON_PREFIXES.some((prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix))) {
    throw new ProposalError('人物卡和世界书不能用正文提案改，请用对应的维护工具', 'FORBIDDEN')
  }
  return rel
}

/** Unique exact match; duplicates or misses return -1. */
export function locateUnique(content: string, oldText: string): number {
  if (!oldText) return -1
  const first = content.indexOf(oldText)
  if (first < 0) return -1
  return content.indexOf(oldText, first + 1) >= 0 ? -1 : first
}

export function applySegments(
  content: string,
  segments: ProposalSegment[],
): { ok: true; text: string } | { ok: false; error: string } {
  if (!segments.length) return { ok: false, error: '无有效分段' }
  const located: { at: number; len: number; next: string }[] = []
  for (const segment of segments) {
    const at = locateUnique(content, segment.old_text)
    if (at < 0) return { ok: false, error: '无有效分段：old_text 必须精确出现在文件中且唯一' }
    located.push({ at, len: segment.old_text.length, next: segment.new_text })
  }
  located.sort((a, b) => a.at - b.at)
  for (let i = 1; i < located.length; i++) {
    const prev = located[i - 1]
    const cur = located[i]
    if (cur.at < prev.at + prev.len) return { ok: false, error: '分段重叠' }
  }
  let out = content
  for (let i = located.length - 1; i >= 0; i--) {
    const item = located[i]
    out = out.slice(0, item.at) + item.next + out.slice(item.at + item.len)
  }
  return { ok: true, text: out }
}

export function applyProposal(content: string, proposal: Proposal): { ok: true; text: string } | { ok: false; error: string } {
  if (proposal.kind === 'replace') {
    if (typeof proposal.body !== 'string') return { ok: false, error: '整章稿缺少正文' }
    return { ok: true, text: proposal.body }
  }
  if (proposal.kind === 'append') {
    if (typeof proposal.body !== 'string') return { ok: false, error: '续写稿缺少正文' }
    if (!content) return { ok: true, text: proposal.body }
    const sep = content.endsWith('\n') ? '' : '\n'
    return { ok: true, text: content + sep + proposal.body }
  }
  return applySegments(content, proposal.segments)
}

function emptyStore(): ProposalStore {
  return { version: 1, proposals: [] }
}

export async function readStore(cwd: string): Promise<ProposalStore> {
  const abs = confinePath(cwd, PROPOSALS_REL)
  try {
    const raw = await fs.readFile(abs, 'utf8')
    const parsed = JSON.parse(raw) as ProposalStore
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.proposals)) return emptyStore()
    return { version: 1, proposals: parsed.proposals.filter((item) => item && typeof item.id === 'string' && typeof item.path === 'string') }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return emptyStore()
    if (error instanceof PathConfineError) throw error
    throw new ProposalError('failed to read proposals', 'IO')
  }
}

export async function writeStore(cwd: string, store: ProposalStore): Promise<void> {
  const abs = confinePath(cwd, PROPOSALS_REL)
  const dir = path.dirname(abs)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(abs, JSON.stringify({ version: 1, proposals: store.proposals }, null, 2), 'utf8')
}

export function newProposalId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export async function upsertProposal(cwd: string, proposal: Proposal): Promise<Proposal> {
  const store = await readStore(cwd)
  const next = store.proposals.filter((item) => normalizeRel(item.path) !== normalizeRel(proposal.path))
  next.push(proposal)
  await writeStore(cwd, { version: 1, proposals: next })
  return proposal
}

export async function readTargetText(cwd: string, relative: string): Promise<string> {
  const abs = confinePath(cwd, relative)
  try {
    return await fs.readFile(abs, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new ProposalError('文件不存在', 'NOT_FOUND')
    throw new ProposalError('failed to read target', 'IO')
  }
}

export function toWorkspaceRel(cwd: string, relative: string): string {
  const abs = confinePath(cwd, relative)
  return toPosixRelative(cwd, abs)
}
