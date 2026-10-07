/** Wire-version validation stays here; execution receives only file changes. */
import path from 'node:path'
import {
  isWritingProposalV2,
  parseWritingProposal,
  ProposalError,
  WritingProposalError,
  type WritingProposalV2,
} from 'dsh-manuscript/host-api'
import { moveDocument, moveManuscriptDocument, renameDocument } from '../lifecycle/lifecycle.ts'
import { isPlanningKind, parsePlanningProposal } from './planning-proposals.ts'
import { ProposalOpsError, type MergeProposal, type ProposalRename, type RenameOperation, type RenamesProposal, type SplitProposal } from './proposal-ops.ts'
import type { ProposalChange } from './proposal-execution.ts'

const MARKER = 'dsh-editor.proposal'
const KINDS = ['split', 'merge', 'renames'] as const
const MANUSCRIPT_ROOT = '正文/'
type LegacyEnvelope = { marker: typeof MARKER; version: 1; summary: string }
export type LegacySplitProposal = LegacyEnvelope & SplitProposal
export type LegacyMergeProposal = LegacyEnvelope & MergeProposal
export type LegacyRenamesProposal = LegacyEnvelope & { kind: 'renames'; renames: ProposalRename[] }
export type LegacyOpsProposal = LegacySplitProposal | LegacyMergeProposal | LegacyRenamesProposal

function cleanPath(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\\/g, '/') : ''
}

function isMarkdownRelative(value: string): boolean {
  if (!value || value.startsWith('/') || /^[a-z]:/i.test(value) || value.includes('\0') || value.includes(':')) return false
  if (value.split('/').includes('..') || value.split('/').some((part) => part.startsWith('.'))) return false
  return /\.md$/i.test(value)
}

/** Historical V1 validation, including its Markdown-only paths and unversioned targets. */
export function parseLegacyOpsProposal(value: unknown): LegacyOpsProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProposalOpsError('proposal 必须是非数组对象', 'INVALID')
  const row = value as Record<string, unknown>
  if (row.marker !== MARKER) throw new ProposalOpsError(`proposal.marker 必须是 ${MARKER}`, 'INVALID')
  if (row.version !== 1) throw new ProposalOpsError('proposal.version 必须是 1', 'INVALID')
  const summary = typeof row.summary === 'string' ? row.summary.trim() : ''
  if (!summary) throw new ProposalOpsError('proposal.summary 是必填摘要', 'INVALID')
  const kind = row.kind
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    throw new ProposalOpsError(`proposal.kind 必须是 ${KINDS.join(' / ')}；edit 请走 manuscript 通道`, 'INVALID')
  }
  const common = { marker: MARKER, version: 1, summary } as const
  if (kind === 'split') {
    const target = cleanPath(row.path)
    const newPath = cleanPath(row.newPath)
    const anchor = typeof row.anchor === 'string' ? row.anchor : ''
    if (!isMarkdownRelative(target)) throw new ProposalOpsError('split.path 必须是项目相对 Markdown 路径', 'INVALID')
    if (!isMarkdownRelative(newPath)) throw new ProposalOpsError('split.newPath 必须是项目相对 Markdown 路径', 'INVALID')
    if (newPath === target) throw new ProposalOpsError('split.newPath 不能与 path 相同', 'INVALID')
    if (!anchor.trim()) throw new ProposalOpsError('split.anchor 必填', 'INVALID')
    return { ...common, kind, path: target, anchor, newPath }
  }
  if (kind === 'merge') {
    const target = cleanPath(row.path)
    const sourcePath = cleanPath(row.sourcePath)
    if (!isMarkdownRelative(target)) throw new ProposalOpsError('merge.path 必须是项目相对 Markdown 路径', 'INVALID')
    if (!isMarkdownRelative(sourcePath)) throw new ProposalOpsError('merge.sourcePath 必须是项目相对 Markdown 路径', 'INVALID')
    if (sourcePath === target) throw new ProposalOpsError('merge.sourcePath 不能与 path 相同', 'INVALID')
    return { ...common, kind, path: target, sourcePath }
  }
  if (!Array.isArray(row.renames) || row.renames.length < 1 || row.renames.length > 50) {
    throw new ProposalOpsError('renames.renames 需要 1-50 项', 'INVALID')
  }
  const renames: ProposalRename[] = []
  const seen = new Set<string>()
  for (const value of row.renames) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProposalOpsError('renames 项必须为对象', 'INVALID')
    const entry = value as Record<string, unknown>
    const from = cleanPath(entry.from)
    const to = cleanPath(entry.to)
    if (!isMarkdownRelative(from) || !isMarkdownRelative(to)) throw new ProposalOpsError('renames 项必须为项目相对 Markdown 路径', 'INVALID')
    if (from === to) throw new ProposalOpsError(`renames 项 ${from} 不能原地改名`, 'INVALID')
    if (seen.has(from) || seen.has(to)) throw new ProposalOpsError('renames 项不能重叠', 'INVALID')
    seen.add(from)
    seen.add(to)
    renames.push({ from, to })
  }
  return { ...common, kind: 'renames', renames }
}

/** Select the actual lifecycle primitive once, retaining V1 destination restrictions. */
export function legacyRenamesChange(proposal: Pick<LegacyRenamesProposal, 'renames'>): RenamesProposal {
  return {
    kind: 'renames',
    renames: proposal.renames.map<RenameOperation>((entry) => {
      const { from, to } = entry
      if (path.posix.dirname(from) === path.posix.dirname(to)) {
        return { ...entry, relocate: (access, expectedVersion) => renameDocument({ access, path: from, newName: path.posix.basename(to), expectedVersion }) }
      }
      return {
        ...entry,
        assertAllowed() {
          if (path.posix.basename(from) !== path.posix.basename(to) || !from.startsWith(MANUSCRIPT_ROOT) || !to.startsWith(MANUSCRIPT_ROOT)) {
            throw new ProposalOpsError(`renames 项 ${from} → ${to} 跨目录需满足：文件名相同且双方都在 ${MANUSCRIPT_ROOT} 之下`, 'INVALID')
          }
        },
        relocate: (access, expectedVersion) => moveManuscriptDocument({ access, path: from, targetDirectory: path.posix.dirname(to), expectedVersion }),
      }
    }),
  }
}

export function writingProposalChange(proposal: Exclude<WritingProposalV2, { kind: 'edit' }>): ProposalChange {
  const { basis } = proposal
  if (proposal.kind === 'create') return { kind: 'create', path: proposal.path, text: proposal.text, targetPolicy: 'exclusive', basis }
  if (proposal.kind === 'split') return { kind: 'split', path: proposal.path, anchor: proposal.anchor, newPath: proposal.newPath, targetVersion: proposal.targetVersion, basis }
  if (proposal.kind === 'merge') return { kind: 'merge', path: proposal.path, sourcePath: proposal.sourcePath, targetVersion: proposal.targetVersion, sourceVersion: proposal.sourceVersion, basis }
  return {
    kind: 'renames',
    basis,
    renames: proposal.renames.map<RenameOperation>((entry) => ({
      ...entry,
      relocate: (access, expectedVersion) => moveDocument({ access, path: entry.from, targetPath: entry.to, expectedVersion }),
    })),
  }
}

export function parseProposalChange(input: unknown): ProposalChange {
  if (isWritingProposalV2(input)) {
    try {
      const proposal = parseWritingProposal(input)
      if (proposal.kind === 'edit') throw new ProposalOpsError('edit 请走 manuscript 通道', 'INVALID')
      return writingProposalChange(proposal)
    } catch (error) {
      if (error instanceof WritingProposalError || error instanceof ProposalError) {
        throw new ProposalOpsError(error.message, error.code === 'STALE' ? 'STALE' : 'INVALID', { cause: error })
      }
      throw error
    }
  }
  if (input && typeof input === 'object' && isPlanningKind((input as Record<string, unknown>).kind)) {
    const proposal = parsePlanningProposal(input)
    if (proposal.kind === 'create') return { kind: 'create', path: proposal.path, text: proposal.text, targetPolicy: 'fill-empty' }
    if (proposal.kind === 'chapter_plan') return { kind: 'chapter_plan', path: proposal.path, sourceVersion: proposal.sourceVersion, beats: proposal.beats }
    return { kind: 'chapter_summary', path: proposal.path, sourceVersion: proposal.sourceVersion, state: proposal.state }
  }
  const proposal = parseLegacyOpsProposal(input)
  if (proposal.kind === 'renames') return legacyRenamesChange(proposal)
  if (proposal.kind === 'split') return { kind: 'split', path: proposal.path, anchor: proposal.anchor, newPath: proposal.newPath }
  return { kind: 'merge', path: proposal.path, sourcePath: proposal.sourcePath }
}
