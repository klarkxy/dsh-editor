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
  defaultModel?: () => ModelRoute | undefined
  modelCenterAvailable?: boolean
  signal?: AbortSignal
}): Promise<ResolvedRoute> {
  const { llm, policy, target, source, sessionId, sessionModels, defaultModel, modelCenterAvailable, signal } = input
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
  // Without the manager, every tier uses the default chat model. Explicit
  // model/session choices above remain authoritative, including invalid ones.
  let route = modelCenterAvailable === false ? undefined : configuredRole(policy, target.role)
  if (!route) {
    route = configuredRole(policy, 'normal') ?? defaultModel?.()
    if (!route) fail(AI_ROLE_UNSET, '请先设置默认对话模型。')
    route = cloneRoute(route)
    if (target.role !== 'normal') inheritedRole = 'normal'
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
  defaultModel?: () => ModelRoute | undefined
  modelCenterAvailable?: boolean
  signal?: AbortSignal
}): Promise<ResolvedRoute> {
  const { llm, policy, purpose, spec, sessionId, override, sessionModels, defaultModel, modelCenterAvailable, signal } = input
  if (override) {
    return resolveTarget({ llm, policy, target: override, source: 'override', sessionId, sessionModels, defaultModel, modelCenterAvailable, signal })
  }
  const mapped = policy.purposes[purpose]
  if (mapped) {
    return resolveTarget({ llm, policy, target: mapped, source: 'purpose', sessionId, sessionModels, defaultModel, modelCenterAvailable, signal })
  }
  if (spec) {
    return resolveTarget({ llm, policy, target: spec.defaultTarget, source: 'default', sessionId, sessionModels, defaultModel, modelCenterAvailable, signal })
  }
  fail(AI_UNKNOWN_PURPOSE, '用途未注册。')
}

type ModelSelectionLike = { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
type RequestHeaderLike = { config?: ModelSelectionLike; adapterDefaults?: { reasoningEffort?: unknown } }

type SessionModelsHost = {
  agents?: { get(sessionId: string): { session?: { requestHeader?: () => RequestHeaderLike | undefined } } | undefined }
  sessionProjections?: { stateOf(session: unknown, key: string): { pending?: ModelSelectionLike | null } | undefined }
  agentDefaultModel?: { currentSelection(): ModelSelectionLike }
}

function routeFromSelection(value: ModelSelectionLike | undefined, message: string): ModelRoute {
  if (typeof value?.provider !== 'string' || typeof value.model !== 'string') fail(AI_SESSION_INVALID, message)
  const effort = streamReasoningEffort(value.reasoningEffort)
  return effort
    ? { provider: value.provider, model: value.model, reasoningEffort: effort }
    : { provider: value.provider, model: value.model }
}

/**
 * Read the live host picker. A durable pending choice wins, then the route
 * recorded by the current request, then the host's default model.
 */
export function sessionModelsFromHost(getHost: () => unknown): SessionModelsFn {
  return async (sessionId, signal) => {
    signal?.throwIfAborted()
    const host = getHost() as SessionModelsHost | undefined
    if (!host?.agents || !host.sessionProjections) fail(AI_SESSION_UNAVAILABLE, '无法读取当前会话模型。')
    const agent = host.agents.get(sessionId)
    const session = agent?.session
    if (!session) fail(AI_SESSION_UNAVAILABLE, '当前会话不在 Host 中，无法读取模型。')
    let projection: { pending?: ModelSelectionLike | null } | undefined
    try {
      projection = host.sessionProjections.stateOf(session, 'modelSelection')
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error
      fail(AI_SESSION_UNAVAILABLE, '无法读取当前会话模型。')
    }
    signal?.throwIfAborted()
    if (!projection) fail(AI_SESSION_UNAVAILABLE, '当前会话模型投影不可用。')
    if (projection.pending !== null && projection.pending !== undefined) {
      return routeFromSelection(projection.pending, '当前会话模型选择无效。')
    }
    const header = session.requestHeader?.()
    const recorded = header?.config
    if (recorded !== undefined) {
      const selected = header?.adapterDefaults?.reasoningEffort === true
        ? { provider: recorded.provider, model: recorded.model }
        : recorded
      return routeFromSelection(selected, '当前会话模型记录无效。')
    }
    return routeFromSelection(host.agentDefaultModel?.currentSelection(), '默认对话模型不可用。')
  }
}
