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
 * 新提案 kind（split / merge / renames）的 prepare / apply。
 * edit / create 仍走 manuscript 通道；parseProposal 直接抛 INVALID。
 */
async function runProposalDispatch(
  endpoint: 'proposal.prepare' | 'proposal.apply',
  request: WorkbenchRequestContext,
): Promise<unknown> {
  const { host, access, op, body } = request
  const proposal = parseProposal(body.proposal)
  const files = { fs: host.fs, cwd: access.workspace.path, root: access.root, policy: access.policy }
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
