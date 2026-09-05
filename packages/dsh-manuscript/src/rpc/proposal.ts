import { createTextFile, FileOpError, readTextFile, type WorkspaceFileContext, writeTextFile } from './files.ts'
import { normalizeWorkspaceRelative } from './paths.ts'

export class ProposalError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID' | 'NOT_MARKDOWN' | 'AMBIGUOUS' | 'STALE',
  ) {
    super(message)
    this.name = 'ProposalError'
  }
}

export type EditProposal = { kind: 'edit'; path: string; oldText: string; newText: string; summary: string }
export type CreateProposal = { kind: 'create'; path: string; text: string; summary: string }
export type Proposal = EditProposal | CreateProposal

export function parseProposal(payload: Record<string, unknown>): Proposal {
  const kind = payload.kind
  const path = normalizeWorkspaceRelative(typeof payload.path === 'string' ? payload.path : '')
  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : ''
  if (path === '.' || !summary) throw new ProposalError('proposal path and summary are required', 'INVALID')
  if (!/\.md$/i.test(path)) throw new ProposalError('proposal target must be Markdown', 'NOT_MARKDOWN')
  if (kind === 'edit') {
    const oldText = typeof payload.oldText === 'string' ? payload.oldText : ''
    const newText = typeof payload.newText === 'string' ? payload.newText : ''
    if (!oldText || oldText === newText) throw new ProposalError('edit proposal must change non-empty text', 'INVALID')
    return { kind, path, oldText, newText, summary }
  }
  if (kind === 'create') {
    const text = typeof payload.text === 'string' ? payload.text : ''
    if (!text) throw new ProposalError('new file content is required', 'INVALID')
    return { kind, path, text, summary }
  }
  throw new ProposalError('proposal kind must be edit or create', 'INVALID')
}

function occurrences(text: string, needle: string): number {
  let count = 0
  let index = 0
  while ((index = text.indexOf(needle, index)) >= 0) {
    count++
    index += Math.max(1, needle.length)
  }
  return count
}

export async function prepareProposal(context: WorkspaceFileContext, proposal: Proposal): Promise<Record<string, unknown>> {
  if (proposal.kind === 'create') {
    try {
      await readTextFile(context, proposal.path)
      throw new ProposalError('target file already exists', 'STALE')
    } catch (error) {
      if (error instanceof FileOpError && error.code === 'NOT_FOUND') {
        return { ...proposal, applicable: true }
      }
      throw error
    }
  }
  const current = await readTextFile(context, proposal.path)
  if (occurrences(current.text, proposal.oldText) !== 1) {
    throw new ProposalError('original text is missing or not unique', 'AMBIGUOUS')
  }
  return {
    ...proposal,
    applicable: true,
    version: current.version,
    before: proposal.oldText,
    after: proposal.newText,
  }
}

export async function applyProposal(
  context: WorkspaceFileContext,
  proposal: Proposal,
  expectedVersion: string,
): Promise<{ path: string; version: string; operation: 'create' | 'edit' }> {
  if (proposal.kind === 'create') {
    const result = await createTextFile(context, proposal.path, proposal.text)
    return { path: proposal.path, version: result.version, operation: 'create' }
  }
  if (!expectedVersion) throw new ProposalError('proposal version is required', 'STALE')
  const current = await readTextFile(context, proposal.path)
  if (current.version !== expectedVersion) throw new ProposalError('proposal is stale', 'STALE')
  if (occurrences(current.text, proposal.oldText) !== 1) {
    throw new ProposalError('original text is missing or not unique', 'AMBIGUOUS')
  }
  const result = await writeTextFile(
    context,
    proposal.path,
    current.text.replace(proposal.oldText, () => proposal.newText),
    expectedVersion,
  )
  return { path: proposal.path, version: result.version, operation: 'edit' }
}
