import type { Context } from '@deepseek-ai/cordis'
import { asHost, resolveWorkspaceAccess, withWorkspaceWrite } from './host.ts'
import { completeFim } from './rpc/fim.ts'
import { createTextFile, listDir, readTextFile, writeTextFile } from './rpc/files.ts'
import { completePatch, parsePatchRequest, PatchInputError } from './rpc/patch.ts'
import { parseAuthorPreferences } from './rpc/author-preferences.ts'
import { createDraftStore, draftDomainSpec, DraftInputError, type DraftStore } from './rpc/draft.ts'
import { applyProposal, parseProposal, prepareProposal, ProposalError } from './rpc/proposal.ts'
import { SearchError, searchWorkspaceText } from './rpc/search.ts'
import { badRequest, mapHostError, type HostRpcError } from './rpc/host-error.ts'
import { createUsageRecorder, resolveDays, UsageInputError, usageDomainSpec, type UsageRecorder } from './rpc/usage.ts'
import { createZhihuUsageRecorder, zhihuUsageDomainSpec, type ZhihuSearchEvent, type ZhihuUsageRecorder } from './rpc/zhihu-usage.ts'

export const name = 'dsh-manuscript'
export const inject = ['connection', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'llm', 'storageDomain'] as const

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
  if (error instanceof ProposalError || error instanceof PatchInputError || error instanceof DraftInputError || error instanceof UsageInputError) return badRequest(error.message)
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
  usage?: UsageRecorder,
  zhihuUsage?: ZhihuUsageRecorder,
): Promise<unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Payload) : {}
  // `usage.summary` is global data and must not require a live session; short-circuit
  // before `resolveWorkspaceAccess` so an empty payload still returns the recorder snapshot.
  if (endpoint === 'usage.summary') {
    if (!usage) throw new Error('manuscript usage storage is unavailable')
    const days = resolveDays(body.days)
    return { days: await usage.read(days) }
  }
  // `zhihu.usage` is likewise global metering data.
  if (endpoint === 'zhihu.usage') {
    if (!zhihuUsage) throw new Error('manuscript zhihu usage storage is unavailable')
    const days = resolveDays(body.days)
    return { days: await zhihuUsage.read(days) }
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
        authorPreferences: parseAuthorPreferences(body.authorPreferences),
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
  return ['file.create', 'file.write', 'proposal.apply'].includes(endpoint)
    ? withWorkspaceWrite(access.root.targetKey, run) : run()
}

export async function apply(ctx: Context): Promise<void> {
  const host = asHost(ctx)
  const domain = await ctx.storageDomain.open(draftDomainSpec)
  const drafts = createDraftStore(domain.table('drafts'))
  ctx.effect(() => () => domain.close(), 'dsh-manuscript.draftDomainClose')

  const usageDomain = await ctx.storageDomain.open(usageDomainSpec)
  const usage = createUsageRecorder(usageDomain.table('daily'))
  ctx.effect(() => () => usageDomain.close(), 'dsh-manuscript.usageDomainClose')
  installUsageWaterfall(ctx, usage)

  const zhihuUsageDomain = await ctx.storageDomain.open(zhihuUsageDomainSpec)
  const zhihuUsage = createZhihuUsageRecorder(zhihuUsageDomain.table('daily'))
  ctx.effect(() => () => zhihuUsageDomain.close(), 'dsh-manuscript.zhihuUsageDomainClose')
  installZhihuUsageListener(ctx, zhihuUsage)

  ctx.effect(() =>
    host.connection.rpc.handle(
      '/manuscript',
      async (endpoint: string, payload: unknown, signal: AbortSignal) => {
        try {
          const value = await dispatch(ctx, endpoint, payload, signal, drafts, usage, zhihuUsage)
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

/** Minimal typing of the upstream `llm/stream` waterfall event so we don't add a peer just for one hook. */
type LlmStreamOptions = { provider?: string; model?: string }
type LlmStreamChunk = { type: string; usage?: Record<string, number> }
type LlmStreamEvent = (
  options: LlmStreamOptions,
  next: () => AsyncIterable<LlmStreamChunk>,
) => AsyncIterable<LlmStreamChunk>

/** Wrap every `llm/stream` call: capture the provider-reported usage into the daily recorder, never block the stream. */
function installUsageWaterfall(ctx: Context, recorder: UsageRecorder): void {
  // The host merges in `@deepseek-ai/dsh-llm`'s `Events` declaration, so the literal
  // event name is what carries the type — a peer import would only be cosmetic.
  const on = ctx.on as unknown as (
    name: 'llm/stream',
    listener: LlmStreamEvent,
    options?: { global?: boolean; prepend?: boolean },
  ) => () => boolean
  on(
    'llm/stream',
    (options, next) => trackUsage(ctx, options, next, recorder),
    { global: true, prepend: true },
  )
}

async function* trackUsage(
  ctx: Context,
  options: LlmStreamOptions,
  next: () => AsyncIterable<LlmStreamChunk>,
  recorder: UsageRecorder,
): AsyncIterable<LlmStreamChunk> {
  const provider = typeof options?.provider === 'string' ? options.provider : ''
  const model = typeof options?.model === 'string' ? options.model : ''
  const modelKey = provider && model ? `${provider}/${model}` : ''
  const iterator = next()[Symbol.asyncIterator]()
  let lastUsage: Record<string, number> | undefined
  let observed = false
  let completed = false
  try {
    while (true) {
      const { value, done } = await iterator.next()
      if (done) {
        completed = true
        break
      }
      if (value && value.type === 'usage' && value.usage) {
        lastUsage = value.usage
        observed = true
      }
      yield value
    }
  } finally {
    if (observed && modelKey) {
      try {
        await recorder.record(modelKey, lastUsage ?? {}, { request: completed })
      } catch (error) {
        // Metering must never influence the LLM stream itself.
        logWarning(ctx, error)
      }
    }
  }
}

/** Record every zhihu tool execution emitted by novel tool hosts. Metering must never throw. */
function installZhihuUsageListener(ctx: Context, recorder: ZhihuUsageRecorder): void {
  const on = ctx.on as unknown as (
    name: 'dsh-editor/zhihu-search',
    listener: (event: ZhihuSearchEvent) => void,
    options?: { global?: boolean },
  ) => () => boolean
  on(
    'dsh-editor/zhihu-search',
    (event) => {
      void recorder.record(event).catch((error) => logWarning(ctx, error))
    },
    { global: true },
  )
}

function logWarning(ctx: Context, error: unknown): void {
  try {
    const logger = (ctx as { logger?: { warn?: (message: string, cause?: unknown) => void } }).logger
    if (logger?.warn) logger.warn('manuscript.usage: recorder failed', error)
  } catch {
    // Best-effort: the host may not expose a logger, and we must not surface metering errors.
  }
}
