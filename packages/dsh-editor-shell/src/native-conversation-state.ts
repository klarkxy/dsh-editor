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
