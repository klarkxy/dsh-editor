export const CONVERSATION_SETTINGS_NAMESPACE = 'dsh-editor-conversations'

export type ConversationWorkRecord = {
  archivedIds: string[]
  tombstoneIds: string[]
  titles: Record<string, string>
}

export type ConversationSettings = {
  works: Record<string, ConversationWorkRecord>
}

export const DEFAULT_CONVERSATION_WORK: ConversationWorkRecord = {
  archivedIds: [],
  tombstoneIds: [],
  titles: {},
}

export const DEFAULT_CONVERSATION_SETTINGS: ConversationSettings = { works: {} }

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of values) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!key || typeof entry !== 'string') continue
    const title = entry.trim()
    if (!title) continue
    result[key] = title
  }
  return result
}

/** 宽容解析：坏数据当作没有归档或墓碑。 */
export function decodeConversationSettings(value: unknown): ConversationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { works: {} }
  const raw = (value as Record<string, unknown>).works
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { works: {} }
  const works: Record<string, ConversationWorkRecord> = {}
  for (const [workspaceId, entry] of Object.entries(raw)) {
    if (!workspaceId || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    works[workspaceId] = {
      archivedIds: uniqueStrings(record.archivedIds),
      tombstoneIds: uniqueStrings(record.tombstoneIds),
      titles: stringRecord(record.titles),
    }
  }
  return { works }
}

export function conversationWorkRecord(settings: ConversationSettings | undefined, workspaceId: string | undefined): ConversationWorkRecord {
  if (!workspaceId) return { archivedIds: [], tombstoneIds: [], titles: {} }
  const found = settings?.works[workspaceId]
  return {
    archivedIds: [...(found?.archivedIds ?? [])],
    tombstoneIds: [...(found?.tombstoneIds ?? [])],
    titles: { ...(found?.titles ?? {}) },
  }
}

export function putConversationWork(settings: ConversationSettings, workspaceId: string, record: ConversationWorkRecord): ConversationSettings {
  return {
    works: {
      ...settings.works,
      [workspaceId]: {
        archivedIds: [...record.archivedIds],
        tombstoneIds: [...record.tombstoneIds],
        titles: { ...record.titles },
      },
    },
  }
}
