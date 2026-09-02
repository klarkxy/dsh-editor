/** Browser-safe protocol shared with the editor Shell. */
export const NOVEL_KNOWLEDGE_TOOL_NAME = 'novel_knowledge'
export const PROPOSAL_TOOL_NAME = 'novel_propose'
export const ZHIHU_SEARCH_TOOL_NAME = 'zhihu_search'
export const PROJECT_KNOWLEDGE_TOOL_NAME = 'project_knowledge'
export const PROPOSAL_MARKER = 'dsh-editor.proposal'

export type ProposalMarker = {
  marker: typeof PROPOSAL_MARKER
  version: 1
  kind: 'edit' | 'create'
  path: string
  summary: string
  oldText?: string
  newText?: string
  text?: string
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function aliasedString(args: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    if (typeof args[name] === 'string') return args[name]
  }
  return ''
}

/** Validates and normalizes the preview-only proposal result. */
export function proposalMarker(args: Record<string, unknown>): ProposalMarker {
  const kind = cleanString(args.kind)
  const path = cleanString(args.path).replace(/\\/g, '/')
  const summary = cleanString(args.summary).trim()
  if ((kind !== 'edit' && kind !== 'create') || !path || !summary) throw new Error('kind, path and summary are required')
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').includes('..') || !/\.md$/i.test(path)) {
    throw new Error('path must be a project-relative Markdown file')
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

/** Parses a serialized tool result before the browser renders an author proposal. */
export function parseProposalMarker(text: string): ProposalMarker | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Partial<ProposalMarker> & Record<string, unknown>
  if (row.marker !== PROPOSAL_MARKER || row.version !== 1) return undefined
  if ((row.kind !== 'edit' && row.kind !== 'create') || typeof row.path !== 'string' || typeof row.summary !== 'string') return undefined
  if (row.kind === 'edit' && (typeof row.oldText !== 'string' || typeof row.newText !== 'string')) return undefined
  if (row.kind === 'create' && typeof row.text !== 'string') return undefined
  const allowed = new Set(row.kind === 'edit'
    ? ['marker', 'version', 'kind', 'path', 'summary', 'oldText', 'newText']
    : ['marker', 'version', 'kind', 'path', 'summary', 'text'])
  if (Object.keys(row).some((key) => !allowed.has(key))) return undefined
  try {
    const parsed = proposalMarker(row)
    if (parsed.path !== row.path || parsed.summary !== row.summary) return undefined
    return parsed
  } catch {
    return undefined
  }
}
