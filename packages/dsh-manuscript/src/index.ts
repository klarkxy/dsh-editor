import type { Context } from '@deepseek-ai/cordis'
import { asHost, resolveWorkspaceAccess, withWorkspaceWrite } from './host.ts'
import { registerHostRpc } from './rpc/channel.ts'
import { createTextFile, listDir, readTextFile, writeTextFile } from './rpc/files.ts'
import { parsePatchRequest, PatchInputError } from './rpc/patch.ts'
import type { ManuscriptAssist } from './assist-api.ts'
import { createDraftStore, draftDomainSpec, DraftInputError, type DraftStore } from './rpc/draft.ts'
import { applyProposal, parseProposal, prepareProposal, ProposalError } from './rpc/proposal.ts'
import { createProposalReceiptStore, validateProposalReceiptId, proposalReceiptDomainSpec, ProposalReceiptWriteError, type ProposalReceiptStore } from './rpc/proposal-receipt.ts'
import { WritingProposalError } from './rpc/writing-proposal.ts'
import { SearchError, searchWorkspaceText } from './rpc/search.ts'
import { badRequest, mapHostError, type HostRpcError } from './rpc/host-error.ts'
import { collectUsageLog, resolveDays, UsageInputError, type UsageRecorder } from './rpc/usage.ts'

export const name = 'dsh-manuscript'
export const inject = ['connection', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'storageDomain', 'webServer'] as const

type RpcOk<T> = { ok: true; value: T }
type RpcError = HostRpcError | {
  code: 'internal'
  message: string
  details: { partial: true; appliedPaths: string[]; reason: 'proposal-receipt-write-failed' }
}
type RpcErr = { ok: false; error: RpcError }
type RpcResult<T> = RpcOk<T> | RpcErr

function fail(error: RpcError): RpcErr {
  return { ok: false, error }
}

export function mapError(error: unknown): RpcErr {
  if (error instanceof ProposalReceiptWriteError) return fail({
    code: 'internal', message: error.message,
    details: { partial: true, appliedPaths: [error.path], reason: 'proposal-receipt-write-failed' },
  })
  const hostError = mapHostError(error)
  if (hostError) return hostError
  if (error instanceof SearchError) {
    if (error.code === 'BAD_QUERY') return badRequest(error.message)
    return fail({ code: 'internal', message: error.message, details: {} })
  }
  if (error instanceof ProposalError || error instanceof WritingProposalError || error instanceof PatchInputError || error instanceof DraftInputError || error instanceof UsageInputError || error instanceof AssistUnavailableError) return badRequest(error.message)
  return fail({ code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} })
}

class AssistUnavailableError extends Error {}

type Payload = Record<string, unknown>

function str(payload: Payload, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

/** Shell sends flat `{sessionId,...proposal}` / `{sessionId,...proposal,expectedVersion}`. Strip only those transport/control keys. */
function proposalFromRpcBody(body: Payload): Record<string, unknown> {
  const proposal = { ...body }
  delete proposal.sessionId
  delete proposal.expectedVersion
  delete proposal.receiptId
  return proposal
}

export async function dispatch(
  ctx: Context,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  drafts?: DraftStore,
  usage?: UsageRecorder,
  receipts?: ProposalReceiptStore,
): Promise<unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Payload) : {}
  // `usage.summary` is global data and must not require a live session; short-circuit
  // before `resolveWorkspaceAccess` so an empty payload still returns the recorder snapshot.
  if (endpoint === 'capabilities.get') return { completion: Boolean(ctx.get?.('manuscriptAssist')) }
  if (endpoint === 'usage.summary') {
    const assist = ctx.get?.('manuscriptAssist') as ManuscriptAssist | undefined
    if (!usage && assist) return assist.summary(body.days)
    if (!usage) throw new Error('manuscript usage storage is unavailable')
    const days = await usage.read(resolveDays(body.days))
    return { days, log: collectUsageLog(days) }
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
    if (body.receiptId !== undefined) validateProposalReceiptId(body.receiptId)
    const rel = str(body, 'path')
    if (endpoint.startsWith('draft.') && !drafts) throw new Error('manuscript draft storage is unavailable')
    if (endpoint === 'draft.get') return { draft: drafts!.get(access.workspace.path, body) }
    if (endpoint === 'draft.list') return { drafts: drafts!.list(access.workspace.path, body) }
    if (endpoint === 'draft.put') return await drafts!.put(access.workspace.path, body)
    if (endpoint === 'draft.delete') return await drafts!.delete(access.workspace.path, body)
    if (endpoint === 'tree.list') return { entries: await listDir(files, rel) }
    if (endpoint === 'file.read') return await readTextFile(files, rel)
    if (endpoint === 'file.create') return await createTextFile(files, rel, str(body, 'text'))
    if (endpoint === 'file.write') {
      const receiptId = str(body, 'receiptId')
      const undoProposal = receiptId && body.undoProposal && typeof body.undoProposal === 'object'
        ? parseProposal(body.undoProposal as Payload) : undefined
      if (undoProposal) {
        const receipt = receipts?.get(access.workspace.path, targetSessionId, receiptId, undoProposal)
        if (!receipt || receipt.state !== 'applied' || receipt.path !== rel || receipt.version !== str(body, 'version')) {
          throw new ProposalError('undo does not match the applied proposal receipt', 'STALE')
        }
      }
      const result = await writeTextFile(files, rel, str(body, 'text'), str(body, 'version'))
      if (undoProposal) await receipts!.record(access.workspace.path, targetSessionId, receiptId, undoProposal, 'undone', { path: undoProposal.path, version: result.version })
      return result
    }
    if (endpoint === 'search.text') return await searchWorkspaceText({
      files,
      query: str(body, 'query'),
      scope: str(body, 'scope') === 'manuscript' ? 'manuscript' : 'project',
      directory: body.directory,
    })
    if (endpoint === 'proposal.receipt') {
      if (!receipts) throw new Error('proposal receipt storage is unavailable')
      return { receipt: receipts.get(access.workspace.path, targetSessionId, str(body, 'receiptId'), parseProposal(proposalFromRpcBody(body))) }
    }
    if (endpoint === 'proposal.prepare') return await prepareProposal(files, parseProposal(proposalFromRpcBody(body)))
    if (endpoint === 'proposal.apply') {
      const proposal = parseProposal(proposalFromRpcBody(body))
      const receiptId = str(body, 'receiptId')
      if (receiptId && !receipts) throw new Error('proposal receipt storage is unavailable')
      if (receiptId && receipts!.get(access.workspace.path, targetSessionId, receiptId, proposal)) {
        throw new ProposalError('proposal has already been settled', 'STALE')
      }
      const result = await applyProposal(files, proposal, str(body, 'expectedVersion'))
      if (receiptId) await receipts!.record(access.workspace.path, targetSessionId, receiptId, proposal, 'applied', result)
      return result
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
  ctx.effect(() => () => domain.close(), 'dsh-manuscript.draftDomainClose')
  const receiptDomain = await ctx.storageDomain.open(proposalReceiptDomainSpec)
  const receipts = createProposalReceiptStore(receiptDomain.table('receipts'))
  ctx.effect(() => () => receiptDomain.close(), 'dsh-manuscript.proposalReceiptDomainClose')
  // Read-only facade of the existing draft store; maintenance never owns a second draft store.
  ctx.provide('manuscriptDrafts', {
    hasUnsaved: (workspacePath: string, relative: string) => [...domain.table('drafts').entries()].some(([, row]) =>
      row.workspacePath === workspacePath && row.path.toLocaleLowerCase() === relative.toLocaleLowerCase() && row.text !== row.baseText),
  })

  ctx.effect(() => registerHostRpc(host, '/manuscript', async (endpoint, payload, signal) => {
    try {
      const value = await dispatch(ctx, endpoint, payload, signal, drafts, undefined, receipts)
      return { ok: true, value } satisfies RpcResult<unknown>
    } catch (error) {
      return mapError(error)
    }
  }))
}
