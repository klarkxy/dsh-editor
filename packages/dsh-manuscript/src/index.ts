import type { Context } from '@deepseek-ai/cordis'
import { asHost } from './host.ts'
import { completeFim } from './rpc/fim.ts'
import { createTextFile, FileOpError, listDir, readTextFile, renameTextFile, writeTextFile } from './rpc/files.ts'
import { PathConfineError } from './rpc/paths.ts'
import { acceptProposal, listProposals, ProposalApplyError, rejectProposal } from './rpc/proposal.ts'

export const name = 'dsh-manuscript'
export const inject = ['connection'] as const

type RpcOk<T> = { ok: true; value: T }
type RpcErr = { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
type RpcResult<T> = RpcOk<T> | RpcErr

function fail(code: string, message: string, details: Record<string, unknown> = {}): RpcErr {
  return { ok: false, error: { code, message, details } }
}

function mapError(error: unknown): RpcErr {
  if (error instanceof PathConfineError) {
    return fail('workspace-invalid-path', error.message, { path: '' })
  }
  if (error instanceof ProposalApplyError) {
    return fail('internal', error.message)
  }
  if (error instanceof FileOpError) {
    if (error.code === 'STALE') return fail('internal', error.message)
    if (error.code === 'NOT_FOUND' || error.code === 'NOT_DIRECTORY' || error.code === 'PARENT_MISSING') {
      return fail('directory-unreadable', error.message, { path: '' })
    }
    return fail('internal', error.message)
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return fail('cancelled', 'cancelled')
  }
  return fail('internal', error instanceof Error ? error.message : String(error))
}

type Payload = Record<string, unknown>

function str(payload: Payload, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

async function dispatch(ctx: Context, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Payload) : {}
  const cwd = str(body, 'cwd')
  const rel = str(body, 'path')
  if (endpoint === 'tree.list') return { entries: await listDir(cwd, rel) }
  if (endpoint === 'file.read') return await readTextFile(cwd, rel)
  if (endpoint === 'file.create') return await createTextFile(cwd, rel, str(body, 'text'))
  if (endpoint === 'file.write') {
    return await writeTextFile(cwd, rel, str(body, 'text'), str(body, 'version'))
  }
  if (endpoint === 'file.rename') {
    return await renameTextFile(cwd, rel, str(body, 'name'))
  }
  if (endpoint === 'proposal.list') return await listProposals(cwd, rel)
  if (endpoint === 'proposal.reject') return await rejectProposal(cwd, str(body, 'id'))
  if (endpoint === 'proposal.accept') {
    const text = typeof body.text === 'string' ? body.text : undefined
    return await acceptProposal(cwd, str(body, 'id'), str(body, 'version'), text)
  }
  if (endpoint === 'fim.complete') {
    const llm = ctx.get('llm') as
      | {
          listProviders?: () => { id: string }[]
          listModels?: (provider: string) => Promise<{ id: string }[]>
        }
      | undefined
    const selection = ctx.get('agentDefaultModel') as
      | { currentSelection?: () => { provider?: string; model?: string } | undefined }
      | undefined
    const current = selection?.currentSelection?.()
    const providers = llm?.listProviders?.() ?? []
    const provider = str(body, 'provider') || current?.provider || providers[0]?.id || ''
    const models = provider && llm?.listModels ? await llm.listModels(provider) : []
    const model = str(body, 'model') || current?.model || models[0]?.id || ''
    if (!provider || !model) return { text: '', route: 'chat' }
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
      { authority: 'loopback' },
    ),
  )
}
