export type SnapshotView = {
  snapshotId: string
  label?: string
  createdAt: string
  files: number
  bytes: number
  excluded: number
}

export type RestoreView = {
  state: 'none' | 'ready' | 'blocked' | 'recoverable' | 'complete'
  token?: string
  receiptId?: string
  snapshotId?: string
  files: number
  bytes: number
  excluded: Array<{ path: string; reason: string }>
  preview: string[]
  message?: string
}

export type SnapshotFlow =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'list'; snapshots: SnapshotView[]; note?: string }
  | { kind: 'review'; sourceSessionId: string; targetSessionId: string; targetWorkspaceId: string; snapshot?: SnapshotView; probe: RestoreView }
  | { kind: 'recover'; targetSessionId: string; targetWorkspaceId: string; probe: RestoreView }
  | { kind: 'cleanup-confirm'; targetSessionId: string; targetWorkspaceId: string; receiptId: string }

export const idleSnapshotFlow: SnapshotFlow = { kind: 'idle' }

export function snapshotSummary(snapshot: Pick<SnapshotView, 'files' | 'bytes' | 'excluded'>): string {
  return `${snapshot.files} 个文件，${snapshot.bytes.toLocaleString()} 字节，排除 ${snapshot.excluded} 项`
}

export function restoreSummary(view: RestoreView): string {
  return `${view.files} 个文件，${view.bytes.toLocaleString()} 字节，排除 ${view.excluded.length} 项`
}

export function snapshotReview(
  sourceSessionId: string,
  targetSessionId: string,
  targetWorkspaceId: string,
  probe: RestoreView,
  snapshot?: SnapshotView,
): SnapshotFlow {
  return probe.state === 'ready' && probe.token
    ? { kind: 'review', sourceSessionId, targetSessionId, targetWorkspaceId, probe, snapshot }
    : idleSnapshotFlow
}

export function recoverSnapshot(targetSessionId: string, targetWorkspaceId: string, probe: RestoreView): SnapshotFlow {
  return probe.state === 'recoverable' && probe.receiptId && probe.snapshotId
    ? { kind: 'recover', targetSessionId, targetWorkspaceId, probe }
    : idleSnapshotFlow
}

export function blocksWorkspaceOpen(view: RestoreView): boolean {
  return view.state === 'recoverable'
}
