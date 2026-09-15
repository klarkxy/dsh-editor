import { createTextFile, FileOpError, listDirStrict, readTextFile, type WorkspaceFileContext, writeTextFile } from './files.ts'
import { normalizeWorkspaceRelative, parentRelative } from './paths.ts'
import {
  WRITING_PROPOSAL_MARKER,
  WRITING_PROPOSAL_VERSION,
  WRITING_V2_CREATE,
  isWritingV2Create,
  parseWritingProposal,
  WritingProposalError,
  type WritingProposalBasis,
} from './writing-proposal.ts'

export class ProposalError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID' | 'NOT_MARKDOWN' | 'AMBIGUOUS' | 'STALE',
  ) {
    super(message)
    this.name = 'ProposalError'
  }
}

export type EditProposal = {
  kind: 'edit'
  path: string
  oldText: string
  newText: string
  summary: string
  basis?: WritingProposalBasis[]
  targetVersion?: string
}
export type CreateProposal = {
  kind: 'create'
  path: string
  text: string
  summary: string
  basis?: WritingProposalBasis[]
  writingV2?: typeof WRITING_V2_CREATE
}
export type Proposal = EditProposal | CreateProposal

function asManuscriptProposal(payload: Record<string, unknown>): Proposal {
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

export function parseProposal(payload: Record<string, unknown>): Proposal {
  if (payload.marker === WRITING_PROPOSAL_MARKER) {
    if (payload.version === WRITING_PROPOSAL_VERSION) {
      try {
        const parsed = parseWritingProposal(payload)
        if (parsed.kind !== 'edit' && parsed.kind !== 'create') {
          throw new ProposalError('proposal kind must be edit or create', 'INVALID')
        }
        return parsed.kind === 'edit'
          ? {
            kind: 'edit',
            path: parsed.path,
            oldText: parsed.oldText,
            newText: parsed.newText,
            summary: parsed.summary,
            targetVersion: parsed.targetVersion,
            ...(parsed.basis ? { basis: parsed.basis } : {}),
          }
          : { kind: 'create', path: parsed.path, text: parsed.text, summary: parsed.summary, writingV2: WRITING_V2_CREATE, ...(parsed.basis ? { basis: parsed.basis } : {}) }
      } catch (error) {
        if (error instanceof ProposalError) throw error
        if (error instanceof WritingProposalError) {
          throw new ProposalError(error.message, error.code === 'STALE' ? 'STALE' : 'INVALID')
        }
        throw error
      }
    }
    if (payload.version !== 1) {
      throw new ProposalError('unsupported proposal version', 'INVALID')
    }
  }
  return asManuscriptProposal(payload)
}

/** Re-read each basis source and fail closed as STALE when path or version no longer match. */
export async function assertWritingProposalBasis(
  context: WorkspaceFileContext,
  basis: readonly WritingProposalBasis[] | undefined,
): Promise<void> {
  if (!basis?.length) return
  for (const item of basis) {
    try {
      const current = await readTextFile(context, item.path)
      if (current.version !== item.version) {
        throw new ProposalError(`basis source ${item.path} has changed`, 'STALE')
      }
    } catch (error) {
      if (error instanceof ProposalError) throw error
      if (error instanceof FileOpError) throw new ProposalError(`basis source ${item.path} has changed`, 'STALE')
      throw error
    }
  }
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

function assertGenerationBaseline(actual: string, expected: string | undefined): void {
  if (expected !== undefined && actual !== expected) {
    throw new ProposalError('proposal is stale', 'STALE')
  }
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
  await assertWritingProposalBasis(context, proposal.basis)
  if (proposal.kind === 'create') {
    try {
      const existing = await readTextFile(context, proposal.path)
      /* V1 可填充仍为空白的占位文件；V2 exclusive create 不覆盖任何已有文件。 */
      if (isWritingV2Create(proposal) || existing.text.trim() !== '') {
        throw new ProposalError('target file already exists', 'STALE')
      }
      return { ...proposal, applicable: true }
    } catch (error) {
      if (error instanceof FileOpError && error.code === 'NOT_FOUND') {
        // This low-level channel never creates directories. Workbench owns that workflow.
        try { await listDirStrict(context, parentRelative(proposal.path)) }
        catch (parentError) {
          if (parentError instanceof FileOpError && parentError.code === 'NOT_FOUND') {
            throw new FileOpError('parent directory does not exist', 'PARENT_MISSING')
          }
          throw parentError
        }
        return { ...proposal, applicable: true }
      }
      throw error
    }
  }
  const current = await readTextFile(context, proposal.path)
  assertGenerationBaseline(current.version, proposal.targetVersion)
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
  await assertWritingProposalBasis(context, proposal.basis)
  if (proposal.kind === 'create') {
    try {
      const existing = await readTextFile(context, proposal.path)
      if (isWritingV2Create(proposal) || existing.text.trim() !== '') {
        throw new ProposalError('target file already exists', 'STALE')
      }
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
  assertGenerationBaseline(current.version, proposal.targetVersion)
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
