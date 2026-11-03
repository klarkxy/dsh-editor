/**
 * pluginNavigation bridge for the retired official manager contract.
 *
 * The service must exist before web boot finishes — plugins inject
 * `pluginNavigation` at activation time — so the host-side provider records
 * the requested settings section and the React root consumes it once the
 * layout can open the plugins panel.
 */
let target: string | undefined
let version = 0
const listeners = new Set<() => void>()
let opener: (() => void) | undefined

export function requestPluginNavSection(id: string): void {
  target = id
  version += 1
  try { opener?.() } catch { /* best effort: the consumer still reads the target */ }
  for (const listener of [...listeners]) listener()
}

export function pluginNavVersion(): number {
  return version
}

export function subscribePluginNav(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** One-shot read: the first consumer owns the pending section. */
export function consumePluginNavTarget(): string | undefined {
  const value = target
  target = undefined
  return value
}

/** The React root registers its real panel opener; undefined until it mounts. */
export function registerPluginNavOpener(open: () => void): () => void {
  opener = open
  return () => { if (opener === open) opener = undefined }
}
