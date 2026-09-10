/** A multi-file operation stopped after committing part of its work. */
export type OperationRecovery = { partial: true; appliedPaths: string[]; recoveryPath?: string; safetySnapshotId?: string }
