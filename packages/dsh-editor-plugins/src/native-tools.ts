import { presetDeclarationFile, selectedToolInserts, syncPresetDeclarations, type NativeToolState } from './preset-config.ts'
import { defaultPersistIo, isEnoent, replaceFileAtomic, runQueuedSorted, type PersistIo } from './persist.ts'
import type { PluginPaths } from './paths.ts'

type NativeMethod = (this: NativeToolManager, ...args: never[]) => Promise<unknown>
export type NativeToolManager = {
  listBundles: () => Promise<unknown>
  listPlugins: () => Promise<unknown>
  installBundle?: NativeMethod
  setBundleEnabled?: NativeMethod
  removeBundle?: NativeMethod
  setPluginEnabled: NativeMethod
  waitForInstall?: NativeMethod
}
type Operation = 'installBundle' | 'setBundleEnabled' | 'removeBundle' | 'setPluginEnabled'
type Receipt = { changed?: boolean; application?: string; error?: unknown; warnings?: string[]; target?: string; bundle?: string }

export async function readNativeToolState(manager: Pick<NativeToolManager, 'listBundles' | 'listPlugins'>): Promise<NativeToolState> {
  const [bundles, plugins] = await Promise.all([manager.listBundles(), manager.listPlugins()])
  if (!Array.isArray(bundles) || !Array.isArray(plugins)) throw new Error('Native plugin inventory is unavailable')
  return { bundles, plugins }
}

function failed(value: unknown): boolean {
  const row = value as Receipt | null
  return !row || typeof row !== 'object' || Boolean(row.error) || !['applied', 'restart-required', 'overridden'].includes(row.application ?? '')
}

function reported(value: unknown, message: string, error?: unknown): Receipt {
  const row = value && typeof value === 'object' ? value as Receipt : {}
  return {
    ...row,
    ...(error === undefined ? {} : { application: 'failed', error: row.error ?? { code: 'operation-error' } }),
    warnings: [...(row.warnings ?? []), `editor-tool-projection: ${message}${error === undefined ? '' : ` (${String(error)})`}`],
  }
}

function projectionCompatible(previous: string | undefined, tools: Awaited<ReturnType<typeof selectedToolInserts>>): boolean {
  if (previous === undefined) return tools.length === 0
  const allowed = new Set(tools.map(row => `${row.id}\0${row.name}`))
  try {
    const patches = JSON.parse(previous) as Array<{ insert?: Array<{ id: string; name: string }> }>
    return patches.every(patch => (patch.insert ?? []).every(row => !row.name.endsWith('/tools') || allowed.has(`${row.id}\0${row.name}`)))
  } catch { return false }
}

/**
 * The official manager still owns package operations, its lock, HMR and receipts.
 * Only this host-owned projection is coordinated with local writing-preset writes.
 * External CLI/profile edits do not participate in this in-process queue.
 */
export function adaptNativeToolProjection(manager: NativeToolManager, options: {
  paths: PluginPaths
  reloadProfile: () => Promise<boolean>
  io?: PersistIo
}): { ready: Promise<void>; dispose: () => void } {
  const { paths } = options
  const io = options.io ?? defaultPersistIo
  const file = presetDeclarationFile(paths.profileDir)
  const original = {
    installBundle: manager.installBundle,
    setBundleEnabled: manager.setBundleEnabled,
    removeBundle: manager.removeBundle,
    setPluginEnabled: manager.setPluginEnabled,
  }
  const originalWait = manager.waitForInstall
  const pendingInstalls = new Map<string, Promise<unknown>>()
  const wrappers: Partial<Record<Operation, NativeMethod>> = {}
  let disposed = false
  const queued = <T>(work: () => Promise<T>) => runQueuedSorted([paths.home, paths.stateFile], work)
  const sync = async (native: NativeToolState, exclusion: { excludeBundle?: string; excludeEntry?: string } = {}) => {
    await syncPresetDeclarations(paths.home, paths.profileDir, { native, io, ...exclusion })
  }
  const reload = async () => {
    if (!await options.reloadProfile()) throw new Error('Profile reload is unavailable; restart required')
  }
  const ready = queued(async () => {
    if (disposed) return
    const before = await optionalText()
    await sync(await readNativeToolState(manager))
    if (await optionalText() !== before) await reload()
  })

  async function optionalText(): Promise<string | undefined> {
    try { return await io.readFile(file, 'utf8') } catch (error) { if (isEnoent(error)) return undefined; throw error }
  }
  async function restore(previous: string | undefined): Promise<void> {
    if (previous === undefined) await io.rm(file, { force: true })
    else await replaceFileAtomic(file, previous, io)
  }

  for (const method of Object.keys(original) as Operation[]) {
    const nativeMethod = original[method]
    if (!nativeMethod) continue
    const wrapper: NativeMethod = function (this: NativeToolManager, ...args: never[]) {
      const receiver = this
      if (disposed) return nativeMethod.apply(receiver, args)
      const installOptions = method === 'installBundle' ? args[1] as { requestId?: unknown } | undefined : undefined
      const requestId = typeof installOptions?.requestId === 'string' ? installOptions.requestId : undefined
      const pending = requestId === undefined ? undefined : pendingInstalls.get(requestId)
      if (pending) return pending
      const run = queued(async () => {
        if (disposed) return nativeMethod.apply(receiver, args)
        const target = String(args[0])
        const enabled = args[1] as boolean | undefined
        let before: NativeToolState | undefined
        let previous: string | undefined
        let previousTools: string | undefined
        let captured = false
        let attempted = false
        let receipt: unknown
        let cause: unknown
        try {
          before = await readNativeToolState(receiver)
          previous = await optionalText()
          previousTools = JSON.stringify(await selectedToolInserts(paths.profileDir, { native: before }))
          captured = true
          if (method === 'removeBundle' || method === 'setBundleEnabled' && enabled === false) {
            await sync(before, { excludeBundle: target })
          } else if (method === 'setPluginEnabled' && enabled === false) {
            await sync(before, { excludeEntry: target })
          }
          attempted = true
          receipt = await nativeMethod.apply(receiver, args)
          if (failed(receipt)) return await recover()
          await sync(await readNativeToolState(receiver))
          // Keep native restart-required and overridden outcomes even after projection reload.
          if ((receipt as Receipt).application !== 'restart-required') await reload()
          return receipt
        } catch (error) {
          cause = error
          receipt = reported(receipt ?? {
            changed: false, application: 'failed', stage: method === 'installBundle' ? 'install' : method === 'removeBundle' ? 'remove' : 'enable',
            target, ...(enabled === undefined || method === 'installBundle' ? {} : { enabled }),
          }, 'synchronization failed', error)
          return await recover()
        }

        async function recover(): Promise<unknown> {
          if (!captured || !before) return receipt
          try {
            let current = await readNativeToolState(receiver)
            const bundleName = method === 'installBundle' ? (receipt as Receipt).bundle : target
            if (attempted) {
              if (method !== 'setPluginEnabled' && bundleName && original.setBundleEnabled) {
                const wasEnabled = before.bundles.find(row => row.name === bundleName)?.enabled ?? false
                const bundle = current.bundles.find(row => row.name === bundleName)
                // Never reselect a dependency pnpm has already removed.
                if (bundle && (bundle.installed || bundle.rows?.length) && bundle.enabled !== wasEnabled) {
                  const result = await original.setBundleEnabled.apply(receiver, [bundleName, wasEnabled] as never[])
                  if (failed(result)) throw new Error(`Native selection recovery failed: ${JSON.stringify(result)}`)
                }
              } else if (method === 'setPluginEnabled') {
                const was = before.plugins.find(row => row.entryId === target)
                const now = current.plugins.find(row => row.entryId === target)
                if (was && now && was.enabled !== now.enabled) {
                  const result = await original.setPluginEnabled.apply(receiver, [target, was.enabled] as never[])
                  if (failed(result)) throw new Error(`Native entry recovery failed: ${JSON.stringify(result)}`)
                }
              }
              current = await readNativeToolState(receiver)
            }
            const currentTools = await selectedToolInserts(paths.profileDir, { native: current })
            const selectionRestored = method === 'setPluginEnabled'
              ? before.plugins.find(row => row.entryId === target)?.enabled === current.plugins.find(row => row.entryId === target)?.enabled
              : !bundleName || (before.bundles.find(row => row.name === bundleName)?.enabled ?? false) === (current.bundles.find(row => row.name === bundleName)?.enabled ?? false)
            const compatible = selectionRestored && previousTools === JSON.stringify(currentTools) && projectionCompatible(previous, currentTools)
            if (compatible) await restore(previous)
            else await sync(current)
            await reload()
            return reported(receipt, compatible ? 'previous projection and available selections restored' : 'projection reconciled with remaining native dependencies')
          } catch (recovery) {
            // Recovery may itself leave partial native changes. Retain the safest current
            // projection; failure to write or reload it is reported, never called rollback.
            let consistency: unknown
            try { await sync(await readNativeToolState(receiver)) } catch (error) { consistency = error }
            return reported(receipt, `recovery failed${consistency === undefined ? '; projection matches current native state' : `; current-state projection failed (${String(consistency)})`}`, recovery ?? cause)
          }
        }
      })
      if (requestId === undefined) return run
      const tracked = run.finally(() => {
        if (pendingInstalls.get(requestId) === tracked) pendingInstalls.delete(requestId)
      })
      pendingInstalls.set(requestId, tracked)
      return tracked
    }
    wrappers[method] = wrapper
    manager[method] = wrapper
  }
  // The native wait can settle before projection synchronization or recovery.
  // Keep it outside the queue, joining only currently pending adapted installs.
  const waitWrapper: NativeMethod | undefined = originalWait && original.installBundle
    ? function (this: NativeToolManager, ...args: never[]) {
      if (!disposed && typeof args[0] === 'string') {
        const pending = pendingInstalls.get(args[0])
        if (pending) return pending
      }
      return originalWait.apply(this, args)
    }
    : undefined
  if (waitWrapper) manager.waitForInstall = waitWrapper
  return {
    ready,
    dispose: () => {
      disposed = true
      pendingInstalls.clear()
      for (const method of Object.keys(wrappers) as Operation[]) {
        if (manager[method] === wrappers[method]) manager[method] = original[method]!
      }
      if (waitWrapper && manager.waitForInstall === waitWrapper) manager.waitForInstall = originalWait
    },
  }
}
