import { createHash } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { ProposalError, type Proposal } from './proposal.ts'

const receiptSchema = z.object({
  state: z.enum(['applied', 'undone']), path: z.string(), version: z.string(), updatedAt: z.string(),
})
export type ProposalReceipt = z.infer<typeof receiptSchema>
export const proposalReceiptDomainSpec = defineDomain({
  name: 'dsh_editor_proposal_receipts', version: 1,
  tables: { receipts: domainTable<string, ProposalReceipt>(receiptSchema) },
})
export interface ProposalReceiptTable {
  get(key: string): ProposalReceipt | undefined
  put(key: string, value: ProposalReceipt): Promise<void>
}
export class ProposalReceiptWriteError extends Error {
  constructor(readonly path: string, cause: unknown) {
    super('稿件已写入，但审批回执未能保存。请核对已写入文件。', { cause })
    this.name = 'ProposalReceiptWriteError'
  }
}
export function validateProposalReceiptId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProposalError('invalid proposal receipt id', 'INVALID')
  }
}
export function createProposalReceiptStore(table: ProposalReceiptTable) {
  function key(workspacePath: string, sessionId: string, receiptId: string, proposal: Proposal) {
    validateProposalReceiptId(receiptId)
    // parseProposal creates the canonical field order; proposal baselines remain part of the identity.
    const digest = createHash('sha256').update(JSON.stringify(proposal)).digest('hex')
    return JSON.stringify([workspacePath, sessionId, receiptId, digest])
  }
  return {
    get(workspacePath: string, sessionId: string, receiptId: string, proposal: Proposal) {
      return table.get(key(workspacePath, sessionId, receiptId, proposal)) ?? null
    },
    async record(workspacePath: string, sessionId: string, receiptId: string, proposal: Proposal,
      state: 'applied' | 'undone', result: { path: string; version: string }) {
      try {
        await table.put(key(workspacePath, sessionId, receiptId, proposal), {
          state, path: result.path, version: result.version, updatedAt: new Date().toISOString(),
        })
      } catch (cause) { throw new ProposalReceiptWriteError(result.path, cause) }
    },
  }
}
export type ProposalReceiptStore = ReturnType<typeof createProposalReceiptStore>
