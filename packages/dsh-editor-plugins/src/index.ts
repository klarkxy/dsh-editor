import { syncPresetDeclarations } from './preset-config.ts'
import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from 'dsh-manuscript/host-api'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  PLUGINS_RPC_CHANNEL,
  type MarketplaceListing,
  type PluginActionReceipt,
  type PluginsRpcResult,
} from './contracts.ts'
import { CORE_PLUGIN_BUNDLE_NAMES, protectCorePluginManager } from './core-lock.ts'
import { isSafePackageName, readPreparedCatalog } from './core.ts'
import { githubHeaders, marketplaceSearchUrl, parseGitHubSpec, parseMarketplaceSearch, sanitizeMarketplaceQuery } from './github.ts'
import { npmMarketplaceListing, parseNpmSpec } from './npm.ts'
import { emptyPluginState, isOwnedManagedPatch, parsePluginState, renderOverridePatch, withoutHostLockedOverrides, type PluginState } from './overlay.ts'
import { resolvePluginPaths, type PluginPaths } from './paths.ts'
import {
  CORE_WRITING_PRESET_ID,
  deployAppOwnedPreset,
  listWritingPresets,
  readCompositionPresets,
  removeAppOwnedPreset,
} from './writing-presets.ts'
import {
  defaultPersistIo,
  isEnoent,
  PluginPersistBlockedError,
  PluginPersistError,
  replaceFileAtomic,
  runQueuedSorted,
  writeJsonAtomic,
  type PersistIo,
} from './persist.ts'

export const name = 'dsh-editor-plugins'
export const inject = ['connection', 'loader', 'webServer'] as const

type LoaderFace = {
  entries(): Iterable<unknown>
  update?(id: string, options: { disabled?: boolean | null }): Promise<unknown> | unknown
}

type RpcHost = Context & HostRpcContext & {
  loader: LoaderFace
}

function fail(code: 'bad-request' | 'cancelled' | 'forbidden' | 'not-found' | 'network' | 'internal', message: string, details: Record<string, unknown> = {}): PluginsRpcResult {
  return { ok: false, error: { code, message, details } }
}

const bad = (message: string, details: Record<string, unknown> = {}) => fail('bad-request', message, details)
const forbidden = (message: string) => fail('forbidden', message)
const cancelled = () => fail('cancelled', '请求已取消')

const RETIRED_DISTRIBUTION_BUNDLES = new Set([
  'dsh-web-search-tavily',
  '@klarkxy/dsh-ai-services',
  '@klarkxy/dsh-model-center',
  '@klarkxy/dsh-memory',
  '@klarkxy/dsh-self-improvement',
  '@klarkxy/dsh-fusion',
])

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
    if (CORE_PLUGIN_BUNDLE_NAMES.has(name) || RETIRED_DISTRIBUTION_BUNDLES.has(name)) continue
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

export async function readPluginState(paths: PluginPaths): Promise<PluginState> {
  try {
    const parsed = parsePluginState(JSON.parse(await readFile(paths.stateFile, 'utf8')))
    return parsed ?? emptyPluginState()
  } catch {
    return emptyPluginState()
  }
}

async function readOptionalText(path: string, io: PersistIo): Promise<string | undefined> {
  try {
    return await io.readFile(path, 'utf8')
  } catch (error) {
    if (isEnoent(error)) return undefined
    throw error
  }
}

async function restoreText(path: string, previous: string | undefined, io: PersistIo): Promise<void> {
  if (previous === undefined) {
    await io.rm(path, { force: true })
    return
  }
  await replaceFileAtomic(path, previous, io)
}

async function validatePluginPersistence(paths: PluginPaths, io: PersistIo): Promise<void> {
  let previousPatch: string | undefined
  try {
    previousPatch = await readOptionalText(paths.patchFile, io)
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    throw new PluginPersistBlockedError('unreadable-patch', cause)
  }
  if (!isOwnedManagedPatch(previousPatch)) throw new PluginPersistBlockedError('unmanaged-patch')
}

export async function persistPluginState(paths: PluginPaths, state: PluginState, io: PersistIo = defaultPersistIo): Promise<void> {
  state.overrides = withoutHostLockedOverrides(state.overrides)
  await runQueuedSorted([paths.home, paths.stateFile, paths.patchFile], async () => {
    await validatePluginPersistence(paths, io)
    const previousState = await readOptionalText(paths.stateFile, io)
    await writeJsonAtomic(paths.stateFile, state, io)
    try {
      await replaceFileAtomic(paths.patchFile, renderOverridePatch(state.overrides), io)
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      try {
        await restoreText(paths.stateFile, previousState, io)
      } catch (recovery) {
        throw new PluginPersistError('未能保存插件开关，请重试。', {
          cause,
          recovery: 'failed',
          recoveryCause: recovery instanceof Error ? recovery.message : String(recovery),
        })
      }
      throw new PluginPersistError('未能保存插件开关，请重试。', { cause, recovery: 'restored' })
    }
  })
}

function persistFailed(error: unknown): PluginsRpcResult {
  if (error instanceof PluginPersistBlockedError) {
    return fail('forbidden', error.message, { reason: error.reason, ...(error.detail ? { cause: error.detail } : {}) })
  }
  if (error instanceof PluginPersistError) {
    return fail('internal', error.message, error.details)
  }
  const cause = error instanceof Error ? error.message : String(error)
  return fail('internal', '未能保存插件开关，请重试。', { cause })
}

export async function handlePluginsRpc(
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  options: {
    loader: LoaderFace
    paths: PluginPaths
    fetch?: typeof fetch
    io?: PersistIo
    reloadProfile?: () => Promise<boolean>
  },
): Promise<PluginsRpcResult> {
  if (signal.aborted) return cancelled()
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  try {
    if (endpoint === 'marketplace.search') {
      const query = typeof body.query === 'string' ? body.query : ''
      const locals = await listLocalMarketplaceListings(options.paths.profileDir)
      const matchedLocal = locals.filter((item) => matchesLocalQuery(item, query))
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
    if (endpoint === 'presets.list') {
      const state = await readPluginState(options.paths)
      return { ok: true, value: await listWritingPresets(options.paths, state) }
    }
    if (endpoint === 'presets.setEnabled') {
      const id = typeof body.id === 'string' ? body.id : ''
      if (!id || typeof body.enabled !== 'boolean') return bad('请指定要开关的写作模式')
      if (id === CORE_WRITING_PRESET_ID) return forbidden('通用写作是核心写作模式，不能关闭')
      const declared = await readCompositionPresets(options.paths.profileDir)
      const row = declared.find((item) => item.id === id)
      if (!row) return fail('not-found', '未找到该写作模式')
      const source = join(options.paths.profileDir, 'node_modules', row.packageName, row.path)
      try {
        if (body.enabled) await deployAppOwnedPreset(options.paths.home, id, source)
        else await removeAppOwnedPreset(options.paths.home, id)
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error)
        return fail('internal', '未能更新写作模式，请重试。', { cause })
      }
      const state = await readPluginState(options.paths)
      state.presets = { ...state.presets, [id]: body.enabled }
      try {
        await persistPluginState(options.paths, state, options.io ?? defaultPersistIo)
      } catch (error) {
        try {
          if (body.enabled) await removeAppOwnedPreset(options.paths.home, id)
          else await deployAppOwnedPreset(options.paths.home, id, source)
        } catch { /* best-effort rollback; the next boot re-applies the saved state */ }
        return persistFailed(error)
      }
      await syncPresetDeclarations(options.paths.home, options.paths.profileDir)
      const applied = await options.reloadProfile?.().catch(() => false)
      return { ok: true, value: { restartRequired: applied !== true } satisfies PluginActionReceipt }
    }
    return bad('不支持的插件操作')
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return cancelled()
    if (error instanceof PluginPersistBlockedError || error instanceof PluginPersistError) return persistFailed(error)
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
  let queue = Promise.resolve()
  const serialize = <T>(work: () => Promise<T>) => {
    const run = queue.then(work, work)
    queue = run.then(() => undefined, () => undefined)
    return run
  }
  ctx.effect(() => registerHostRpc(host, PLUGINS_RPC_CHANNEL, (endpoint, payload, signal) => (
    serialize(() => handlePluginsRpc(endpoint, payload, signal, {
      loader: host.loader,
      paths,
      reloadProfile: async () => {
        if (!host.get('hmr')) return false
        const profile = host.get('profileContext') as import('@deepseek-ai/dsh-app-boot').ProfileContext | undefined
        if (!profile) return false
        const { readProfilePatches, reconcileProfilePatches } = await import('@deepseek-ai/dsh-app-boot')
        await reconcileProfilePatches(host.root, readProfilePatches('dsh-editor', profile), 'dsh-editor')
        return true
      },
    }))
  )))
  ctx.effect(() => {
    try {
      const manager = host.get('pluginManager') as Parameters<typeof protectCorePluginManager>[0] | undefined
      if (manager && typeof manager.listPlugins === 'function' && typeof manager.setPluginEnabled === 'function') {
        return protectCorePluginManager(manager)
      }
    } catch { /* Official manager is the host service; tests may omit it. */ }
    return () => {}
  })
}
