import { PROOFREAD_KINDS, type ProofreadFinding, type ProofreadHabitStat, type ProofreadKind, type ProofreadSeverity } from 'dsh-editor-workbench/contracts'
import { intlLocale, t } from './messages.ts'

export { PROOFREAD_KINDS, type ProofreadFinding, type ProofreadHabitStat, type ProofreadKind, type ProofreadSeverity }

export const SENSITIVE_LIST_PATH = '.dsh-editor/敏感词.txt'
export const SENSITIVE_ALLOW_PATH = '.dsh-editor/敏感词-忽略.txt'

export const PROOFREAD_KIND_LABELS: Record<ProofreadKind, string> = {
  get punctuation() { return t('proofread.kind.punctuation') },
  get typo() { return t('proofread.kind.typo') },
  get sensitive() { return t('proofread.kind.sensitive') },
  get repeat() { return t('proofread.kind.repeat') },
  get habit() { return t('proofread.kind.habit') },
  get card() { return t('proofread.kind.card') },
}

export const PROOFREAD_KIND_CHIP_ORDER: readonly ProofreadKind[] = ['punctuation', 'typo', 'sensitive', 'repeat', 'habit', 'card']

const SEVERITY_RANK: Record<ProofreadSeverity, number> = { error: 0, warning: 1, info: 2 }

export type ProofreadScope = 'document' | 'manuscript'

export type ProofreadFilter = {
  kinds: readonly ProofreadKind[]
  habitTerm: string | null
}

export type ProofreadReplacement = { start: number; end: number; text: string }

export type CombinedReplacements = {
  text: string
  applied: ProofreadReplacement[]
  skipped: ProofreadReplacement[]
}

export type GroupedProofreadFindings = { path: string; findings: ProofreadFinding[] }[]

export type ExcerptParts = { before: string; match: string; after: string }

export type ProofreadEditDraft = { path: string; oldText: string; newText: string; summary: string }

export function proofreadKindLabel(kind: ProofreadKind): string {
  return PROOFREAD_KIND_LABELS[kind] ?? kind
}

export function quotedTerm(message: string): string {
  const match = /「([^」]+)」/.exec(message)
  return match?.[1] ?? ''
}

export function allProofreadKinds(): ProofreadKind[] {
  return [...PROOFREAD_KINDS]
}

export function toggleProofreadKind(kinds: readonly ProofreadKind[], kind: ProofreadKind): ProofreadKind[] {
  return kinds.includes(kind) ? kinds.filter((item) => item !== kind) : [...kinds, kind]
}

export function kindCounts(findings: readonly ProofreadFinding[]): Record<ProofreadKind, number> {
  const counts = { punctuation: 0, sensitive: 0, repeat: 0, typo: 0, habit: 0, card: 0 }
  for (const finding of findings) counts[finding.kind] += 1
  return counts
}

export function isStaleFinding(finding: Pick<ProofreadFinding, 'version'>, currentVersion: string | undefined): boolean {
  return Boolean(currentVersion) && finding.version !== currentVersion
}

export function canProposeProofreadPath(path: string): boolean {
  return /\.md$/i.test(path)
}

export function sortProofreadFindings(findings: readonly ProofreadFinding[]): ProofreadFinding[] {
  return [...findings].sort((left, right) => (
    left.path.localeCompare(right.path, intlLocale(), { numeric: true, sensitivity: 'base' })
    || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || left.start - right.start
    || left.kind.localeCompare(right.kind)
  ))
}

export function filterProofreadFindings(findings: readonly ProofreadFinding[], filter: ProofreadFilter): ProofreadFinding[] {
  return findings.filter((finding) => {
    if (filter.habitTerm) {
      return finding.kind === 'habit' && quotedTerm(finding.message) === filter.habitTerm
    }
    return filter.kinds.includes(finding.kind)
  })
}

export function groupFindingsByFile(findings: readonly ProofreadFinding[]): GroupedProofreadFindings {
  const groups = new Map<string, ProofreadFinding[]>()
  for (const finding of findings) {
    const list = groups.get(finding.path)
    if (list) list.push(finding)
    else groups.set(finding.path, [finding])
  }
  return [...groups.entries()].map(([path, group]) => ({ path, findings: sortProofreadFindings(group) }))
}

export function excerptParts(excerpt: string, needle: string): ExcerptParts {
  if (!needle) return { before: excerpt, match: '', after: '' }
  const index = excerpt.indexOf(needle)
  if (index < 0) return { before: excerpt, match: '', after: '' }
  return { before: excerpt.slice(0, index), match: needle, after: excerpt.slice(index + needle.length) }
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = 0
  while ((index = text.indexOf(needle, index)) >= 0) {
    count++
    index += Math.max(1, needle.length)
  }
  return count
}

export function combineReplacements(source: string, replacements: readonly ProofreadReplacement[]): CombinedReplacements {
  const ordered = [...replacements].sort((left, right) => left.start - right.start || left.end - right.end)
  const applied: ProofreadReplacement[] = []
  const skipped: ProofreadReplacement[] = []
  let lastEnd = 0
  let text = ''
  for (const item of ordered) {
    if (item.start < lastEnd || item.start < 0 || item.end > source.length || item.end < item.start) {
      skipped.push(item)
      continue
    }
    text += source.slice(lastEnd, item.start) + item.text
    lastEnd = item.end
    applied.push(item)
  }
  text += source.slice(lastEnd)
  return { text, applied, skipped }
}

export function uniqueReplacement(source: string, start: number, end: number, replacement: string): { oldText: string; newText: string } | undefined {
  if (start < 0 || end > source.length || end < start) return undefined
  const span = source.slice(start, end)
  if (span === replacement) return undefined
  if (span && countOccurrences(source, span) === 1) return { oldText: span, newText: replacement }
  let left = start
  let right = end
  while (left > 0 || right < source.length) {
    if (left > 0) left--
    else right++
    const oldText = source.slice(left, right)
    if (!oldText || countOccurrences(source, oldText) !== 1) continue
    const newText = source.slice(left, start) + replacement + source.slice(end, right)
    if (oldText === newText) return undefined
    return { oldText, newText }
  }
  const newText = source.slice(0, start) + replacement + source.slice(end)
  if (source === newText) return undefined
  return { oldText: source, newText }
}

export function documentPunctuationFindings(
  findings: readonly ProofreadFinding[],
  path: string,
  version: string,
): ProofreadFinding[] {
  return findings.filter((finding) => (
    finding.kind === 'punctuation'
    && finding.path === path
    && finding.version === version
    && finding.suggestion !== undefined
  ))
}

export function replacementsFromFindings(findings: readonly ProofreadFinding[]): ProofreadReplacement[] {
  const replacements: ProofreadReplacement[] = []
  for (const finding of findings) {
    if (finding.suggestion === undefined) continue
    replacements.push({ start: finding.start, end: finding.end, text: finding.suggestion })
  }
  return replacements
}

export function singleFindingEdit(source: string, finding: ProofreadFinding): ProofreadEditDraft | undefined {
  if (finding.suggestion === undefined || !canProposeProofreadPath(finding.path)) return undefined
  const unique = uniqueReplacement(source, finding.start, finding.end, finding.suggestion)
  if (!unique) return undefined
  return { path: finding.path, oldText: unique.oldText, newText: unique.newText, summary: t('proofread.editSummary', { message: finding.message }) }
}

export function batchPunctuationEdit(source: string, path: string, findings: readonly ProofreadFinding[]): ProofreadEditDraft | undefined {
  if (!canProposeProofreadPath(path)) return undefined
  const combined = combineReplacements(source, replacementsFromFindings(findings))
  if (!combined.applied.length || combined.text === source) return undefined
  return {
    path,
    oldText: source,
    newText: combined.text,
    summary: t('proofread.batchSummary', { count: combined.applied.length }),
  }
}

export function parseIgnoreTerms(text: string): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').replace(/#.*$/, '').trim()
    if (!line || seen.has(line)) continue
    seen.add(line)
    terms.push(line)
  }
  return terms
}

export function appendIgnoreLine(existing: string | null | undefined, term: string): string {
  const value = term.trim()
  if (!value) return existing ?? ''
  if (parseIgnoreTerms(existing ?? '').includes(value)) return existing ?? `${value}\n`
  const body = (existing ?? '').replace(/\s+$/, '')
  return body ? `${body}\n${value}\n` : `${value}\n`
}

export function formatPerThousand(value: number): string {
  return `${value.toLocaleString(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 })}‰`
}

export function proofreadSkippedText(skipped: number): string {
  return skipped > 0 ? t('proofread.skipped', { count: skipped }) : ''
}
