import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AiServices } from '@klarkxy/dsh-ai-services/contracts'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-ai-services/host-rpc'
import {
  MEMORY_ACTIVATE_ID, MEMORY_PLUGIN, MEMORY_RPC_CHANNEL, projectIdFromCwd, sessionCwd,
  type InjectedMemoryMessage, type MemoryPersistedState, type PreStepDecision, type RpcResult,
} from './contracts.ts'
import { shouldRunIdleDream } from './idle.ts'
import { handleMemoryRpc } from './rpc.ts'
import { MemoryRuntime } from './service.ts'
import { cloneState, emptyMemoryState, type MemoryStore } from './store.ts'
import { memoryDomain, storedSettings } from './storage.ts'

export const name = MEMORY_PLUGIN
export const inject = ['storageDomain', 'connection', 'webServer', 'aiServices', 'sessions'] as const
export { MemoryRuntime } from './service.ts'
export { CHAT_EVENTS_SLOT, MEMORY_RPC_CHANNEL, defaultSettings, projectIdFromCwd } from './contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { aiMemory: MemoryRuntime }
}

type DomainHandle = {
  table(name: 'state'): {
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
    entries(): IterableIterator<[string, unknown]>
  }
  close(): Promise<void>
}

type Host = Context & HostRpcContext & {
  storageDomain: { open: (spec: typeof memoryDomain) => Promise<DomainHandle> }
  aiServices: AiServices
  sessions: { get(id: string): unknown }
}

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as Host
  const domain = await host.storageDomain.open(memoryDomain)
  const store = domainStore(domain)
  const idle = { agentIdle: new Map<string, boolean>(), lastActivity: new Map<string, number>(), timers: new Map<string, ReturnType<typeof setTimeout>>() }
  const runtime = new MemoryRuntime({
    store,
    activateAi: () => host.aiServices.activate(MEMORY_ACTIVATE_ID),
    createInjectMessage: payload => createPluginUserMessage(payload),
  })
  ctx.provide('aiMemory', runtime)
  ctx.effect(() => async () => {
    for (const timer of idle.timers.values()) clearTimeout(timer)
    idle.timers.clear()
    await runtime.dispose()
    await domain.close()
  }, 'dsh-memory.dispose')
  ctx.effect(() => registerHostRpc(host, MEMORY_RPC_CHANNEL, (endpoint, payload, signal): Promise<RpcResult> => (
    handleMemoryRpc(endpoint, payload, signal, runtime, sessionId => readSession(ctx, sessionId))
  )), 'dsh-memory.rpc')
  ctx.effect(() => {
    const offStep = listen(ctx, 'agent/pre-step', async (
      payload: { agent: { id?: unknown; session?: unknown }; signal: AbortSignal },
      next: () => Promise<PreStepDecision>,
    ) => runtime.handlePreStep({
      sessionId: String((payload.agent as { id?: unknown }).id ?? ''),
      session: payload.agent.session,
      signal: payload.signal,
      next,
    }))
    const offStatus = listen(ctx, 'agent/status', (payload: { agent: { id?: unknown; session?: unknown }; status: string }) => {
      const sessionId = String((payload.agent as { id?: unknown }).id ?? '')
      if (!sessionId) return
      const now = Date.now()
      if (payload.status === 'running') {
        idle.agentIdle.set(sessionId, false)
        idle.lastActivity.set(sessionId, now)
        const timer = idle.timers.get(sessionId)
        if (timer) { clearTimeout(timer); idle.timers.delete(sessionId) }
        return
      }
      if (payload.status !== 'idle') return
      idle.agentIdle.set(sessionId, true)
      idle.lastActivity.set(sessionId, idle.lastActivity.get(sessionId) ?? now)
      const timer = idle.timers.get(sessionId)
      if (timer) clearTimeout(timer)
      const wait = runtime.status().settings.idleMs
      idle.timers.set(sessionId, setTimeout(() => {
        idle.timers.delete(sessionId)
        const settings = runtime.status().settings
        if (!shouldRunIdleDream({
          dreamIdleEnabled: settings.dreamIdleEnabled,
          pluginActive: runtime.pluginActive,
          agentIdle: idle.agentIdle.get(sessionId) === true,
          dreamRunning: runtime.hasActiveDream(sessionId),
          lastActivityAt: idle.lastActivity.get(sessionId) ?? now,
          now: Date.now(),
          idleMs: settings.idleMs,
          lastAttemptAt: runtime.dreamLastAttemptAt,
          materialCount: runtime.dreamMaterialCount(),
        })) return
        void runtime.runIdleDream(sessionId, projectIdFromCwd(sessionCwd(readSession(ctx, sessionId))), 'idle').catch(() => {})
      }, wait))
    })
    return () => { offStep?.(); offStatus?.() }
  }, 'dsh-memory.hooks')
}

export function createPluginUserMessage(payload: InjectedMemoryMessage): unknown {
  return createUserMessage({
    source: payload.source,
    content: payload.content,
  })
}

function domainStore(domain: DomainHandle): MemoryStore {
  const table = domain.table('state')
  return {
    load() {
      const stored = table.get('current') as MemoryPersistedState | undefined
      if (!stored) return emptyMemoryState()
      return cloneState({
        settings: storedSettings(stored.settings),
        records: stored.records ?? [],
        tombstones: stored.tombstones ?? [],
        dreams: stored.dreams ?? [],
        lastAttemptAt: stored.lastAttemptAt,
      })
    },
    async save(state) {
      await table.put('current', cloneState(state))
    },
  }
}

function readSession(ctx: Context, sessionId: string): unknown {
  return (ctx as Host).sessions.get(sessionId)
}

function listen(ctx: Context, name: string, handler: (...args: never[]) => unknown): (() => void) | undefined {
  const on = ctx.on as unknown as (event: string, listener: (...args: never[]) => unknown) => (() => void) | void
  const off = on.call(ctx, name, handler)
  return typeof off === 'function' ? off : undefined
}
