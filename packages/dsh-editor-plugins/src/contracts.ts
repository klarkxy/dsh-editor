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
  /** App-generated distribution ownership, independent of locking and origin. */
  builtin?: boolean
  /** Entry is controlled by its session or another built-in feature. */
  managedBy?: 'session' | 'feature'
  /** Installed on disk but not yet present in the running loader. */
  pendingRestart?: boolean
  /** Startup failure from the loader, distinct from installation success. */
  failureReason?: string
  spec?: string
  version?: string
}

export type PluginInventory = {
  core: PluginCard[]
  optional: PluginCard[]
  community: PluginCard[]
  /** Native `clientModules.graph().entries` ids; omitted on a clientless host. */
  clientPackages?: string[]
}

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

export type InspectSeverity = 'error' | 'warning' | 'info'
export type InspectVerdict = 'ready' | 'warn' | 'blocked'
export type InspectFinding = { code: string; severity: InspectSeverity; message: string }
export type InspectEntry = { id: string; name: string }
export type PluginPresetDeclaration = { id: string; path: string }
export type NpmArtifact = { spec: string; integrity: string }
export type PluginInspectReport = {
  verdict: InspectVerdict
  name?: string
  version?: string
  entries: InspectEntry[]
  hasClient: boolean
  findings: InspectFinding[]
  /** Exact npm artifact approved in the current inspection attempt. */
  npmArtifact?: NpmArtifact
  /** Validated own ./tools modules contributed to the host's generated overlay. */
  toolInserts?: InspectEntry[]
  /** 插件通过 dshEditor.presets 声明、且通过静态检查的对话 preset。 */
  presets?: PluginPresetDeclaration[]
}

export type PluginsErrorCode = 'bad-request' | 'cancelled' | 'forbidden' | 'not-found' | 'network' | 'internal'

export type PluginsRpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: PluginsErrorCode; message: string; details: Record<string, unknown> } }
