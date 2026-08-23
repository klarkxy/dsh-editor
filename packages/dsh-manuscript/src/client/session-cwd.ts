/** Session list snapshot fields used to bind the manuscript workspace. */
export type SessionListSnapshot = {
  current?: string
  byId?: Record<string, { cwd?: string }>
}

/**
 * Resolve the active workspace cwd from the official sessions list.
 * RootOwnerProps has no sessionId; only `list.current` is authoritative.
 */
export function cwdFromSessionList(snap: SessionListSnapshot | undefined): string {
  const current = snap?.current
  if (!current) return ''
  const cwd = snap.byId?.[current]?.cwd
  return typeof cwd === 'string' ? cwd : ''
}
