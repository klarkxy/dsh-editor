import { applyChapterProposal, applyCreate, isPlanningKind, parsePlanningProposal, prepareChapterMeta, prepareCreate } from '../planning-proposals.ts'
import {
  applyMerge,
  applyRenames,
  applySplit,
  parseProposal,
  prepareMerge,
  prepareRenames,
  prepareSplit,
} from '../proposal-ops.ts'
import type { WorkbenchHandlers, WorkbenchRequestContext } from './types.ts'

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
