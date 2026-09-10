import type { CardKind } from '../contracts.ts'

export type CardsOpenRequest = { nonce: number; kind: CardKind }

type Listener = (request: CardsOpenRequest) => void

const listeners = new Set<Listener>()
let pending: CardsOpenRequest | null = null

export function requestCardsOpen(kind: CardKind): CardsOpenRequest {
  pending = { nonce: Date.now(), kind }
  for (const listener of listeners) listener(pending)
  return pending
}

export function pendingCardsRequest(): CardsOpenRequest | null {
  return pending
}

export function consumeCardsRequest(request: CardsOpenRequest): void {
  if (pending && pending.nonce === request.nonce) pending = null
}

export function subscribeCardsRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
