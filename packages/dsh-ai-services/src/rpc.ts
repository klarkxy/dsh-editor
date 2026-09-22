import type { AiServices, RpcResult } from './contracts.ts'
import { AiServicesError } from './errors.ts'
import { resolveRpcSchema, updatePolicySchema } from './storage.ts'

function fail(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message } }
}

function mapError(error: unknown): RpcResult {
  if (error instanceof AiServicesError) return fail(error.code, error.message)
  return fail('AI_REQUEST_FAILED', '操作失败，请刷新后重试。')
}

export async function handleAiRpc(
  service: AiServices & { storageFailedFlag?: boolean },
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<RpcResult> {
  try {
    signal.throwIfAborted()
    if (endpoint === 'status') {
      if (payload !== undefined && payload !== null && (typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload as object).length > 0)) {
        return fail('AI_INVALID_REQUEST', '未知操作。')
      }
      return {
        ok: true,
        value: {
          policy: service.getPolicy(),
          purposes: service.purposes(),
          storageFailed: Boolean(service.storageFailedFlag),
        },
      }
    }
    if (endpoint === 'update') {
      const parsed = updatePolicySchema.safeParse(payload)
      if (!parsed.success) return fail('AI_INVALID_REQUEST', '策略格式无效。')
      return { ok: true, value: await service.updatePolicy(parsed.data.policy, parsed.data.expectedRevision) }
    }
    if (endpoint === 'resolve') {
      const parsed = resolveRpcSchema.safeParse(payload)
      if (!parsed.success) return fail('AI_INVALID_REQUEST', '路由请求无效。')
      return { ok: true, value: await service.resolve(parsed.data.purpose, parsed.data.sessionId, parsed.data.override) }
    }
    if (endpoint === 'usage') {
      if (payload !== undefined && payload !== null && (typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload as object).length > 0)) {
        return fail('AI_INVALID_REQUEST', '未知操作。')
      }
      return { ok: true, value: service.usage() }
    }
    return fail('AI_INVALID_REQUEST', '未知操作。')
  } catch (error) {
    if (signal.aborted) return fail('AI_CANCELLED', '请求已取消。')
    return mapError(error)
  }
}
