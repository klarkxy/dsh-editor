// Re-export common RPC utilities from panel-base
export {
  safeRpcCall,
  LatestRequestGate,
  type RpcResult,
  type RequestTicket,
} from 'dsh-editor-panel-base/rpc'

import { errorMessage as baseErrorMessage, type RpcResult } from 'dsh-editor-panel-base/rpc'
import type { ShellLocale } from 'dsh-editor-seats'
import { t } from './messages.ts'

export function snapshotTimeLabel(time: number): string {
  const date = new Date(time)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Adapter for panel-base errorMessage - provides message keys from memory panel i18n
 */
export function errorMessage(result: RpcResult, _locale?: ShellLocale): string {
  return baseErrorMessage(result, _locale, (key: string) => t(key as any))
}
