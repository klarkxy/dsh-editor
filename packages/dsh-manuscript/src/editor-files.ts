import type { Context } from '@deepseek-ai/cordis'
import { WORKBENCH_RPC_CHANNEL } from '../../dsh-editor-shell/src/workbench-rpc.ts'
import { asHost, resolveWorkspaceAccess } from './host.ts'
import { badRequest, mapHostError, type HostRpcError } from './rpc/host-error.ts'
import { applyImport, cleanupImport, ImportError, probeImport, type ImportAccess } from './rpc/import.ts'
import { archiveDocument, LifecycleError, listArchives, renameDocument, restoreArchive, type LifecycleAccess } from './rpc/lifecycle.ts'
import { createManuscriptGroup, initializeProject, prepareNovelIndex, ProjectInitError } from './rpc/project.ts'
import { createSnapshot, listSnapshots, restoreApply, restoreCleanup, restoreProbe, SnapshotError, type SnapshotAccess } from './rpc/snapshot.ts'
import { compileContext } from './rpc/context.ts'

type Payload = Record<string, unknown>
type RpcError =
  | HostRpcError
  | { code: 'directory-unreadable'; message: string; details: { path: string } }
  | { code: 'directory-exists'; message: string; details: { path: string } }
  | { code: 'workspace-invalid-path'; message: string; details: { path: string } }
  | { code: 'internal'; message: string; details: Record<string, never> }
type RpcResult = { ok: true; value: unknown } | { ok: false; error: RpcError }

function str(payload: Payload, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

export function mapEditorFilesError(error: unknown): RpcResult {
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
  if (error instanceof SnapshotError) {
    if (error.code === 'READ_ONLY') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'BLOCKED' || error.code === 'STALE' || error.code === 'CLEANUP_BLOCKED') return badRequest(error.message)
    return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
  }
  if (error instanceof LifecycleError) {
    if (error.code === 'READ_ONLY' || error.code === 'NOT_FOUND') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'EXISTS') return { ok: false, error: { code: 'directory-exists', message: error.message, details: { path: '' } } }
    if (error.code === 'IO' || error.code === 'UNSUPPORTED') return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
    return badRequest(error.message)
  }
  return mapHostError(error) ?? { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } }
}

export async function dispatchEditorFiles(ctx: Context, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Payload : {}
  const host = asHost(ctx)
  const targetSessionId = endpoint.startsWith('project.import') || endpoint.startsWith('snapshot.restore')
    ? str(body, 'targetSessionId')
    : str(body, 'sessionId')
  const access = await resolveWorkspaceAccess(host, targetSessionId, signal)
  const files = { fs: host.fs, cwd: access.workspace.path, root: access.root, policy: access.policy, signal }
  const rel = str(body, 'path')
  const importAccess = (value: typeof access): ImportAccess => ({
    path: value.workspace.path,
    rootKey: value.root.targetKey,
    mode: value.policy.mode,
    files: { fs: host.fs, cwd: value.workspace.path, root: value.root, policy: value.policy, signal },
  })
  const snapshotAccess = (value: typeof access): SnapshotAccess => ({
    path: value.workspace.path,
    rootKey: value.root.targetKey,
    mode: value.policy.mode,
    files: { fs: host.fs, cwd: value.workspace.path, root: value.root, policy: value.policy, signal },
  })
  const lifecycleAccess = (value: typeof access): LifecycleAccess => ({
    path: value.workspace.path,
    rootKey: value.root.targetKey,
    mode: value.policy.mode,
    files: { fs: host.fs, cwd: value.workspace.path, root: value.root, policy: value.policy, signal },
  })

  if (endpoint === 'project.init') return await initializeProject({ root: access.workspace.path, mode: access.policy.mode, newProject: body.newProject === true, signal })
  if (endpoint === 'project.prepareIndex') return await prepareNovelIndex({ root: access.workspace.path, mode: access.policy.mode, signal })
  if (endpoint === 'structure.groupCreate') return await createManuscriptGroup({ root: access.workspace.path, mode: access.policy.mode, relative: rel, signal })
  if (endpoint === 'context.compile') return await compileContext(files, str(body, 'userRequest'), str(body, 'activePath') || undefined)
  if (endpoint === 'project.importProbe') {
    const sourceSessionId = str(body, 'sourceSessionId')
    const source = sourceSessionId ? await resolveWorkspaceAccess(host, sourceSessionId, signal) : undefined
    return await probeImport({ target: importAccess(access), source: source ? importAccess(source) : undefined })
  }
  if (endpoint === 'project.importApply') {
    const source = await resolveWorkspaceAccess(host, str(body, 'sourceSessionId'), signal)
    return await applyImport({ source: importAccess(source), target: importAccess(access), token: str(body, 'probeToken') })
  }
  if (endpoint === 'project.importCleanup') return await cleanupImport({ target: importAccess(access), receiptId: str(body, 'receiptId') })
  if (endpoint === 'snapshot.list') return await listSnapshots(snapshotAccess(access))
  if (endpoint === 'snapshot.create') return await createSnapshot(snapshotAccess(access), str(body, 'label'))
  if (endpoint === 'snapshot.restoreProbe') {
    const sourceId = str(body, 'sourceSessionId')
    const source = sourceId ? await resolveWorkspaceAccess(host, sourceId, signal) : undefined
    return await restoreProbe({ source: source ? snapshotAccess(source) : undefined, target: snapshotAccess(access), snapshotId: str(body, 'snapshotId') || undefined })
  }
  if (endpoint === 'snapshot.restoreApply') {
    const source = await resolveWorkspaceAccess(host, str(body, 'sourceSessionId'), signal)
    return await restoreApply({ source: snapshotAccess(source), target: snapshotAccess(access), snapshotId: str(body, 'snapshotId'), token: str(body, 'token') })
  }
  if (endpoint === 'snapshot.restoreCleanup') return await restoreCleanup({ target: snapshotAccess(access), receiptId: str(body, 'receiptId') })
  if (endpoint === 'file.rename') return await renameDocument({ access: lifecycleAccess(access), path: rel, newName: str(body, 'newName'), expectedVersion: str(body, 'expectedVersion') })
  if (endpoint === 'archive.list') return await listArchives(lifecycleAccess(access))
  if (endpoint === 'archive.apply') return await archiveDocument({
    access: lifecycleAccess(access),
    path: rel || undefined,
    expectedVersion: str(body, 'expectedVersion') || undefined,
    archiveId: str(body, 'archiveId') || undefined,
  })
  if (endpoint === 'archive.restore') return await restoreArchive({
    access: lifecycleAccess(access),
    archiveId: str(body, 'archiveId'),
    expectedVersion: str(body, 'expectedVersion') || undefined,
  })
  throw new Error(`unknown workbench endpoint ${endpoint}`)
}

export function registerEditorFilesRpc(ctx: Context): () => void {
  const host = asHost(ctx)
  return host.connection.rpc.handle(WORKBENCH_RPC_CHANNEL, async (endpoint: string, payload: unknown, signal: AbortSignal) => {
    try {
      return { ok: true, value: await dispatchEditorFiles(ctx, endpoint, payload, signal) }
    } catch (error) {
      return mapEditorFilesError(error)
    }
  }, { authority: 'loopback' })
}
