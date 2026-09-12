import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from 'dsh-manuscript/host-api'
import { readFile, rm } from 'node:fs/promises'
import {
  PLUGINS_RPC_CHANNEL,
  type PluginCard,
  type PluginFiberPhase,
  type PluginInventory,
  type PluginActionReceipt,
  type PluginsRpcResult,
} from './contracts.ts'
import {
  catalogFor, catalogLookupId, classifyEntry, isProtectedEntry, isProtectedPackage, isSafeEntryId, isSafePackageName,
  loadRuntimeCatalog, packageNameOf, type RuntimeCatalog,
} from './core.ts'
import { githubHeaders, marketplaceSearchUrl, parseGitHubSpec, parseMarketplaceSearch, sanitizeMarketplaceQuery } from './github.ts'
import { inspectPluginPackage } from './inspect.ts'
import { defaultExtract, defaultLink, defaultNpmInstall, installGitHubPlugin, stageGitHubPlugin, uninstallUserPlugin } from './install.ts'
import { emptyPluginState, isOwnedManagedPatch, parsePluginState, renderOverridePatch, type PluginState } from './overlay.ts'
import { resolvePluginPaths, type PluginPaths } from './paths.ts'
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

const FIBER_PHASE: Record<number, PluginFiberPhase> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  5: 'unloading',
}

type LoaderEntry = {
  id: string
  disabled: boolean
  options: { name: string; group?: boolean | null }
  fiber?: { state: number }
}

type LoaderFace = {
  entries(): Iterable<LoaderEntry>
  update(id: string, options: { disabled?: boolean | null }): Promise<unknown> | unknown
  remove?(id: string): Promise<unknown> | unknown
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

function fiberPhaseOf(entry: LoaderEntry): PluginFiberPhase {
  if (entry.fiber === undefined) return null
  return FIBER_PHASE[entry.fiber.state] ?? null
}

export function inventoryFromLoader(loader: LoaderFace, state: PluginState, catalog: RuntimeCatalog): PluginInventory {
  const installed = new Map(state.installed.map((item) => [item.name, item]))
  const inventory: PluginInventory = { core: [], optional: [], community: [] }
  for (const entry of loader.entries()) {
    if (entry.options.group) continue
    const moduleName = entry.options.name
    const group = classifyEntry(entry.id, moduleName, catalog)
    if (group === 'hidden') continue
    const info = catalogFor(entry.id, moduleName, catalog)
    const packageName = packageNameOf(moduleName)
    const extra = installed.get(packageName)
    const card: PluginCard = {
      entryId: entry.id,
      moduleName,
      packageName,
      title: info.title,
      description: info.description,
      group,
      enabled: !entry.disabled,
      locked: isProtectedEntry(entry.id, moduleName, catalog),
      fiberPhase: fiberPhaseOf(entry),
      origin: extra ? 'installed' : 'bundled',
      spec: extra?.spec,
      version: extra?.version,
    }
    inventory[group].push(card)
  }
  return inventory
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

async function setEntriesEnabled(
  entryIds: string[],
  enabled: boolean,
  options: { loader: LoaderFace; paths: PluginPaths; catalog?: RuntimeCatalog; io?: PersistIo },
  catalogForCall: () => Promise<RuntimeCatalog>,
): Promise<PluginsRpcResult> {
  if (entryIds.length === 0 || typeof enabled !== 'boolean') return bad('请指定要开关的插件')
  if (new Set(entryIds).size !== entryIds.length) return bad('请指定要开关的插件')
  const running = [...options.loader.entries()]
  const catalog = await catalogForCall()
  const matches: Array<{ entryId: string; patchId: string }> = []
  for (const entryId of entryIds) {
    const patchId = entryId.startsWith('include:') ? catalogLookupId(entryId) : entryId
    if (!isSafeEntryId(patchId)) return bad('请指定要开关的插件')
    const match = running.find((entry) => entry.id === entryId)
    if (!match) return fail('not-found', '未找到该插件')
    if (isProtectedEntry(entryId, match.options.name, catalog)) return forbidden('系统核心插件不能关闭')
    matches.push({ entryId, patchId })
  }
  const state = await readPluginState(options.paths)
  const overrides = { ...state.overrides }
  for (const match of matches) overrides[match.patchId] = enabled
  state.overrides = overrides
  try {
    await persistPluginState(options.paths, state, options.io ?? defaultPersistIo)
  } catch (error) {
    return persistFailed(error)
  }
  let appliedCount = 0
  for (const match of matches) {
    try {
      await options.loader.update(match.entryId, { disabled: !enabled })
      const updated = [...options.loader.entries()].find((entry) => entry.id === match.entryId)
      if (updated && updated.disabled === !enabled) appliedCount++
    } catch { /* The saved override will apply on restart. */ }
  }
  return { ok: true, value: { restartRequired: appliedCount !== matches.length } satisfies PluginActionReceipt }
}

export async function handlePluginsRpc(
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  options: { loader: LoaderFace; paths: PluginPaths; fetch?: typeof fetch; catalog?: RuntimeCatalog; io?: PersistIo },
): Promise<PluginsRpcResult> {
  if (signal.aborted) return cancelled()
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  const catalogForCall = async (): Promise<RuntimeCatalog> => {
    if (options.catalog) return options.catalog
    const names = [...options.loader.entries()].map((entry) => packageNameOf(entry.options.name))
    return loadRuntimeCatalog(options.paths.profileDir, names)
  }
  try {
    if (endpoint === 'inventory.list') {
      const state = await readPluginState(options.paths)
      return { ok: true, value: inventoryFromLoader(options.loader, state, await catalogForCall()) }
    }
    if (endpoint === 'entry.setEnabled') {
      const entryId = typeof body.entryId === 'string' ? body.entryId : ''
      if (!entryId || typeof body.enabled !== 'boolean') return bad('请指定要开关的插件')
      return setEntriesEnabled([entryId], body.enabled, options, catalogForCall)
    }
    if (endpoint === 'entries.setEnabled') {
      const entryIds = Array.isArray(body.entryIds) && body.entryIds.every((id) => typeof id === 'string')
        ? body.entryIds as string[]
        : null
      if (!entryIds || typeof body.enabled !== 'boolean') return bad('请指定要开关的插件')
      return setEntriesEnabled(entryIds, body.enabled, options, catalogForCall)
    }
    if (endpoint === 'marketplace.search') {
      const query = typeof body.query === 'string' ? body.query : ''
      if (sanitizeMarketplaceQuery(query) === undefined) return bad('搜索词含有不支持的字符')
      const spec = parseGitHubSpec(query)
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
      return { ok: true, value: { listings } }
    }
    if (endpoint === 'marketplace.inspect') {
      const spec = typeof body.spec === 'string' ? parseGitHubSpec(body.spec) : undefined
      if (!spec) return bad('请输入 GitHub 仓库，例如 owner/repo')
      const staged = await stageGitHubPlugin(spec, options.paths, signal, {
        fetch: options.fetch ?? fetch,
        extract: defaultExtract,
      })
      try {
        const inspect = await inspectPluginPackage(staged.unpacked, await catalogForCall())
        return { ok: true, value: inspect }
      } finally {
        await rm(staged.staging, { recursive: true, force: true })
      }
    }
    if (endpoint === 'marketplace.install') {
      const spec = typeof body.spec === 'string' ? parseGitHubSpec(body.spec) : undefined
      if (!spec) return bad('请输入 GitHub 仓库，例如 owner/repo')
      await validatePluginPersistence(options.paths, options.io ?? defaultPersistIo)
      const installed = await installGitHubPlugin(spec, options.paths, signal, {
        fetch: options.fetch ?? fetch,
        extract: defaultExtract,
        npmInstall: defaultNpmInstall,
        link: defaultLink,
      }, await catalogForCall())
      const state = await readPluginState(options.paths)
      state.installed = [...state.installed.filter((item) => item.name !== installed.name), installed]
      await persistPluginState(options.paths, state, options.io ?? defaultPersistIo)
      return { ok: true, value: { ...installed, restartRequired: true } }
    }
    if (endpoint === 'marketplace.uninstall') {
      const packageName = typeof body.name === 'string' ? body.name : ''
      if (!isSafePackageName(packageName)) return bad('请指定要卸载的插件')
      if (isProtectedPackage(packageName, (await catalogForCall()).bundles)) return forbidden('系统核心插件不能卸载')
      const state = await readPluginState(options.paths)
      if (!state.installed.some((item) => item.name === packageName)) return fail('not-found', '该插件不是从市场安装的，不能从这里卸载')
      await validatePluginPersistence(options.paths, options.io ?? defaultPersistIo)
      const running = [...options.loader.entries()].filter((entry) => packageNameOf(entry.options.name) === packageName)
      await uninstallUserPlugin(packageName, options.paths)
      for (const entry of running) {
        try { await options.loader.remove?.(entry.id) } catch { /* 卸下文件后仍需重启才能卸掉 Client */ }
      }
      state.installed = state.installed.filter((item) => item.name !== packageName)
      await persistPluginState(options.paths, state, options.io ?? defaultPersistIo)
      return { ok: true, value: { restartRequired: true } satisfies PluginActionReceipt }
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
    serialize(() => handlePluginsRpc(endpoint, payload, signal, { loader: host.loader, paths }))
  )))
}
