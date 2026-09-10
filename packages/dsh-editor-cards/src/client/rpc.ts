import type { ShellLocale } from 'dsh-editor-seats'
import { t } from './messages.ts'

export type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message?: string; details?: unknown } }

export type RequestTicket = Readonly<{ scope: string; sequence: number }>

export function safeRpcCall<T>(request: () => Promise<unknown>): Promise<RpcResult<T>> {
  return Promise.resolve()
    .then(() => request() as Promise<RpcResult<T>>)
    .catch((error: unknown) => ({
      ok: false as const,
      error: { code: 'internal', message: error instanceof Error ? error.message : 'request failed', details: {} },
    }))
}

function rpcFailureText(result: RpcResult): string {
  if (result.ok) return ''
  return `${result.error.code ?? ''} ${result.error.message ?? ''}`
}

export function isStaleFailure(result: RpcResult): boolean {
  if (result.ok) return false
  return /stale|changed|version|版本/i.test(rpcFailureText(result))
}

export function errorMessage(result: RpcResult, _locale?: ShellLocale): string {
  if (result.ok) return ''
  const blob = rpcFailureText(result)
  if (/stale|changed|version|版本/i.test(blob)) return t('error.diskChanged')
  if (/session-not-found|session is not live/i.test(blob)) return t('error.sessionMissing')
  if (/not-found|missing/i.test(blob)) return t('error.notFound')
  return result.error.message || t('error.generic')
}

export class LatestRequestGate {
  private scope = ''
  private sequence = 0

  setScope(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope
    this.sequence += 1
  }

  begin(scope: string): RequestTicket {
    this.setScope(scope)
    this.sequence += 1
    return { scope, sequence: this.sequence }
  }

  isCurrent(ticket: RequestTicket): boolean {
    return ticket.scope === this.scope && ticket.sequence === this.sequence
  }
}
