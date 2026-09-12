import {
  PROOFREAD_KINDS,
  PROOFREAD_MAX_FINDINGS,
  type ProofreadFinding,
  type ProofreadHabitStat,
  type ProofreadKind,
} from './contracts.ts'
import {
  BUNDLED_SENSITIVE_TEXT,
  BUNDLED_TYPOS,
  HABIT_MAX_OCCURRENCES,
  HABIT_PER_THOUSAND_THRESHOLD,
  HABIT_STATS_LIMIT,
  HABIT_TERMS,
  REDUPLICATION_WHITELIST,
  type TypoPattern,
} from './defaults.ts'

export { PROOFREAD_MAX_FINDINGS }
export { HABIT_MAX_OCCURRENCES, HABIT_PER_THOUSAND_THRESHOLD, HABIT_STATS_LIMIT }
export type { TypoPattern }

const MAX_REPEAT_PHRASE = 8
/** 一X一X measure stacking (一段一段) is ordinary Chinese, not a stutter. */
function isNaturalMeasureStack(phrase: string): boolean {
  return phrase.length === 2 && phrase[0] === '一'
}
const REPEAT_WINDOW = 12
const HALF_TO_FULL: Record<string, string> = {
  ',': '，',
  '.': '。',
  '?': '？',
  '!': '！',
  ':': '：',
  ';': '；',
  '(': '（',
  ')': '）',
}
const DUPLICATE_PUNCT = new Set(['。', '，', '、', '！', '？', '：', '；', ',', '.', '!', '?', ':', ';'])
const ELLIPSIS = '…'
const EM_DASH = '—'
const QUOTE_OPEN: Record<string, string> = { '“': '”', '「': '」' }
const QUOTE_CLOSE: Record<string, string> = { '”': '“', '」': '「' }

export type ProofreadTextOptions = {
  path?: string
  version?: string
  kinds?: readonly ProofreadKind[]
  typos?: readonly TypoPattern[]
  sensitiveTerms?: readonly string[]
  sensitiveAllowlist?: readonly string[]
  habitTerms?: readonly string[]
  habitThreshold?: number
  habitMaxOccurrences?: number
  maxFindings?: number
}

export type ProofreadTextResult = {
  findings: ProofreadFinding[]
  habitStats: ProofreadHabitStat[]
  truncated: boolean
}

export function parseTermList(text: string): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').replace(/#.*$/, '').trim()
    if (!line || line.length > 64 || /[\u0000-\u001f\u007f]/.test(line)) continue
    if (seen.has(line)) continue
    seen.add(line)
    terms.push(line)
  }
  return terms
}

export function bundledSensitiveTerms(): string[] {
  return parseTermList(BUNDLED_SENSITIVE_TEXT)
}

export function pathCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function isCjk(code: number): boolean {
  return (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)
}

function isCjkAt(text: string, index: number): boolean {
  return index >= 0 && index < text.length && isCjk(text.charCodeAt(index))
}

function isAnalyzed(text: string, index: number): boolean {
  const ch = text[index]
  return ch !== undefined && ch !== '\0'
}

function allCjkSpan(text: string, start: number, end: number): boolean {
  if (end <= start) return false
  for (let index = start; index < end; index++) {
    if (!isCjkAt(text, index) || !isAnalyzed(text, index)) return false
  }
  return true
}

function frontmatterEnd(text: string): number {
  const bom = text.startsWith('\uFEFF') ? 1 : 0
  const source = text.slice(bom)
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) return 0
  const close = /\r?\n---(?:\r?\n|$)/g
  close.lastIndex = source.indexOf('\n') + 1
  const match = close.exec(source)
  if (!match || match.index > 4_096) return 0
  return bom + match.index + match[0].length
}

export function maskForAnalysis(text: string): string {
  const chars = text.split('')
  const end = frontmatterEnd(text)
  for (let index = 0; index < end; index++) {
    const ch = chars[index]
    if (ch !== '\n' && ch !== '\r') chars[index] = '\0'
  }
  let cursor = 0
  while (cursor < text.length) {
    const newline = text.indexOf('\n', cursor)
    const lineEnd = newline === -1 ? text.length : newline
    const line = text.slice(cursor, lineEnd).replace(/\r$/, '')
    const marker = /^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/.exec(line)
    if (marker) {
      for (let offset = 0; offset < marker[0].length; offset++) {
        if (chars[cursor + offset] !== '\r') chars[cursor + offset] = '\0'
      }
    }
    cursor = lineEnd + 1
  }
  return chars.join('')
}

function locate(text: string, start: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < start && index < text.length; index++) {
    if (text[index] === '\n') {
      line++
      lineStart = index + 1
    }
  }
  return { line, column: start - lineStart + 1 }
}

function lineExcerpt(text: string, start: number, end: number): string {
  let lineStart = start
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--
  let lineEnd = start
  while (lineEnd < text.length && text[lineEnd] !== '\n') lineEnd++
  const line = text.slice(lineStart, lineEnd).replace(/\r$/, '')
  const local = Math.max(0, start - lineStart)
  const length = Math.max(1, end - start)
  const left = Math.max(0, local - 44)
  const right = Math.min(line.length, local + length + 64)
  return `${left > 0 ? '…' : ''}${line.slice(left, right).trim()}${right < line.length ? '…' : ''}`
}

export function finding(
  raw: string,
  start: number,
  end: number,
  kind: ProofreadKind,
  severity: ProofreadFinding['severity'],
  message: string,
  path: string,
  version: string,
  suggestion?: string,
  extra?: { code?: string; term?: string },
): ProofreadFinding {
  const { line, column } = locate(raw, start)
  return {
    path,
    line,
    column,
    start,
    end,
    kind,
    severity,
    message,
    excerpt: lineExcerpt(raw, start, end),
    ...(suggestion !== undefined ? { suggestion } : {}),
    ...(extra?.code ? { code: extra.code } : {}),
    ...(extra?.term !== undefined ? { term: extra.term } : {}),
    version,
  }
}

export function analyzedChars(masked: string): number {
  let count = 0
  for (let index = 0; index < masked.length; index++) {
    const ch = masked[index]!
    if (ch !== '\0' && !/\s/.test(ch)) count++
  }
  return count
}

function typoAllowed(text: string, start: number, entry: TypoPattern): boolean {
  if (entry.notBefore) {
    for (const prefix of entry.notBefore) {
      if (start >= prefix.length && text.slice(start - prefix.length, start) === prefix) return false
    }
  }
  if (entry.notAfter) {
    const after = start + entry.from.length
    for (const suffix of entry.notAfter) {
      if (text.slice(after, after + suffix.length) === suffix) return false
    }
  }
  return true
}

function scanDictionary(
  masked: string,
  terms: readonly { key: string; extra?: TypoPattern }[],
): Array<{ start: number; end: number; key: string; extra?: TypoPattern }> {
  const ordered = [...terms].sort((left, right) => right.key.length - left.key.length || left.key.localeCompare(right.key, 'zh-CN'))
  const hits: Array<{ start: number; end: number; key: string; extra?: TypoPattern }> = []
  let index = 0
  while (index < masked.length) {
    if (!isAnalyzed(masked, index)) {
      index++
      continue
    }
    let matched: (typeof hits)[number] | undefined
    for (const term of ordered) {
      if (!term.key || !masked.startsWith(term.key, index)) continue
      const end = index + term.key.length
      let clean = true
      for (let cursor = index; cursor < end; cursor++) {
        if (!isAnalyzed(masked, cursor)) { clean = false; break }
      }
      if (!clean) continue
      if (term.extra && !typoAllowed(masked, index, term.extra)) continue
      matched = { start: index, end, key: term.key, extra: term.extra }
      break
    }
    if (matched) {
      hits.push(matched)
      index = matched.end
    } else {
      index++
    }
  }
  return hits
}

function scanPunctuation(masked: string, raw: string, path: string, version: string, sink: ProofreadFinding[]): void {
  for (let index = 0; index < masked.length; index++) {
    if (!isAnalyzed(masked, index)) continue
    const ch = masked[index]!
    const mapped = HALF_TO_FULL[ch]
    if (mapped && isCjkAt(masked, index - 1) && isCjkAt(masked, index + 1)) {
      sink.push(finding(raw, index, index + 1, 'punctuation', 'warning', `半角「${ch}」应使用全角`, path, version, mapped))
    }
    if ((ch === ' ' || ch === '\t') && isCjkAt(masked, index - 1)) {
      let end = index
      while (end < masked.length && (masked[end] === ' ' || masked[end] === '\t')) end++
      if (isCjkAt(masked, end)) {
        sink.push(finding(raw, index, end, 'punctuation', 'warning', '汉字之间存在空格', path, version, ''))
        index = end - 1
      }
    }
  }

  for (let index = 0; index < masked.length; index++) {
    if (!isAnalyzed(masked, index)) continue
    const ch = masked[index]!
    if (ch === ELLIPSIS || ch === EM_DASH) {
      let end = index + 1
      while (end < masked.length && masked[end] === ch && isAnalyzed(masked, end)) end++
      index = end - 1
      continue
    }
    if (!DUPLICATE_PUNCT.has(ch)) continue
    let end = index + 1
    while (end < masked.length && masked[end] === ch && isAnalyzed(masked, end)) end++
    if (end - index >= 2) {
      const suggestion = ch === '.' && end - index >= 3 ? '……' : (HALF_TO_FULL[ch] ?? ch)
      sink.push(finding(raw, index, end, 'punctuation', 'warning', '连续重复标点', path, version, suggestion))
      index = end - 1
    }
  }

  const mix = /[?？!！]{2,}/g
  let match: RegExpExecArray | null
  while ((match = mix.exec(masked))) {
    const start = match.index
    const value = match[0]!
    let clean = true
    for (let cursor = start; cursor < start + value.length; cursor++) {
      if (!isAnalyzed(masked, cursor)) { clean = false; break }
    }
    if (!clean) continue
    if (value === '？！' || value === '！？') continue
    if (/^([？！?!])\1+$/.test(value)) continue
    const suggestion = /[!！]/.test(value) && /[?？]/.test(value) ? (value.includes('！') || value.startsWith('!') ? '！？' : '？！') : (HALF_TO_FULL[value[0]!] ?? '？！')
    sink.push(finding(raw, start, start + value.length, 'punctuation', 'warning', '问号感叹号半全角混用', path, version, suggestion))
  }

  const stack: Array<{ ch: string; index: number }> = []
  for (let index = 0; index < masked.length; index++) {
    if (!isAnalyzed(masked, index)) continue
    const ch = masked[index]!
    if (QUOTE_OPEN[ch]) {
      stack.push({ ch, index })
      continue
    }
    const open = QUOTE_CLOSE[ch]
    if (!open) continue
    const top = stack.pop()
    if (!top || top.ch !== open) {
      sink.push(finding(raw, index, index + 1, 'punctuation', 'warning', '引号未配对', path, version))
      if (top) stack.push(top)
    }
  }
  for (const leftover of stack) {
    sink.push(finding(raw, leftover.index, leftover.index + 1, 'punctuation', 'warning', '引号未配对', path, version))
  }
}

function scanTypos(masked: string, raw: string, path: string, version: string, typos: readonly TypoPattern[], sink: ProofreadFinding[]): void {
  const terms = typos.filter((entry) => entry.from && entry.to && entry.from !== entry.to).map((entry) => ({ key: entry.from, extra: entry }))
  for (const hit of scanDictionary(masked, terms)) {
    sink.push(finding(raw, hit.start, hit.end, 'typo', 'error', `疑似错别字「${hit.key}」`, path, version, hit.extra?.to))
  }
}

function scanSensitive(masked: string, raw: string, path: string, version: string, terms: readonly string[], sink: ProofreadFinding[]): void {
  const unique = [...new Set(terms.filter(Boolean))]
  for (const hit of scanDictionary(masked, unique.map((key) => ({ key })))) {
    sink.push(finding(raw, hit.start, hit.end, 'sensitive', 'warning', `敏感词「${hit.key}」`, path, version))
  }
}

function scanRepeat(masked: string, raw: string, path: string, version: string, sink: ProofreadFinding[]): void {
  const covered = new Uint8Array(masked.length)
  const mark = (start: number, end: number): boolean => {
    for (let index = start; index < end; index++) {
      if (covered[index]) return false
    }
    covered.fill(1, start, end)
    return true
  }

  for (let index = 0; index < masked.length; index++) {
    if (!isCjkAt(masked, index) || covered[index]) continue
    let reported = false
    const maxLen = Math.min(MAX_REPEAT_PHRASE, Math.floor((masked.length - index) / 2))
    for (let len = maxLen; len >= 2; len--) {
      if (!allCjkSpan(masked, index, index + len) || !allCjkSpan(masked, index + len, index + len * 2)) continue
      const phrase = masked.slice(index, index + len)
      if (masked.slice(index + len, index + len * 2) !== phrase) continue
      if (REDUPLICATION_WHITELIST.has(phrase)) continue
      const end = index + len * 2
      if (!mark(index, end)) continue
      const naturalStack = isNaturalMeasureStack(phrase)
      sink.push(finding(
        raw,
        index,
        end,
        'repeat',
        naturalStack ? 'info' : 'warning',
        naturalStack ? `建议核对叠词「${phrase}${phrase}」` : `词语重复「${phrase}」`,
        path,
        version,
      ))
      index = end - 1
      reported = true
      break
    }
    if (reported) continue
    if (isCjkAt(masked, index + 1) && masked[index] === masked[index + 1]) {
      const pair = masked.slice(index, index + 2)
      if (!REDUPLICATION_WHITELIST.has(pair) && mark(index, index + 2)) {
        sink.push(finding(raw, index, index + 2, 'repeat', 'warning', `词语重复「${pair}」`, path, version))
        index++
      }
    }
  }

  for (let index = 0; index < masked.length; index++) {
    if (!isCjkAt(masked, index) || covered[index]) continue
    const maxLen = Math.min(MAX_REPEAT_PHRASE, masked.length - index)
    for (let len = maxLen; len >= 2; len--) {
      if (!allCjkSpan(masked, index, index + len)) continue
      const phrase = masked.slice(index, index + len)
      if (REDUPLICATION_WHITELIST.has(phrase)) continue
      const windowStart = index + len
      const windowEnd = Math.min(masked.length, windowStart + REPEAT_WINDOW)
      const window = masked.slice(windowStart, windowEnd)
      const offset = window.indexOf(phrase)
      if (offset < 0) continue
      const second = windowStart + offset
      if (!allCjkSpan(masked, second, second + len)) continue
      const end = second + len
      if (end - (index + len) > REPEAT_WINDOW) continue
      if (!mark(index, end)) continue
      sink.push(finding(raw, index, end, 'repeat', 'warning', `词语重复「${phrase}」`, path, version))
      index = end - 1
      break
    }
  }
}

export type HabitHit = { key: string; start: number; end: number; path: string; version: string; raw: string }

export function collectHabitHits(
  masked: string,
  raw: string,
  path: string,
  version: string,
  terms: readonly string[],
  counts: Map<string, number>,
): HabitHit[] {
  const ordered = [...new Set(terms.filter(Boolean))].sort((left, right) => right.length - left.length || left.localeCompare(right, 'zh-CN'))
  const hits = scanDictionary(masked, ordered.map((key) => ({ key })))
  for (const hit of hits) counts.set(hit.key, (counts.get(hit.key) ?? 0) + 1)
  return hits.map((hit) => ({ key: hit.key, start: hit.start, end: hit.end, path, version, raw }))
}

export function emitHabitFindings(
  hits: readonly HabitHit[],
  counts: Map<string, number>,
  chars: number,
  threshold: number,
  maxOccurrences: number,
  sink: ProofreadFinding[],
): void {
  const emitted = new Map<string, number>()
  for (const hit of hits) {
    const count = counts.get(hit.key) ?? 0
    if (chars === 0 || (count * 1000) / chars <= threshold) continue
    const used = emitted.get(hit.key) ?? 0
    if (used >= maxOccurrences) continue
    emitted.set(hit.key, used + 1)
    sink.push(finding(hit.raw, hit.start, hit.end, 'habit', 'info', `口癖「${hit.key}」偏多`, hit.path, hit.version))
  }
}

export function habitStatsFrom(counts: Map<string, number>, chars: number): ProofreadHabitStat[] {
  return [...counts.entries()]
    .map(([term, count]) => ({
      term,
      count,
      perThousand: chars === 0 ? 0 : Math.round((count * 1000 / chars) * 100) / 100,
    }))
    .sort((left, right) => right.count - left.count || right.perThousand - left.perThousand || left.term.localeCompare(right.term, 'zh-CN'))
    .slice(0, HABIT_STATS_LIMIT)
}

function enabled(kinds: readonly ProofreadKind[], kind: ProofreadKind): boolean {
  return kinds.includes(kind)
}

export function proofreadText(text: string, options: ProofreadTextOptions = {}): ProofreadTextResult {
  const kinds = options.kinds ?? PROOFREAD_KINDS
  const path = options.path ?? ''
  const version = options.version ?? ''
  const maxFindings = options.maxFindings ?? PROOFREAD_MAX_FINDINGS
  const masked = maskForAnalysis(text)
  const findings: ProofreadFinding[] = []
  if (enabled(kinds, 'punctuation')) scanPunctuation(masked, text, path, version, findings)
  if (enabled(kinds, 'typo')) scanTypos(masked, text, path, version, options.typos ?? BUNDLED_TYPOS, findings)
  if (enabled(kinds, 'sensitive')) {
    const allow = new Set(options.sensitiveAllowlist ?? [])
    const terms = (options.sensitiveTerms ?? bundledSensitiveTerms()).filter((term) => !allow.has(term))
    scanSensitive(masked, text, path, version, terms, findings)
  }
  if (enabled(kinds, 'repeat')) scanRepeat(masked, text, path, version, findings)
  const counts = new Map<string, number>()
  if (enabled(kinds, 'habit')) {
    const hits = collectHabitHits(masked, text, path, version, options.habitTerms ?? HABIT_TERMS, counts)
    emitHabitFindings(
      hits,
      counts,
      analyzedChars(masked),
      options.habitThreshold ?? HABIT_PER_THOUSAND_THRESHOLD,
      options.habitMaxOccurrences ?? HABIT_MAX_OCCURRENCES,
      findings,
    )
  }
  const truncated = findings.length > maxFindings
  findings.sort((left, right) => pathCompare(left.path, right.path) || left.start - right.start || left.kind.localeCompare(right.kind))
  return {
    findings: truncated ? findings.slice(0, maxFindings) : findings,
    habitStats: enabled(kinds, 'habit') ? habitStatsFrom(counts, analyzedChars(masked)) : [],
    truncated,
  }
}
