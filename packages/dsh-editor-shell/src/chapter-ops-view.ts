import { PROPOSAL_MARKER, type ProposalMarker } from 'dsh-editor-novel-kernel/contracts'

/** Kernel markers pin `version: 1`; workbench `PROPOSAL_VERSION` is the same constant. */
export const PROPOSAL_VERSION = 1

const ENTRY_NAME_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const MARKDOWN_CHAPTER = /^正文\/.+\.md$/i

export function isMarkdownChapterPath(path: string): boolean {
  return MARKDOWN_CHAPTER.test(path.replace(/\\/g, '/'))
}

export function dirnameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '' : normalized.slice(0, index)
}

export function basenameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? normalized : normalized.slice(index + 1)
}

function joinDir(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name
}

/** Same single-segment rules the tree uses for `entry.*` / new files, plus a `.md` suffix. */
export function normalizeChapterFileName(input: string): string {
  const name = input.trim()
  if (!name) return ''
  if (/\.[a-z0-9]{1,8}$/i.test(name)) return /\.md$/i.test(name) ? name : ''
  return `${name}.md`
}

export function isValidChapterFileName(input: string): boolean {
  const name = normalizeChapterFileName(input)
  if (!name) return false
  if (name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\')) return false
  if (ENTRY_NAME_FORBIDDEN.test(name) || name.startsWith('.')) return false
  if (name.length > 120 || /[. ]$/.test(name) || RESERVED_NAME.test(name)) return false
  return /\.md$/i.test(name)
}

/**
 * Next unused sibling path: numeric stems get `-2`, `-3`, …;
 * otherwise `{stem}-下.md`, then `{stem}-下2.md`, …
 */
export function suggestSplitName(path: string, existing: readonly string[]): string {
  const directory = dirnameOf(path)
  const stem = basenameOf(path).replace(/\.(md|txt)$/i, '')
  const taken = new Set(existing.map((item) => item.replace(/\\/g, '/')))
  taken.add(path.replace(/\\/g, '/'))
  const candidates = /^\d+$/.test(stem)
    ? (index: number) => joinDir(directory, `${stem}-${index + 2}.md`)
    : (index: number) => joinDir(directory, index === 0 ? `${stem}-下.md` : `${stem}-下${index + 1}.md`)
  for (let index = 0; index < 500; index += 1) {
    const next = candidates(index)
    if (!taken.has(next)) return next
  }
  return candidates(Date.now() % 1000)
}

/** Non-overlapping `indexOf` count; same uniqueness rule as workbench `findAnchor`. */
export function anchorOccurrences(text: string, anchor: string): number {
  if (!anchor) return 0
  let count = 0
  let index = text.indexOf(anchor)
  while (index >= 0) {
    count += 1
    index = text.indexOf(anchor, index + anchor.length)
  }
  return count
}

export function neighbourChapters(path: string, ordered: readonly string[]): { previous?: string; next?: string } {
  const index = ordered.indexOf(path)
  if (index < 0) return {}
  return {
    ...(index > 0 ? { previous: ordered[index - 1] } : {}),
    ...(index < ordered.length - 1 ? { next: ordered[index + 1] } : {}),
  }
}

export function buildSplitProposal(input: { path: string; anchor: string; newPath: string; summary: string }): ProposalMarker {
  return {
    marker: PROPOSAL_MARKER,
    version: PROPOSAL_VERSION,
    kind: 'split',
    summary: input.summary,
    path: input.path.replace(/\\/g, '/'),
    anchor: input.anchor,
    newPath: input.newPath.replace(/\\/g, '/'),
  }
}

export function buildMergeProposal(input: { path: string; sourcePath: string; summary: string }): ProposalMarker {
  return {
    marker: PROPOSAL_MARKER,
    version: PROPOSAL_VERSION,
    kind: 'merge',
    summary: input.summary,
    path: input.path.replace(/\\/g, '/'),
    sourcePath: input.sourcePath.replace(/\\/g, '/'),
  }
}

/** Line containing `offset`; if the caret sits on a blank line, the next non-empty line (or the previous one at EOF). */
export function paragraphAt(text: string, offset: number): string {
  if (!text) return ''
  let cursor = Math.max(0, Math.min(offset, text.length))
  while (cursor < text.length && (text[cursor] === '\n' || text[cursor] === '\r')) cursor += 1
  if (cursor >= text.length) {
    let end = text.length
    while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) end -= 1
    if (end === 0) return ''
    let start = end
    while (start > 0 && text[start - 1] !== '\n' && text[start - 1] !== '\r') start -= 1
    return text.slice(start, end)
  }
  let start = cursor
  while (start > 0 && text[start - 1] !== '\n' && text[start - 1] !== '\r') start -= 1
  let end = cursor
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end += 1
  return text.slice(start, end)
}
