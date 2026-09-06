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
    if (oldText === newText) throw new ProposalError('edit proposal must change the text', 'INVALID')
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

/* oldText 为空表示“填充空文件”：仅当文件当前为空白时适用，避免覆盖已有正文。 */
function assertEditable(currentText: string, oldText: string): void {
  if (oldText === '') {
    if (currentText.trim() !== '') {
      throw new ProposalError('target file is not empty; edit with the current text as oldText', 'AMBIGUOUS')
    }
    return
  }
  if (occurrences(currentText, oldText) !== 1) {
    throw new ProposalError('original text is missing or not unique', 'AMBIGUOUS')
  }
}

export async function prepareProposal(context: WorkspaceFileContext, proposal: Proposal): Promise<Record<string, unknown>> {
  if (proposal.kind === 'create') {
    try {
      const existing = await readTextFile(context, proposal.path)
      /* 已存在但仍是空白（如提前建好标题的章节占位文件）时允许 create 覆盖。 */
      if (existing.text.trim() !== '') throw new ProposalError('target file already exists', 'STALE')
      return { ...proposal, applicable: true }
    } catch (error) {
      if (error instanceof FileOpError && error.code === 'NOT_FOUND') {
        return { ...proposal, applicable: true }
      }
      throw error
    }
  }
  const current = await readTextFile(context, proposal.path)
  assertEditable(current.text, proposal.oldText)
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
    try {
      const existing = await readTextFile(context, proposal.path)
      if (existing.text.trim() !== '') throw new ProposalError('target file already exists', 'STALE')
      const result = await writeTextFile(context, proposal.path, proposal.text, existing.version)
      return { path: proposal.path, version: result.version, operation: 'create' }
    } catch (error) {
      if (!(error instanceof FileOpError && error.code === 'NOT_FOUND')) throw error
    }
    const result = await createTextFile(context, proposal.path, proposal.text)
    return { path: proposal.path, version: result.version, operation: 'create' }
  }
  if (!expectedVersion) throw new ProposalError('proposal version is required', 'STALE')
  const current = await readTextFile(context, proposal.path)
  if (current.version !== expectedVersion) throw new ProposalError('proposal is stale', 'STALE')
  assertEditable(current.text, proposal.oldText)
  const result = await writeTextFile(
    context,
    proposal.path,
    proposal.oldText === '' ? proposal.newText : current.text.replace(proposal.oldText, () => proposal.newText),
    expectedVersion,
  )
  return { path: proposal.path, version: result.version, operation: 'edit' }
}
