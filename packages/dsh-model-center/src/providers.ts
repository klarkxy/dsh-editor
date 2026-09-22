import type { DiscoveredModel, ProviderListing } from './contracts.ts'

export function providerIdOf(entry: { provider?: unknown; id?: unknown }): string {
  if (typeof entry.provider === 'string' && entry.provider.length > 0) return entry.provider
  if (typeof entry.id === 'string' && entry.id.length > 0) return entry.id
  return ''
}

export function displayNameOf(entry: { displayName?: unknown; name?: unknown; provider?: unknown; id?: unknown }): string {
  if (typeof entry.displayName === 'string' && entry.displayName.length > 0) return entry.displayName
  if (typeof entry.name === 'string' && entry.name.length > 0) return entry.name
  return providerIdOf(entry) || 'provider'
}

export type ConfigurableProvider = {
  provider?: unknown
  id?: unknown
  displayName?: unknown
  name?: unknown
  settingsNs?: unknown
  settingsPath?: unknown
  declared?: unknown
  error?: unknown
}

export type LiveProvider = { id?: unknown; name?: unknown }

export type CredentialView = { configured?: unknown; writable?: unknown; source?: unknown }

export type SettingsSchemaWalk = {
  getPath?(value: unknown, path: string[]): unknown
}

export function settingsPathOf(entry: ConfigurableProvider): string[] {
  return Array.isArray(entry.settingsPath)
    ? entry.settingsPath.filter((item): item is string => typeof item === 'string')
    : []
}

export function profileAt(value: unknown, path: string[]): unknown {
  let current: unknown = value
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function apiKeyEnvOf(profile: unknown): string | undefined {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.trim() ? ref.trim() : undefined
}

export function namespacesOf(snapshot: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>()
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return map
  const view = (snapshot as { view?: { namespaces?: unknown } }).view
  const namespaces = view && typeof view === 'object' && !Array.isArray(view) ? view.namespaces : undefined
  if (!Array.isArray(namespaces)) return map
  for (const entry of namespaces) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const ns = (entry as { ns?: unknown }).ns
    if (typeof ns === 'string' && ns) map.set(ns, (entry as { value?: unknown }).value)
  }
  return map
}

/** Resolve the profile's apiKeyEnv. Never invent PROVIDER_API_KEY. */
export function resolveApiKeyEnv(
  namespaces: Map<string, unknown>,
  settingsNs: string,
  settingsPath: string[],
  schema?: SettingsSchemaWalk,
): string | undefined {
  if (!settingsNs) return undefined
  const namespace = namespaces.get(settingsNs)
  const profile = schema?.getPath ? schema.getPath(namespace, settingsPath) : profileAt(namespace, settingsPath)
  return apiKeyEnvOf(profile)
}

function authOf(credential: CredentialView | undefined): ProviderListing['auth'] {
  if (credential?.configured === true) return 'configured'
  if (credential?.configured === false) return 'missing'
  return 'unknown'
}

export function joinProviderListings(
  configurable: readonly ConfigurableProvider[],
  live: readonly LiveProvider[],
  credentials: Record<string, CredentialView> = {},
  apiKeyEnvs: ReadonlyMap<string, string> = new Map(),
): ProviderListing[] {
  const liveIds = new Set(live.map(item => typeof item.id === 'string' ? item.id : '').filter(Boolean))
  const rows = configurable.map(entry => {
    const id = providerIdOf(entry)
    const credentialRef = id ? apiKeyEnvs.get(id) : undefined
    const credential = credentialRef ? credentials[credentialRef] : undefined
    return {
      id: id || displayNameOf(entry),
      displayName: displayNameOf(entry),
      settingsNs: typeof entry.settingsNs === 'string' ? entry.settingsNs : '',
      settingsPath: settingsPathOf(entry),
      live: id ? liveIds.has(id) : false,
      declared: entry.declared === true ? true : entry.declared === false ? false : undefined,
      error: typeof entry.error === 'string' && entry.error ? entry.error : undefined,
      auth: authOf(credential),
      writable: typeof credential?.writable === 'boolean' ? credential.writable : undefined,
      credentialRef,
    } satisfies ProviderListing
  })
  for (const item of live) {
    const id = typeof item.id === 'string' ? item.id : ''
    if (!id || rows.some(row => row.id === id)) continue
    const credentialRef = apiKeyEnvs.get(id)
    const credential = credentialRef ? credentials[credentialRef] : undefined
    rows.push({
      id,
      displayName: typeof item.name === 'string' && item.name ? item.name : id,
      settingsNs: '',
      settingsPath: [],
      live: true,
      declared: undefined,
      error: undefined,
      auth: authOf(credential),
      writable: typeof credential?.writable === 'boolean' ? credential.writable : undefined,
      credentialRef,
    })
  }
  return rows
}

export function credentialRefsToDescribe(rows: readonly ProviderListing[]): string[] {
  return [...new Set(rows.flatMap(row => row.credentialRef ? [row.credentialRef] : []))]
}

export function shouldLoadNativeProviders(renderProviders?: unknown): boolean {
  return typeof renderProviders !== 'function'
}

export function authLabel(auth: ProviderListing['auth'], locale: 'zh' | 'en' = 'zh'): string {
  if (auth === 'configured') return locale === 'en' ? 'Key configured' : '已配置密钥'
  if (auth === 'missing') return locale === 'en' ? 'Key missing' : '未配置密钥'
  return locale === 'en' ? 'Auth unknown' : '密钥状态未知'
}

export function discoveredIds(models: readonly DiscoveredModel[]): string[] {
  return [...new Set(models.map(model => model.id).filter(Boolean))]
}

export function canDiscoverModels(llm: { discoverModels?: unknown } | undefined): boolean {
  return typeof llm?.discoverModels === 'function'
}

export function canOpenSettingsDocument(settings: { openSettingsDocument?: unknown } | undefined): boolean {
  return typeof settings?.openSettingsDocument === 'function'
}

export function nativeSettingsNote(locale: 'zh' | 'en' = 'zh'): string {
  return locale === 'en' ? 'Open native settings for provider credentials.' : '凭据请在原生设置中编辑。'
}
