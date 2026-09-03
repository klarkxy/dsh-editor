import type { Context } from '@deepseek-ai/cordis'
import { asHost, badRequest, mapHostError, resolveWorkspaceAccess, WorkspaceAuthorityError, type ManuscriptHost } from 'dsh-manuscript/host-api'
import { WORKBENCH_RPC_CHANNEL, type WorkbenchRpcResult } from './contracts.ts'
import { BinaryError, readImageFile, type BinaryAccess } from './binary.ts'
import { applyImport, cleanupImport, ImportError, probeImport, type ImportAccess } from './import.ts'
import { archiveDocument, LifecycleError, listArchives, moveManuscriptDocument, renameDocument, restoreArchive, type LifecycleAccess } from './lifecycle.ts'
import { createManuscriptGroup, createProjectHome, defaultProjectsRoot, initializeProject, inspectProjectRoot, prepareNovelIndex, ProjectInitError } from './project.ts'
import { createSnapshot, listSnapshots, restoreApply, restoreCleanup, restoreProbe, SnapshotError, type SnapshotAccess } from './snapshot.ts'
import { compileContext } from './context.ts'
import { OverviewError, readProjectOverview, setChapterStatus, type OverviewAccess } from './overview.ts'
import {
  applyMerge,
  applyRenames,
  applySplit,
  parseProposal,
  prepareMerge,
  prepareRenames,
  prepareSplit,
  ProposalOpsError,
} from './proposal-ops.ts'
import { createWorkbenchTools } from './workbench-tools.ts'

export const name = 'dsh-editor-workbench'
export const inject = ['connection', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'tools'] as const

type Payload = Record<string, unknown>

function str(payload: Payload, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

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
  if (error instanceof OverviewError) {
    if (error.code === 'READ_ONLY') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'STALE' || error.code === 'BLOCKED' || error.code === 'INVALID_PATH') return badRequest(error.message)
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
  if (endpoint === 'project.inspect') {
    const workspacePath = str(body, 'workspacePath')
    if (!workspacePath) throw new WorkspaceAuthorityError('workspace path is required', 'WORKSPACE_NOT_FOUND', { workspacePath })
    let workspace
    try {
      workspace = await host.workspaceRegistry.resolveByPath(workspacePath)
    } catch (error) {
      throw new WorkspaceAuthorityError('workspace is unavailable', 'WORKSPACE_UNAVAILABLE', { workspacePath }, { cause: error })
    }
    if (!workspace) throw new WorkspaceAuthorityError('workspace is not registered', 'WORKSPACE_NOT_FOUND', { workspacePath })
    return await inspectProjectRoot(workspace.path, signal)
  }
  if (endpoint === 'project.createHome') {
    return await createProjectHome({ root: defaultProjectsRoot(), title: str(body, 'title'), signal })
  }
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
  const overviewAccess = (value: typeof access): OverviewAccess => ({
    path: value.workspace.path,
    rootKey: value.root.targetKey,
    mode: value.policy.mode,
    files: { fs: host.fs, cwd: value.workspace.path, root: value.root, policy: value.policy, signal },
  })

  if (endpoint === 'project.init') return await initializeProject({ root: access.workspace.path, mode: access.policy.mode, newProject: body.newProject === true, signal })
  if (endpoint === 'project.prepareIndex') return await prepareNovelIndex({ root: access.workspace.path, mode: access.policy.mode, signal })
  if (endpoint === 'project.overview') return await readProjectOverview(overviewAccess(access))
  if (endpoint === 'chapter.statusSet') return await setChapterStatus({
    access: overviewAccess(access),
    path: rel,
    status: body.status as 'draft' | 'revising' | 'final',
    expectedStatusRevision: typeof body.expectedStatusRevision === 'string' ? body.expectedStatusRevision : null,
  })
  if (endpoint === 'structure.groupCreate') return await createManuscriptGroup({ root: access.workspace.path, mode: access.policy.mode, relative: rel, signal })
  if (endpoint === 'context.compile') return await compileContext(files, str(body, 'userRequest'), str(body, 'activePath') || undefined, str(body, 'authorPreferences'), str(body, 'authorMemory'))
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
  if (endpoint === 'file.moveManuscript') return await moveManuscriptDocument({ access: lifecycleAccess(access), path: rel, targetDirectory: str(body, 'targetDirectory'), expectedVersion: str(body, 'expectedVersion') })
  if (endpoint === 'file.readBinary') {
    const binaryAccess: BinaryAccess = {
      fs: host.fs as BinaryAccess['fs'],
      cwd: access.workspace.path,
      root: access.root,
      policy: access.policy,
      signal,
    }
    return await readImageFile({ access: binaryAccess, path: rel })
  }
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
  if (endpoint === 'proposal.prepare' || endpoint === 'proposal.apply') {
    return await runProposalDispatch(endpoint, host, access, lifecycleAccess, body)
  }
  throw new Error(`unknown workbench endpoint ${endpoint}`)
}

export function registerWorkbenchRpc(ctx: Context): () => void {
  const host = asHost(ctx)
  return host.connection.rpc.handle(WORKBENCH_RPC_CHANNEL, async (endpoint: string, payload: unknown, signal: AbortSignal) => {
    try {
      return { ok: true, value: await dispatchEditorFiles(ctx, endpoint, payload, signal) }
    } catch (error) {
      return mapEditorFilesError(error)
    }
  }, { authority: 'loopback' })
}

/**
 * 新提案 kind（split / merge / renames）的 prepare / apply。
 * edit / create 仍走 manuscript 通道；parseProposal 直接抛 INVALID。
 */
async function runProposalDispatch(
  endpoint: 'proposal.prepare' | 'proposal.apply',
  host: ReturnType<typeof asHost>,
  access: Awaited<ReturnType<typeof resolveWorkspaceAccess>>,
  lifecycleAccess: (value: typeof access) => LifecycleAccess,
  body: Payload,
): Promise<unknown> {
  const proposal = parseProposal(body.proposal)
  const files = { fs: host.fs, cwd: access.workspace.path, root: access.root, policy: access.policy }
  if (endpoint === 'proposal.prepare') {
    if (proposal.kind === 'split') return { split: await prepareSplit(files, proposal) }
    if (proposal.kind === 'merge') return { merge: await prepareMerge(files, proposal) }
    return { renames: await prepareRenames(files, proposal) }
  }
  const expectedVersions = body.expectedVersions && typeof body.expectedVersions === 'object' && !Array.isArray(body.expectedVersions)
    ? body.expectedVersions as Record<string, string>
    : undefined
  if (proposal.kind === 'split') {
    const version = expectedVersions?.[proposal.path] ?? ''
    return await applySplit(files, proposal, version)
  }
  if (proposal.kind === 'merge') {
    return await applyMerge(lifecycleAccess(access), proposal, {
      path: expectedVersions?.[proposal.path],
      sourcePath: expectedVersions?.[proposal.sourcePath],
    })
  }
  return await applyRenames(lifecycleAccess(access), proposal, expectedVersions)
}

export function apply(ctx: Context): void {
  const host = asHost(ctx) as ManuscriptHostWithTools
  ctx.effect(() => registerWorkbenchRpc(ctx), 'dsh-editor-workbench.rpc')
  const tools = host.tools
  if (tools && typeof tools.register === 'function') {
    const resolveOverviewAccess = async (cwd: string): Promise<OverviewAccess> => {
      const workspace = await host.workspaceRegistry.resolveByPath(cwd)
      if (!workspace) throw new WorkspaceAuthorityError('workspace is not registered', 'WORKSPACE_NOT_FOUND', { workspacePath: cwd })
      const session = host.sessions.get(workspace.sessionIds[0] ?? '')
      if (!session) throw new WorkspaceAuthorityError('session is unavailable', 'SESSION_NOT_FOUND', { workspacePath: cwd })
      const policy = host.sandboxPolicy.resolve({ session })
      return {
        path: workspace.path,
        rootKey: workspace.path,
        mode: policy.mode,
        files: { fs: host.fs, cwd: workspace.path, root: { targetKey: workspace.path, displayPath: workspace.path }, policy, signal: undefined },
      }
    }
    for (const tool of createWorkbenchTools({ resolveAccess: resolveOverviewAccess })) {
      tools.register(tool)
    }
  }
}

/** apply 里 host.tools 在 cordis 默认注入之外显式依赖；用结构化类型避免无关字段。 */
type ManuscriptHostWithTools = ManuscriptHost & {
  tools?: { register: (tool: unknown) => unknown }
}
