import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ManuscriptAssist } from './assist-api.ts'
import { asHost, resolveWorkspaceAccess } from './host.ts'
import { completeFim } from './rpc/fim.ts'
import { completePatch, parsePatchRequest } from './rpc/patch.ts'
import { parseAuthorPreferences, parseChapterContext } from './rpc/author-preferences.ts'
import { readProjectRules } from './rpc/project-rules.ts'
import { createUsageRecorder, usageDomainSpec, resolveDays, type UsageRecorder } from './rpc/usage.ts'

export const name = 'dsh-manuscript-assist'
export const inject = ['llm', 'storageDomain', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy'] as const

export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(usageDomainSpec)
  const usage = createUsageRecorder(domain.table('daily'))
  ctx.effect(() => () => domain.close(), 'manuscript-assist.usageDomainClose')
  installUsageWaterfall(ctx, usage)
  const service: ManuscriptAssist = {
    summary: async days => ({ days: await usage.read(resolveDays(days)) }),
    async complete(endpoint, body, route, signal) {
      // requestHeader is the last executed request, not the current picker value.
      // Reuse the existing gateway's selection owner when this host provides it.
      const api = ctx.get('apiProxy') as { sessions?: { models(request: unknown): Promise<{ result: { ok: boolean; value?: { current?: { provider?: string; model?: string }; routable?: boolean }; error?: { message?: string } } }> } } | undefined
      if (signal.aborted) return { text: '', route: 'dsh-llm' }
      if (api?.sessions?.models) {
        const response = await api.sessions.models({ type: 'client-request', rpcId: randomUUID(), method: 'session.models', payload: { sessionId: body.sessionId } })
        if (signal.aborted) return { text: '', route: 'dsh-llm' }
        if (!response.result.ok) throw new Error(response.result.error?.message || '无法读取当前写作模型')
        const selected = response.result.value?.current
        if (!selected || typeof selected.provider !== 'string' || typeof selected.model !== 'string') throw new Error('当前写作模型响应无效')
        if (response.result.value?.routable === false) throw new Error('当前写作模型不可用')
        route = { provider: selected.provider, model: selected.model }
      }
      if (!route.provider || !route.model) return { text: '', route: 'dsh-llm' }

      const host = asHost(ctx)
      const access = await resolveWorkspaceAccess(host, String(body.sessionId), signal)
      const rules = await readProjectRules({
        fs: host.fs,
        cwd: access.workspace.path,
        root: access.root,
        policy: access.policy,
        signal,
      })

      if (endpoint === 'fim.complete') return completeFim({
        ctx, ...route,
        prefix: typeof body.prefix === 'string' ? body.prefix : '',
        suffix: typeof body.suffix === 'string' ? body.suffix : '',
        authorPreferences: parseAuthorPreferences(body.authorPreferences),
        chapterContext: parseChapterContext(body.chapterContext),
        projectRules: rules.text,
        signal,
      })
      return completePatch({ ctx, ...route, request: parsePatchRequest(body), projectRules: rules.text, signal })
    },
  }
  ctx.provide('manuscriptAssist', service)
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


function logWarning(ctx: Context, error: unknown): void {
  try {
    const logger = (ctx as { logger?: { warn?: (message: string, cause?: unknown) => void } }).logger
    if (logger?.warn) logger.warn('manuscript.usage: recorder failed', error)
  } catch {
    // Best-effort: the host may not expose a logger, and we must not surface metering errors.
  }
}
