import type { Context } from '@deepseek-ai/cordis'
import type { asHost, resolveWorkspaceAccess, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import type { WorkspaceOpAccess } from '../kit/access.ts'

export type WorkbenchRequestContext = {
  ctx: Context
  host: ReturnType<typeof asHost>
  /** Resolved workspace; absent for sessionless endpoints. */
  access: Awaited<ReturnType<typeof resolveWorkspaceAccess>>
  /** Built once per request after access resolution. */
  files: WorkspaceFileContext
  op: WorkspaceOpAccess
  body: Record<string, unknown>
  signal: AbortSignal
  resolvePeer(sessionId: string): Promise<WorkspaceOpAccess>
}

export type WorkbenchHandler = {
  run(request: WorkbenchRequestContext): Promise<unknown>
  mutation?: boolean
  sessionless?: boolean
  sessionKey?: 'sessionId' | 'targetSessionId'
}

export type WorkbenchHandlers = Record<string, WorkbenchHandler>

export function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}
