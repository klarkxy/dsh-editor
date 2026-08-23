import type { Context } from '@deepseek-ai/cordis'
import { asHost, resolveWorkspaceAccess, WorkspaceAuthorityError } from './host.ts'
import { completeFim } from './rpc/fim.ts'
import { createTextFile, FileOpError, listDir, readTextFile, writeTextFile } from './rpc/files.ts'
import { PathConfineError } from './rpc/paths.ts'

export const name = 'dsh-manuscript'
export const inject = ['connection', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'llm'] as const

type RpcOk<T> = { ok: true; value: T }
type RpcErr = { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
type RpcResult<T> = RpcOk<T> | RpcErr

function fail(code: string, message: string, details: Record<string, unknown> = {}): RpcErr {
  return { ok: false, error: { code, message, details } }
}

export function mapError(error: unknown): RpcErr {
  if (error instanceof WorkspaceAuthorityError) {
    const codes: Record<WorkspaceAuthorityError['code'], string> = {
      SESSION_REQUIRED: 'session-required',
      SESSION_NOT_FOUND: 'session-not-found',
      SESSION_CWD_MISSING: 'session-workspace-missing',
      WORKSPACE_NOT_FOUND: 'session-workspace-missing',
      WORKSPACE_MISMATCH: 'session-workspace-mismatch',
      WORKSPACE_UNAVAILABLE: 'session-workspace-unavailable',
    }
    return fail(codes[error.code], error.message)
  }
  if (error instanceof PathConfineError) return fail('workspace-invalid-path', error.message, { path: '' })
  if (error instanceof FileOpError) {
    const codes: Record<FileOpError['code'], string> = {
      NOT_FOUND: 'file-not-found',
      NOT_DIRECTORY: 'directory-unreadable',
      EXISTS: 'file-exists',
      STALE: 'file-stale',
      NOT_TEXT: 'file-not-text',
      PARENT_MISSING: 'directory-unreadable',
      TOO_LARGE: 'file-too-large',
      DENIED: 'sandbox-denied',
      SYMLINK: 'workspace-symlink-denied',
      CANCELLED: 'cancelled',
      IO: 'internal',
    }
    return fail(codes[error.code], error.message)
  }
  if (error instanceof Error && error.name === 'AbortError') return fail('cancelled', 'cancelled')
  return fail('internal', error instanceof Error ? error.message : String(error))
}

type Payload = Record<string, unknown>

function str(payload: Payload, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

export async function dispatch(
  ctx: Context,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Payload) : {}
  const host = asHost(ctx)
  const access = await resolveWorkspaceAccess(host, str(body, 'sessionId'), signal)
  const files = {
    fs: host.fs,
    cwd: access.workspace.path,
    root: access.root,
    policy: access.policy,
    signal,
  }
  const rel = str(body, 'path')
  if (endpoint === 'tree.list') return { entries: await listDir(files, rel) }
  if (endpoint === 'file.read') return await readTextFile(files, rel)
  if (endpoint === 'file.create') return await createTextFile(files, rel, str(body, 'text'))
  if (endpoint === 'file.write') return await writeTextFile(files, rel, str(body, 'text'), str(body, 'version'))
  if (endpoint === 'fim.complete') {
    const config = access.session.requestHeader?.()?.config
    const provider = typeof config?.provider === 'string' ? config.provider : ''
    const model = typeof config?.model === 'string' ? config.model : ''
    if (!provider || !model) return { text: '', route: 'dsh-llm' }
    return await completeFim({
      ctx,
      provider,
      model,
      prefix: str(body, 'prefix'),
      suffix: str(body, 'suffix'),
      signal,
    })
  }
  throw new Error(`unknown endpoint ${endpoint}`)
}

export function apply(ctx: Context): void {
  const host = asHost(ctx)
  ctx.effect(() =>
    host.connection.rpc.handle(
      '/manuscript',
      async (endpoint: string, payload: unknown, signal: AbortSignal) => {
        try {
          const value = await dispatch(ctx, endpoint, payload, signal)
          return { ok: true, value } satisfies RpcResult<unknown>
        } catch (error) {
          return mapError(error)
        }
      },
      // This fence limits exposure to the local DSH process. The selected
      // session is still explicit RPC input; generic RPC has no caller identity.
      { authority: 'loopback' },
    ),
  )
}
