export const PLUGINS_RPC_CHANNEL = '/dsh-editor-plugins'
export const PLUGINS_SETTINGS_SLOT = 'dsh-editor.settings.plugins'
export const PLUGIN_STATE_SCHEMA = 1
export const MARKETPLACE_TOPIC = 'dsh-plugin'
export const MARKETPLACE_PAGE_SIZE = 20
export const MARKETPLACE_QUERY_MAX = 80
export const INSTALL_TARBALL_MAX_BYTES = 40 * 1024 * 1024

export type PluginFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
export type PluginOrigin = 'bundled' | 'installed'
export type PluginGroup = 'core' | 'optional' | 'community'

export type PluginCard = {
  entryId: string
  moduleName: string
  packageName: string
  title: string
  description: string
  group: PluginGroup
  enabled: boolean
  locked: boolean
  fiberPhase: PluginFiberPhase
  origin: PluginOrigin
  spec?: string
  version?: string
}

export type PluginInventory = {
  core: PluginCard[]
  optional: PluginCard[]
  community: PluginCard[]
}

export type MarketplaceListing = {
  spec: string
  owner: string
  repo: string
  description: string
  stars: number
  url: string
  updatedAt: string
  topics: string[]
}

export type PluginActionReceipt = {
  restartRequired: boolean
}

export type InspectSeverity = 'error' | 'warning' | 'info'
export type InspectVerdict = 'ready' | 'warn' | 'blocked'
export type InspectFinding = { code: string; severity: InspectSeverity; message: string }
export type InspectEntry = { id: string; name: string }
export type PluginInspectReport = {
  verdict: InspectVerdict
  name?: string
  version?: string
  entries: InspectEntry[]
  hasClient: boolean
  findings: InspectFinding[]
}

export type PluginsErrorCode = 'bad-request' | 'cancelled' | 'forbidden' | 'not-found' | 'network' | 'internal'

export type PluginsRpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: PluginsErrorCode; message: string; details: Record<string, unknown> } }
