import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { emptyFusionState, type FusionState, type FusionStore } from './contracts.ts'
import { validateState } from './validation.ts'

/** One atomic business record; Sessions remain the transcript authority. */
export const fusionStateSchema = z.unknown().transform((value, ctx): FusionState => {
  try { return validateState(value) }
  catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid Fusion state' }); return z.NEVER }
})
export const fusionDomain = defineDomain({ name: 'dsh_fusion', version: 1,
  tables: { state: domainTable<string, FusionState>(fusionStateSchema) },
})
export const FUSION_STATE_KEY = 'state'
export function createFusionStore(table: { get(key: string): FusionState | undefined; put(key: string, value: FusionState): Promise<void> }): FusionStore {
  return {
    load: () => validateState(table.get(FUSION_STATE_KEY) ?? emptyFusionState()),
    save: next => table.put(FUSION_STATE_KEY, validateState(next)),
  }
}
