/**
 * Locked workbench Host tool guard: fail-closed for unknown tools.
 * Generic read/search/ask/Skill/proposal are allowed.
 * novel_knowledge is the shared read-only novel tool (legacy full and
 * knowledge-only). Other novel_* names are an explicit legacy compatibility
 * list and stay subject to the novel-kernel editorToolGuard when that
 * full surface is mounted.
 */
import { WRITING_PROPOSE_TOOL_NAME } from 'dsh-manuscript/host-api'

export const HOST_GUARD_REJECTION = 'DSH Editor only allows project search, read, and previewable proposals.'

const GENERIC_READ = new Set(['read'])
const GENERIC_SEARCH = new Set(['glob', 'grep'])
const GENERIC_ASK = new Set(['ask_user_question'])
const GENERIC_SKILL = new Set(['Skill', 'skill'])
const GENERIC_PROPOSAL = new Set([WRITING_PROPOSE_TOOL_NAME, 'author_observe'])

const LEGACY_NOVEL_TOOLS = new Set([
  'novel_propose',
  'novel_knowledge',
  'novel_overview',
  'novel_index_write',
  'novel_scratch_write',
  'novel_scratch_read',
  'novel_scratch_list',
  'novel_memory_update',
])

const ZHIHU_SEARCH = new Set([
  'zhihu_search',
  'zhihu_global_search',
  'zhihu_hot_list',
  'zhihu_ask',
  'zhihu_knowledge_search',
])

function safeRelative(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== 'string' || value.includes('\0')) return false
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes(':') || path.split('/').includes('..')) return false
  return true
}

export function hostToolGuard(exec: { name: string; arguments: Readonly<Record<string, unknown>> }): string | undefined {
  const name = exec.name
  const args = exec.arguments
  if (GENERIC_READ.has(name)) {
    return safeRelative(args.file_path) ? undefined : HOST_GUARD_REJECTION
  }
  if (GENERIC_SEARCH.has(name)) {
    // Only the real search-root path is a path field. grep/glob patterns are query text.
    return safeRelative(args.path) ? undefined : HOST_GUARD_REJECTION
  }
  if (GENERIC_ASK.has(name) || GENERIC_SKILL.has(name) || GENERIC_PROPOSAL.has(name)) return undefined
  if (ZHIHU_SEARCH.has(name)) return undefined
  if (LEGACY_NOVEL_TOOLS.has(name)) return undefined
  return HOST_GUARD_REJECTION
}
