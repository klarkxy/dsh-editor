/** Session list snapshot fields used to bind the manuscript workspace. */
export type SessionListSnapshot = {
  current?: string
  byId?: Record<string, { cwd?: string }>
}

export type ActiveWorkspace = {
  sessionId: string
  cwd: string
}

/**
 * Resolve the active workspace cwd from the official sessions list.
 * RootOwnerProps has no sessionId; only `list.current` is authoritative.
 */
export function cwdFromSessionList(snap: SessionListSnapshot | undefined): string {
  return activeWorkspaceFromSessionList(snap)?.cwd ?? ''
}

/**
 * The server resolves workspace authority from this session ID.  `cwd` is
 * retained only for rendering and local document-switch protection.
 */
export function activeWorkspaceFromSessionList(snap: SessionListSnapshot | undefined): ActiveWorkspace | null {
  const current = snap?.current
  if (!current) return null
  const cwd = snap.byId?.[current]?.cwd
  return typeof cwd === 'string' ? { sessionId: current, cwd } : null
}
