import type { Context } from '@deepseek-ai/cordis'
import {
  PROOFREAD_RPC_CHANNEL, PROOFREAD_MAX_TEXT_BYTES, PROOFREAD_MAX_FINDINGS,
  TEXT_PROOFREAD_KINDS, type TextCheckRequest, type ProofreadRpcResult,
} from './contracts.ts'
import { proofreadText } from './engine.ts'

export const name = 'dsh-proofread'
export const inject = ['connection'] as const

type RpcHost = Context & {
  connection: { rpc: { handle: (
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ProofreadRpcResult>,
    options: { authority: 'loopback' },
  ) => (() => void | Promise<void>) } }
}
function invalid(message: string): ProofreadRpcResult {
  return { ok: false, error: { code: 'bad-request', message, details: {} } }
}
/** This endpoint never resolves a session, path, credential or model. */
export async function checkText(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ProofreadRpcResult> {
  if (signal.aborted) return { ok: false, error: { code: 'cancelled', message: '校对已取消', details: {} } }
  if (endpoint !== 'text.check') return invalid('不支持的校对操作')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('请输入待校对文本')
  const body = payload as Record<string, unknown>
  if (Object.keys(body).some(key => key !== 'text' && key !== 'kinds')) return invalid('不支持的校对选项')
  if (typeof body.text !== 'string') return invalid('请输入待校对文本')
  if (body.text.length > PROOFREAD_MAX_TEXT_BYTES || new TextEncoder().encode(body.text).byteLength > PROOFREAD_MAX_TEXT_BYTES) {
    return invalid('文本超过 2 MB，请分段校对')
  }
  if (body.kinds !== undefined && (!Array.isArray(body.kinds) || body.kinds.length > TEXT_PROOFREAD_KINDS.length ||
    body.kinds.some(kind => typeof kind !== 'string' || !(TEXT_PROOFREAD_KINDS as readonly string[]).includes(kind)))) {
    return invalid('校对规则无效')
  }
  const request = body as TextCheckRequest
  try {
    const value = proofreadText(request.text, { kinds: request.kinds ?? TEXT_PROOFREAD_KINDS, maxFindings: PROOFREAD_MAX_FINDINGS })
    if (signal.aborted) return { ok: false, error: { code: 'cancelled', message: '校对已取消', details: {} } }
    return { ok: true, value }
  } catch {
    return { ok: false, error: { code: 'internal', message: '校对失败，请重试', details: {} } }
  }
}
export function apply(ctx: Context): void {
  const host = ctx as RpcHost
  ctx.effect(() => host.connection.rpc.handle(PROOFREAD_RPC_CHANNEL, checkText, { authority: 'loopback' }))
}
