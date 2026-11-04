import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { BotRpcDeps } from './rpc.ts'
import type { BotToolDeps } from './recall.ts'
import type { SessionEventLike } from './transcript.ts'
import { frozenPromptFor } from './freeze.ts'
import { currentPromptFingerprint } from './prefs.ts'
import { resolveWorkspaceAccess, asHost } from 'dsh-manuscript/host-api'

type AgentsHost = {
  agents?: {
    get?(id: string): { readonly status?: 'idle' | 'running' } | undefined
  }
  sessions?: {
    get?(sessionId: string): Session | undefined
    retain?(sessionId: string, options?: { source?: string }): { ready: Promise<{ session: Session }>; release(): void }
  }
  sessionQuery?: {
    readSession(sessionId: string): Promise<{ events: SessionEventLike[] }>
  }
  llm?: {
    resolveModelInfo(provider: string, model: string): Promise<{ context?: { contextWindow?: number }; maxOutputTokens?: number } | undefined>
  }
}

/** Full raw-log read via dsh-session-query (live-preferred, detached, no activation). */
async function readEvents(ctx: Context, sessionId: string): Promise<SessionEventLike[]> {
  const host = ctx as Context & AgentsHost
  const query = host.sessionQuery
  if (!query?.readSession) throw new Error('sessionQuery is not mounted; bot reads are unavailable')
  const snapshot = await query.readSession(sessionId)
  return snapshot.events
}

export type HeldSession = { session: Session; release(): void }

/** Retain a live session for the whole operation; caller must release(). */
async function liveSession(ctx: Context, sessionId: string): Promise<HeldSession | undefined> {
  const host = ctx as Context & AgentsHost
  const direct = host.sessions?.get?.(sessionId)
  if (direct) return { session: direct, release: () => undefined }
  const ref = host.sessions?.retain?.(sessionId, { source: 'workspaceOperation' })
  if (!ref) return undefined
  const { session } = await ref.ready
  return { session, release: () => ref.release() }
}

/** Documented host lookup: ctx.agents.get(sessionId).status ('idle' | 'running'). */
function sessionRunning(ctx: Context, sessionId: string): boolean {
  const host = ctx as Context & AgentsHost
  return host.agents?.get?.(sessionId)?.status === 'running'
}

async function usableWindow(ctx: Context, session: Session): Promise<number | undefined> {
  const host = ctx as Context & AgentsHost
  const header = session.requestHeader()
  const config = (header?.config ?? {}) as { provider?: string; model?: string; maxTokens?: number; maxOutputTokens?: number }
  const requestContext = session.requestContext?.() as { contextWindow?: number } | undefined
  let window = requestContext?.contextWindow
  if ((!window || window <= 0) && host.llm?.resolveModelInfo && config.provider && config.model) {
    const info = await host.llm.resolveModelInfo(config.provider, config.model).catch(() => undefined)
    window = info?.context?.contextWindow
  }
  if (!window || window <= 0) return undefined
  const outputCap = config.maxOutputTokens ?? config.maxTokens ?? 0
  const usable = window - (outputCap > 0 ? outputCap : 0)
  return usable > 0 ? usable : undefined
}

export function createBotRpcDeps(ctx: Context): BotRpcDeps {
  return {
    readEvents: (sessionId) => readEvents(ctx, sessionId),
    liveSession: (sessionId) => liveSession(ctx, sessionId),
    sessionRunning: (sessionId) => sessionRunning(ctx, sessionId),
    promptFingerprint: (sessionId) => ({ current: currentPromptFingerprint(ctx), stored: frozenPromptFor(sessionId)?.fingerprint }),
    hasTurns: async (sessionId) => (await readEvents(ctx, sessionId)).some((event) => event.type === 'turn/start' || event.type === 'user/message'),
    usableWindow: (session) => usableWindow(ctx, session),
  }
}

export function createBotToolDeps(ctx: Context): BotToolDeps {
  return {
    readEvents: (sessionId) => readEvents(ctx, sessionId),
    workRoot: async (sessionId) => {
      try {
        const host = asHost(ctx)
        const access = await resolveWorkspaceAccess(host, sessionId)
        return access.workspace.path
      } catch {
        return undefined
      }
    },
  }
}
