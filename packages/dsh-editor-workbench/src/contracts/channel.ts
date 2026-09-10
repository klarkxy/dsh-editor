import type { MemoryChange, MemoryChangeSummary, MemoryUpdateReceipt } from './memory.ts'
import type {
  ChapterStatus,
  ChapterStatusSetResponse,
  ProgressHistory,
  ProgressRecordResult,
  ProjectInitResponse,
  ProjectInspectionResponse,
  ProjectOverview,
  WorkbenchPathResponse,
} from './project.ts'
import type { ImportProbeResponse } from './import.ts'
import type { RestoreProbeResponse, SnapshotResponse } from './snapshot.ts'
import type { ArchiveListResponse, ArchiveResponse } from './archive.ts'
import type { ProofreadScanRequest, ProofreadScanResponse } from './proofread.ts'
import type { ProjectContextCompilation, TaskContextCompilation } from './context.ts'
import type { OperationRecovery } from './recovery.ts'

/** Loopback-only Host RPC channel for desktop workspace lifecycle operations. */
export const WORKBENCH_RPC_CHANNEL = '/dsh-editor-workbench'

export type WorkbenchEndpoint =
  | 'project.inspect'
  | 'project.createHome'
  | 'project.init'
  | 'project.prepareIndex'
  | 'project.overview'
  | 'chapter.statusSet'
  | 'progress.record'
  | 'progress.history'
  | 'structure.groupCreate'
  | 'directory.create'
  | 'context.compile'
  | 'rules.get'
  | 'rules.open'
  | 'memory.list'
  | 'memory.get'
  | 'memory.apply'
  | 'memory.undo'
  | 'project.importProbe'
  | 'project.importApply'
  | 'project.importCleanup'
  | 'snapshot.list'
  | 'snapshot.create'
  | 'snapshot.rollback'
  | 'snapshot.restoreProbe'
  | 'snapshot.restoreApply'
  | 'snapshot.restoreCleanup'
  | 'file.rename'
  | 'file.moveManuscript'
  | 'file.readBinary'
  | 'archive.list'
  | 'archive.apply'
  | 'archive.restore'
  | 'proposal.prepare'
  | 'proposal.apply'
  | 'entry.copy'
  | 'entry.move'
  | 'entry.delete'
  | 'entry.rename'
  | 'proofread.scan'

export type ProposalRename = { from: string; to: string }
export type ProposalPayload =
  | { marker: 'dsh-editor.proposal'; version: 1; kind: 'split'; summary: string; path: string; anchor: string; newPath: string }
  | { marker: 'dsh-editor.proposal'; version: 1; kind: 'merge'; summary: string; path: string; sourcePath: string }
  | { marker: 'dsh-editor.proposal'; version: 1; kind: 'renames'; summary: string; renames: ProposalRename[] }
export type ProposalSplitPlan = { kind: 'split'; version: string; before: string; after: string; headChars: number; tailChars: number }
export type ProposalMergePlan = { kind: 'merge'; versions: { path: string; sourcePath: string }; pathChars: number; sourceChars: number }
export type ProposalRenamesPlan = { kind: 'renames'; versions: Record<string, string>; entries: ProposalRename[] }
export type ProposalApplyResult = { applied: string[]; failed?: { from: string; reason: string }; snapshotDir?: string }

export type WorkbenchRequestMap = {
  'project.inspect': { workspacePath: string }
  'project.createHome': { title: string }
  'project.init': { sessionId: string; newProject: boolean }
  'project.prepareIndex': { sessionId: string }
  'project.overview': { sessionId: string }
  'chapter.statusSet': { sessionId: string; path: string; status: ChapterStatus }
  'progress.record': { sessionId: string; totalChars: number }
  'progress.history': { sessionId: string; days?: number }
  'structure.groupCreate': { sessionId: string; path: string }
  'directory.create': { sessionId: string; path: string }
  'context.compile': { sessionId: string; userRequest: string; activePath?: string; authorPreferences?: string; authorMemory?: string }
  'rules.get': { sessionId: string }
  'rules.open': { sessionId: string }
  'memory.list': { sessionId: string }
  'memory.get': { sessionId: string; id: string }
  'memory.apply': { sessionId: string; id: string }
  'memory.undo': { sessionId: string; id: string }
  'project.importProbe': { targetSessionId: string; sourceSessionId?: string }
  'project.importApply': { targetSessionId: string; sourceSessionId: string; probeToken: string }
  'project.importCleanup': { targetSessionId: string; receiptId: string }
  'snapshot.list': { sessionId: string }
  'snapshot.create': { sessionId: string; label?: string }
  'snapshot.rollback': { sessionId: string; snapshotId: string }
  'snapshot.restoreProbe': { targetSessionId: string; sourceSessionId?: string; snapshotId?: string }
  'snapshot.restoreApply': { targetSessionId: string; sourceSessionId: string; snapshotId: string; token: string }
  'snapshot.restoreCleanup': { targetSessionId: string; receiptId: string }
  'file.rename': { sessionId: string; path: string; newName: string; expectedVersion: string }
  'file.moveManuscript': { sessionId: string; path: string; targetDirectory: string; expectedVersion: string }
  'file.readBinary': { sessionId: string; path: string }
  'archive.list': { sessionId: string }
  'archive.apply': { sessionId: string; path?: string; expectedVersion?: string; archiveId?: string }
  'archive.restore': { sessionId: string; archiveId: string; expectedVersion?: string }
  'proposal.prepare': { sessionId: string; proposal: ProposalPayload }
  'proposal.apply': { sessionId: string; proposal: ProposalPayload; expectedVersions?: Record<string, string> }
  'entry.copy': { sessionId: string; path: string; targetDir: string }
  'entry.move': { sessionId: string; path: string; targetDir: string }
  'entry.delete': { sessionId: string; path: string }
  'entry.rename': { sessionId: string; path: string; name: string }
  'proofread.scan': ProofreadScanRequest
}

export type WorkbenchResponseMap = {
  'project.inspect': ProjectInspectionResponse
  'project.createHome': WorkbenchPathResponse
  'project.init': ProjectInitResponse
  'project.prepareIndex': ProjectInitResponse
  'project.overview': ProjectOverview
  'chapter.statusSet': ChapterStatusSetResponse
  'progress.record': ProgressRecordResult
  'progress.history': ProgressHistory
  'structure.groupCreate': WorkbenchPathResponse
  'directory.create': WorkbenchPathResponse
  'context.compile': ProjectContextCompilation | TaskContextCompilation
  'rules.get': { path: string; text: string; version: string | null; exists: boolean }
  'rules.open': { path: string; text: string; version: string | null; exists: boolean }
  'memory.list': { items: MemoryChangeSummary[] }
  'memory.get': { record: MemoryChange }
  'memory.apply': MemoryUpdateReceipt
  'memory.undo': MemoryUpdateReceipt
  'project.importProbe': ImportProbeResponse
  'project.importApply': { imported: number; skipped: number }
  'project.importCleanup': { removed: number }
  'snapshot.list': SnapshotResponse[]
  'snapshot.create': SnapshotResponse
  'snapshot.rollback': { restored: number; removed: number; safetySnapshotId?: string }
  'snapshot.restoreProbe': RestoreProbeResponse
  'snapshot.restoreApply': { restored: number; skipped: number; complete: true }
  'snapshot.restoreCleanup': { removed: number }
  'file.rename': Required<WorkbenchPathResponse>
  'file.moveManuscript': Required<WorkbenchPathResponse>
  'file.readBinary': { base64: string; mime: string }
  'archive.list': ArchiveListResponse
  'archive.apply': ArchiveResponse
  'archive.restore': ArchiveResponse
  'proposal.prepare': { split?: ProposalSplitPlan; merge?: ProposalMergePlan; renames?: ProposalRenamesPlan }
  'proposal.apply': ProposalApplyResult
  'entry.copy': { path: string }
  'entry.move': { path: string }
  'entry.delete': { path: string }
  'entry.rename': { path: string }
  'proofread.scan': ProofreadScanResponse
}

export type WorkbenchRpcIssue = { code: 'custom'; path: string[]; message: string }
export type WorkbenchRpcError =
  | { code: 'bad-request'; message: string; details: { issues: WorkbenchRpcIssue[] } }
  | { code: 'cancelled'; message: string; details: Record<string, never> }
  | { code: 'session-not-found'; message: string; details: { sessionId: string } }
  | { code: 'workspace-attach-failed'; message: string; details: { sessionId: string; workspaceId: string } }
  | { code: 'workspace-not-found'; message: string; details: { workspaceId: string } }
  | { code: 'workspace-invalid-path'; message: string; details: { path: string } }
  | { code: 'directory-unreadable'; message: string; details: { path: string } }
  | { code: 'directory-exists'; message: string; details: { path: string } }
  | { code: 'internal'; message: string; details: Partial<OperationRecovery> }
export type WorkbenchRpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: WorkbenchRpcError }
