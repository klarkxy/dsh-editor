import type { Context } from '@deepseek-ai/cordis'
import { isAgentLoopRequest, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { AI_RPC_CHANNEL, type AiServices, type RpcResult } from './contracts.ts'
import { registerHostRpc, type HostRpcContext } from './host-rpc.ts'
import { handleAiRpc } from './rpc.ts'
import { AiServicesRuntime } from './service.ts'
import { sessionModelsFromApi } from './routing.ts'
import { POLICY_KEY, RECEIPTS_KEY, aiServicesDomain, boundedReceipts } from './storage.ts'

export { AiServicesRuntime } from './service.ts'
export { registerHostRpc, type HostRpcContext } from './host-rpc.ts'
export { AI_RPC_CHANNEL, CHAT_EVENTS_SLOT, MODEL_SETTINGS_SLOT } from './contracts.ts'
export type * from './contracts.ts'

export const name = '@klarkxy/dsh-ai-services'
export const inject = ['llm', 'storageDomain', 'connection', 'webServer'] as const

declare module '@deepseek-ai/cordis' { interface Context { aiServices: AiServices } }

type Host = Context & HostRpcContext
type StreamListener = (
  options: GenerateOptions,
  next: () => AsyncIterable<unknown>,
) => AsyncIterable<unknown>

function installForegroundPriority(ctx: Context, service: AiServicesRuntime): () => void {
  const on = ctx.on as unknown as (
    name: 'llm/stream',
    listener: StreamListener,
    options?: { global?: boolean; prepend?: boolean },
  ) => () => boolean
  return on.call(ctx, 'llm/stream', (options, next) => {
    if (!isAgentLoopRequest(options)) return next()
    return (async function* () {
      service.noteAgent(options.provider, 1)
      try {
        yield* next()
      } finally {
        service.noteAgent(options.provider, -1)
      }
    })()
  }, { global: true, prepend: true })
}

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as Host
  const domain = await ctx.storageDomain.open(aiServicesDomain)
  const policyTable = domain.table('policy')
  const receiptTable = domain.table('receipts')
  const stored = policyTable.get(POLICY_KEY)
  const { imports = [], ...initialPolicy } = stored ?? {}
  const service = new AiServicesRuntime({
    llm: ctx.llm,
    initialPolicy: stored ? initialPolicy as import('./contracts.ts').AiPolicy : undefined,
    initialImports: imports,
    initialReceipts: receiptTable.get(RECEIPTS_KEY)?.items,
    store: {
      savePolicy: (policy, imports) => policyTable.put(POLICY_KEY, { ...policy, imports }),
      saveReceipts: items => receiptTable.put(RECEIPTS_KEY, { items: boundedReceipts(items) }),
    },
    sessionModels: sessionModelsFromApi(() => ctx.get('apiProxy')),
  })
  ctx.effect(() => async () => { await service.dispose(); await domain.close() }, 'ai-services.dispose')
  ctx.effect(() => installForegroundPriority(ctx, service), 'ai-services.foreground')
  ctx.provide('aiServices', service)
  ctx.effect(() => registerHostRpc(host, AI_RPC_CHANNEL, (endpoint, payload, signal): Promise<RpcResult> => (
    handleAiRpc(service, endpoint, payload, signal)
  )), 'ai-services.rpc')
}
