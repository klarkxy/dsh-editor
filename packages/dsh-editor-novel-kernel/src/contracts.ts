/** Browser-safe protocol shared with the editor Shell. */
export const NOVEL_KNOWLEDGE_TOOL_NAME = 'novel_knowledge'
export const PROPOSAL_TOOL_NAME = 'novel_propose'
export const ZHIHU_SEARCH_TOOL_NAME = 'zhihu_search'
export const ZHIHU_GLOBAL_SEARCH_TOOL_NAME = 'zhihu_global_search'
export const ZHIHU_HOT_LIST_TOOL_NAME = 'zhihu_hot_list'
export const ZHIHU_ASK_TOOL_NAME = 'zhihu_ask'
export const ZHIHU_KNOWLEDGE_SEARCH_TOOL_NAME = 'zhihu_knowledge_search'
export const NOVEL_OVERVIEW_TOOL_NAME = 'novel_overview'
export const NOVEL_INDEX_WRITE_TOOL_NAME = 'novel_index_write'
/** DSH 运行时自带的提问工具；写作助手在需要作者拍板时使用，经 editorToolGuard 校验后放行。 */
export const USER_QUESTION_TOOL_NAME = 'ask_user_question'
/** agent 临时工作区：.dsh-editor/scratch/ 内自由读写，路径软禁、有界、对作者视图隐藏。 */
export const SCRATCH_DIRECTORY = '.dsh-editor/scratch'
export const NOVEL_SCRATCH_WRITE_TOOL_NAME = 'novel_scratch_write'
export const NOVEL_SCRATCH_READ_TOOL_NAME = 'novel_scratch_read'
export const NOVEL_SCRATCH_LIST_TOOL_NAME = 'novel_scratch_list'
export const SCRATCH_MAX_FILE_CHARS = 20_000
export const SCRATCH_MAX_FILES = 20
/** 作品索引是产品内部状态：固定路径，由 novel_index_write 直接写入，不走提案确认。 */
export const NOVEL_INDEX_PATH = '.dsh-editor/作品索引.md'
export const PROPOSAL_MARKER = 'dsh-editor.proposal'

export {
  AUTHOR_MEMORY_MARKER,
  AUTHOR_OBSERVE_MAX_CHARS,
  AUTHOR_OBSERVE_TOOL_NAME,
  authorMemoryMarker,
  parseAuthorMemoryMarker,
  type AuthorMemoryMarker,
} from 'dsh-editor-workbench/contracts'

export type ProposalRename = { from: string; to: string }
export type ProposalChapterState = { now?: string; where?: string; knows?: string; ended?: string; open?: string }

export type ProposalMarker = {
  marker: typeof PROPOSAL_MARKER
  version: 1
  summary: string
} & (
  | { kind: 'edit'; path: string; oldText: string; newText: string }
  | { kind: 'create'; path: string; text: string }
  | { kind: 'chapter_plan'; path: string; sourceVersion: string; beats: string[] }
  | { kind: 'chapter_summary'; path: string; sourceVersion: string; state: ProposalChapterState }
  /** anchor 在原文件中唯一；anchor 起（含 anchor 本身）的内容进入 newPath。 */
  | { kind: 'split'; path: string; anchor: string; newPath: string }
  /** sourcePath 的内容追加到 path 末尾，随后 sourcePath 被归档（可从归档恢复）。 */
  | { kind: 'merge'; path: string; sourcePath: string }
  | { kind: 'renames'; renames: ProposalRename[] }  // 同目录改名，或 正文/ 内跨目录移动（文件名不变）
)

const PROPOSAL_KINDS = ['edit', 'create', 'chapter_plan', 'chapter_summary', 'split', 'merge', 'renames'] as const

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
  if (kind === 'chapter_plan' || kind === 'chapter_summary') {
    if (!/^正文\/.+\.md$/i.test(path) || path.split('/').some((part) => !part || part.startsWith('.'))) {
      throw new Error('chapter proposal must target an existing chapter under 正文/')
    }
    const sourceVersion = cleanString(args.sourceVersion).trim()
    if (!sourceVersion || sourceVersion.length > 512) throw new Error('sourceVersion from the chapter read receipt is required')
    if (kind === 'chapter_plan') {
      if ('state' in args || !Array.isArray(args.beats) || args.beats.length > 12
        || args.beats.some((beat) => typeof beat !== 'string' || !beat.trim() || beat.trim().length > 120 || /[\r\n\u0000]/.test(beat))) {
        throw new Error('chapter_plan requires up to 12 non-empty beats of at most 120 characters, without state')
      }
      return { marker: PROPOSAL_MARKER, version: 1, kind, path, summary, sourceVersion, beats: args.beats.map((beat: string) => beat.trim()) }
    }
    if ('beats' in args || !args.state || typeof args.state !== 'object' || Array.isArray(args.state)) {
      throw new Error('chapter_summary requires a state object, without beats')
    }
    const state: ProposalChapterState = {}
    let total = 0
    for (const [key, value] of Object.entries(args.state)) {
      if (!['now', 'where', 'knows', 'ended', 'open'].includes(key) || typeof value !== 'string' || /[\r\n\u0000]/.test(value)) {
        throw new Error('chapter_summary state only accepts now, where, knows, ended, open single-line text')
      }
      total += value.trim().length
      state[key as keyof ProposalChapterState] = value.trim()
    }
    if (total > 300) throw new Error('chapter_summary state must be at most 300 characters')
    return { marker: PROPOSAL_MARKER, version: 1, kind, path, summary, sourceVersion, state }
  }
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
    /* oldText 允许为空：表示目标文件当前为空，用 newText 填充全文（由 Host 侧预检把关）。 */
    if (oldText === newText) throw new Error('edit requires different oldText and newText')
    return { marker: PROPOSAL_MARKER, version: 1, kind, path, summary, oldText, newText }
  }
  const text = cleanString(args.text)
  if (!text) throw new Error('create requires text')
  return { marker: PROPOSAL_MARKER, version: 1, kind, path, summary, text }
}

const ALLOWED_KEYS: Record<string, readonly string[]> = {
  edit: ['marker', 'version', 'kind', 'path', 'summary', 'oldText', 'newText'],
  create: ['marker', 'version', 'kind', 'path', 'summary', 'text'],
  chapter_plan: ['marker', 'version', 'kind', 'path', 'summary', 'sourceVersion', 'beats'],
  chapter_summary: ['marker', 'version', 'kind', 'path', 'summary', 'sourceVersion', 'state'],
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
