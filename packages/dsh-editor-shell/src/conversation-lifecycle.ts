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

export function conversationRows(input: { workspaceSessionIds: readonly string[]; archivedIds?: readonly string[]; currentId?: string; titles?: Record<string, string | undefined>; reusableBlankIds?: readonly string[] }): ConversationRow[] {
  const archived = new Set(input.archivedIds ?? [])
  const blank = new Set(input.reusableBlankIds ?? [])
  return input.workspaceSessionIds
    .filter((id) => !archived.has(id) && (id === input.currentId || !blank.has(id)))
    .map((id) => {
      const title = input.titles?.[id]?.trim() ?? ''
      return { id, title: isUnnamedConversationTitle(title) ? '新对话' : title, current: id === input.currentId }
    })
}

export function conversationTitle(text: string, limit = 36): string {
  const normalized = stripReasoningText(text).replace(/\s+/g, ' ').trim().replace(/[。！？!?].*$/u, '').trim()
  if (!normalized) return ''
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

/** 本地日期标签（YYYY-MM-DD），用于自动会话标题的「日期 | 内容」前缀。 */
export function conversationDateLabel(time: number): string {
  const date = new Date(time)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
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
