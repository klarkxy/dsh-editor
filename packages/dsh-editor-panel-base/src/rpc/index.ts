/**
 * Common RPC utilities for DSH Editor panels.
 * 
 * Provides type-safe RPC communication patterns including:
 * - Result types (ok/error)
 * - Safe call wrappers
 * - Request gating (prevent race conditions)
 * - Error message localization
 * 
 * @module dsh-editor-panel-base/rpc
 */

import type { ShellLocale } from 'dsh-editor-seats'

/**
 * RPC call result - either success with value or failure with error details.
 */
export type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message?: string; details?: unknown } }

/**
 * Request tracking ticket for race condition prevention.
 */
export type RequestTicket = Readonly<{ scope: string; sequence: number }>

/**
 * Wrap an RPC call with error handling.
 * Catches exceptions and converts them to RpcResult error format.
 */
export function safeRpcCall<T>(request: () => Promise<unknown>): Promise<RpcResult<T>> {
  return Promise.resolve()
    .then(() => request() as Promise<RpcResult<T>>)
    .catch((error: unknown) => ({
      ok: false as const,
      error: { code: 'internal', message: error instanceof Error ? error.message : 'request failed', details: {} },
    }))
}

/**
 * Extract text representation from RPC failure.
 * @internal
 */
function rpcFailureText(result: RpcResult): string {
  if (result.ok) return ''
  return `${result.error.code ?? ''} ${result.error.message ?? ''}`
}

/**
 * Convert RPC error to user-friendly localized message.
 * 
 * Patterns matched:
 * - Stale/version conflicts -> disk changed
 * - Session not found -> session missing
 * - Not found -> resource missing
 * - Default -> generic error
 * 
 * @param result - The RPC result to extract error from
 * @param locale - Shell locale (currently unused, for future i18n)
 * @param messages - Message provider function (panel-specific)
 * @returns Localized error message
 */
export function errorMessage(
  result: RpcResult,
  _locale: ShellLocale | undefined,
  messages: (key: string) => string
): string {
  if (result.ok) return ''
  const blob = rpcFailureText(result)
  if (/stale|changed|version|版本/i.test(blob)) return messages('error.diskChanged')
  if (/session-not-found|session is not live/i.test(blob)) return messages('error.sessionMissing')
  if (/not-found|missing/i.test(blob)) return messages('error.notFound')
  return result.error.message || messages('error.generic')
}

/**
 * Gate to ensure only the latest request in a scope is processed.
 * Prevents race conditions when rapid requests are made.
 * 
 * @example
 * ```ts
 * const gate = new LatestRequestGate()
 * const ticket = gate.begin('project-123')
 * const result = await fetchData()
 * if (gate.isCurrent(ticket)) {
 *   updateUI(result)
 * }
 * ```
 */
export class LatestRequestGate {
  private scope = ''
  private sequence = 0

  /**
   * Change scope, invalidating all previous tickets.
   */
  setScope(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope
    this.sequence += 1
  }

  /**
   * Begin a new request, returning a ticket.
   * Previous tickets in this scope are invalidated.
   */
  begin(scope: string): RequestTicket {
    this.setScope(scope)
    this.sequence += 1
    return { scope, sequence: this.sequence }
  }

  /**
   * Check if a ticket is still current.
   * Returns false if a newer request was started in the same scope.
   */
  isCurrent(ticket: RequestTicket): boolean {
    return ticket.scope === this.scope && ticket.sequence === this.sequence
  }
}
