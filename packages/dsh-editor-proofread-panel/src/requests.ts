import { createRequestManager, type PanelRequest } from 'dsh-editor-panel-base/requests'
import type { ProofreadScope } from './proofread-view.ts'

export type ProofreadRequest = PanelRequest & { scope: ProofreadScope }

const manager = createRequestManager<ProofreadRequest>()

export function requestProofread(scope: ProofreadScope): ProofreadRequest {
  return manager.request({ scope, nonce: Date.now() })
}

export const pendingProofreadRequest = manager.pending
export const consumeProofreadRequest = manager.consume
export const subscribeProofreadRequest = manager.subscribe
