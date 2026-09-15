/** Browser-safe author-memory marker shared with the editor Shell. */
export const AUTHOR_OBSERVE_TOOL_NAME = 'author_observe'
export const AUTHOR_MEMORY_MARKER = 'dsh-editor.memory'

/** 助手建议追加的作者侧写条目最大长度；与 V2 envelope 中 author_memory 的 2000 字预算协同。 */
export const AUTHOR_OBSERVE_MAX_CHARS = 200

/** 助手观察后提议追加的作者侧写条目；经作者确认后由 Shell 写入 authorMemory。 */
export type AuthorMemoryMarker = {
  marker: typeof AUTHOR_MEMORY_MARKER
  version: 1
  observation: string
  reason: string
}

/** Validates and normalizes one proposed author-memory entry; runs on the Host inside the tool executor. */
export function authorMemoryMarker(args: Record<string, unknown>): AuthorMemoryMarker {
  const observation = typeof args.observation === 'string' ? args.observation.trim() : ''
  const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
  if (!observation) throw new Error('observation is required')
  if (!reason) throw new Error('reason is required')
  if (observation.length > AUTHOR_OBSERVE_MAX_CHARS) throw new Error(`observation must be <= ${AUTHOR_OBSERVE_MAX_CHARS} characters`)
  return { marker: AUTHOR_MEMORY_MARKER, version: 1, observation, reason }
}

/** Parses a serialized tool result before the browser renders an author-memory confirmation card. */
export function parseAuthorMemoryMarker(text: string): AuthorMemoryMarker | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (row.marker !== AUTHOR_MEMORY_MARKER || row.version !== 1) return undefined
  if (typeof row.observation !== 'string' || !row.observation) return undefined
  if (typeof row.reason !== 'string' || !row.reason) return undefined
  if (row.observation.length > AUTHOR_OBSERVE_MAX_CHARS) return undefined
  const allowed = new Set(['marker', 'version', 'observation', 'reason'])
  if (Object.keys(row).some((key) => !allowed.has(key))) return undefined
  try {
    return authorMemoryMarker(row)
  } catch {
    return undefined
  }
}
