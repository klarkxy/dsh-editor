import type { Context } from '@deepseek-ai/cordis'
import { withWorkspaceWrite, asHost, badRequest, mapHostError, registerHostRpc, resolveWorkspaceAccess } from 'dsh-manuscript/host-api'
import { WORKBENCH_RPC_CHANNEL, type WorkbenchRpcResult } from './contracts.ts'
import { BinaryError } from './binary.ts'
import { ImportError } from './import.ts'
import { LifecycleError } from './lifecycle.ts'
import { workspaceOpAccess } from './kit/access.ts'
import { ProjectInitError } from './project.ts'
import { SnapshotError } from './snapshot.ts'
import { OverviewError } from './overview.ts'
import { ChapterStatusError } from './chapter-status.ts'
import { MetadataIoError } from './metadata-io.ts'
import { WritingLogError } from './writing-log.ts'
import { ProofreadError } from './proofread.ts'
import { ProposalOpsError } from './proposal-ops.ts'
import { getWorkbenchHandler, str, type WorkbenchRequestContext } from './rpc/index.ts'

export const name = 'dsh-editor-workbench'
export const inject = ['connection', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'webServer'] as const

type Payload = Record<string, unknown>

export function mapEditorFilesError(error: unknown): WorkbenchRpcResult {
  if (error instanceof ProjectInitError) {
    if (error.code === 'CANCELLED') return { ok: false, error: { code: 'cancelled', message: error.message, details: {} } }
    if (error.code === 'IO') return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
    if (error.code === 'READ_ONLY') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'EXISTS') return { ok: false, error: { code: 'directory-exists', message: error.message, details: { path: '' } } }
    return { ok: false, error: { code: 'workspace-invalid-path', message: error.message, details: { path: '' } } }
  }
  if (error instanceof ImportError) {
    if (error.code === 'READ_ONLY') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'STALE' || error.code === 'BLOCKED' || error.code === 'TARGET_NOT_EMPTY' || error.code === 'NESTED' || error.code === 'CLEANUP_BLOCKED') return badRequest(error.message)
    return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
  }
  if ((error instanceof SnapshotError || error instanceof ProposalOpsError) && error.recovery) {
    return { ok: false, error: { code: 'internal', message: error.message, details: error.recovery } }
  }
  if (error instanceof SnapshotError) {
    if (error.code === 'READ_ONLY') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'BLOCKED' || error.code === 'STALE' || error.code === 'CLEANUP_BLOCKED') return badRequest(error.message)
    return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
  }
  if (error instanceof LifecycleError && error.recoveryPath) {
    return { ok: false, error: { code: 'internal', message: error.message, details: {
      partial: true, appliedPaths: [], recoveryPath: error.recoveryPath,
    } } }
  }
  if (error instanceof LifecycleError) {
    if (error.code === 'READ_ONLY' || error.code === 'NOT_FOUND') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'EXISTS') return { ok: false, error: { code: 'directory-exists', message: error.message, details: { path: '' } } }
    if (error.code === 'IO' || error.code === 'UNSUPPORTED') return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
    return badRequest(error.message)
  }
  if (error instanceof OverviewError || error instanceof ChapterStatusError || error instanceof WritingLogError || error instanceof MetadataIoError || error instanceof ProofreadError) {
    if (error.code === 'READ_ONLY') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'BLOCKED' || error.code === 'INVALID_PATH' || error.code === 'INVALID') return badRequest(error.message)
    return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
  }
  if (error instanceof BinaryError) {
    if (error.code === 'INVALID_PATH' || error.code === 'BLOCKED') {
      return { ok: false, error: { code: 'workspace-invalid-path', message: error.message, details: { path: '' } } }
    }
    if (error.code === 'NOT_FOUND') {
      return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    }
    if (error.code === 'INVALID_EXTENSION' || error.code === 'TOO_LARGE') return badRequest(error.message)
    return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
  }
  if (error instanceof ProposalOpsError) {
    if (error.code === 'NOT_FOUND') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'EXISTS') return { ok: false, error: { code: 'directory-exists', message: error.message, details: { path: '' } } }
    if (error.code === 'IO') return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
    return badRequest(error.message)
  }
  return mapHostError(error) ?? { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } }
}

export async function dispatchEditorFiles(ctx: Context, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Payload : {}
  const host = asHost(ctx)
  const handler = getWorkbenchHandler(endpoint)
  if (!handler) throw new Error(`unknown workbench endpoint ${endpoint}`)

  const resolvePeer = async (sessionId: string) => {
    const peer = await resolveWorkspaceAccess(host, sessionId, signal)
    return workspaceOpAccess(host, peer, signal)
  }

  if (handler.sessionless) {
    return handler.run({ ctx, host, body, signal, resolvePeer } as WorkbenchRequestContext)
  }

  const sessionKey = handler.sessionKey ?? 'sessionId'
  const access = await resolveWorkspaceAccess(host, str(body, sessionKey), signal)
  const files = { fs: host.fs, cwd: access.workspace.path, root: access.root, policy: access.policy, signal }
  const op = workspaceOpAccess(host, access, signal)
  const run = (): Promise<unknown> => handler.run({ ctx, host, access, files, op, body, signal, resolvePeer })
  return handler.mutation ? withWorkspaceWrite(access.root.targetKey, run) : run()
}

export function registerWorkbenchRpc(ctx: Context): () => void {
  const host = asHost(ctx)
  return registerHostRpc(host, WORKBENCH_RPC_CHANNEL, async (endpoint: string, payload: unknown, signal: AbortSignal) => {
    try {
      return { ok: true, value: await dispatchEditorFiles(ctx, endpoint, payload, signal) }
    } catch (error) {
      return mapEditorFilesError(error)
    }
  })
}

export function apply(ctx: Context): void {
  ctx.effect(() => registerWorkbenchRpc(ctx), 'dsh-editor-workbench.rpc')
}
