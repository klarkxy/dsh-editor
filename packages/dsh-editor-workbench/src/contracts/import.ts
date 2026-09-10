export type ImportProbeResponse = {
  state: 'none' | 'ready' | 'blocked' | 'recoverable' | 'complete'
  token?: string
  receiptId?: string
  files: number
  bytes: number
  skipped: Array<{ path: string; reason: 'hidden' | 'symlink' | 'other' | 'nonText' }>
  preview: string[]
  message?: string
}
