import { readPluginCatalog, type CatalogManager } from './catalog.ts'
import { RETIRED_PLUGIN_PACKAGES } from '../../../apps/desktop/src/distribution-contract.ts'
import { adaptNativeToolProjection, readNativeToolState, type NativeToolManager } from './native-tools.ts'
import type { NativeToolState } from './preset-config.ts'
import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from 'dsh-manuscript/host-api'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  PLUGINS_RPC_CHANNEL,
  PLUGIN_CATALOG_ENDPOINT,
  type MarketplaceListing,
  type PluginActionReceipt,
  type PluginCatalog,
  type PluginsRpcResult,
} from './contracts.ts'
import { CORE_PLUGIN_BUNDLE_NAMES, protectCorePluginManager } from './core-lock.ts'
import { isSafePackageName, readPreparedCatalog } from './core.ts'
import { HIDDEN_DISCOVERY_REPOS, RECOMMENDED_PLUGINS, type RecommendedPlugin } from './curation.ts'
import { githubHeaders, marketplaceSearchUrl, parseGitHubSpec, parseMarketplaceSearch, sanitizeMarketplaceQuery } from './github.ts'
import { npmMarketplaceListing, parseNpmSpec } from './npm.ts'
import { emptyPluginState, parsePluginState, type PluginState } from './overlay.ts'
import { resolvePluginPaths, type PluginPaths } from './paths.ts'
import type { PersistIo } from './persist.ts'

export const name = 'dsh-editor-plugins'
export const inject = ['connection', 'webServer'] as const

type RpcHost = Context & HostRpcContext

function fail(code: 'bad-request' | 'cancelled' | 'forbidden' | 'not-found' | 'network' | 'internal', message: string, details: Record<string, unknown> = {}): PluginsRpcResult {
  return { ok: false, error: { code, message, details } }
}

const bad = (message: string, details: Record<string, unknown> = {}) => fail('bad-request', message, details)
const forbidden = (message: string) => fail('forbidden', message)
const cancelled = () => fail('cancelled', '请求已取消')

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}

export function resolveProfileArtifactDir(profileDir: string, packageName: string): string | undefined {
  if (!isSafePackageName(packageName)) return undefined
  const artifactRoot = resolve(profileDir, 'bundled-packages', 'node_modules')
  const candidate = resolve(artifactRoot, ...packageName.split('/'))
  return isPathInside(artifactRoot, candidate) ? candidate : undefined
}

function isDshBundle(manifest: unknown): manifest is { name?: unknown } {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  const dsh = (manifest as { dsh?: unknown }).dsh
  if (!dsh || typeof dsh !== 'object' || Array.isArray(dsh)) return false
  return (dsh as { bundle?: unknown }).bundle != null
}

function catalogCopy(packageName: string, catalog: Awaited<ReturnType<typeof readPreparedCatalog>>): { title: string; description: string } {
  const row = Object.values(catalog?.entries ?? {}).find((item) => item.packageName === packageName)
  return { title: row?.title || packageName, description: row?.description || '' }
}

function localMarketplaceListing(packageName: string, artifactDir: string, copy: { title: string; description: string }): MarketplaceListing {
  const slash = packageName.indexOf('/')
  return {
    spec: `link:${artifactDir.replaceAll('\\', '/')}`,
    source: 'local',
    packageName,
    title: copy.title,
    owner: slash < 0 ? '' : packageName.slice(0, slash),
    repo: slash < 0 ? packageName : packageName.slice(slash + 1),
    description: copy.description,
    stars: 0,
    url: '',
    updatedAt: '',
    topics: [],
  }
}

function recommendedMarketplaceListing(item: RecommendedPlugin): MarketplaceListing {
  const slash = item.packageName.indexOf('/')
  return {
    spec: `npm:${item.packageName}`,
    source: 'recommended',
    packageName: item.packageName,
    title: item.title,
    owner: slash < 0 ? '' : item.packageName.slice(0, slash),
    repo: slash < 0 ? item.packageName : item.packageName.slice(slash + 1),
    description: item.description,
    stars: 0,
    url: item.homepage,
    updatedAt: '',
    topics: [],
  }
}

function matchesLocalQuery(item: MarketplaceListing, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  if ([item.packageName, item.title, item.description].some((field) => typeof field === 'string' && field.toLocaleLowerCase().includes(needle))) return true
  const npm = parseNpmSpec(query)
  return Boolean(npm && !npm.version && item.packageName === npm.name)
}

async function listLocalMarketplaceListings(profileDir: string): Promise<MarketplaceListing[]> {
  let names: string[] = []
  try {
    const composition = JSON.parse(await readFile(join(profileDir, 'composition.json'), 'utf8')) as { nativeDependencies?: unknown }
    if (!composition.nativeDependencies || typeof composition.nativeDependencies !== 'object' || Array.isArray(composition.nativeDependencies)) {
      return []
    }
    names = Object.keys(composition.nativeDependencies)
  } catch {
    return []
  }
  const catalog = await readPreparedCatalog(profileDir)
  const listings: MarketplaceListing[] = []
  for (const name of names) {
    if (CORE_PLUGIN_BUNDLE_NAMES.has(name) || RETIRED_PLUGIN_PACKAGES.has(name)) continue
    const artifactDir = resolveProfileArtifactDir(profileDir, name)
    if (!artifactDir) continue
    try {
      const manifest = JSON.parse(await readFile(join(artifactDir, 'package.json'), 'utf8')) as { name?: unknown }
      if (!isDshBundle(manifest) || manifest.name !== name) continue
      listings.push(localMarketplaceListing(name, artifactDir, catalogCopy(name, catalog)))
    } catch {
      continue
    }
  }
  return listings
}






export async function handlePluginsRpc(
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  options: {
    paths: PluginPaths
    fetch?: typeof fetch
    io?: PersistIo
    reloadProfile?: () => Promise<boolean>
    readToolState?: () => Promise<NativeToolState | undefined>
    /** Official manager, read-only. Absent when the host has no plugin service. */
    manager?: CatalogManager
  },
): Promise<PluginsRpcResult> {
  if (signal.aborted) return cancelled()
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  try {
    if (endpoint === PLUGIN_CATALOG_ENDPOINT) {
      const value: PluginCatalog = await readPluginCatalog(options.paths.profileDir, options.manager)
      return { ok: true, value }
    }
    if (endpoint === 'marketplace.search') {
      const query = typeof body.query === 'string' ? body.query : ''
      const locals = await listLocalMarketplaceListings(options.paths.profileDir)
      const localNames = new Set(locals.map((item) => item.packageName))
      const recommended = RECOMMENDED_PLUGINS
        .filter((item) => !localNames.has(item.packageName))
        .map(recommendedMarketplaceListing)
      const matchedLocal = [...recommended, ...locals].filter((item) => matchesLocalQuery(item, query))
      const npm = parseNpmSpec(query)
      const spec = parseGitHubSpec(query)
      if (!query.trim()) return { ok: true, value: { listings: matchedLocal } }
      if (!spec && !npm?.version && matchedLocal.length > 0) {
        return { ok: true, value: { listings: matchedLocal } }
      }
      if (npm) return { ok: true, value: { listings: [npmMarketplaceListing(npm)] } }
      if (sanitizeMarketplaceQuery(query) === undefined) return bad('搜索词含有不支持的字符')
      const ioFetch = options.fetch ?? fetch
      const response = await ioFetch(marketplaceSearchUrl(query), { headers: githubHeaders(), signal })
      if (signal.aborted) return cancelled()
      if (!response.ok) return fail('network', response.status === 403 ? 'GitHub 搜索次数过多，请稍后再试' : `搜索失败（HTTP ${response.status}）`)
      const listings = parseMarketplaceSearch(await response.json())
        .filter((item) => !HIDDEN_DISCOVERY_REPOS.has(`${item.owner}/${item.repo}`.toLocaleLowerCase()))
      if (spec && !listings.some((item) => item.spec === spec.spec)) {
        listings.unshift({
          spec: spec.spec, owner: spec.owner, repo: spec.repo, description: '按仓库名直接安装',
          stars: 0, url: `https://github.com/${spec.owner}/${spec.repo}`, updatedAt: '', topics: [],
        })
      }
      if (!matchedLocal.length) return { ok: true, value: { listings } }
      const seen = new Set(matchedLocal.map((item) => item.spec))
      return { ok: true, value: { listings: [...matchedLocal, ...listings.filter((item) => !seen.has(item.spec))] } }
    }
    return bad('不支持的插件操作')
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return cancelled()
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('GitHub') || message.includes('fetch') || message.includes('network')) {
      return fail('network', '网络请求失败，请稍后重试。', { cause: message })
    }
    return fail('internal', '未能完成插件操作，请重试。', { cause: message })
  }
}

export function apply(ctx: Context): void {
  const host = ctx as RpcHost
  const paths = resolvePluginPaths(process.env, process.argv, undefined, import.meta.url)
  const reloadProfile = async () => {
    if (!host.get('hmr')) return false
    const profile = host.get('profileContext') as import('@deepseek-ai/dsh-app-boot').ProfileContext | undefined
    if (!profile) return false
    const { readProfilePatches, reconcileProfilePatches } = await import('@deepseek-ai/dsh-app-boot')
    await reconcileProfilePatches(host.root, readProfilePatches('dsh-editor', profile), 'dsh-editor')
    return true
  }
  let queue = Promise.resolve()
  const serialize = <T>(work: () => Promise<T>) => {
    const run = queue.then(work, work)
    queue = run.then(() => undefined, () => undefined)
    return run
  }
  ctx.effect(() => registerHostRpc(host, PLUGINS_RPC_CHANNEL, (endpoint, payload, signal) => (
    serialize(() => handlePluginsRpc(endpoint, payload, signal, {
      paths,
      reloadProfile,
      manager: {
        listBundles: async () => {
          const manager = host.get('pluginManager') as NativeToolManager | undefined
          return manager?.listBundles ? manager.listBundles() : undefined
        },
        listPlugins: async () => {
          const manager = host.get('pluginManager') as NativeToolManager | undefined
          return manager?.listPlugins ? manager.listPlugins() : undefined
        },
      },
      readToolState: async () => {
        const manager = host.get('pluginManager') as NativeToolManager | undefined
        return manager?.listBundles ? readNativeToolState(manager) : undefined
      },
    }))
  )))
  ctx.effect(() => {
    try {
      const manager = host.get('pluginManager') as Parameters<typeof protectCorePluginManager>[0] | undefined
      if (manager && typeof manager.listPlugins === 'function' && typeof manager.setPluginEnabled === 'function') {
        const adapter = typeof manager.listBundles === 'function'
          ? adaptNativeToolProjection(manager as NativeToolManager, { paths, reloadProfile })
          : undefined
        const unprotect = protectCorePluginManager(manager)
        adapter?.ready.catch(error => ctx.logger.warn('Native tool projection startup synchronization failed: %s', String(error)))
        return () => { unprotect(); adapter?.dispose() }
      }
    } catch { /* Official manager is the host service; tests may omit it. */ }
    return () => {}
  })
}
