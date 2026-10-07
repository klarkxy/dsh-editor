/** A single prepare/apply dispatcher for validated, protocol-independent changes. */
import {
  assertWritingProposalBasis,
  ProposalError,
  WritingProposalError,
  type WritingProposalBasis,
} from 'dsh-manuscript/host-api'
import type { LifecycleAccess } from '../lifecycle/lifecycle.ts'
import { applyChapterProposal, applyCreate, prepareChapterMeta, prepareCreate, type ChapterProposal, type CreateProposal } from './planning-proposals.ts'
import {
  applyMerge, applyRenames, applySplit,
  prepareMerge, prepareRenames, prepareSplit, ProposalOpsError,
  type MergeProposal, type RenamesProposal, type SplitProposal,
} from './proposal-ops.ts'

export type ProposalChange = (CreateProposal | ChapterProposal | SplitProposal | MergeProposal | RenamesProposal) & {
  basis?: WritingProposalBasis[]
}

export async function executeProposal(
  phase: 'prepare' | 'apply',
  access: LifecycleAccess,
  proposal: ProposalChange,
  expectedVersions?: Record<string, string>,
): Promise<unknown> {
  const { files } = access
  try {
    // On apply, the RPC mutation queue already holds the workspace lock.
    await assertWritingProposalBasis(files, proposal.basis)
  } catch (error) {
    if (error instanceof WritingProposalError || error instanceof ProposalError) {
      throw new ProposalOpsError(error.message, error.code === 'STALE' ? 'STALE' : 'INVALID', { cause: error })
    }
    throw error
  }
  switch (proposal.kind) {
    case 'create':
      return phase === 'prepare'
        ? { create: await prepareCreate(files, proposal) }
        : await applyCreate(files, proposal, expectedVersions?.[proposal.path])
    case 'chapter_plan':
    case 'chapter_summary':
      return phase === 'prepare'
        ? { chapterMeta: await prepareChapterMeta(files, proposal) }
        : await applyChapterProposal(files, proposal, expectedVersions?.[proposal.path])
    case 'split':
      return phase === 'prepare'
        ? { split: await prepareSplit(files, proposal) }
        : await applySplit(files, proposal, expectedVersions?.[proposal.path] ?? '')
    case 'merge':
      return phase === 'prepare'
        ? { merge: await prepareMerge(files, proposal) }
        : await applyMerge(access, proposal, {
          path: expectedVersions?.[proposal.path], sourcePath: expectedVersions?.[proposal.sourcePath],
        })
    case 'renames':
      return phase === 'prepare'
        ? { renames: await prepareRenames(files, proposal) }
        : await applyRenames(access, proposal, expectedVersions)
  }
}
