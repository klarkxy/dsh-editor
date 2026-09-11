import type { Context } from '@deepseek-ai/cordis'
import { asHost, resolveWorkspaceAccess, withWorkspaceWrite } from './host.ts'
import { registerHostRpc } from './rpc/channel.ts'
import { createTextFile, listDir, readTextFile, writeTextFile } from './rpc/files.ts'
import { parsePatchRequest, PatchInputError } from './rpc/patch.ts'
import type { ManuscriptAssist } from './assist-api.ts'
import { createDraftStore, draftDomainSpec, DraftInputError, type DraftStore } from './rpc/draft.ts'
import { applyProposal, parseProposal, prepareProposal, ProposalError } from './rpc/proposal.ts'
import { SearchError, searchWorkspaceText } from './rpc/search.ts'
import { badRequest, mapHostError, type HostRpcError } from './rpc/host-error.ts'
import { resolveDays, UsageInputError, type UsageRecorder } from './rpc/usage.ts'

export const name = 'dsh-manuscript'
export const inject = ['connection', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'storageDomain', 'webServer'] as const

type RpcOk<T> = { ok: true; value: T }
type RpcError = HostRpcError
type RpcErr = { ok: false; error: RpcError }
type RpcResult<T> = RpcOk<T> | RpcErr

function fail(error: RpcError): RpcErr {
  return { ok: false, error }
}

export function mapError(error: unknown): RpcErr {
  const hostError = mapHostError(error)
  if (hostError) return hostError
  if (error instanceof SearchError) {
    if (error.code === 'BAD_QUERY') return badRequest(error.message)
    return fail({ code: 'internal', message: error.message, details: {} })
  }
  if (error instanceof ProposalError || error instanceof PatchInputError || error instanceof DraftInputError || error instanceof UsageInputError || error instanceof AssistUnavailableError) return badRequest(error.message)
  return fail({ code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} })
}

class AssistUnavailableError extends Error {}

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
  usage?: UsageRecorder,
): Promise<unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Payload) : {}
  // `usage.summary` is global data and must not require a live session; short-circuit
  // before `resolveWorkspaceAccess` so an empty payload still returns the recorder snapshot.
  if (endpoint === 'capabilities.get') return { completion: Boolean(ctx.get?.('manuscriptAssist')) }
  if (endpoint === 'usage.summary') {
    const assist = ctx.get?.('manuscriptAssist') as ManuscriptAssist | undefined
    if (!usage && assist) return assist.summary(body.days)
    if (!usage) throw new Error('manuscript usage storage is unavailable')
    const days = resolveDays(body.days)
    return { days: await usage.read(days) }
  }
  const host = asHost(ctx)
  const targetSessionId = str(body, 'sessionId')
  const access = await resolveWorkspaceAccess(host, targetSessionId, signal)
  const files = {
    fs: host.fs,
    cwd: access.workspace.path,
    root: access.root,
    policy: access.policy,
    signal,
  }
  const run = async (): Promise<unknown> => {
    const rel = str(body, 'path')
    if (endpoint.startsWith('draft.') && !drafts) throw new Error('manuscript draft storage is unavailable')
    if (endpoint === 'draft.get') return { draft: drafts!.get(access.workspace.path, body) }
    if (endpoint === 'draft.list') return { drafts: drafts!.list(access.workspace.path, body) }
    if (endpoint === 'draft.put') return await drafts!.put(access.workspace.path, body)
    if (endpoint === 'draft.delete') return await drafts!.delete(access.workspace.path, body)
    if (endpoint === 'tree.list') return { entries: await listDir(files, rel) }
    if (endpoint === 'file.read') return await readTextFile(files, rel)
    if (endpoint === 'file.create') return await createTextFile(files, rel, str(body, 'text'))
    if (endpoint === 'file.write') return await writeTextFile(files, rel, str(body, 'text'), str(body, 'version'))
    if (endpoint === 'search.text') return await searchWorkspaceText({
      files,
      query: str(body, 'query'),
      scope: str(body, 'scope') === 'manuscript' ? 'manuscript' : 'project',
    })
    if (endpoint === 'proposal.prepare') return await prepareProposal(files, parseProposal(body))
    if (endpoint === 'proposal.apply') {
      return await applyProposal(files, parseProposal(body), str(body, 'expectedVersion'))
    }
    if (endpoint === 'fim.complete' || endpoint === 'patch.complete') {
      // Validate the legacy patch request even when no model is configured.
      if (endpoint === 'patch.complete') parsePatchRequest(body)
      const config = access.session.requestHeader?.()?.config
      const provider = typeof config?.provider === 'string' ? config.provider : ''
      const model = typeof config?.model === 'string' ? config.model : ''
      const assist = ctx.get?.('manuscriptAssist') as ManuscriptAssist | undefined
      if (!assist) {
        if (!provider || !model) return { text: '', route: 'dsh-llm' }
        throw new AssistUnavailableError('写作补全未启用')
      }
      return assist.complete(endpoint, body, { provider, model }, signal)
    }
    throw new Error(`unknown endpoint ${endpoint}`)
  }
  return ['file.create', 'file.write', 'proposal.apply', 'draft.put', 'draft.delete'].includes(endpoint)
    ? withWorkspaceWrite(access.root.targetKey, run) : run()
}

export async function apply(ctx: Context): Promise<void> {
  const host = asHost(ctx)
  const domain = await ctx.storageDomain.open(draftDomainSpec)
  const drafts = createDraftStore(domain.table('drafts'))
  // Read-only facade of the existing draft store; maintenance never owns a second draft store.
  ctx.provide('manuscriptDrafts', {
    hasUnsaved: (workspacePath: string, relative: string) => [...domain.table('drafts').entries()].some(([, row]) =>
      row.workspacePath === workspacePath && row.path.toLocaleLowerCase() === relative.toLocaleLowerCase() && row.text !== row.baseText),
  })
  ctx.effect(() => () => domain.close(), 'dsh-manuscript.draftDomainClose')

  ctx.effect(() => registerHostRpc(host, '/manuscript', async (endpoint, payload, signal) => {
    try {
      const value = await dispatch(ctx, endpoint, payload, signal, drafts)
      return { ok: true, value } satisfies RpcResult<unknown>
    } catch (error) {
      return mapError(error)
    }
  }))
}
