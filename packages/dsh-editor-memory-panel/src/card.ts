import { createElement as e, type ReactNode } from 'react'
import { parseMemoryUpdateReceipt, type MemoryUpdateReceipt } from 'dsh-editor-workbench/contracts'
import type { ShellMessageCardContext } from 'dsh-editor-seats'
import { MemoryChangeDetail, type RpcCaller } from './panel.ts'
import { setMemoryLocale } from './messages.ts'

function asReceipt(result: unknown): MemoryUpdateReceipt | undefined {
  if (typeof result === 'string') return parseMemoryUpdateReceipt(result)
  if (!result || typeof result !== 'object') return undefined
  return parseMemoryUpdateReceipt(JSON.stringify(result))
}

/** Chat `novel_memory_update` tool-result → the same confirm/undo card the sidebar uses. */
export function renderMemoryUpdateMessageCard(props: {
  result: unknown
  context: ShellMessageCardContext
  rpc: RpcCaller
}): ReactNode | null {
  setMemoryLocale(props.context.locale)
  const receipt = asReceipt(props.result)
  if (!receipt) return null
  return e(MemoryChangeDetail, {
    rpc: props.rpc,
    sessionId: props.context.sessionId,
    id: receipt.id,
    fallback: receipt,
    onApplied: props.context.onApplied,
    onRefresh: () => {
      props.context.refresh('tree')
      props.context.refresh('content')
    },
  })
}
