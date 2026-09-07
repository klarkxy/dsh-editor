export type ReplaceableHit = {
  path: string
  start: number
  end: number
  version: string
}

export type ReplaceSpan = {
  start: number
  end: number
}

export type ReplaceFilePlan = {
  path: string
  version: string
  spans: ReplaceSpan[]
}

export type ReplacePlan = {
  replacement: string
  files: ReplaceFilePlan[]
  skipped: number
  stale: string[]
}

export type ReplacePlanSummary = {
  files: number
  occurrences: number
  skipped: number
  staleFiles: number
  perFile: { path: string; count: number }[]
}

export type ReplaceReadVerdict = 'ok' | 'stale' | 'changed'

const NATURAL_PATH_LOCALE = 'zh-CN'

function naturalPathOrder(left: string, right: string): number {
  return left.localeCompare(right, NATURAL_PATH_LOCALE, { numeric: true })
}

function spansOverlap(left: ReplaceSpan, right: ReplaceSpan): boolean {
  return left.start < right.end && right.start < left.end
}

function isValidSpan(span: ReplaceSpan): boolean {
  return Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end >= span.start
}

function collapseSpans(hits: readonly ReplaceableHit[]): { spans: ReplaceSpan[]; skipped: number } {
  const sorted = hits
    .map((hit) => ({ start: hit.start, end: hit.end }))
    .sort((left, right) => right.start - left.start || right.end - left.end)
  const kept: ReplaceSpan[] = []
  let skipped = 0
  for (const span of sorted) {
    if (!isValidSpan(span) || kept.some((other) => spansOverlap(span, other))) {
      skipped += 1
      continue
    }
    kept.push(span)
  }
  return { spans: kept, skipped }
}

export function planReplace(hits: readonly ReplaceableHit[], replacement: string): ReplacePlan {
  const groups = new Map<string, ReplaceableHit[]>()
  for (const hit of hits) {
    const list = groups.get(hit.path)
    if (list) list.push(hit)
    else groups.set(hit.path, [hit])
  }

  const files: ReplaceFilePlan[] = []
  const stale: string[] = []
  let skipped = 0

  for (const path of [...groups.keys()].sort(naturalPathOrder)) {
    const group = groups.get(path)!
    const versions = new Set(group.map((hit) => hit.version))
    if (versions.size !== 1) {
      stale.push(path)
      continue
    }
    const collapsed = collapseSpans(group)
    skipped += collapsed.skipped
    if (!collapsed.spans.length) continue
    files.push({ path, version: group[0]!.version, spans: collapsed.spans })
  }

  return { replacement, files, skipped, stale }
}

export function applyReplaceToText(text: string, spans: readonly ReplaceSpan[], replacement: string): string {
  for (const span of spans) {
    if (!isValidSpan(span) || span.end > text.length) {
      throw new RangeError('replace span is out of range')
    }
  }
  const ordered = [...spans].sort((left, right) => right.start - left.start || right.end - left.end)
  let next = text
  for (const span of ordered) {
    next = `${next.slice(0, span.start)}${replacement}${next.slice(span.end)}`
  }
  return next
}

export function spansMatchQuery(text: string, spans: readonly ReplaceSpan[], query: string): boolean {
  const needle = query.toLowerCase()
  return spans.every((span) => {
    if (span.start < 0 || span.end > text.length || span.end < span.start) return false
    return text.slice(span.start, span.end).toLowerCase() === needle
  })
}

export function classifyReplaceRead(
  file: ReplaceFilePlan,
  read: { text: string; version: string },
  query: string,
): ReplaceReadVerdict {
  if (read.version !== file.version) return 'stale'
  if (!spansMatchQuery(read.text, file.spans, query)) return 'changed'
  return 'ok'
}

export function prepareReplaceWrite(
  file: ReplaceFilePlan,
  read: { text: string; version: string },
  query: string,
  replacement: string,
): { ok: true; text: string } | { ok: false; reason: Exclude<ReplaceReadVerdict, 'ok'> } {
  const verdict = classifyReplaceRead(file, read, query)
  if (verdict !== 'ok') return { ok: false, reason: verdict }
  return { ok: true, text: applyReplaceToText(read.text, file.spans, replacement) }
}

export function summarizeReplacePlan(plan: ReplacePlan): ReplacePlanSummary {
  return {
    files: plan.files.length,
    occurrences: plan.files.reduce((count, file) => count + file.spans.length, 0),
    skipped: plan.skipped,
    staleFiles: plan.stale.length,
    perFile: plan.files.map((file) => ({ path: file.path, count: file.spans.length })),
  }
}
