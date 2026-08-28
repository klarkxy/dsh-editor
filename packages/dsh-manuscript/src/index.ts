import type { Context } from '@deepseek-ai/cordis'
import { asHost, resolveWorkspaceAccess, WorkspaceAuthorityError } from './host.ts'
import { completeFim } from './rpc/fim.ts'
import { createTextFile, FileOpError, listDir, readTextFile, writeTextFile } from './rpc/files.ts'
import { completePatch, parsePatchRequest, PatchInputError } from './rpc/patch.ts'
import { createDraftStore, draftDomainSpec, DraftInputError, type DraftStore } from './rpc/draft.ts'
import { PathConfineError } from './rpc/paths.ts'
import { initializeProject, prepareNovelIndex, ProjectInitError } from './rpc/project.ts'
import { applyProposal, parseProposal, prepareProposal, ProposalError } from './rpc/proposal.ts'
import { applyImport, cleanupImport, ImportError, probeImport, type ImportAccess } from './rpc/import.ts'

export const name = 'dsh-manuscript'
export const inject = ['connection', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'llm', 'storageDomain'] as const

type RpcOk<T> = { ok: true; value: T }
type RpcIssue = { code: 'custom'; path: string[]; message: string }
type RpcError =
  | { code: 'bad-request'; message: string; details: { issues: RpcIssue[] } }
  | { code: 'cancelled'; message: string; details: Record<string, never> }
  | { code: 'session-not-found'; message: string; details: { sessionId: string } }
  | { code: 'workspace-attach-failed'; message: string; details: { sessionId: string; workspaceId: string } }
  | { code: 'workspace-not-found'; message: string; details: { workspaceId: string } }
  | { code: 'workspace-invalid-path'; message: string; details: { path: string } }
  | { code: 'directory-unreadable'; message: string; details: { path: string } }
  | { code: 'directory-exists'; message: string; details: { path: string } }
  | { code: 'internal'; message: string; details: Record<string, never> }
type RpcErr = { ok: false; error: RpcError }
type RpcResult<T> = RpcOk<T> | RpcErr

function fail(error: RpcError): RpcErr {
  return { ok: false, error }
}

function badRequest(message: string): RpcErr {
  return fail({ code: 'bad-request', message, details: { issues: [{ code: 'custom', path: [], message }] } })
}

export function mapError(error: unknown): RpcErr {
  if (error instanceof WorkspaceAuthorityError) {
    if (error.code === 'SESSION_REQUIRED') return badRequest(error.message)
    if (error.code === 'SESSION_NOT_FOUND') {
      return fail({ code: 'session-not-found', message: error.message, details: { sessionId: error.context.sessionId ?? '' } })
    }
    if (error.code === 'WORKSPACE_NOT_FOUND') {
      return fail({ code: 'workspace-not-found', message: error.message, details: { workspaceId: error.context.workspacePath ?? '' } })
    }
    if (error.code === 'WORKSPACE_MISMATCH') {
      return fail({
        code: 'workspace-attach-failed',
        message: error.message,
        details: { sessionId: error.context.sessionId ?? '', workspaceId: error.context.workspacePath ?? '' },
      })
    }
    return fail({ code: 'directory-unreadable', message: error.message, details: { path: error.context.workspacePath ?? '' } })
  }
  if (error instanceof PathConfineError) {
    return fail({ code: 'workspace-invalid-path', message: error.message, details: { path: '' } })
  }
  if (error instanceof ProjectInitError) {
    if (error.code === 'CANCELLED') return fail({ code: 'cancelled', message: error.message, details: {} })
    if (error.code === 'IO') return fail({ code: 'internal', message: error.message, details: {} })
    if (error.code === 'READ_ONLY') return fail({ code: 'directory-unreadable', message: error.message, details: { path: '' } })
    return fail({ code: 'workspace-invalid-path', message: error.message, details: { path: '' } })
  }
  if (error instanceof ImportError) {
    if (error.code === 'READ_ONLY') return fail({ code: 'directory-unreadable', message: error.message, details: { path: '' } })
    if (error.code === 'STALE' || error.code === 'BLOCKED' || error.code === 'TARGET_NOT_EMPTY' || error.code === 'NESTED' || error.code === 'CLEANUP_BLOCKED') return badRequest(error.message)
    return fail({ code: 'internal', message: error.message, details: {} })
  }
  if (error instanceof ProposalError || error instanceof PatchInputError || error instanceof DraftInputError) return badRequest(error.message)
  if (error instanceof FileOpError) {
    if (error.code === 'CANCELLED') return fail({ code: 'cancelled', message: error.message, details: {} })
    if (error.code === 'IO') return fail({ code: 'internal', message: error.message, details: {} })
    if (error.code === 'SYMLINK') return fail({ code: 'workspace-invalid-path', message: error.message, details: { path: '' } })
    if (error.code === 'EXISTS') return fail({ code: 'directory-exists', message: error.message, details: { path: '' } })
    if (error.code === 'NOT_FOUND' || error.code === 'NOT_DIRECTORY' || error.code === 'PARENT_MISSING' || error.code === 'DENIED') {
      return fail({ code: 'directory-unreadable', message: error.message, details: { path: '' } })
    }
    return badRequest(error.message)
  }
  if (error instanceof Error && error.name === 'AbortError') return fail({ code: 'cancelled', message: 'cancelled', details: {} })
  return fail({ code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} })
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
  drafts?: DraftStore,
): Promise<unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Payload) : {}
  const host = asHost(ctx)
  const targetSessionId = endpoint.startsWith('project.import') ? str(body, 'targetSessionId') : str(body, 'sessionId')
  const access = await resolveWorkspaceAccess(host, targetSessionId, signal)
  const files = {
    fs: host.fs,
    cwd: access.workspace.path,
    root: access.root,
    policy: access.policy,
    signal,
  }
  const rel = str(body, 'path')
  const importAccess = (value: typeof access): ImportAccess => ({
    path: value.workspace.path,
    rootKey: value.root.targetKey,
    mode: value.policy.mode,
    files: { fs: host.fs, cwd: value.workspace.path, root: value.root, policy: value.policy, signal },
  })
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
  if (endpoint.startsWith('draft.') && !drafts) throw new Error('manuscript draft storage is unavailable')
  if (endpoint === 'draft.get') return { draft: drafts!.get(access.workspace.path, body) }
  if (endpoint === 'draft.put') return await drafts!.put(access.workspace.path, body)
  if (endpoint === 'draft.delete') return await drafts!.delete(access.workspace.path, body)
  if (endpoint === 'tree.list') return { entries: await listDir(files, rel) }
  if (endpoint === 'file.read') return await readTextFile(files, rel)
  if (endpoint === 'file.create') return await createTextFile(files, rel, str(body, 'text'))
  if (endpoint === 'file.write') return await writeTextFile(files, rel, str(body, 'text'), str(body, 'version'))
  if (endpoint === 'project.init') {
    return await initializeProject({
      root: access.workspace.path,
      mode: access.policy.mode,
      newProject: body.newProject === true,
      signal,
    })
  }
  if (endpoint === 'project.prepareIndex') {
    return await prepareNovelIndex({
      root: access.workspace.path,
      mode: access.policy.mode,
      signal,
    })
  }
  if (endpoint === 'proposal.prepare') return await prepareProposal(files, parseProposal(body))
  if (endpoint === 'proposal.apply') {
    return await applyProposal(files, parseProposal(body), str(body, 'expectedVersion'))
  }
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
  if (endpoint === 'patch.complete') {
    const request = parsePatchRequest(body)
    const config = access.session.requestHeader?.()?.config
    const provider = typeof config?.provider === 'string' ? config.provider : ''
    const model = typeof config?.model === 'string' ? config.model : ''
    if (!provider || !model) return { text: '', route: 'dsh-llm' }
    return await completePatch({
      ctx,
      provider,
      model,
      request,
      signal,
    })
  }
  throw new Error(`unknown endpoint ${endpoint}`)
}

export async function apply(ctx: Context): Promise<void> {
  const host = asHost(ctx)
  const domain = await ctx.storageDomain.open(draftDomainSpec)
  const drafts = createDraftStore(domain.table('drafts'))
  ctx.effect(() => () => domain.close(), 'dsh-manuscript.draftDomainClose')
  ctx.effect(() =>
    host.connection.rpc.handle(
      '/manuscript',
      async (endpoint: string, payload: unknown, signal: AbortSignal) => {
        try {
          const value = await dispatch(ctx, endpoint, payload, signal, drafts)
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
