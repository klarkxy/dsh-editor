import type { ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'

export type ChatOutgoing = {
  text: string
  state: 'sending' | 'accepted' | 'failed'
  afterRows: number
  projectContextReceipt?: ProjectContextReceiptBundle
}
