import type { Context } from '@deepseek-ai/cordis'
import type { AiServices, RpcResult } from '@klarkxy/dsh-ai-services/contracts'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-ai-services/host-rpc'
import {
  MOOD_PLUGIN, MOOD_RPC_CHANNEL, type AskUserQuestionAnswer, type AskUserRequest,
} from './contracts.ts'
import { createMoodContextMessage } from './inject.ts'
import { isHumanUserMessage, type UserMessageLike } from './evidence.ts'
import { MoodService, type PreStepDecision, type PreStepPayload } from './service.ts'
import { domainStore, moodDomain, type MoodDomainHandle } from './storage.ts'

export const name = MOOD_PLUGIN
export const inject = ['aiServices', 'storageDomain', 'sessions', 'userQuestions', 'agents', 'connection', 'webServer'] as const

export { MoodService } from './service.ts'
export { createMoodContextMessage } from './inject.ts'
export { domainStore, moodDomain } from './storage.ts'
export { CHAT_EVENTS_SLOT, MOOD_AI_PLUGIN, MOOD_PLUGIN, MOOD_RPC_CHANNEL, defaultSettings, projectIdFromCwd } from './contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { aiMood: MoodService }
}

export type LiveAgent = {
  id?: unknown
  steer?: (message: unknown) => void
  followup?: (message: unknown) => void
}

export type AgentsRegistry = {
  get(id: unknown): LiveAgent | undefined
}

type Host = Context & HostRpcContext & {
  storageDomain: { open: (spec: typeof moodDomain) => Promise<MoodDomainHandle> }
  aiServices: AiServices
  sessions: { get(id: unknown): { id?: unknown; header?: { cwd?: string }; meta?: { cwd?: string }; snapshotEvents(): readonly unknown[] } | undefined }
  userQuestions: { ask(input: AskUserRequest): Promise<AskUserQuestionAnswer> }
  agents: AgentsRegistry
}

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as Host
  if (!host.storageDomain || !host.aiServices || !host.sessions || !host.userQuestions || !host.agents) {
    throw new Error('dsh-mood requires Host aiServices, storageDomain, sessions, userQuestions, and agents')
  }
  const domain = await host.storageDomain.open(moodDomain)
  const service = new MoodService({
    store: domainStore(domain),
    readEvents: sessionId => readSessionEvents(host, sessionId),
    liveSession: sessionId => readLiveSession(host, sessionId),
    activateAi: () => host.aiServices.activate(MOOD_PLUGIN),
    askUser: request => host.userQuestions.ask(request),
    createInjectMessage: text => createMoodContextMessage(text),
    resumeHeld: async (sessionId, messages) => { resumeHeldOnHost(host.agents, sessionId, messages) },
  })
  ctx.provide('aiMood', service)
  ctx.effect(() => async () => { await service.dispose(); await domain.close() }, 'dsh-mood.dispose')
  ctx.effect(() => registerHostRpc(host, MOOD_RPC_CHANNEL, (endpoint, payload, signal): Promise<RpcResult> => (
    service.call(endpoint, payload, signal)
  )), 'dsh-mood.rpc')
  ctx.effect(() => {
    const offStep = listen(ctx, 'agent/pre-step', async (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => (
      service.handlePreStep(payload, next)
    ))
    return () => { offStep?.() }
  }, 'dsh-mood.pre-step')
}

function readLiveSession(host: Host, sessionId: string) {
  return host.sessions.get(sessionId) ?? host.sessions.get(String(sessionId))
}

function readSessionEvents(host: Host, sessionId: string) {
  const session = readLiveSession(host, sessionId) as { snapshotEvents?: () => ReadonlyArray<{ seq: number; type: string; data?: unknown }> } | undefined
  return session?.snapshotEvents?.()
}

/** Bound invoke: native steer/followup call this.send on the live Agents.get instance. */
export function resumeHeldOnHost(agents: AgentsRegistry, sessionId: string, messages: unknown[]): void {
  const agent = agents.get(sessionId) ?? agents.get(String(sessionId))
  if (!agent) throw Object.assign(new Error('当前 Host 没有可恢复的会话。'), { code: 'MOOD_SESSION_NOT_FOUND' })
  const humans = messages.filter(message => isHumanUserMessage(message as UserMessageLike))
  if (!humans.length) throw Object.assign(new Error('没有可重试的原请求。'), { code: 'MOOD_NOT_FOUND' })
  if (typeof agent.steer === 'function') {
    for (const human of humans) agent.steer(human)
    return
  }
  if (typeof agent.followup === 'function') {
    for (const human of humans) agent.followup(human)
    return
  }
  throw Object.assign(new Error('当前会话不能按原请求重试。'), { code: 'MOOD_NO_RESUME' })
}

function listen(ctx: Context, name: string, handler: (...args: never[]) => unknown): (() => void) | undefined {
  const on = ctx.on as unknown as (event: string, listener: (...args: never[]) => unknown) => (() => void) | void
  const off = on.call(ctx, name, handler)
  return typeof off === 'function' ? off : undefined
}
