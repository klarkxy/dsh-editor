import { WorkspaceAuthorityError } from '../host.ts'
import { FileOpError } from './files.ts'
import { PathConfineError } from './paths.ts'

export type HostRpcIssue = { code: 'custom'; path: string[]; message: string }
export type HostRpcError =
  | { code: 'bad-request'; message: string; details: { issues: HostRpcIssue[] } }
  | { code: 'cancelled'; message: string; details: Record<string, never> }
  | { code: 'session-not-found'; message: string; details: { sessionId: string } }
  | { code: 'workspace-attach-failed'; message: string; details: { sessionId: string; workspaceId: string } }
  | { code: 'workspace-not-found'; message: string; details: { workspaceId: string } }
  | { code: 'workspace-invalid-path'; message: string; details: { path: string } }
  | { code: 'directory-unreadable'; message: string; details: { path: string } }
  | { code: 'directory-exists'; message: string; details: { path: string } }
  | { code: 'internal'; message: string; details: Record<string, never> }
export type HostRpcErr = { ok: false; error: HostRpcError }

export function badRequest(message: string): HostRpcErr {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [{ code: 'custom', path: [], message }] } } }
}

export function mapHostError(error: unknown): HostRpcErr | undefined {
  if (error instanceof WorkspaceAuthorityError) {
    if (error.code === 'SESSION_REQUIRED') return badRequest(error.message)
    if (error.code === 'SESSION_NOT_FOUND') {
      return { ok: false, error: { code: 'session-not-found', message: error.message, details: { sessionId: error.context.sessionId ?? '' } } }
    }
    if (error.code === 'WORKSPACE_NOT_FOUND') {
      return { ok: false, error: { code: 'workspace-not-found', message: error.message, details: { workspaceId: error.context.workspacePath ?? '' } } }
    }
    if (error.code === 'WORKSPACE_MISMATCH') {
      return {
        ok: false,
        error: {
          code: 'workspace-attach-failed',
          message: error.message,
          details: { sessionId: error.context.sessionId ?? '', workspaceId: error.context.workspacePath ?? '' },
        },
      }
    }
    return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: error.context.workspacePath ?? '' } } }
  }
  if (error instanceof PathConfineError) {
    return { ok: false, error: { code: 'workspace-invalid-path', message: error.message, details: { path: '' } } }
  }
  if (error instanceof FileOpError) {
    if (error.code === 'CANCELLED') return { ok: false, error: { code: 'cancelled', message: error.message, details: {} } }
    if (error.code === 'IO') return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
    if (error.code === 'SYMLINK') return { ok: false, error: { code: 'workspace-invalid-path', message: error.message, details: { path: '' } } }
    if (error.code === 'EXISTS') return { ok: false, error: { code: 'directory-exists', message: error.message, details: { path: '' } } }
    if (error.code === 'NOT_FOUND' || error.code === 'NOT_DIRECTORY' || error.code === 'PARENT_MISSING' || error.code === 'DENIED') {
      return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    }
    return badRequest(error.message)
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { ok: false, error: { code: 'cancelled', message: 'cancelled', details: {} } }
  }
  return undefined
}
