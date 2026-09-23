import { AI_RPC_CHANNEL } from './contracts.ts'
import type { AiPolicy, ProviderListing, RegisteredPurpose, ResolvedRoute } from './contracts.ts'
import { unwrapRpc } from './client-view.ts'
import { emptyCatalog, parseModelCatalog, type SessionModelCatalog } from './model-catalog.ts'
import { previewResolve } from './policy.ts'
import {
  credentialRefsToDescribe, joinProviderListings, namespacesOf, resolveApiKeyEnv, type ConfigurableProvider,
  type CredentialView, type LiveProvider, type SettingsSchemaWalk,
} from './providers.ts'
import { isPolicyConflict, parseAiPolicy, parseAiServicesStatus, parsePolicyUpdate, parseResolvedRoute } from './schema.ts'

export type RpcCall = (channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<unknown>

export type GenerationGate = {
  current: () => number
  next: () => number
  isCurrent: (token: number) => boolean
}

export function createGenerationGate(start = 0): GenerationGate {
  let current = start
  return {
    current: () => current,
    next: () => {
      current += 1
      return current
    },
    isCurrent: token => token === current,
  }
}

export function stillCurrent(token: number, gate: Pick<GenerationGate, 'isCurrent'>, signal?: AbortSignal): boolean {
  return gate.isCurrent(token) && !signal?.aborted
}

export interface LoadModelCenterInput {
  call: RpcCall
  sessionId?: string
  loadProviders: boolean
  llm?: {
    listConfigurableProviders(): Promise<unknown>
    listProviders?(): Promise<unknown>
  }
  credentials?: { describe(refs: string[]): Promise<unknown> }
  session?: { modelCatalog(): Promise<unknown> }
  configForms?: { describe?: () => { getSnapshot?: () => unknown; ensure?: () => Promise<unknown> } }
  settingsSchema?: SettingsSchemaWalk
  signal?: AbortSignal
}

export interface ModelCenterSnapshot {
  policy: AiPolicy
  purposes: RegisteredPurpose[]
  storageFailed: boolean
  catalog: SessionModelCatalog
  providers: ProviderListing[]
  resolved: Record<string, ResolvedRoute | { error: string }>
}

function asList<T>(result: unknown): T[] {
  try {
    const value = unwrapRpc<T[]>(result)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function statusValue(result: unknown): unknown {
  try { return unwrapRpc(result) }
  catch { return result }
}

export async function loadModelCenter(
  input: LoadModelCenterInput,
  isCurrent: () => boolean,
): Promise<ModelCenterSnapshot | undefined> {
  const { signal } = input
  const aiResult = await input.call(AI_RPC_CHANNEL, 'status', {}, signal)
  if (!isCurrent()) return undefined
  const ai = parseAiServicesStatus(statusValue(aiResult))
  if (!ai.ok) throw new Error(ai.error)

  let catalog = emptyCatalog()
  if (input.session?.modelCatalog) {
    try {
      catalog = parseModelCatalog(statusValue(await input.session.modelCatalog()))
    } catch {
      catalog = emptyCatalog()
    }
    if (!isCurrent()) return undefined
  }

  let providers: ProviderListing[] = []
  if (input.loadProviders && input.llm) {
    const configurableResult = await input.llm.listConfigurableProviders()
    if (!isCurrent()) return undefined
    const liveResult = input.llm.listProviders ? await input.llm.listProviders() : { ok: true as const, value: [] }
    if (!isCurrent()) return undefined
    const configurable = asList<ConfigurableProvider>(configurableResult)
    const live = asList<LiveProvider>(liveResult)

    let namespaces = new Map<string, unknown>()
    const described = input.configForms?.describe?.()
    if (described?.ensure) {
      try { await described.ensure() }
      catch { /* describe stays empty */ }
      if (!isCurrent()) return undefined
    }
    if (described?.getSnapshot) namespaces = namespacesOf(described.getSnapshot())

    const apiKeyEnvs = new Map<string, string>()
    for (const entry of configurable) {
      const id = typeof entry.provider === 'string' && entry.provider ? entry.provider
        : typeof entry.id === 'string' ? entry.id : ''
      if (!id) continue
      const settingsNs = typeof entry.settingsNs === 'string' ? entry.settingsNs : ''
      const settingsPath = Array.isArray(entry.settingsPath)
        ? entry.settingsPath.filter((item): item is string => typeof item === 'string')
        : []
      const ref = resolveApiKeyEnv(namespaces, settingsNs, settingsPath, input.settingsSchema)
      if (ref) apiKeyEnvs.set(id, ref)
    }

    const draft = joinProviderListings(configurable, live, {}, apiKeyEnvs)
    const refs = credentialRefsToDescribe(draft)
    let credentials: Record<string, CredentialView> = {}
    if (refs.length && input.credentials?.describe) {
      try { credentials = unwrapRpc(await input.credentials.describe(refs)) }
      catch { credentials = {} }
      if (!isCurrent()) return undefined
    }
    providers = joinProviderListings(configurable, live, credentials, apiKeyEnvs)
  }

  const resolved: Record<string, ResolvedRoute | { error: string }> = {}
  for (const spec of ai.value.purposes) {
    try {
      const raw = unwrapRpc(await input.call(AI_RPC_CHANNEL, 'resolve', {
        purpose: spec.id,
        sessionId: input.sessionId,
      }, signal))
      if (!isCurrent()) return undefined
      const parsed = parseResolvedRoute(raw)
      if (parsed.success) {
        resolved[spec.id] = parsed.data
        continue
      }
    } catch {
      if (!isCurrent()) return undefined
    }
    const local = previewResolve(ai.value.policy, spec.id, { specs: ai.value.purposes })
    resolved[spec.id] = local.ok ? local.route : { error: local.error }
  }
  if (!isCurrent()) return undefined
  return {
    policy: ai.value.policy,
    purposes: ai.value.purposes,
    storageFailed: ai.value.storageFailed,
    catalog,
    providers,
    resolved,
  }
}

export type PolicySaveResult =
  | { ok: true; policy: AiPolicy }
  | { ok: false; reason: 'stale' | 'conflict' | 'invalid'; error: string }

export async function savePolicyUpdate(
  call: RpcCall,
  request: unknown,
  isCurrent: () => boolean,
  signal?: AbortSignal,
): Promise<PolicySaveResult> {
  const parsed = parsePolicyUpdate(request)
  if (!parsed.ok) return { ok: false, reason: 'invalid', error: parsed.error }
  try {
    const raw = await call(AI_RPC_CHANNEL, 'update', parsed.value, signal)
    if (!isCurrent()) return { ok: false, reason: 'stale', error: '' }
    const policy = parseAiPolicy(unwrapRpc(raw))
    if (!policy) return { ok: false, reason: 'invalid', error: 'AI 策略接口与约定不一致。' }
    return { ok: true, policy }
  } catch (error) {
    if (!isCurrent()) return { ok: false, reason: 'stale', error: '' }
    if (isPolicyConflict(error)) {
      return { ok: false, reason: 'conflict', error: error instanceof Error ? error.message : '策略冲突。' }
    }
    return { ok: false, reason: 'invalid', error: error instanceof Error ? error.message : '保存失败。' }
  }
}
