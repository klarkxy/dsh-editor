import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from 'dsh-manuscript/host-api'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import {
  PLUGINS_RPC_CHANNEL,
  type PluginCard,
  type PluginFiberPhase,
  type PluginInventory,
  type PluginActionReceipt,
  type PluginsRpcResult,
} from './contracts.ts'
import {
  catalogFor, classifyEntry, isProtectedEntry, isProtectedPackage, isSafeEntryId, isSafePackageName,
  loadRuntimeCatalog, packageNameOf, type RuntimeCatalog,
} from './core.ts'
import { githubHeaders, marketplaceSearchUrl, parseGitHubSpec, parseMarketplaceSearch, sanitizeMarketplaceQuery } from './github.ts'
import { inspectPluginPackage } from './inspect.ts'
import { defaultExtract, defaultLink, defaultNpmInstall, installGitHubPlugin, stageGitHubPlugin, uninstallUserPlugin } from './install.ts'
import { canReplaceHomePatch, emptyPluginState, parsePluginState, renderOverridePatch, type PluginState } from './overlay.ts'
import { resolvePluginPaths, type PluginPaths } from './paths.ts'

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

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const stage = `${path}.${process.pid}.tmp`
  await writeFile(stage, `${JSON.stringify(value, null, 2)}\n`)
  await rename(stage, path)
}

export async function persistPluginState(paths: PluginPaths, state: PluginState): Promise<boolean> {
  await writeJsonAtomic(paths.stateFile, state)
  let existing: string | undefined
  try { existing = await readFile(paths.patchFile, 'utf8') } catch { existing = undefined }
  if (!canReplaceHomePatch(existing)) return false
  const stage = `${paths.patchFile}.${process.pid}.tmp`
  await writeFile(stage, renderOverridePatch(state.overrides))
  await rename(stage, paths.patchFile)
  return true
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

export async function handlePluginsRpc(
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  options: { loader: LoaderFace; paths: PluginPaths; fetch?: typeof fetch; catalog?: RuntimeCatalog },
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
      if (!isSafeEntryId(entryId) || typeof body.enabled !== 'boolean') return bad('请指定要开关的插件')
      const match = [...options.loader.entries()].find((entry) => entry.id === entryId)
      if (!match) return fail('not-found', '未找到该插件')
      if (isProtectedEntry(entryId, match.options.name, await catalogForCall())) return forbidden('系统核心插件不能关闭')
      const state = await readPluginState(options.paths)
      state.overrides = { ...state.overrides, [entryId]: body.enabled }
      const persisted = await persistPluginState(options.paths, state)
      try { await options.loader.update(entryId, { disabled: !body.enabled }) } catch { /* persist still applies on restart */ }
      return { ok: true, value: { restartRequired: !persisted } satisfies PluginActionReceipt }
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
      const installed = await installGitHubPlugin(spec, options.paths, signal, {
        fetch: options.fetch ?? fetch,
        extract: defaultExtract,
        npmInstall: defaultNpmInstall,
        link: defaultLink,
      }, await catalogForCall())
      const state = await readPluginState(options.paths)
      state.installed = [...state.installed.filter((item) => item.name !== installed.name), installed]
      await persistPluginState(options.paths, state)
      return { ok: true, value: { ...installed, restartRequired: true } }
    }
    if (endpoint === 'marketplace.uninstall') {
      const packageName = typeof body.name === 'string' ? body.name : ''
      if (!isSafePackageName(packageName)) return bad('请指定要卸载的插件')
      if (isProtectedPackage(packageName, (await catalogForCall()).bundles)) return forbidden('系统核心插件不能卸载')
      const state = await readPluginState(options.paths)
      if (!state.installed.some((item) => item.name === packageName)) return fail('not-found', '该插件不是从市场安装的，不能从这里卸载')
      const running = [...options.loader.entries()].filter((entry) => packageNameOf(entry.options.name) === packageName)
      await uninstallUserPlugin(packageName, options.paths)
      for (const entry of running) {
        try { await options.loader.remove?.(entry.id) } catch { /* 卸下文件后仍需重启才能卸掉 Client */ }
      }
      state.installed = state.installed.filter((item) => item.name !== packageName)
      await persistPluginState(options.paths, state)
      return { ok: true, value: { restartRequired: true } satisfies PluginActionReceipt }
    }
    return bad('不支持的插件操作')
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return cancelled()
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('GitHub') || message.includes('fetch') || message.includes('network')) {
      return fail('network', message)
    }
    return fail('internal', message || '插件操作失败，请重试')
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
