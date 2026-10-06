/** Private keyed seat that hosts the official plugin manager without declaring global `main`. */
export const NATIVE_PLUGIN_MANAGER_SEAT = 'dsh-editor.native-plugin-manager'
export const NATIVE_PLUGIN_MANAGER_PACKAGE = '@deepseek-ai/dsh-client-ui-plugin-manager'
export const NATIVE_PLUGIN_MANAGER_KEY = 'plugins'

const ACTIVE_FIBER = 2

type SlotRegisterSpec = {
  name?: string
  key?: string
  children?: unknown
  store?: unknown
  inject?: unknown
  locale?: unknown
  [field: string]: unknown
}

type NativeSlots = {
  inject(key: string, callback: unknown): unknown
  register(spec: SlotRegisterSpec, component?: unknown): unknown
  [field: string]: unknown
}

type NativeManagerEntry = {
  options: { name?: string }
  ctx: object
  parent: { ctx: { extend(meta: object): object } }
  fiber?: { uid?: number; state?: number; restart(): Promise<unknown> | unknown }
  update(options: object, create?: boolean, force?: boolean): Promise<unknown> | unknown
}

type PatchContext = {
  on(name: string, listener: (...args: never[]) => unknown): unknown
  get?(name: string): unknown
}

const facades = new WeakMap<object, NativeSlots>()

function isMainRegister(spec: SlotRegisterSpec | undefined): spec is SlotRegisterSpec {
  return spec?.name === 'main' && (spec.key === undefined || spec.key === NATIVE_PLUGIN_MANAGER_KEY)
}

/** Map only the official manager's `main` occupancy onto the Editor-owned private seat. */
export function managerSeatFacade(native: NativeSlots): NativeSlots {
  const cached = facades.get(native)
  if (cached) return cached
  const facade = new Proxy(native, {
    get(target, prop, receiver) {
      if (prop === 'inject') {
        return (key: string, callback: unknown) => target.inject(key === 'main' ? NATIVE_PLUGIN_MANAGER_SEAT : key, callback)
      }
      if (prop === 'register') {
        return (spec: SlotRegisterSpec, component?: unknown) => {
          const mapped = isMainRegister(spec) ? { ...spec, name: NATIVE_PLUGIN_MANAGER_SEAT } : spec
          return target.register(mapped, component)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(target) : value
    },
  })
  facades.set(native, facade)
  return facade
}

function adaptManagerEntry(entry: NativeManagerEntry): void {
  if (entry.options.name !== NATIVE_PLUGIN_MANAGER_PACKAGE) return
  Object.setPrototypeOf(entry.ctx, entry.parent.ctx.extend({
    get slots() {
      const native = (this as { get(name: string): NativeSlots }).get('slots')
      return managerSeatFacade(native)
    },
  }))
}

function loaderEntries(ctx: PatchContext): Iterable<NativeManagerEntry> {
  try {
    const loader = ctx.get?.('loader') as { entries?: () => Iterable<NativeManagerEntry> } | undefined
    return loader?.entries?.() ?? []
  } catch {
    return []
  }
}

function restartActiveManager(entry: NativeManagerEntry): void {
  const fiber = entry.fiber
  if (!fiber?.uid || fiber.state !== ACTIVE_FIBER) return
  void fiber.restart()
}

/**
 * Public loader/patch-context adapter installed before Editor publishes `layout`.
 * Keeps the Host ui-plugin-manager row; does not apply a second controller.
 */
export function adaptNativePluginManagerSeat(ctx: PatchContext): void {
  ctx.on('loader/patch-context', ((entry: NativeManagerEntry, next: () => void) => {
    next()
    adaptManagerEntry(entry)
  }) as never)
  for (const entry of loaderEntries(ctx)) {
    if (entry.options.name !== NATIVE_PLUGIN_MANAGER_PACKAGE) continue
    const pending = entry.update({}, false, true)
    if (pending && typeof (pending as Promise<unknown>).then === 'function') {
      void (pending as Promise<unknown>).then(() => restartActiveManager(entry))
    } else {
      restartActiveManager(entry)
    }
  }
}
