export type ConversationRow = { id: string; title: string; current: boolean }

export function conversationRows(input: { workspaceSessionIds: readonly string[]; archivedIds?: readonly string[]; currentId?: string; titles?: Record<string, string | undefined>; reusableBlankIds?: readonly string[] }): ConversationRow[] {
  const archived = new Set(input.archivedIds ?? [])
  const blank = new Set(input.reusableBlankIds ?? [])
  return input.workspaceSessionIds
    .filter((id) => !archived.has(id) && (id === input.currentId || !blank.has(id)))
    .map((id) => ({ id, title: input.titles?.[id]?.trim() || '新对话', current: id === input.currentId }))
}

export function conversationTitle(text: string, limit = 36): string {
  const normalized = text.replace(/\s+/g, ' ').trim().replace(/[。！？!?].*$/u, '').trim()
  if (!normalized) return ''
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

export function nextAutomaticConversationTitle(input: { durableTitle?: string; assistantReplies: readonly string[]; attempted: boolean }, limit = 36): string {
  if (input.durableTitle?.trim() || input.attempted) return ''
  const reply = input.assistantReplies.find((text) => text.trim())
  return reply ? conversationTitle(reply, limit) : ''
}

export function shouldConfirmConversationSwitch(draft: string, nextId: string, currentId: string): boolean {
  return Boolean(draft.trim()) && nextId !== currentId
}

export class ConversationRenameQueue {
  private readonly pending = new Map<string, Promise<void>>()

  enqueue(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(sessionId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.pending.set(sessionId, next)
    void next.finally(() => {
      if (this.pending.get(sessionId) === next) this.pending.delete(sessionId)
    }).catch(() => undefined)
    return next
  }
}
