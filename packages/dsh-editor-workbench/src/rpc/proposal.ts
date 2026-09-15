import { applyChapterProposal, applyCreate, isPlanningKind, parsePlanningProposal, prepareChapterMeta, prepareCreate, type PlanningCreateProposal } from '../planning-proposals.ts'
import {
  applyMerge,
  applyRenames,
  applySplit,
  parseProposal,
  prepareMerge,
  prepareRenames,
  prepareSplit,
  ProposalOpsError,
  type MergeProposal,
  type RenamesProposal,
  type SplitProposal,
} from '../proposal-ops.ts'
import {
  WRITING_V2_CREATE,
  assertWritingProposalBasis,
  isWritingProposalV2,
  parseWritingProposal,
  ProposalError,
  WritingProposalError,
  type WritingProposalV2,
} from 'dsh-manuscript/host-api'
import type { WorkbenchHandlers, WorkbenchRequestContext } from './types.ts'

function asPlanningCreate(proposal: Extract<WritingProposalV2, { kind: 'create' }>): PlanningCreateProposal {
  return {
    marker: 'dsh-editor.proposal',
    version: 1,
    kind: 'create',
    path: proposal.path,
    text: proposal.text,
    summary: proposal.summary,
    writingV2: WRITING_V2_CREATE,
  }
}

function asLegacyOpsProposal(proposal: Exclude<WritingProposalV2, { kind: 'edit' | 'create' }>): SplitProposal | MergeProposal | RenamesProposal {
  if (proposal.kind === 'split') {
    return {
      marker: 'dsh-editor.proposal',
      version: 1,
      kind: 'split',
      summary: proposal.summary,
      path: proposal.path,
      anchor: proposal.anchor,
      newPath: proposal.newPath,
      targetVersion: proposal.targetVersion,
    }
  }
  if (proposal.kind === 'merge') {
    return {
      marker: 'dsh-editor.proposal',
      version: 1,
      kind: 'merge',
      summary: proposal.summary,
      path: proposal.path,
      sourcePath: proposal.sourcePath,
      targetVersion: proposal.targetVersion,
      sourceVersion: proposal.sourceVersion,
    }
  }
  return { marker: 'dsh-editor.proposal', version: 1, kind: 'renames', summary: proposal.summary, renames: proposal.renames }
}

function wrapWritingProposalError(error: unknown): never {
  if (error instanceof WritingProposalError || error instanceof ProposalError) {
    throw new ProposalOpsError(error.message, error.code === 'STALE' ? 'STALE' : 'INVALID')
  }
  throw error
}

/**
 * 作者提案的 prepare / apply，包括目录创建与章纲、小结字段更新。
 * 普通 edit 继续由 manuscript 通道处理。
 */
async function runProposalDispatch(
  endpoint: 'proposal.prepare' | 'proposal.apply',
  request: WorkbenchRequestContext,
): Promise<unknown> {
  const { files, op, body } = request
  const input = body.proposal
  if (isWritingProposalV2(input)) {
    try {
      const proposal = parseWritingProposal(input)
      await assertWritingProposalBasis(files, proposal.basis)
      if (proposal.kind === 'edit') {
        throw new ProposalOpsError('edit 请走 manuscript 通道', 'INVALID')
      }
      if (proposal.kind === 'create') {
        const create = asPlanningCreate(proposal)
        if (endpoint === 'proposal.prepare') return { create: await prepareCreate(files, create) }
        const versions = body.expectedVersions
        const expected = versions && typeof versions === 'object' && !Array.isArray(versions)
          ? (versions as Record<string, string>)[proposal.path] : undefined
        return await applyCreate(files, create, expected)
      }
      const legacy = asLegacyOpsProposal(proposal)
      if (endpoint === 'proposal.prepare') {
        if (legacy.kind === 'split') return { split: await prepareSplit(files, legacy) }
        if (legacy.kind === 'merge') return { merge: await prepareMerge(files, legacy) }
        return { renames: await prepareRenames(files, legacy, 'generic') }
      }
      const expectedVersions = body.expectedVersions && typeof body.expectedVersions === 'object' && !Array.isArray(body.expectedVersions)
        ? body.expectedVersions as Record<string, string>
        : undefined
      if (legacy.kind === 'split') return await applySplit(files, legacy, expectedVersions?.[legacy.path] ?? '')
      if (legacy.kind === 'merge') {
        return await applyMerge(op, legacy, {
          path: expectedVersions?.[legacy.path],
          sourcePath: expectedVersions?.[legacy.sourcePath],
        })
      }
      return await applyRenames(op, legacy, expectedVersions, 'generic')
    } catch (error) {
      wrapWritingProposalError(error)
    }
  }
  if (input && typeof input === 'object' && isPlanningKind((input as Record<string, unknown>).kind)) {
    const proposal = parsePlanningProposal(input)
    if (endpoint === 'proposal.prepare') {
      return proposal.kind === 'create'
        ? { create: await prepareCreate(files, proposal) }
        : { chapterMeta: await prepareChapterMeta(files, proposal) }
    }
    const versions = body.expectedVersions
    const expected = versions && typeof versions === 'object' && !Array.isArray(versions)
      ? (versions as Record<string, string>)[proposal.path] : undefined
    return proposal.kind === 'create'
      ? await applyCreate(files, proposal, expected)
      : await applyChapterProposal(files, proposal, expected)
  }
  const proposal = parseProposal(body.proposal)
  if (endpoint === 'proposal.prepare') {
    if (proposal.kind === 'split') return { split: await prepareSplit(files, proposal) }
    if (proposal.kind === 'merge') return { merge: await prepareMerge(files, proposal) }
    return { renames: await prepareRenames(files, proposal) }
  }
  const expectedVersions = body.expectedVersions && typeof body.expectedVersions === 'object' && !Array.isArray(body.expectedVersions)
    ? body.expectedVersions as Record<string, string>
    : undefined
  if (proposal.kind === 'split') {
    const version = expectedVersions?.[proposal.path] ?? ''
    return await applySplit(files, proposal, version)
  }
  if (proposal.kind === 'merge') {
    return await applyMerge(op, proposal, {
      path: expectedVersions?.[proposal.path],
      sourcePath: expectedVersions?.[proposal.sourcePath],
    })
  }
  return await applyRenames(op, proposal, expectedVersions)
}

export const proposalHandlers = {
  'proposal.prepare': {
    async run(request) {
      return await runProposalDispatch('proposal.prepare', request)
    },
  },
  'proposal.apply': {
    mutation: true,
    async run(request) {
      return await runProposalDispatch('proposal.apply', request)
    },
  },
} satisfies WorkbenchHandlers
