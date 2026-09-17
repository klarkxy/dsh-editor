/**
 * Locked workbench Host tool guard: fail-closed for unknown tools on
 * app-owned writing presets only.
 * Generic read/search/ask/Skill/proposal are allowed.
 * novel_knowledge is the shared read-only novel tool (legacy full and
 * knowledge-only). Other novel_* names are an explicit legacy compatibility
 * list and stay subject to the novel-kernel editorToolGuard when that
 * full surface is mounted.
 *
 * Official DSH / community agent presets keep their own tool surface
 * (including terminal). This guard is a global registration, so it must
 * no-op unless the calling session is one of our writing presets.
 */
import { WRITING_PROPOSE_TOOL_NAME } from 'dsh-manuscript/host-api'

export const HOST_GUARD_REJECTION = 'DSH Editor only allows project search, read, and previewable proposals.'

/** Four current writing modes plus the hidden legacy writing preset. */
export const WRITING_AGENT_PRESETS = [
  'dsh-editor-writing',
  'dsh-editor-novel',
  'dsh-editor-article',
  'dsh-editor-technical',
  'dsh-editor',
] as const

export type WritingAgentPreset = typeof WRITING_AGENT_PRESETS[number]

export function isWritingAgentPreset(preset: string | null | undefined): preset is WritingAgentPreset {
  return typeof preset === 'string' && (WRITING_AGENT_PRESETS as readonly string[]).includes(preset)
}

export type HostGuardExec = {
  name: string
  arguments?: unknown
  agent?: { session?: { header?: { agentPreset?: string | null } } }
}

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

function recordArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function callingPreset(exec: HostGuardExec): string | undefined {
  const preset = exec.agent?.session?.header?.agentPreset
  return typeof preset === 'string' && preset.trim() ? preset.trim() : undefined
}

export function hostToolGuard(exec: HostGuardExec): string | undefined {
  if (!isWritingAgentPreset(callingPreset(exec))) return undefined
  const name = exec.name
  const args = recordArgs(exec.arguments)
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
