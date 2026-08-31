import type { RestoreProbeResponse, SnapshotResponse } from 'dsh-editor-workbench/contracts'

export type SnapshotView = SnapshotResponse
export type RestoreView = RestoreProbeResponse

export type SnapshotFlow =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
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
