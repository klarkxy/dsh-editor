/**
 * Generic request management for panel open/activation.
 * 
 * Provides publish-subscribe pattern for triggering panel display:
 * - Command/UI calls `request*()` to trigger panel open
 * - Panel subscribes and responds to requests
 * - Nonce-based deduplication prevents stale activations
 * 
 * @module dsh-editor-panel-base/requests
 */

/**
 * Base request type with nonce for deduplication.
 * Panels can extend this with additional fields.
 */
export interface PanelRequest {
  nonce: number
}

/**
 * Create a request management system for a panel.
 * 
 * @example
 * ```ts
 * // In memory-panel/requests.ts
 * export type MemoryRequest = PanelRequest
 * 
 * const manager = createRequestManager<MemoryRequest>()
 * export const requestMemoryOpen = manager.request
 * export const pendingMemoryRequest = manager.pending
 * export const consumeMemoryRequest = manager.consume
 * export const subscribeMemoryRequest = manager.subscribe
 * ```
 * 
 * @example
 * ```ts
 * // With additional fields
 * export type ProofreadRequest = PanelRequest & { scope: ProofreadScope }
 * 
 * const manager = createRequestManager<ProofreadRequest>()
 * export function requestProofread(scope: ProofreadScope): ProofreadRequest {
 *   return manager.request({ scope, nonce: Date.now() })
 * }
 * ```
 */
export function createRequestManager<T extends PanelRequest>() {
  type Listener = (request: T) => void
  
  const listeners = new Set<Listener>()
  let pending: T | null = null

  return {
    /**
     * Trigger a panel open request.
     * Notifies all subscribers and stores as pending.
     */
    request(req: T): T {
      pending = req
      for (const listener of listeners) listener(pending)
      return pending
    },

    /**
     * Get the current pending request, if any.
     */
    pending(): T | null {
      return pending
    },

    /**
     * Mark a request as consumed/handled.
     * Clears pending if the nonce matches.
     */
    consume(request: T): void {
      if (pending && pending.nonce === request.nonce) {
        pending = null
      }
    },

    /**
     * Subscribe to panel open requests.
     * @returns Unsubscribe function
     */
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
