import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-ai-services'
import type { AiServices } from '@klarkxy/dsh-ai-services/contracts'
import { FUSION_PLUGIN, FUSION_RPC_CHANNEL } from './contracts.ts'
import { FusionError } from './validation.ts'
import { fusionDomain, createFusionStore } from './storage.ts'
import { FusionRuntime } from './runtime.ts'
export const name = FUSION_PLUGIN
export const inject = ['agents', 'subagents', 'tools', 'systemPrompt', 'sessions', 'sessionQuery', 'sessionProjections', 'storageDomain', 'aiServices', 'connection', 'webServer'] as const
export type * from './contracts.ts'
export type * from './host-contracts.ts'
export { FusionRuntime } from './runtime.ts'
export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(fusionDomain)
  let runtime: FusionRuntime | undefined
  try {
    runtime = new FusionRuntime(ctx, createFusionStore(domain.table('state')), ctx.get('aiServices') as AiServices)
    await runtime.start()
  } catch (error) {
    if (runtime) await runtime.dispose().catch(() => {})
    await domain.close()
    throw error
  }
  const activeRuntime = runtime
  ctx.effect(() => async () => { try { await activeRuntime.dispose() } finally { await domain.close() } }, 'fusion.dispose')
  ctx.provide('fusion', activeRuntime)
  ctx.effect(() => registerHostRpc(ctx as Context & HostRpcContext, FUSION_RPC_CHANNEL, async (endpoint, payload, signal) => {
    try { return { ok: true as const, value: await activeRuntime.rpc(endpoint, payload, signal) } }
    catch (error) { return { ok: false as const, error: { code: error instanceof FusionError ? error.code : 'FAILED', message: error instanceof Error ? error.message : String(error) } } }
  }), 'fusion.rpc')
}
