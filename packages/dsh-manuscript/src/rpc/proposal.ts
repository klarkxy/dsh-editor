import fs from 'node:fs/promises'
import path from 'node:path'
import { createTextFile, FileOpError, readTextFile, writeTextFile } from './files.ts'
import { confinePath, PathConfineError } from './paths.ts'

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

export class ProposalApplyError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'NO_MATCH' | 'OVERLAP' | 'EMPTY',
  ) {
    super(message)
    this.name = 'ProposalApplyError'
  }
}

export function normalizeRel(relative: string): string {
  return relative.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

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
    return {
      version: 1,
      proposals: parsed.proposals.filter((item) => item && typeof item.id === 'string' && typeof item.path === 'string'),
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return emptyStore()
    if (error instanceof PathConfineError) throw error
    throw new FileOpError('failed to read proposals', 'IO')
  }
}

async function writeStore(cwd: string, store: ProposalStore): Promise<void> {
  const abs = confinePath(cwd, PROPOSALS_REL)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, JSON.stringify({ version: 1, proposals: store.proposals }, null, 2), 'utf8')
}

export async function listProposals(cwd: string, relative = ''): Promise<{ proposals: Proposal[] }> {
  const store = await readStore(cwd)
  const filter = relative ? normalizeRel(relative) : ''
  const proposals = filter
    ? store.proposals.filter((item) => normalizeRel(item.path) === filter)
    : store.proposals
  return { proposals }
}

export async function rejectProposal(cwd: string, id: string): Promise<{ removed: boolean }> {
  if (!id) throw new ProposalApplyError('proposal id is required', 'EMPTY')
  const store = await readStore(cwd)
  const next = store.proposals.filter((item) => item.id !== id)
  const removed = next.length !== store.proposals.length
  if (removed) await writeStore(cwd, { version: 1, proposals: next })
  return { removed }
}

export async function acceptProposal(
  cwd: string,
  id: string,
  version: string,
  editorText?: string,
): Promise<{ text: string; version: string; path: string }> {
  if (!id) throw new ProposalApplyError('proposal id is required', 'EMPTY')
  const store = await readStore(cwd)
  const proposal = store.proposals.find((item) => item.id === id)
  if (!proposal) throw new ProposalApplyError('proposal not found', 'NOT_FOUND')
  let exists = true
  let current = typeof editorText === 'string' ? editorText : ''
  try {
    const read = await readTextFile(cwd, proposal.path)
    if (typeof editorText !== 'string') current = read.text
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND' && proposal.kind === 'replace') {
      exists = false
      current = typeof editorText === 'string' ? editorText : ''
    } else {
      throw error
    }
  }
  const applied = applyProposal(current, proposal)
  if (!applied.ok) throw new ProposalApplyError(applied.error, 'NO_MATCH')
  const written = exists
    ? await writeTextFile(cwd, proposal.path, applied.text, version)
    : await createTextFile(cwd, proposal.path, applied.text)
  await writeStore(cwd, { version: 1, proposals: store.proposals.filter((item) => item.id !== id) })
  return { text: applied.text, version: written.version, path: proposal.path }
}
