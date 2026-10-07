export const PLUGINS_RPC_CHANNEL = '/dsh-editor-plugins'
export const PLUGINS_SETTINGS_SLOT = 'dsh-editor.settings.plugins'
export const PLUGIN_STATE_SCHEMA = 1
export const MARKETPLACE_TOPIC = 'dsh-plugin'
export const MARKETPLACE_PAGE_SIZE = 20
export const MARKETPLACE_QUERY_MAX = 80
export type MarketplaceListing = {
  spec: string
  source?: 'github' | 'npm' | 'local'
  owner: string
  repo: string
  description: string
  stars: number
  url: string
  updatedAt: string
  topics: string[]
  packageName?: string
  title?: string
}

export type PluginActionReceipt = {
  restartRequired: boolean
}

/** 第一方写作模式 preset 卡片：locked 的是核心通用写作，其余可在设置里开关。 */
export type WritingPresetCard = {
  id: string
  title: string
  description: string
  enabled: boolean
  locked: boolean
  packageName?: string
}

export type WritingPresetInventory = {
  presets: WritingPresetCard[]
}

export type PluginsErrorCode = 'bad-request' | 'cancelled' | 'forbidden' | 'not-found' | 'network' | 'internal'

export type PluginsRpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: PluginsErrorCode; message: string; details: Record<string, unknown> } }
