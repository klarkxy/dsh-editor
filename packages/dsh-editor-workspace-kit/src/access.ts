import type { WorkspaceAccess, WorkspaceFileContext } from 'dsh-manuscript/host-api'

export type WorkspaceOpAccess = {
  path: string
  rootKey: string
  mode: string
  files: WorkspaceFileContext
}

export type OverviewAccess = WorkspaceOpAccess
export type ImportAccess = WorkspaceOpAccess
export type SnapshotAccess = WorkspaceOpAccess
export type LifecycleAccess = WorkspaceOpAccess & {
  moveNoReplace?: (source: string, target: string, signal?: AbortSignal) => Promise<void>
}

export function workspaceOpAccess(
  host: { fs: WorkspaceFileContext['fs'] },
  access: Pick<WorkspaceAccess, 'workspace' | 'root' | 'policy'>,
  signal: AbortSignal,
): WorkspaceOpAccess {
  return {
    path: access.workspace.path,
    rootKey: access.root.targetKey,
    mode: access.policy.mode,
    files: { fs: host.fs, cwd: access.workspace.path, root: access.root, policy: access.policy, signal },
  }
}
