import { getLocale, t } from './i18n/index.ts'
import { isNovelIndexJobTitle } from './novel-index.ts'

export type ConversationRow = { id: string; title: string; current: boolean }

export function stripReasoningText(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/giu, '')
    .replace(/<think\b[^>]*>[\s\S]*$/giu, '')
    .replace(/<\/?think\b[^>]*>/giu, '')
    .trim()
}

export function isUnnamedConversationTitle(title: string | undefined): boolean {
  const normalized = title?.trim() ?? ''
  if (!normalized || isNovelIndexJobTitle(normalized)) return true
  if (/dsh-editor\.project-context|project-context/i.test(normalized)) return true
  if (!/^(?:\{|\[)/.test(normalized)) return false
  try {
    const parsed = JSON.parse(normalized) as unknown
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return /^\{\s*"?(?:schema|user_request|project_context)"?\s*:/i.test(normalized)
  }
}

function conversationTitleFor(id: string, titles: Record<string, string | undefined> | undefined): string {
  const title = titles?.[id]?.trim() ?? ''
  return isUnnamedConversationTitle(title) ? t('chat.newConversation') : title
}

export function conversationRows(input: { workspaceSessionIds: readonly string[]; archivedIds?: readonly string[]; forgottenIds?: readonly string[]; currentId?: string; titles?: Record<string, string | undefined>; reusableBlankIds?: readonly string[] }): ConversationRow[] {
  const archived = new Set(input.archivedIds ?? [])
  const forgotten = new Set(input.forgottenIds ?? [])
  const blank = new Set(input.reusableBlankIds ?? [])
  return input.workspaceSessionIds
    .filter((id) => !forgotten.has(id) && !archived.has(id) && (id === input.currentId || !blank.has(id)))
    .map((id) => ({ id, title: conversationTitleFor(id, input.titles), current: id === input.currentId }))
}

/** 已归档但仍可恢复的对话；墓碑 id 不会出现在这里。 */
export function archivedConversationRows(input: { workspaceSessionIds: readonly string[]; archivedIds?: readonly string[]; forgottenIds?: readonly string[]; currentId?: string; titles?: Record<string, string | undefined> }): ConversationRow[] {
  const archived = new Set(input.archivedIds ?? [])
  const forgotten = new Set(input.forgottenIds ?? [])
  return input.workspaceSessionIds
    .filter((id) => archived.has(id) && !forgotten.has(id))
    .map((id) => ({ id, title: conversationTitleFor(id, input.titles), current: id === input.currentId }))
}

export function canArchiveOrDeleteConversation(visibleCount: number): boolean {
  return visibleCount > 1
}

export function nextVisibleConversationId(visibleIds: readonly string[], removingId: string): string | undefined {
  return visibleIds.find((id) => id !== removingId)
}

export function archiveConversationIds(archivedIds: readonly string[], id: string): string[] {
  return archivedIds.includes(id) ? [...archivedIds] : [...archivedIds, id]
}

export function restoreConversationIds(archivedIds: readonly string[], id: string): string[] {
  return archivedIds.filter((item) => item !== id)
}

export function tombstoneConversationIds(input: { archivedIds: readonly string[]; tombstoneIds: readonly string[]; id: string }): { archivedIds: string[]; tombstoneIds: string[] } {
  return {
    archivedIds: input.archivedIds.filter((item) => item !== input.id),
    tombstoneIds: input.tombstoneIds.includes(input.id) ? [...input.tombstoneIds] : [...input.tombstoneIds, input.id],
  }
}

export function conversationTitle(text: string, limit = 36): string {
  const normalized = stripReasoningText(text).replace(/\s+/g, ' ').trim().replace(/[。！？!?].*$/u, '').trim()
  if (!normalized) return ''
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

/** 本地日期标签（YYYY-MM-DD），用于自动会话标题的「日期 | 内容」前缀。 */
export function conversationDateLabel(time: number): string {
  const date = new Date(time)
  if (getLocale() === 'zh') {
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }
  return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

export function nextAutomaticConversationTitle(input: { durableTitle?: string; assistantReplies: readonly string[]; attempted: boolean; date?: number }, limit = 36): string {
  const durableTitle = input.durableTitle?.trim() ?? ''
  if (!isUnnamedConversationTitle(durableTitle) || input.attempted) return ''
  const reply = input.assistantReplies
    .map(stripReasoningText)
    .find((text) => text && !isNovelIndexJobTitle(text))
  if (!reply) return ''
  const prefix = `${conversationDateLabel(input.date ?? Date.now())} | `
  const content = conversationTitle(reply, Math.max(8, limit - prefix.length))
  return content ? `${prefix}${content}` : ''
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
