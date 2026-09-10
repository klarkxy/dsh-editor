import { useCallback, useEffect, useRef, useState } from 'react'
import { SHELL_RPC_CHANNEL, type ShellCapabilities } from '../capabilities.ts'
import { t } from '../i18n/index.ts'
import { errorMessage, safeRpcCall, type RpcResult, type ShellContext } from './shared.ts'

/*
 * 可选 AI 能力的产品开关,区别于"选中插件损坏"。查询失败是显式错误态
 * (可重试),绝不退化成静默的"功能已关闭"。能力未加载完成前,调用方
 * 不得挂载 Chat / 自动索引等 AI 界面。
 */
export type ShellCapabilityState =
  | { kind: 'loading' }
  | { kind: 'ready'; value: ShellCapabilities }
  | { kind: 'error'; message: string }

/** 解析 capabilities.get 应答：失败或契约字段缺失都判为错误,而不是普通停用。 */
export function capabilityStateFromResult(result: RpcResult<unknown>): ShellCapabilityState {
  if (!result.ok) return { kind: 'error', message: errorMessage(result) || t('capabilities.invalid') }
  const value = result.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'error', message: t('capabilities.invalid') }
  const caps = value as Record<string, unknown>
  const features = caps.features
  if (!features || typeof features !== 'object' || Array.isArray(features)) {
    return { kind: 'error', message: t('capabilities.invalid') }
  }
  const normalized: Record<string, boolean> = {}
  for (const [key, flag] of Object.entries(features)) {
    if (typeof flag !== 'boolean') return { kind: 'error', message: t('capabilities.invalid') }
    normalized[key] = flag
  }
  return { kind: 'ready', value: { features: normalized } }
}

/* cordis Context 的事件面：连接代际重建时运行时会广播 'connection/reset'。
 * 这里只做结构探测,事件 API 不可用时静默跳过刷新。 */
type ConnectionResetEvents = { on?: (event: string, listener: () => void) => unknown }

export function useShellCapabilities(ctx: ShellContext): { state: ShellCapabilityState; retry(): void } {
  const [state, setState] = useState<ShellCapabilityState>({ kind: 'loading' })
  /* 代数令牌 + AbortController：卸载/重置/新请求发出时,既丢弃迟到的应答
     (stale 守卫)也真正取消在途 HTTP 请求。 */
  const generation = useRef(0)
  const inFlight = useRef<AbortController | null>(null)
  const load = useCallback(async (announceLoading: boolean) => {
    const ticket = ++generation.current
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    if (announceLoading) setState({ kind: 'loading' })
    const result = await safeRpcCall<ShellCapabilities>(() => ctx.connection.rpc.call(SHELL_RPC_CHANNEL, 'capabilities.get', {}, controller.signal))
    if (inFlight.current === controller) inFlight.current = null
    if (ticket !== generation.current) return
    setState(capabilityStateFromResult(result))
  }, [ctx])
  /* 根激活时加载一次；卸载时取消在途请求并作废其应答。 */
  useEffect(() => {
    void load(true)
    return () => {
      generation.current += 1
      inFlight.current?.abort()
      inFlight.current = null
    }
  }, [load])
  /* 连接重置后静默刷新（supersede 会取消上一个在途请求）：保留当前展示,新结果到达再替换。 */
  useEffect(() => {
    const events = ctx as ShellContext & ConnectionResetEvents
    if (typeof events.on !== 'function') return
    const dispose = events.on('connection/reset', () => { void load(false) })
    return typeof dispose === 'function' ? () => { (dispose as () => void)() } : undefined
  }, [ctx, load])
  /* 真实错误由用户手动重试。 */
  const retry = useCallback(() => { void load(true) }, [load])
  return { state, retry }
}
