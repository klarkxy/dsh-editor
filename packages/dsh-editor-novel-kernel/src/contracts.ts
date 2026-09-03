/** Browser-safe protocol shared with the editor Shell. */
export const NOVEL_KNOWLEDGE_TOOL_NAME = 'novel_knowledge'
export const PROPOSAL_TOOL_NAME = 'novel_propose'
export const ZHIHU_SEARCH_TOOL_NAME = 'zhihu_search'
export const ZHIHU_GLOBAL_SEARCH_TOOL_NAME = 'zhihu_global_search'
export const ZHIHU_HOT_LIST_TOOL_NAME = 'zhihu_hot_list'
export const ZHIHU_ASK_TOOL_NAME = 'zhihu_ask'
export const ZHIHU_KNOWLEDGE_SEARCH_TOOL_NAME = 'zhihu_knowledge_search'
export const PROJECT_KNOWLEDGE_TOOL_NAME = 'project_knowledge'
export const NOVEL_SEARCH_TOOL_NAME = 'novel_search'
export const NOVEL_OVERVIEW_TOOL_NAME = 'novel_overview'
export const NOVEL_CHAPTER_STATUS_TOOL_NAME = 'novel_set_chapter_status'
export const PROPOSAL_MARKER = 'dsh-editor.proposal'

export type ChapterStatusValue = 'draft' | 'revising' | 'final'
export const CHAPTER_STATUS_VALUES: readonly ChapterStatusValue[] = ['draft', 'revising', 'final']

export type ProposalRename = { from: string; to: string }

export type ProposalMarker = {
  marker: typeof PROPOSAL_MARKER
  version: 1
  summary: string
} & (
  | { kind: 'edit'; path: string; oldText: string; newText: string }
  | { kind: 'create'; path: string; text: string }
  /** anchor 在原文件中唯一；anchor 起（含 anchor 本身）的内容进入 newPath。 */
  | { kind: 'split'; path: string; anchor: string; newPath: string }
  /** sourcePath 的内容追加到 path 末尾，随后 sourcePath 被归档（可从归档恢复）。 */
  | { kind: 'merge'; path: string; sourcePath: string }
  | { kind: 'renames'; renames: ProposalRename[] }  // 同目录改名，或 正文/ 内跨目录移动（文件名不变）
)

const PROPOSAL_KINDS = ['edit', 'create', 'split', 'merge', 'renames'] as const

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function aliasedString(args: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    if (typeof args[name] === 'string') return args[name]
  }
  return ''
}

/** 项目相对 Markdown 路径：与 edit/create 的既有校验同一套规则。 */
function safeMarkdownPath(value: string): boolean {
  if (!value) return false
  if (value.startsWith('/') || /^[a-z]:/i.test(value) || value.split('/').includes('..')) return false
  return /\.md$/i.test(value)
}

function cleanPath(value: unknown): string {
  return cleanString(value).replace(/\\/g, '/')
}

function cleanRenames(value: unknown): ProposalRename[] {
  if (!Array.isArray(value)) return []
  const out: ProposalRename[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const row = entry as Record<string, unknown>
    const from = cleanPath(row.from)
    const to = cleanPath(row.to)
    if (!from || !to) return []
    out.push({ from, to })
  }
  return out
}

/** Validates and normalizes the preview-only proposal result. */
export function proposalMarker(args: Record<string, unknown>): ProposalMarker {
  const kind = cleanString(args.kind) as ProposalMarker['kind']
  const summary = cleanString(args.summary).trim()
  if (!(PROPOSAL_KINDS as readonly string[]).includes(kind) || !summary) throw new Error('kind and summary are required')
  if (kind === 'renames') {
    const renames = cleanRenames(args.renames)
    if (renames.length < 1 || renames.length > 50) throw new Error('renames requires 1-50 entries')
    const seen = new Set<string>()
    for (const item of renames) {
      if (!safeMarkdownPath(item.from) || !safeMarkdownPath(item.to)) throw new Error('renames entries must be project-relative Markdown paths')
      if (item.from === item.to) throw new Error('renames entries must change the path')
      if (seen.has(item.from) || seen.has(item.to)) throw new Error('renames entries must not overlap')
      seen.add(item.from)
      seen.add(item.to)
    }
    return { marker: PROPOSAL_MARKER, version: 1, kind, summary, renames }
  }
  const path = cleanPath(args.path)
  if (!safeMarkdownPath(path)) throw new Error('path must be a project-relative Markdown file')
  if (kind === 'split') {
    const anchor = cleanString(args.anchor)
    const newPath = cleanPath(args.newPath)
    if (!anchor.trim()) throw new Error('split requires anchor')
    if (!safeMarkdownPath(newPath)) throw new Error('newPath must be a project-relative Markdown file')
    if (newPath === path) throw new Error('newPath must differ from path')
    return { marker: PROPOSAL_MARKER, version: 1, kind, path, summary, anchor, newPath }
  }
  if (kind === 'merge') {
    const sourcePath = cleanPath(args.sourcePath)
    if (!safeMarkdownPath(sourcePath)) throw new Error('sourcePath must be a project-relative Markdown file')
    if (sourcePath === path) throw new Error('sourcePath must differ from path')
    return { marker: PROPOSAL_MARKER, version: 1, kind, path, summary, sourcePath }
  }
  if (kind === 'edit') {
    const oldText = aliasedString(args, ['oldText', 'old_text', 'old_string'])
    const newText = aliasedString(args, ['newText', 'new_text', 'new_string'])
    if (!oldText || oldText === newText) throw new Error('edit requires different oldText and newText')
    return { marker: PROPOSAL_MARKER, version: 1, kind, path, summary, oldText, newText }
  }
  const text = cleanString(args.text)
  if (!text) throw new Error('create requires text')
  return { marker: PROPOSAL_MARKER, version: 1, kind, path, summary, text }
}

const ALLOWED_KEYS: Record<string, readonly string[]> = {
  edit: ['marker', 'version', 'kind', 'path', 'summary', 'oldText', 'newText'],
  create: ['marker', 'version', 'kind', 'path', 'summary', 'text'],
  split: ['marker', 'version', 'kind', 'path', 'summary', 'anchor', 'newPath'],
  merge: ['marker', 'version', 'kind', 'path', 'summary', 'sourcePath'],
  renames: ['marker', 'version', 'kind', 'summary', 'renames'],
}

/** Parses a serialized tool result before the browser renders an author proposal. */
export function parseProposalMarker(text: string): ProposalMarker | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (row.marker !== PROPOSAL_MARKER || row.version !== 1) return undefined
  const kind = row.kind
  if (typeof kind !== 'string' || !(kind in ALLOWED_KEYS)) return undefined
  if (typeof row.summary !== 'string') return undefined
  if (kind !== 'renames' && typeof row.path !== 'string') return undefined
  if (kind === 'edit' && (typeof row.oldText !== 'string' || typeof row.newText !== 'string')) return undefined
  if (kind === 'create' && typeof row.text !== 'string') return undefined
  if (kind === 'split' && (typeof row.anchor !== 'string' || typeof row.newPath !== 'string')) return undefined
  if (kind === 'merge' && typeof row.sourcePath !== 'string') return undefined
  if (kind === 'renames' && !Array.isArray(row.renames)) return undefined
  const allowed = new Set(ALLOWED_KEYS[kind])
  if (Object.keys(row).some((key) => !allowed.has(key))) return undefined
  try {
    const parsed = proposalMarker(row)
    if (parsed.summary !== row.summary) return undefined
    if (parsed.kind !== 'renames' && 'path' in parsed && parsed.path !== row.path) return undefined
    return parsed
  } catch {
    return undefined
  }
}
