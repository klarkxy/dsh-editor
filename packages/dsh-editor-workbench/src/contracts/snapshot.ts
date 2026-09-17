export type SnapshotChange = { path: string; kind: 'added' | 'removed' | 'modified' }
export type SnapshotResponse = {
  snapshotId: string
  hash: string
  label?: string
  createdAt: string
  files: number
  bytes: number
  excluded: number
  changes: SnapshotChange[]
}
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
