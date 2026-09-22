import type { Context } from '@deepseek-ai/cordis'
import {
  MODEL_CENTER_PLUGIN, MODEL_CENTER_RPC_CHANNEL, type ModelCenterStatus, type RpcResult,
} from './contracts.ts'
import { registerHostRpc, type HostRpcContext } from './host-rpc.ts'

export const name = MODEL_CENTER_PLUGIN
export const inject = ['connection', 'webServer'] as const

export class ModelCenter {
  status(): ModelCenterStatus {
    return { enabled: true, plugin: MODEL_CENTER_PLUGIN }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelCenter: ModelCenter
  }
}

export async function handleHostRpc(
  endpoint: string,
  _payload: unknown,
  signal: AbortSignal,
  service: ModelCenter = new ModelCenter(),
): Promise<RpcResult<ModelCenterStatus>> {
  if (signal.aborted) return { ok: false, error: { code: 'MODEL_CENTER_CANCELLED', message: '已取消。' } }
  if (endpoint === 'status') return { ok: true, value: service.status() }
  return { ok: false, error: { code: 'MODEL_CENTER_INVALID_REQUEST', message: '未知操作。' } }
}

export function apply(ctx: Context): void {
  const host = ctx as Context & HostRpcContext
  const service = new ModelCenter()
  ctx.provide('modelCenter', service)
  ctx.effect(() => registerHostRpc(host, MODEL_CENTER_RPC_CHANNEL, (endpoint, payload, signal) => (
    handleHostRpc(endpoint, payload, signal, service)
  )), 'model-center.rpc')
}
