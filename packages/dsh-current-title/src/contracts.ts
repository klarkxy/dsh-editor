/** Browser-safe contracts. Shared RPC/result types stay on @klarkxy/dsh-ai-services. */
export type { RpcResult } from '@klarkxy/dsh-ai-services/contracts'

export const PLUGIN_NAME = '@klarkxy/dsh-current-title'
export const FEATURE_ID = 'current-title'
export const PROVIDER_ID = '@klarkxy/dsh-current-title'
export const PURPOSE_ID = 'current-title.generate'
export const RPC_CHANNEL = '/dsh-current-title'
export const TITLE_CLIENT_SERVICE = 'dshCurrentTitleClient'
export const PROMPT_VERSION = 'current-title.v1'
export const SCHEMA_VERSION = 'title-json.v1'
export const CONTRACT_VERSION = 1
export const SETTINGS_KEY = 'current'

export const DEFAULT_MAX_RECENT_MESSAGES = 8
export const DEFAULT_TARGET_WORDS = 5
export const DEFAULT_TARGET_CJK = 10
export const DEFAULT_MAX_INPUT_BYTES = 4096
export const DEFAULT_MAX_OUTPUT_TOKENS = 64
export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_TITLE_BYTES = 80

export type TitleLocaleMode = 'auto' | 'zh' | 'en'
export type TitleSourceKind = 'fallback' | 'provider' | 'user'

export interface TitleMessage {
  readonly seq: number
  readonly text: string
}

export interface TitleSnapshot {
  readonly title: string
  readonly messageSeqs: readonly number[]
  readonly source: { readonly kind: TitleSourceKind; readonly provider?: string }
  readonly eventSeq: number
  readonly updatedAt: number
}

export interface TitleSettings {
  revision: number
  locale: TitleLocaleMode
}

export interface TitleSupport {
  nativeOwner: string | null
  weOwn: boolean
  limitation?: string
}

export interface TitleStatus {
  settings: TitleSettings
  support: TitleSupport
  session?: {
    sessionId: string
    title?: string
    sourceKind?: TitleSourceKind
    generating: boolean
    pinned: boolean
  }
}

export interface TitleClientMarker {
  active: boolean
}

export interface GenerateConfig {
  readonly maxRecentMessages: number
  readonly locale: TitleLocaleMode
  readonly targetWords: number
  readonly targetCjkCharacters: number
  readonly maxInputBytes: number
  readonly maxOutputTokens: number
  readonly timeoutMs: number
  readonly maxTitleBytes: number
}

export function defaultSettings(locale: TitleLocaleMode = 'auto'): TitleSettings {
  return { revision: 0, locale }
}

export function defaultGenerateConfig(locale: TitleLocaleMode = 'auto'): GenerateConfig {
  return {
    maxRecentMessages: DEFAULT_MAX_RECENT_MESSAGES,
    locale,
    targetWords: DEFAULT_TARGET_WORDS,
    targetCjkCharacters: DEFAULT_TARGET_CJK,
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxTitleBytes: DEFAULT_MAX_TITLE_BYTES,
  }
}

export function isTitleLocaleMode(value: unknown): value is TitleLocaleMode {
  return value === 'auto' || value === 'zh' || value === 'en'
}
