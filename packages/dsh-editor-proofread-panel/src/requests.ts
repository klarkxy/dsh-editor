import type { ProofreadScope } from './proofread-view.ts'

export type ProofreadRequest = { scope: ProofreadScope; nonce: number }

type Listener = (request: ProofreadRequest) => void

const listeners = new Set<Listener>()
let pending: ProofreadRequest | null = null

export function requestProofread(scope: ProofreadScope): ProofreadRequest {
  pending = { scope, nonce: Date.now() }
  for (const listener of listeners) listener(pending)
  return pending
}

export function pendingProofreadRequest(): ProofreadRequest | null {
  return pending
}

export function consumeProofreadRequest(request: ProofreadRequest): void {
  if (pending && pending.nonce === request.nonce) pending = null
}

export function subscribeProofreadRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
