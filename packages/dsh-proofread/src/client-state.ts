export type ProofreadTicket = { revision: number; request: number }

export type ProofreadClientState = {
  /** Current input revision; every edit bumps it. */
  revision: () => number
  /** Record an input edit; aborts any in-flight request and returns the new revision. */
  noteInput: () => number
  /** Begin a request bound to the current revision; aborts any in-flight request. */
  begin: () => { ticket: ProofreadTicket; signal: AbortSignal }
  /** True only while neither the input nor the request lineage moved on. */
  isCurrent: (ticket: ProofreadTicket) => boolean
  /** Abort the in-flight request and stale its ticket (close/unmount/slot collapse). */
  cancel: () => void
}

/**
 * Stale-result guard for the proofread panel: findings carry text offsets, so
 * a response must only be applied to the exact input revision it was issued
 * from. Editing aborts the in-flight request outright — its findings target
 * text that no longer exists. Request identity handles superseded and
 * cancelled calls.
 */
export function createProofreadClientState(): ProofreadClientState {
  let revision = 0
  let request = 0
  let controller: AbortController | null = null
  return {
    revision: () => revision,
    noteInput: () => {
      controller?.abort()
      controller = null
      request += 1
      return ++revision
    },
    begin: () => {
      controller?.abort()
      controller = new AbortController()
      request += 1
      return { ticket: { revision, request }, signal: controller.signal }
    },
    isCurrent: (ticket) => ticket.revision === revision && ticket.request === request,
    cancel: () => {
      controller?.abort()
      controller = null
      request += 1
    },
  }
}
