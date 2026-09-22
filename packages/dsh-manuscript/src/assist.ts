import type { AiServices } from '@klarkxy/dsh-ai-services/contracts'
import { WRITING_PURPOSES } from './ai-purposes.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ManuscriptAssist } from './assist-api.ts'
import { asHost, resolveWorkspaceAccess } from './host.ts'
import { completeFim } from './rpc/fim.ts'
import { completePatch, parsePatchRequest } from './rpc/patch.ts'
import { parseAuthorPreferences, parseChapterContext } from './rpc/author-preferences.ts'
import { readProjectRules } from './rpc/project-rules.ts'
import { collectUsageLog, createUsageRecorder, usageDomainSpec, resolveDays, type UsageRecorder } from './rpc/usage.ts'
import { trackUsageStream } from './usage-stream.ts'

export const name = 'dsh-manuscript-assist'
export const inject = ['aiServices', 'llm', 'storageDomain', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy'] as const

export async function apply(ctx: Context): Promise<void> {
  const ai = ctx.get('aiServices') as AiServices
  const scope = ai.activate('dsh-manuscript-assist')
  for (const purpose of WRITING_PURPOSES) scope.registerPurpose(purpose)
  ctx.effect(() => () => scope.dispose(), 'manuscript-assist.aiScope')
  ctx.provide('manuscriptAiScope', scope)
  const domain = await ctx.storageDomain.open(usageDomainSpec)
  const usage = createUsageRecorder(domain.table('daily'))
  ctx.effect(() => () => domain.close(), 'manuscript-assist.usageDomainClose')
  installUsageWaterfall(ctx, usage)
  const service: ManuscriptAssist = {
    summary: async days => {
      const rows = await usage.read(resolveDays(days))
      return { days: rows, log: collectUsageLog(rows) }
    },
    async complete(endpoint, body, route, signal) {
      if (signal.aborted) return { text: '', route: 'dsh-llm' }
      const migration = ctx.get('writingAiMigration') as { ready?: Promise<void>; error?: string } | undefined
      await migration?.ready
      if (signal.aborted) return { text: '', route: 'dsh-llm' }
      if (migration?.error) throw new Error(migration.error)
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
        ctx, ...route, sessionId: String(body.sessionId),
        prefix: typeof body.prefix === 'string' ? body.prefix : '',
        suffix: typeof body.suffix === 'string' ? body.suffix : '',
        authorPreferences: parseAuthorPreferences(body.authorPreferences),
        chapterContext: parseChapterContext(body.chapterContext),
        projectRules: rules.text,
        signal,
      })
      return completePatch({ ctx, ...route, sessionId: String(body.sessionId), request: parsePatchRequest(body), projectRules: rules.text, signal })
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
  on.call(ctx,
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
  yield* trackUsageStream(next(), async (usage, completed) => {
    if (!modelKey) return
    await recorder.record(modelKey, usage, { request: completed })
  }, (error) => logWarning(ctx, error))
}

function logWarning(ctx: Context, error: unknown): void {
  try {
    const logger = (ctx as { logger?: { warn?: (message: string, cause?: unknown) => void } }).logger
    if (logger?.warn) logger.warn('manuscript.usage: recorder failed', error)
  } catch {
    // Best-effort: the host may not expose a logger, and we must not surface metering errors.
  }
}
