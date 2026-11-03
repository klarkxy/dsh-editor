/**
 * Framework-free store over the official @deepseek-ai/dsh-plugin-manager
 * service (the `pluginManager/*` RPC on the /api gateway). The official UI is
 * retired; the service stays the single authority for install/remove/enable.
 *
 * Guards everywhere: Cordis throws on uninjected service properties, so every
 * ctx touch goes through recordOf. Unknown bundle/plugin rows drop one entry,
 * never the whole list — same normalization contract as plugins-catalog.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { rpcCallerOf, changeReceipt, type ChangeReceipt } from '../model/plugins-catalog.ts'

export const PLUGIN_MANAGER_CHANNEL = '/api'
const LOG_CAP = 64 * 1024

/* ── Wire shapes (subset of @deepseek-ai/dsh-plugin-manager lib/types) ── */
export type ManagerRegistry = string | null
export type BundleRowInfo = { rowId: string; moduleName: string; entryId?: string; meta?: { title?: unknown; icon?: string } }
export type BundleInfo = {
  name: string
  official: boolean
  availability: 'installation' | 'profile' | 'missing'
  installTarget?: { spec: string; version: string }
  version?: string
  meta?: { title?: unknown; description?: unknown; icon?: string }
  description?: string
  enabled: boolean
  installed: boolean
  source?: string
  optional: boolean
  removable: boolean
  readOnlyReason?: string
  error?: unknown
  rows: BundleRowInfo[]
  overrides: string[]
}
export type PluginInfo = { id: string; patchId?: string; readOnlyReason?: string; [field: string]: unknown }
export type ManagementError = { code?: string; message?: string; diagnostic?: string; incompatible?: unknown[] }
export type ChangeResult = {
  changed: boolean
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  restartReason?: string
  stage?: string
  target?: string
  enabled?: boolean
  error?: ManagementError
  warnings?: string[]
  packageResult?: { exitCode: number; kind?: string; output?: string }
  bundle?: string
  version?: string
  pendingBuilds?: string[]
  approvedBuilds?: string[]
  registries?: ManagerRegistry[]
}
export type PluginSpecInspection =
  | { status: 'accepted'; kind: string; name?: string; version?: string; description?: string; bundle: boolean | null; registry: ManagerRegistry; host?: string }
  | { status: 'refused'; problem: string; reason: string; registries?: ManagerRegistry[] }
export type PluginInstallProgress = {
  requestId: string
  phase: 'installing' | 'cancelling' | 'applying'
  attempt?: { registry: ManagerRegistry; index: number; total: number }
}
export type VersionExemptions = { exemptions: Record<string, string[]>; warnings: string[] }
export type PluginRegistries = { registry: ManagerRegistry; fallbackRegistries: string[]; resolved: string | null }

type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { message?: string } }

/* ── Normalizers: drop the malformed row, keep the list. ── */
function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function boolOf(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeBundleInfo(value: unknown): BundleInfo | undefined {
  const row = recordOf(value)
  const name = textOf(row.name)
  const availability = row.availability
  if (!name || (availability !== 'installation' && availability !== 'profile' && availability !== 'missing')) return undefined
  const rows = Array.isArray(row.rows) ? row.rows.flatMap((item): BundleRowInfo[] => {
    const r = recordOf(item)
    const rowId = textOf(r.rowId)
    const moduleName = textOf(r.moduleName)
    return rowId && moduleName ? [{ rowId, moduleName, ...(textOf(r.entryId) ? { entryId: textOf(r.entryId) } : {}), ...(r.meta !== undefined ? { meta: r.meta as BundleRowInfo['meta'] } : {}) }] : []
  }) : []
  const target = recordOf(row.installTarget)
  return {
    name,
    official: boolOf(row.official),
    availability,
    ...(textOf(target.spec) && textOf(target.version) ? { installTarget: { spec: textOf(target.spec)!, version: textOf(target.version)! } } : {}),
    ...(textOf(row.version) ? { version: textOf(row.version) } : {}),
    ...(row.meta !== undefined ? { meta: row.meta as BundleInfo['meta'] } : {}),
    ...(textOf(row.description) ? { description: textOf(row.description) } : {}),
    enabled: boolOf(row.enabled),
    installed: boolOf(row.installed),
    ...(textOf(row.source) ? { source: textOf(row.source) } : {}),
    optional: boolOf(row.optional),
    removable: boolOf(row.removable),
    ...(textOf(row.readOnlyReason) ? { readOnlyReason: textOf(row.readOnlyReason) } : {}),
    ...(row.error !== undefined ? { error: row.error } : {}),
    rows,
    overrides: Array.isArray(row.overrides) ? row.overrides.filter((item): item is string => typeof item === 'string') : [],
  }
}

export function normalizePluginInfo(value: unknown): PluginInfo | undefined {
  const row = recordOf(value)
  const id = textOf(row.id)
  if (!id) return undefined
  return { ...row, id } as PluginInfo
}

function normalizeProgress(value: unknown): PluginInstallProgress | undefined {
  const row = recordOf(value)
  const requestId = textOf(row.requestId)
  const phase = row.phase
  if (!requestId || (phase !== 'installing' && phase !== 'cancelling' && phase !== 'applying')) return undefined
  const attempt = recordOf(row.attempt)
  return {
    requestId,
    phase,
    ...(typeof attempt.index === 'number' && typeof attempt.total === 'number'
      ? { attempt: { registry: attempt.registry === null || typeof attempt.registry === 'string' ? attempt.registry as ManagerRegistry : null, index: attempt.index, total: attempt.total } }
      : {}),
  }
}

/* ── Snapshot ── */
export type InstallPhase = 'idle' | 'starting' | 'running' | 'settled' | 'unknown' | 'cancelling'
export type InstallState = {
  phase: InstallPhase
  requestId?: string
  progress?: PluginInstallProgress
  /** pnpm output, capped at the last 64KB. */
  log: string
  result?: ChangeResult
  /** Transport-lost reply or host-side uncertainty. */
  failure?: { reason: string; pendingBuilds?: string[] }
}
export type PluginManagerSnapshot = {
  status: 'loading' | 'ready' | 'error'
  bundles: BundleInfo[]
  plugins: PluginInfo[]
  error?: string
  install: InstallState
}

const IDLE_INSTALL: InstallState = { phase: 'idle', log: '' }
const INITIAL: PluginManagerSnapshot = { status: 'loading', bundles: [], plugins: [], install: IDLE_INSTALL }

export type PluginManagerStore = {
  getSnapshot(): PluginManagerSnapshot
  subscribe(listener: () => void): () => void
  reload(): void
  setBundleEnabled(name: string, enabled: boolean): Promise<ChangeReceipt>
  setPluginEnabled(id: string, enabled: boolean): Promise<ChangeReceipt>
  inspect(spec: string, registry?: ManagerRegistry): Promise<RemoteResult<PluginSpecInspection>>
  install(spec: string, options?: { enabled?: boolean; approvedBuilds?: string[]; registry?: ManagerRegistry; saveExact?: boolean }): Promise<void>
  cancelInstall(): Promise<void>
  removeBundle(name: string): Promise<RemoteResult<ChangeResult>>
  registries(): Promise<RemoteResult<PluginRegistries>>
  listVersionExemptions(): Promise<RemoteResult<VersionExemptions>>
  setVersionExemption(packageVersion: string, runtimeVersion: string, enabled: boolean, acceptRisk?: boolean): Promise<RemoteResult<ChangeResult>>
  dispose(): void
}

function isRemoteResult<T>(value: unknown): value is RemoteResult<T> {
  const row = recordOf(value)
  return typeof row.ok === 'boolean'
}

export function createPluginManagerStore(ctx: unknown): PluginManagerStore {
  const rpc = rpcCallerOf(ctx)
  const remote = recordOf(recordOf(ctx).remote)
  const listeners = new Set<() => void>()
  let snapshot = INITIAL
  let disposed = false
  let reloadToken = 0
  /** The in-flight install request, for waitForInstall recovery. */
  let request: { requestId: string; replyLost: boolean; recovering: boolean } | undefined

  const call = <T>(endpoint: string, args: Record<string, unknown>): Promise<RemoteResult<T>> => {
    if (!rpc) return Promise.resolve({ ok: false, error: { message: 'Plugin manager RPC unavailable' } })
    return Promise.resolve(rpc(PLUGIN_MANAGER_CHANNEL, `pluginManager/${endpoint}`, { args }) as Promise<unknown>).then(
      (value): RemoteResult<T> => {
        /* The gateway returns {ok,value} for managed methods; a bare value is
           accepted as success so unit tests and older hosts still work. */
        if (isRemoteResult<T>(value)) return value
        return { ok: true, value: value as T }
      },
      (error): RemoteResult<T> => ({ ok: false, error: { message: error instanceof Error ? error.message : String(error) } }),
    )
  }

  const emit = () => { for (const listener of listeners) listener() }
  const patch = (partial: Partial<PluginManagerSnapshot>) => {
    if (disposed) return
    snapshot = { ...snapshot, ...partial }
    emit()
  }
  const patchInstall = (partial: Partial<InstallState>) => {
    if (disposed) return
    snapshot = { ...snapshot, install: { ...snapshot.install, ...partial } }
    emit()
  }

  const reload = () => {
    if (disposed) return
    const token = ++reloadToken
    void (async () => {
      const [bundles, plugins] = await Promise.all([
        call<unknown[]>('listBundles', {}),
        call<unknown[]>('listPlugins', {}),
      ])
      if (disposed || token !== reloadToken) return
      if (!bundles.ok) { patch({ status: 'error', error: bundles.error.message ?? 'listBundles failed' }); return }
      const items = (Array.isArray(bundles.value) ? bundles.value : []).flatMap((item): BundleInfo[] => {
        const bundle = normalizeBundleInfo(item)
        return bundle ? [bundle] : []
      })
      const entries = plugins.ok && Array.isArray(plugins.value)
        ? plugins.value.flatMap((item): PluginInfo[] => { const row = normalizePluginInfo(item); return row ? [row] : [] })
        : []
      patch({ status: 'ready', bundles: items, plugins: entries, error: undefined })
    })()
  }

  /* ── Install lifecycle, mirroring the official controller's settle/reconcile. ── */
  const settleInstall = (result: ChangeResult) => {
    request = undefined
    const row = recordOf(result)
    const normalized: ChangeResult = {
      changed: boolOf(row.changed),
      application: (row.application === 'applied' || row.application === 'restart-required' || row.application === 'overridden'
        || row.application === 'failed' || row.application === 'cancelled') ? row.application : 'failed',
      ...(row.restartReason !== undefined ? { restartReason: row.restartReason as string } : {}),
      ...(row.stage !== undefined ? { stage: row.stage as string } : {}),
      ...(row.target !== undefined ? { target: row.target as string } : {}),
      ...(row.enabled !== undefined ? { enabled: row.enabled as boolean } : {}),
      ...(row.error !== undefined ? { error: row.error as ManagementError } : {}),
      ...(row.warnings !== undefined ? { warnings: row.warnings as string[] } : {}),
      ...(row.packageResult !== undefined ? { packageResult: row.packageResult as ChangeResult['packageResult'] } : {}),
      ...(row.bundle !== undefined ? { bundle: row.bundle as string } : {}),
      ...(row.version !== undefined ? { version: row.version as string } : {}),
      ...(row.pendingBuilds !== undefined ? { pendingBuilds: row.pendingBuilds as string[] } : {}),
      ...(row.approvedBuilds !== undefined ? { approvedBuilds: row.approvedBuilds as string[] } : {}),
      ...(row.registries !== undefined ? { registries: row.registries as ManagerRegistry[] } : {}),
    }
    const pendingBuilds = Array.isArray(normalized.pendingBuilds) ? normalized.pendingBuilds : undefined
    patchInstall({
      phase: 'settled',
      requestId: undefined,
      progress: undefined,
      result: normalized,
      failure: normalized.application === 'failed'
        ? { reason: textOf(normalized.error?.diagnostic) ?? textOf(normalized.error?.message) ?? 'install failed', ...(pendingBuilds ? { pendingBuilds } : {}) }
        : normalized.application === 'cancelled'
          ? { reason: 'cancelled' }
          : undefined,
    })
    reload()
  }

  const installUncertain = (reason: string) => {
    patchInstall({ phase: 'unknown', failure: { reason } })
  }

  /* A recovery call shares the Host's active result; null means explicitly unknown. */
  const reconcileInstall = async () => {
    if (!request || !request.replyLost || request.recovering) return
    request.recovering = true
    const result = await call<ChangeResult | null>('waitForInstall', { requestId: request.requestId })
    if (disposed || !request) return
    request.recovering = false
    if (!result.ok) { installUncertain(result.error.message ?? 'waitForInstall failed'); return }
    if (result.value !== null) { settleInstall(result.value); return }
    request = undefined
    patchInstall({ phase: 'unknown', failure: undefined })
    reload()
  }

  const install = async (spec: string, options: { enabled?: boolean; approvedBuilds?: string[]; registry?: ManagerRegistry; saveExact?: boolean } = {}) => {
    const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const mine = { requestId, replyLost: false, recovering: false }
    request = mine
    patchInstall({ phase: 'starting', requestId, progress: undefined, log: '', result: undefined, failure: undefined })
    const result = await call<ChangeResult>('installBundle', {
      spec,
      options: {
        enabled: options.enabled ?? false,
        requestId,
        ...(options.registry !== undefined ? { registry: options.registry } : {}),
        ...(options.saveExact !== undefined ? { saveExact: options.saveExact } : {}),
        ...(options.approvedBuilds !== undefined ? { approvedBuilds: [...options.approvedBuilds] } : {}),
      },
    })
    if (disposed || request !== mine) return
    if (!result.ok) {
      mine.replyLost = true
      installUncertain(result.error.message ?? 'installBundle failed')
      void reconcileInstall()
      return
    }
    settleInstall(result.value)
  }

  /* ── Events: reload on change, track progress/log for our request. ── */
  const disposers: Array<() => void> = []
  const on = (event: string, listener: (value: unknown) => void) => {
    const $on = remote.$on
    if (typeof $on === 'function') {
      try {
        const off = ($on as (e: string, l: unknown) => unknown).call(remote, event, listener)
        if (typeof off === 'function') disposers.push(off as () => void)
        return
      } catch { /* host may not forward this event */ }
    }
    const ctxOn = recordOf(ctx).on
    if (typeof ctxOn === 'function') {
      try {
        const off = (ctxOn as (e: string, l: unknown) => unknown).call(ctx, event, listener)
        if (typeof off === 'function') disposers.push(off as () => void)
      } catch { /* ignore */ }
    }
  }
  on('plugin-manager/changed', () => reload())
  on('plugin-manager/install-state', (value) => {
    const progress = normalizeProgress(value)
    if (!progress || progress.requestId !== snapshot.install.requestId) return
    patchInstall({ phase: progress.phase === 'cancelling' ? 'cancelling' : 'running', progress })
  })
  on('plugin-manager/install-log', (value) => {
    const row = recordOf(value)
    if (row.requestId !== undefined && row.requestId !== snapshot.install.requestId) return
    const text = typeof row.text === 'string' ? row.text : ''
    if (!text) return
    const log = (snapshot.install.log + text).slice(-LOG_CAP)
    patchInstall({ log, ...(snapshot.install.phase === 'starting' ? { phase: 'running' } : {}) })
  })
  on('connection/reset', () => { reload(); void reconcileInstall() })
  on('plugin-manager/changed', () => { if (snapshot.install.phase === 'unknown') void reconcileInstall() })

  reload()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    reload,
    async setBundleEnabled(name, enabled) {
      const result = await call<unknown>('setBundleEnabled', { name, enabled })
      if (!result.ok) return { message: result.error.message }
      reload()
      return changeReceipt(result.value)
    },
    async setPluginEnabled(id, enabled) {
      const result = await call<unknown>('setPluginEnabled', { id, enabled })
      if (!result.ok) return { message: result.error.message }
      reload()
      return changeReceipt(result.value)
    },
    inspect: (spec, registry) => call<PluginSpecInspection>('inspect', {
      spec,
      ...(registry !== undefined ? { options: { registry } } : {}),
    }),
    install,
    async cancelInstall() {
      const requestId = snapshot.install.requestId
      if (!requestId) return
      patchInstall({ phase: 'cancelling' })
      await call('cancelInstall', { requestId })
      /* Settlement still arrives via the install result or waitForInstall. */
    },
    removeBundle: (name) => call<ChangeResult>('removeBundle', { name }).then((result) => { if (result.ok) reload(); return result }),
    registries: () => call<PluginRegistries>('registries', {}),
    listVersionExemptions: () => call<VersionExemptions>('listVersionExemptions', {}),
    setVersionExemption: (packageVersion, runtimeVersion, enabled, acceptRisk) =>
      call<ChangeResult>('setVersionExemption', { packageVersion, runtimeVersion, enabled, ...(acceptRisk !== undefined ? { acceptRisk } : {}) }),
    dispose() {
      disposed = true
      request = undefined
      for (const off of disposers.splice(0)) off()
      listeners.clear()
    },
  }
}

/* ── React binding: one store per ctx. ── */
const stores = new WeakMap<object, PluginManagerStore>()

export function pluginManagerStoreOf(ctx: unknown): PluginManagerStore | undefined {
  if (!ctx || typeof ctx !== 'object') return undefined
  const existing = stores.get(ctx)
  if (existing) return existing
  const store = createPluginManagerStore(ctx)
  stores.set(ctx, store)
  return store
}

const UNAVAILABLE = { status: 'loading', bundles: [], plugins: [], install: IDLE_INSTALL } as PluginManagerSnapshot

/** Snapshot hook over the ctx-owned store; absent host services stay 'loading'. */
export function usePluginManager(ctx: unknown): { snapshot: PluginManagerSnapshot; store: PluginManagerStore | undefined } {
  const store = pluginManagerStoreOf(ctx)
  const subscribe = useCallback((listener: () => void) => store?.subscribe(listener) ?? (() => {}), [store])
  const getSnapshot = useCallback(() => store?.getSnapshot() ?? UNAVAILABLE, [store])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { snapshot, store }
}
