import type { SessionId } from './dsh-compat.ts'

export type ConversationFilter = 'active' | 'all' | 'archived'

export function orderedConversationIds(input: {
  ids: readonly string[]
  archivedIds: readonly string[]
  pinnedIds: readonly string[]
  filter: ConversationFilter
}): string[] {
  const archived = new Set(input.archivedIds)
  const pinOrder = new Map(input.pinnedIds.map((id, index) => [id, index]))
  return input.ids
    .filter((id) => input.filter === 'all' || (input.filter === 'archived' ? archived.has(id) : !archived.has(id)))
    .sort((a, b) => (pinOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (pinOrder.get(b) ?? Number.MAX_SAFE_INTEGER))
}

export function isActiveSessionArchiveError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'WorkspaceActiveSessionError') return true
  const rpcError = (error as Error & { rpcError?: { code?: unknown } }).rpcError
  return error.name === 'WorkspaceArchiveError' && rpcError?.code === 'workspace/session-active'
}

/** Move old Editor-only archive entries to the Host, clearing each only after durable success. */
export async function migrateLegacyConversationArchives(input: {
  ids: readonly string[]
  nativeArchivedIds: readonly string[]
  archive(id: SessionId): Promise<void>
  clear(id: string): Promise<void>
}): Promise<string[]> {
  const failed: string[] = []
  const native = new Set(input.nativeArchivedIds)
  for (const id of new Set(input.ids)) {
    try {
      if (!native.has(id)) await input.archive(id as SessionId)
      await input.clear(id)
      native.add(id)
    } catch {
      failed.push(id)
    }
  }
  return failed
}

// Host lifetime ownership survives chat remounts and serializes settings writes.
const archiveMigrations = new WeakMap<object, Map<string, { attempted: Set<string>; pending: Promise<string[]> }>>()
export function coordinateLegacyConversationArchives(owner: object, workspaceId: string, input: Parameters<typeof migrateLegacyConversationArchives>[0]): Promise<string[]> {
  let workspaces = archiveMigrations.get(owner)
  if (!workspaces) archiveMigrations.set(owner, workspaces = new Map())
  let state = workspaces.get(workspaceId)
  if (!state) workspaces.set(workspaceId, state = { attempted: new Set(), pending: Promise.resolve([]) })
  const ids = input.ids.filter(id => !state.attempted.has(id))
  for (const id of ids) state.attempted.add(id)
  if (ids.length) state.pending = state.pending.then(() => migrateLegacyConversationArchives({ ...input, ids }))
  return state.pending
}
export async function waitForLegacyConversationArchives(owner: object, workspaceId: string): Promise<void> {
  const state = archiveMigrations.get(owner)?.get(workspaceId)
  if (!state) return
  let pending: Promise<string[]>
  do { pending = state.pending; await pending } while (state.pending !== pending)
}

// The native settings controller publishes only its latest queued response.
// Serialize this namespace's read/modify/write operations before enqueueing them.
const settingsWrites = new WeakMap<object, Promise<void>>()
export function enqueueConversationSettingsWrite(scope: object, write: () => Promise<void>): Promise<void> {
  const next = (settingsWrites.get(scope) ?? Promise.resolve()).catch(() => {}).then(write)
  settingsWrites.set(scope, next)
  void next.finally(() => { if (settingsWrites.get(scope) === next) settingsWrites.delete(scope) }).catch(() => {})
  return next
}
