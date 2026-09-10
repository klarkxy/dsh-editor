export type OverviewRequest = { nonce: number }

type Listener = (request: OverviewRequest) => void

const listeners = new Set<Listener>()
let pending: OverviewRequest | null = null

export function requestOverview(): OverviewRequest {
  pending = { nonce: Date.now() }
  for (const listener of listeners) listener(pending)
  return pending
}

export function pendingOverviewRequest(): OverviewRequest | null {
  return pending
}

export function consumeOverviewRequest(request: OverviewRequest): void {
  if (pending && pending.nonce === request.nonce) pending = null
}

export function subscribeOverviewRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
