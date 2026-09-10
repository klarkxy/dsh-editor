export type MemoryRequest = { nonce: number }

type Listener = (request: MemoryRequest) => void

const listeners = new Set<Listener>()
let pending: MemoryRequest | null = null

export function requestMemoryOpen(): MemoryRequest {
  pending = { nonce: Date.now() }
  for (const listener of listeners) listener(pending)
  return pending
}

export function pendingMemoryRequest(): MemoryRequest | null {
  return pending
}

export function consumeMemoryRequest(request: MemoryRequest): void {
  if (pending && pending.nonce === request.nonce) pending = null
}

export function subscribeMemoryRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
