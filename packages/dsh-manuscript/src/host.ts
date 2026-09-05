import type { Context } from '@deepseek-ai/cordis'

export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { message: string } }

export type RpcBag = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult>
  handle: (
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
    options: { authority: string },
  ) => () => void
}

export type SlotSpec = {
  name: string
  children?: Record<string, { kind: string; scope: string }>
}

export type FsTargetLike = {
  targetKey: string
  displayPath: string
}

export type FsVersionLike = string

export type FsInfoLike = {
  version: FsVersionLike
  type: 'file' | 'directory' | 'other'
  size?: number
}

export type FsPathInfoLike = {
  version: FsVersionLike
  type: 'file' | 'directory' | 'symlink' | 'other'
  size?: number
}

export type FsDirEntryLike = {
  name: string
  type: 'file' | 'directory' | 'other'
  target: FsTargetLike
  version?: FsVersionLike
  size?: number
}

export type FsWriteIntentLike =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: FsVersionLike }

export type SandboxExecutionPolicyLike = {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
  sessionId?: string
}

export type FileSystemLike = {
  resolve: (path: string, opts?: { cwd?: string; signal?: AbortSignal }) => Promise<FsTargetLike>
  contains: (parent: FsTargetLike, child: FsTargetLike) => boolean
  stat: (target: FsTargetLike, signal?: AbortSignal) => Promise<FsInfoLike | undefined>
  lstat: (path: string, opts?: { cwd?: string }, signal?: AbortSignal) => Promise<FsPathInfoLike | undefined>
  readText: (target: FsTargetLike, signal?: AbortSignal) => Promise<string>
  listDir: (target: FsTargetLike, signal?: AbortSignal) => Promise<FsDirEntryLike[]>
  writeText: (
    target: FsTargetLike,
    content: string,
    expected?: FsWriteIntentLike,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicyLike,
  ) => Promise<{ operation: 'create' | 'update'; version: FsVersionLike; before: string | null; after: string }>
}

export type SessionLike = {
  readonly id: string
  readonly header: { readonly cwd?: string }
  requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined
}

export type WorkspaceLike = {
  readonly path: string
  readonly sessionIds: readonly string[]
}

export type ManuscriptHost = Context & {
  connection: { rpc: RpcBag }
  sessions: { get: (id: string) => SessionLike | undefined }
  workspaceRegistry: { resolveByPath: (path: string) => Promise<WorkspaceLike | undefined> }
  sandboxPolicy: { resolve: (request: { session: SessionLike }) => SandboxExecutionPolicyLike }
  fs: FileSystemLike
}

export type SessionListSnapshot = {
  current?: string
  byId?: Record<string, { cwd?: string }>
}

export type ManuscriptClient = Context & {
  slots: {
    inject: (key: string, callback: () => unknown) => () => void
    register: (
      spec: SlotSpec,
      render: (props: { sessionId?: string; renderSlot?: (name: string) => unknown }) => unknown,
    ) => () => void
  }
  sessions: {
    list?: {
      getSnapshot?: () => SessionListSnapshot
      subscribe?: (fn: () => void) => () => void
    }
  }
  connection: { rpc: RpcBag }
}

export class WorkspaceAuthorityError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'SESSION_REQUIRED'
      | 'SESSION_NOT_FOUND'
      | 'SESSION_CWD_MISSING'
      | 'WORKSPACE_NOT_FOUND'
      | 'WORKSPACE_MISMATCH'
      | 'WORKSPACE_UNAVAILABLE',
    readonly context: { sessionId?: string; workspacePath?: string } = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'WorkspaceAuthorityError'
  }
}

export type WorkspaceAccess = {
  session: SessionLike
  workspace: WorkspaceLike
  root: FsTargetLike
  policy: SandboxExecutionPolicyLike
}

/**
 * Select a live session and derive its registered canonical workspace.
 *
 * This is deliberately a live-session selection boundary, not caller
 * authentication: generic loopback RPC does not expose connection identity.
 */
export async function resolveWorkspaceAccess(
  host: ManuscriptHost,
  sessionId: string,
  signal?: AbortSignal,
): Promise<WorkspaceAccess> {
  if (!sessionId) throw new WorkspaceAuthorityError('session id is required', 'SESSION_REQUIRED', { sessionId })
  const session = host.sessions.get(sessionId)
  if (!session) throw new WorkspaceAuthorityError('session is not live', 'SESSION_NOT_FOUND', { sessionId })
  const cwd = session.header.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new WorkspaceAuthorityError('session has no workspace cwd', 'SESSION_CWD_MISSING', { sessionId })
  }

  let workspace: WorkspaceLike | undefined
  try {
    workspace = await host.workspaceRegistry.resolveByPath(cwd)
  } catch (error) {
    throw new WorkspaceAuthorityError(
      'session workspace is unavailable',
      'WORKSPACE_UNAVAILABLE',
      { sessionId, workspacePath: cwd },
      { cause: error },
    )
  }
  if (!workspace) {
    throw new WorkspaceAuthorityError(
      'session cwd is not a registered workspace',
      'WORKSPACE_NOT_FOUND',
      { sessionId, workspacePath: cwd },
    )
  }
  if (!workspace.sessionIds.some((id) => String(id) === String(session.id))) {
    throw new WorkspaceAuthorityError(
      'session is not attached to this workspace',
      'WORKSPACE_MISMATCH',
      { sessionId, workspacePath: workspace.path },
    )
  }

  const root = await host.fs.resolve('.', { cwd: workspace.path, signal })
  const rootInfo = await host.fs.stat(root, signal)
  if (!rootInfo || rootInfo.type !== 'directory') {
    throw new WorkspaceAuthorityError(
      'registered workspace is not a readable directory',
      'WORKSPACE_UNAVAILABLE',
      { sessionId, workspacePath: workspace.path },
    )
  }
  return {
    session,
    workspace,
    root,
    policy: host.sandboxPolicy.resolve({ session }),
  }
}

export function asHost(ctx: Context): ManuscriptHost {
  return ctx as ManuscriptHost
}

export function asClient(ctx: Context): ManuscriptClient {
  return ctx as ManuscriptClient
}

// One live Host owns workspace mutations. Queue top-level RPCs only; the file
// primitives remain unqueued so a multi-file operation can call them directly.
const workspaceWrites = new Map<string, Promise<unknown>>()
export function withWorkspaceWrite<T>(rootKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = workspaceWrites.get(rootKey) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  workspaceWrites.set(rootKey, result)
  void result.finally(() => {
    if (workspaceWrites.get(rootKey) === result) workspaceWrites.delete(rootKey)
  }).catch(() => undefined)
  return result
}
