export type ZhihuTicket = { revision: number; request: number }

export type ZhihuClientState = {
  /** Current input revision; every query edit, mode switch or tab change bumps it. */
  revision: () => number
  /** Record an input change; aborts any in-flight request and returns the new revision. */
  noteInput: () => number
  /** Begin a request bound to the current revision; aborts any in-flight request. */
  begin: () => { ticket: ZhihuTicket; signal: AbortSignal }
  /** True only while neither the input nor the request lineage moved on. */
  isCurrent: (ticket: ZhihuTicket) => boolean
  /** Abort the in-flight request and stale its ticket (tab change/close/unmount). */
  cancel: () => void
}

/**
 * Stale-result guard for the zhihu panel: a response must only be applied to
 * the exact query/mode revision it was issued from. Editing aborts the
 * in-flight request outright — its results target a query that no longer
 * exists. Request identity handles superseded and cancelled calls, and a late
 * resolution after a tab change or panel close is dropped.
 */
export function createZhihuClientState(): ZhihuClientState {
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
