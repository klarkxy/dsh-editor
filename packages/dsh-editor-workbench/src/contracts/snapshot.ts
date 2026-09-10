export type SnapshotResponse = { snapshotId: string; label?: string; createdAt: string; files: number; bytes: number; excluded: number }
export type RestoreProbeResponse = {
  state: 'none' | 'ready' | 'blocked' | 'recoverable' | 'complete'
  token?: string
  receiptId?: string
  snapshotId?: string
  files: number
  bytes: number
  excluded: Array<{ path: string; reason: 'hidden' | 'generated' | 'other' }>
  preview: string[]
  message?: string
}
