/**
 * Live-session workspace access for legacy index/scratch internals.
 * Not a registry/store/service: one resolve + the shared write queue.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  asHost,
  resolveWorkspaceAccess,
  withWorkspaceWrite,
  WorkspaceAuthorityError,
  type WorkspaceAccess,
} from 'dsh-manuscript/host-api'

export { WorkspaceAuthorityError, type WorkspaceAccess } from 'dsh-manuscript/host-api'

export type ToolExecSession = {
  signal: AbortSignal
  agent?: { session?: { id?: unknown } }
}

export function sessionIdFromExec(exec: ToolExecSession, tool?: string): string {
  const sessionId = exec.agent?.session?.id
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new WorkspaceAuthorityError(
      tool ? `${tool} needs a live agent session` : 'session id is required',
      'SESSION_REQUIRED',
    )
  }
  return sessionId
}

export function assertSameWorkspaceRoot(expected: WorkspaceAccess, actual: WorkspaceAccess, sessionId: string): void {
  if (actual.root.targetKey !== expected.root.targetKey) {
    throw new WorkspaceAuthorityError(
      'session workspace changed during write',
      'WORKSPACE_MISMATCH',
      { sessionId, workspacePath: actual.workspace.path },
    )
  }
}

export async function resolveInternalWorkspaceAccess(
  ctx: Context,
  sessionId: string,
  signal: AbortSignal,
): Promise<WorkspaceAccess> {
  signal.throwIfAborted()
  return resolveWorkspaceAccess(asHost(ctx), sessionId, signal)
}

export async function withInternalWorkspaceWrite<T>(
  ctx: Context,
  sessionId: string,
  signal: AbortSignal,
  operation: (access: WorkspaceAccess) => Promise<T>,
): Promise<T> {
  const access = await resolveInternalWorkspaceAccess(ctx, sessionId, signal)
  return withWorkspaceWrite(access.root.targetKey, async () => {
    const locked = await resolveInternalWorkspaceAccess(ctx, sessionId, signal)
    assertSameWorkspaceRoot(access, locked, sessionId)
    return operation(locked)
  })
}
