import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AiServices } from '@klarkxy/dsh-ai-services/contracts'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-ai-services/host-rpc'
import { checkpointInjectPayload } from './checkpoints.ts'
import {
  RECAP_PLUGIN, RECAP_RPC_CHANNEL, type MoodContractApi, type RecapLogEvent, type RpcResult,
} from './contracts.ts'
import { RecapService } from './service.ts'
import { domainStore, recapDomain, type RecapDomainHandle } from './storage.ts'

export const name = '@klarkxy/dsh-recap'
export const inject = ['connection', 'webServer', 'storageDomain', 'sessions', 'aiServices'] as const

export { RecapService } from './service.ts'
export { domainStore, recapDomain } from './storage.ts'
export { CHAT_EVENTS_SLOT, RECAP_PLUGIN, RECAP_RPC_CHANNEL, defaultSettings } from './contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { recap: RecapService }
}

type Host = Context & HostRpcContext & {
  storageDomain: { open: (spec: typeof recapDomain) => Promise<RecapDomainHandle> }
  sessions: {
    get(id: unknown): { snapshotEvents(): ReadonlyArray<{ seq: number | bigint; type: string; time: number; data: unknown }> } | undefined
  }
  aiServices: AiServices
}

export function toLogEvent(event: { seq: number | bigint; type: string; time: number; data: unknown }): RecapLogEvent {
  return { seq: Number(event.seq), type: event.type, time: event.time, data: event.data }
}

export function createPluginUserMessage(payload: ReturnType<typeof checkpointInjectPayload>): unknown {
  return createUserMessage({
    source: payload.source,
    content: payload.content,
  })
}

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as Host
  if (!host.storageDomain || !host.sessions || !host.aiServices) {
    throw new Error('dsh-recap requires Host storageDomain, sessions, and aiServices')
  }
  const domain = await host.storageDomain.open(recapDomain)
  const service = new RecapService({
    store: domainStore(domain),
    readEvents: sessionId => {
      const session = host.sessions.get(SessionId(sessionId)) ?? host.sessions.get(sessionId)
      return session?.snapshotEvents().map(toLogEvent)
    },
    readContract: sessionId => {
      const mood = ctx.get('aiMood') as MoodContractApi | undefined
      return mood?.getContract?.(sessionId)
    },
    activateAi: () => host.aiServices.activate(RECAP_PLUGIN),
    createInjectMessage: payload => createPluginUserMessage(payload),
  })
  ctx.provide('recap', service)
  ctx.effect(() => async () => { await service.dispose(); await domain.close() }, 'dsh-recap.dispose')
  ctx.effect(() => registerHostRpc(host, RECAP_RPC_CHANNEL, (endpoint, payload, signal): Promise<RpcResult> => service.call(endpoint, payload, signal)), 'dsh-recap.rpc')
  ctx.effect(() => {
    const offEvent = listen(ctx, 'session/event', (session: { id: unknown }, event: { seq: number; type: string; time: number; data: unknown }) => {
      void service.onSessionEvent(String(session.id), toLogEvent(event))
    })
    const offStep = listen(ctx, 'agent/pre-step', async (
      payload: { agent: { id: unknown }; messages: Array<{ source?: { kind?: string; plugin?: string } }>; step: number; signal: AbortSignal },
      next: () => Promise<{ kind: string; messages?: Array<{ source?: { kind?: string; plugin?: string } }>; [flag: string]: unknown }>,
    ) => service.handlePreStep({
      sessionId: String(payload.agent.id),
      messages: payload.messages,
      step: payload.step,
      signal: payload.signal,
      next,
    }))
    return () => { offEvent?.(); offStep?.() }
  }, 'dsh-recap.auto')
}

function listen(ctx: Context, name: string, handler: (...args: never[]) => unknown): (() => void) | undefined {
  const on = ctx.on as unknown as (event: string, listener: (...args: never[]) => unknown) => (() => void) | void
  const off = on.call(ctx, name, handler)
  return typeof off === 'function' ? off : undefined
}
