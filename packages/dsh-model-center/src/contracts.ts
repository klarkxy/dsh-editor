export {
  AI_RPC_CHANNEL,
  MODEL_SETTINGS_SLOT,
} from '@klarkxy/dsh-ai-services/contracts'
export type {
  AiPolicy,
  ModelRole,
  ModelRoute,
  ModelTarget,
  PurposeSpec,
  ResolvedRoute,
  RpcResult,
} from '@klarkxy/dsh-ai-services/contracts'

import type { AiPolicy, ModelRole, ModelRoute, ModelTarget, ResolvedRoute } from '@klarkxy/dsh-ai-services/contracts'

export const MODEL_CENTER_RPC_CHANNEL = '/dsh-model-center'
export const MODEL_CENTER_PLUGIN = '@klarkxy/dsh-model-center'
export const MODEL_CENTER_ENTRY_ID = 'model-center'

export const MODEL_ROLES = ['weak', 'normal', 'strong', 'fantasy'] as const satisfies readonly ModelRole[]

export interface ModelCenterStatus {
  enabled: boolean
  plugin: typeof MODEL_CENTER_PLUGIN
}

export interface RegisteredPurpose {
  id: string
  label: string
  defaultTarget: ModelTarget
  plugin: string
  maxOutputTokens?: number
  maxInputChars?: number
  timeoutMs?: number
}

export interface AiServicesStatus {
  policy: AiPolicy
  purposes: RegisteredPurpose[]
  storageFailed: boolean
}

export interface AiServicesUpdateRequest {
  policy: Omit<AiPolicy, 'revision'>
  expectedRevision: number
}

export interface AiServicesResolveRequest {
  purpose: string
  sessionId?: string
  override?: ModelTarget
}

export type ModelCenterLocale = 'zh' | 'en'
export type ModelCenterTab = 'policy' | 'runtime' | 'providers'

export interface ModelCenterRenderProps {
  sessionId?: string
  locale?: ModelCenterLocale
  renderProviders?: (options?: { includeWritingRoutes?: boolean }) => unknown
  renderChatModel?: () => unknown
}

export interface ProviderListing {
  id: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  live: boolean
  declared?: boolean
  error?: string
  auth: 'configured' | 'missing' | 'unknown'
  writable?: boolean
  credentialRef?: string
}

export interface DiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

export type RoutePreview = {
  ok: true
  route: ResolvedRoute
  conflict?: string
} | {
  ok: false
  error: string
  target?: ModelTarget
  policyRevision: number
}

export function isModelRole(value: unknown): value is ModelRole {
  return value === 'normal' || value === 'weak' || value === 'strong' || value === 'fantasy'
}

export function isBoundRoute(route: ModelRoute | undefined): route is ModelRoute {
  return Boolean(route && route.provider.trim() && route.model.trim())
}
