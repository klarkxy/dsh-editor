import { randomUUID } from 'node:crypto'
import { LlmError, ReasoningEffortId, type LlmCallConfig, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ModelRole, ModelRoute, ModelTarget, PurposeSpec, ResolvedRoute } from './contracts.ts'
import {
  AI_INVALID_ROUTE, AI_ROLE_UNSET, AI_SESSION_INVALID, AI_SESSION_UNAVAILABLE, AI_UNKNOWN_PURPOSE, AI_UNKNOWN_ROLE,
  AiServicesError, abortable, fail, isAbortError, publicCallError,
} from './errors.ts'
import { cloneRoute, isModelRole } from './storage.ts'
import type { AiPolicy } from './contracts.ts'

export type SessionModelsFn = (sessionId: string, signal?: AbortSignal) => Promise<ModelRoute>

export type LlmValidate = Pick<LlmRuntime, 'resolveCallConfig'>

export function streamReasoningEffort(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  if (!id) return undefined
  return id
}

function asCallConfig(route: ModelRoute): LlmCallConfig {
  const effort = streamReasoningEffort(route.reasoningEffort)
  return effort
    ? { provider: route.provider, model: route.model, reasoningEffort: ReasoningEffortId(effort) }
    : { provider: route.provider, model: route.model }
}

export async function validateRoute(llm: LlmValidate, route: ModelRoute, signal?: AbortSignal): Promise<void> {
  if (!route.provider.trim() || !route.model.trim()) fail(AI_INVALID_ROUTE, '指定的模型路由不完整，未改用其他模型。')
  try {
    const work = () => llm.resolveCallConfig(asCallConfig(route), signal)
    await (signal ? abortable(work, signal) : work())
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error
    if (error instanceof LlmError) fail(AI_INVALID_ROUTE, publicCallError(error.code))
    fail(AI_INVALID_ROUTE, '指定的模型路由无效，未改用其他模型。')
  }
}

function configuredRole(policy: AiPolicy, role: ModelRole): ModelRoute | undefined {
  const route = policy.roles[role]
  if (!route) return undefined
  if (!route.provider.trim() || !route.model.trim()) return undefined
  return cloneRoute(route)
}

export async function resolveTarget(input: {
  llm: LlmValidate
  policy: AiPolicy
  target: ModelTarget
  source: ResolvedRoute['source']
  sessionId?: string
  sessionModels?: SessionModelsFn
  signal?: AbortSignal
}): Promise<ResolvedRoute> {
  const { llm, policy, target, source, sessionId, sessionModels, signal } = input
  const policyRevision = policy.revision
  if (target.kind === 'model') {
    const route = cloneRoute({
      provider: target.provider,
      model: target.model,
      ...(streamReasoningEffort(target.reasoningEffort) ? { reasoningEffort: streamReasoningEffort(target.reasoningEffort) } : {}),
    })
    await validateRoute(llm, route, signal)
    return { ...route, source, target, policyRevision }
  }
  if (target.kind === 'session') {
    if (!sessionId) fail(AI_SESSION_UNAVAILABLE, '会话模型需要当前会话。')
    if (!sessionModels) fail(AI_SESSION_UNAVAILABLE, '无法读取当前会话模型。')
    let selected: ModelRoute
    try {
      selected = await sessionModels(sessionId, signal)
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error
      if (error instanceof AiServicesError) throw error
      if (error instanceof Error && error.message) fail(AI_SESSION_INVALID, error.message)
      fail(AI_SESSION_UNAVAILABLE, '无法读取当前会话模型。')
    }
    const effort = streamReasoningEffort(selected.reasoningEffort)
    const route = effort
      ? { provider: selected.provider, model: selected.model, reasoningEffort: effort }
      : { provider: selected.provider, model: selected.model }
    await validateRoute(llm, route, signal)
    return { ...route, source, target, policyRevision }
  }
  if (!isModelRole(target.role)) fail(AI_UNKNOWN_ROLE, '未知模型角色。')
  let inheritedRole: ModelRole | undefined
  let route = configuredRole(policy, target.role)
  if (!route) {
    if (target.role === 'normal') fail(AI_ROLE_UNSET, '尚未配置常用模型。')
    const normal = configuredRole(policy, 'normal')
    if (!normal) fail(AI_ROLE_UNSET, '尚未配置常用模型。')
    route = normal
    inheritedRole = 'normal'
  }
  await validateRoute(llm, route, signal)
  return inheritedRole
    ? { ...route, source, target, policyRevision, inheritedRole }
    : { ...route, source, target, policyRevision }
}

export async function resolvePurposeRoute(input: {
  llm: LlmValidate
  policy: AiPolicy
  purpose: string
  spec?: PurposeSpec
  sessionId?: string
  override?: ModelTarget
  sessionModels?: SessionModelsFn
  signal?: AbortSignal
}): Promise<ResolvedRoute> {
  const { llm, policy, purpose, spec, sessionId, override, sessionModels, signal } = input
  if (override) {
    return resolveTarget({ llm, policy, target: override, source: 'override', sessionId, sessionModels, signal })
  }
  const mapped = policy.purposes[purpose]
  if (mapped) {
    return resolveTarget({ llm, policy, target: mapped, source: 'purpose', sessionId, sessionModels, signal })
  }
  if (spec) {
    return resolveTarget({ llm, policy, target: spec.defaultTarget, source: 'default', sessionId, sessionModels, signal })
  }
  fail(AI_UNKNOWN_PURPOSE, '用途未注册。')
}

type SessionModelsProxy = {
  sessions?: {
    models(request: unknown): Promise<{
      result: {
        ok: boolean
        value?: { current?: { provider?: string; model?: string; reasoningEffort?: string }; routable?: boolean }
        error?: { message?: string }
      }
    }>
  }
}

/** Read the current picker via session.models, never the last request header. */
export function sessionModelsFromApi(getApi: () => unknown): SessionModelsFn {
  return async (sessionId, signal) => {
    signal?.throwIfAborted()
    const api = getApi() as SessionModelsProxy | undefined
    if (!api?.sessions?.models) fail(AI_SESSION_UNAVAILABLE, '无法读取当前会话模型。')
    const request = {
      type: 'client-request', rpcId: randomUUID(), method: 'session.models', payload: { sessionId },
    }
    let response: Awaited<ReturnType<NonNullable<NonNullable<SessionModelsProxy['sessions']>['models']>>>
    try {
      const work = () => api.sessions!.models!(request)
      response = signal ? await abortable(work, signal) : await work()
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error
      if (error instanceof AiServicesError) throw error
      if (error instanceof Error && error.message) fail(AI_SESSION_INVALID, error.message)
      fail(AI_SESSION_UNAVAILABLE, '无法读取当前会话模型。')
    }
    signal?.throwIfAborted()
    if (!response.result.ok) fail(AI_SESSION_INVALID, response.result.error?.message || '无法读取当前会话模型。')
    const selected = response.result.value?.current
    if (!selected || typeof selected.provider !== 'string' || typeof selected.model !== 'string') {
      fail(AI_SESSION_INVALID, '当前会话模型响应无效。')
    }
    if (response.result.value?.routable === false) fail(AI_SESSION_INVALID, '当前会话模型不可用。')
    const effort = streamReasoningEffort(selected.reasoningEffort)
    return effort
      ? { provider: selected.provider, model: selected.model, reasoningEffort: effort }
      : { provider: selected.provider, model: selected.model }
  }
}
