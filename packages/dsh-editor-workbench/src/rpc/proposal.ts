import { parseProposalChange } from '../proposals/proposal-adapters.ts'
import { executeProposal } from '../proposals/proposal-execution.ts'
import type { WorkbenchHandlers, WorkbenchRequestContext } from './types.ts'

async function runProposal(phase: 'prepare' | 'apply', request: WorkbenchRequestContext): Promise<unknown> {
  const { body, op } = request
  const versions = body.expectedVersions
  const expectedVersions = versions && typeof versions === 'object' && !Array.isArray(versions)
    ? versions as Record<string, string> : undefined
  return await executeProposal(phase, op, parseProposalChange(body.proposal), expectedVersions)
}

export const proposalHandlers = {
  'proposal.prepare': {
    async run(request) { return await runProposal('prepare', request) },
  },
  'proposal.apply': {
    mutation: true,
    async run(request) { return await runProposal('apply', request) },
  },
} satisfies WorkbenchHandlers
