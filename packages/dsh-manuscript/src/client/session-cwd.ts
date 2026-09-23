/** Session list snapshot fields used to bind the manuscript workspace. */
export type SessionListSnapshot = {
  byId?: Record<string, { cwd?: string }>
}

export type ActiveWorkspace = {
  sessionId: string
  cwd: string
}

/**
 * Resolve the active workspace cwd from the official sessions list.
 * The navigation owner supplies the selected session; the catalog supplies its cwd.
 */
export function cwdFromSessionList(snap: SessionListSnapshot | undefined, current?: string): string {
  return activeWorkspaceFromSessionList(snap, current)?.cwd ?? ''
}

/**
 * The server resolves workspace authority from this session ID.  `cwd` is
 * retained only for rendering and local document-switch protection.
 */
export function activeWorkspaceFromSessionList(snap: SessionListSnapshot | undefined, current?: string): ActiveWorkspace | null {
  if (!current) return null
  const cwd = snap?.byId?.[current]?.cwd
  return typeof cwd === 'string' ? { sessionId: current, cwd } : null
}
