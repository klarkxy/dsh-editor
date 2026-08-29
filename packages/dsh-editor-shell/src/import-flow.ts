import type { ImportProbeResponse } from 'dsh-editor-workbench/contracts'

export type ImportProbeView = ImportProbeResponse
export type ImportFlow =
  | { kind: 'idle' }
  | { kind: 'review'; sourceSessionId: string; targetSessionId: string; targetWorkspaceId: string; probe: ImportProbeView }
  | { kind: 'recover'; targetSessionId: string; targetWorkspaceId: string; probe: ImportProbeView }
  | { kind: 'cleanup-confirm'; targetSessionId: string; targetWorkspaceId: string; receiptId: string }
  | { kind: 'working'; message: string }

export const idleImportFlow: ImportFlow = { kind: 'idle' }
export function importReview(sourceSessionId: string, targetSessionId: string, targetWorkspaceId: string, probe: ImportProbeView): ImportFlow {
  return probe.state === 'ready' && probe.token ? { kind: 'review', sourceSessionId, targetSessionId, targetWorkspaceId, probe } : { kind: 'idle' }
}
export function recoverImport(targetSessionId: string, targetWorkspaceId: string, probe: ImportProbeView): ImportFlow {
  return probe.state === 'recoverable' && probe.receiptId ? { kind: 'recover', targetSessionId, targetWorkspaceId, probe } : { kind: 'idle' }
}
export function importSummary(probe: ImportProbeView): string { return `${probe.files} 个文件，${probe.bytes.toLocaleString()} 字节` }
