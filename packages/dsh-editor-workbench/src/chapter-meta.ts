import {
  formatYamlList,
  formatYamlScalar,
  normalizeStringList,
  parseFrontmatterItems,
  parseStringListField,
  parseYamlScalar,
  splitFrontmatter,
  type FrontmatterItem,
} from './frontmatter.ts'

export type ChapterStateFields = {
  now?: string
  where?: string
  knows?: string
  ended?: string
  open?: string
}

export type ChapterMetaFields = {
  beats?: string[]
  state?: ChapterStateFields
}

export const CHAPTER_STATE_KEYS = ['now', 'where', 'knows', 'ended', 'open'] as const
export const CHAPTER_STATE_MAX_TOTAL_CHARS = 300
export const CHAPTER_BEATS_MAX = 12
export const CHAPTER_BEAT_MAX_CHARS = 120
const CHAPTER_CONTEXT_TEXT_MAX = 1_200

const STATE_LABELS: Record<(typeof CHAPTER_STATE_KEYS)[number], string> = {
  now: '此刻',
  where: '谁在哪',
  knows: '谁知道什么',
  ended: '上一段停在',
  open: '未收伏笔',
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function isStateKey(key: string): key is (typeof CHAPTER_STATE_KEYS)[number] {
  return (CHAPTER_STATE_KEYS as readonly string[]).includes(key)
}

function fieldValue(raw: string): string {
  const line = raw.split(/\r?\n/, 1)[0] ?? raw
  const field = /^[A-Za-z][\w-]*:\s*(.*)$/.exec(line)
  return field?.[1] ?? ''
}

function fieldBlockLines(raw: string): string[] {
  return raw.split(/\r?\n/).slice(1)
}

function hasStateValues(state?: ChapterStateFields): boolean {
  return Boolean(state && CHAPTER_STATE_KEYS.some((key) => state[key]?.trim()))
}

function parseStateField(raw: string): ChapterStateFields | undefined {
  if (fieldValue(raw).trim()) return undefined
  const state: ChapterStateFields = {}
  const seen = new Set<string>()
  for (const line of fieldBlockLines(raw)) {
    if (/^\s*#/.test(line) || !line.trim()) continue
    const field = /^\s+([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!field) continue
    const key = field[1]!
    if (!isStateKey(key) || seen.has(key)) continue
    const parsed = parseYamlScalar(field[2] ?? '')
    if (parsed === undefined) continue
    const value = parsed.trim()
    if (!value) continue
    seen.add(key)
    state[key] = value
  }
  return hasStateValues(state) ? state : undefined
}

function parseBeatsField(raw: string): string[] | undefined {
  const values = parseStringListField(raw)
  if (!values) return undefined
  const beats = values.map((item) => item.trim()).filter(Boolean)
  return beats.length ? beats : undefined
}

export function parseChapterMeta(text: string): ChapterMetaFields | undefined {
  const split = splitFrontmatter(text)
  if (!split.explicit) return {}
  if (!split.closed) return undefined
  const items = parseFrontmatterItems(split.header)
  if (!items) return undefined
  const fields: ChapterMetaFields = {}
  const seen = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'field' || seen.has(item.key)) continue
    if (item.key === 'beats') {
      seen.add(item.key)
      const beats = parseBeatsField(item.raw)
      if (beats) fields.beats = beats
      continue
    }
    if (item.key === 'state') {
      seen.add(item.key)
      const state = parseStateField(item.raw)
      if (state) fields.state = state
    }
  }
  return fields
}

function sanitizeBeats(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  const normalized = normalizeStringList(values)
  if (normalized) return normalized.length ? normalized : undefined
  const beats: string[] = []
  for (const raw of values) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (value) beats.push(value)
  }
  return beats.length ? beats : undefined
}

function sanitizeState(state: ChapterStateFields | undefined): ChapterStateFields | undefined {
  if (!state) return undefined
  const next: ChapterStateFields = {}
  for (const key of CHAPTER_STATE_KEYS) {
    const raw = state[key]
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (value) next[key] = value
  }
  return hasStateValues(next) ? next : undefined
}

function sanitizeChapterMeta(fields: ChapterMetaFields): ChapterMetaFields {
  const next: ChapterMetaFields = {}
  const beats = fields.beats ? sanitizeBeats(fields.beats) : undefined
  const state = sanitizeState(fields.state)
  if (beats) next.beats = beats
  if (state) next.state = state
  return next
}

export function validateChapterMeta(fields: ChapterMetaFields): string[] {
  const issues: string[] = []
  if (fields.beats) {
    if (fields.beats.length > CHAPTER_BEATS_MAX) issues.push('节拍最多 12 条')
    if (fields.beats.some((beat) => !beat.trim())) issues.push('节拍不能为空')
    if (fields.beats.some((beat) => beat.length > CHAPTER_BEAT_MAX_CHARS)) issues.push('单条节拍不能超过 120 字')
    if (fields.beats.some((beat) => CONTROL_CHARS.test(beat))) issues.push('节拍不能包含控制字符')
  }
  if (fields.state) {
    let total = 0
    for (const key of CHAPTER_STATE_KEYS) {
      const value = fields.state[key]
      if (value === undefined) continue
      total += value.length
      if (value.length > CHAPTER_STATE_MAX_TOTAL_CHARS) issues.push(`状态字段 ${key} 不能超过 300 字`)
      if (CONTROL_CHARS.test(value)) issues.push('状态字段不能包含控制字符')
    }
    if (total > CHAPTER_STATE_MAX_TOTAL_CHARS) issues.push('章末状态合计不能超过 300 字')
  }
  return issues
}

function serializeStateField(state: ChapterStateFields): string[] {
  const lines = ['state:']
  for (const key of CHAPTER_STATE_KEYS) {
    const value = state[key]
    if (!value) continue
    lines.push(`  ${key}: ${formatYamlScalar(value)}`)
  }
  return lines
}

function mergeChapterMeta(current: ChapterMetaFields, patch: Partial<ChapterMetaFields>): ChapterMetaFields {
  const next: ChapterMetaFields = { ...current, state: current.state ? { ...current.state } : undefined }
  if ('beats' in patch) {
    if (!patch.beats?.length) delete next.beats
    else next.beats = patch.beats
  }
  if ('state' in patch) {
    if (!hasStateValues(patch.state)) delete next.state
    else next.state = { ...patch.state }
  }
  if (!next.state || !hasStateValues(next.state)) delete next.state
  return next
}

function headerKeepable(items: readonly FrontmatterItem[]): boolean {
  return items.some((item) => item.kind === 'comment' || (item.kind === 'field' && item.key !== 'beats' && item.key !== 'state'))
}

export function applyChapterMeta(text: string, patch: Partial<ChapterMetaFields>): string {
  const split = splitFrontmatter(text)
  if (split.explicit && !split.closed) throw new Error('章节 frontmatter 未闭合')
  const items = split.explicit ? parseFrontmatterItems(split.header) : []
  if (split.explicit && !items) throw new Error('章节 frontmatter 无法解析')

  const current = parseChapterMeta(text) ?? {}
  const sanitized = sanitizeChapterMeta(mergeChapterMeta(current, patch))
  const issues = validateChapterMeta(sanitized)
  if (issues.length) throw new Error(issues.join('；'))

  const hasBeats = Boolean(sanitized.beats?.length)
  const hasState = hasStateValues(sanitized.state)
  const existing = items ?? []
  if (!hasBeats && !hasState && !headerKeepable(existing)) {
    return split.explicit ? `${split.bom}${split.body}` : text
  }

  const written = new Set<string>()
  const lines: string[] = []
  for (const item of existing) {
    if (item.kind === 'comment' || item.kind === 'blank') {
      lines.push(item.raw)
      continue
    }
    if (item.key === 'beats') {
      written.add('beats')
      if (hasBeats) lines.push(`beats: ${formatYamlList(sanitized.beats!)}`)
      continue
    }
    if (item.key === 'state') {
      written.add('state')
      if (hasState) lines.push(...serializeStateField(sanitized.state!))
      continue
    }
    lines.push(...item.raw.split(/\r?\n/))
    written.add(item.key)
  }
  if (hasBeats && !written.has('beats')) lines.push(`beats: ${formatYamlList(sanitized.beats!)}`)
  if (hasState && !written.has('state')) lines.push(...serializeStateField(sanitized.state!))

  const compact = lines.filter((line, index, all) => !(line === '' && all[index - 1] === ''))
  if (!compact.some((line) => line.trim())) return `${split.bom}${split.body}`
  const header = ['---', ...compact, '---'].join(split.newline)
  return `${split.bom}${header}${split.newline}${split.body}`
}

export function stripChapterFrontmatter(text: string): string {
  const split = splitFrontmatter(text)
  if (!split.explicit || !split.closed) return text
  return `${split.bom}${split.body}`
}

export function formatChapterContextText(input: {
  beats?: string[]
  previousState?: ChapterStateFields
  previousPath?: string
}): string {
  const lines: string[] = []
  const beats = (input.beats ?? []).map((item) => item.trim()).filter(Boolean)
  if (beats.length) {
    lines.push('【本章节拍】')
    for (const beat of beats.slice(0, CHAPTER_BEATS_MAX)) {
      lines.push(`- ${beat.slice(0, CHAPTER_BEAT_MAX_CHARS)}`)
    }
  }
  const stateLines: string[] = []
  if (input.previousState) {
    for (const key of CHAPTER_STATE_KEYS) {
      const value = input.previousState[key]?.trim()
      if (value) stateLines.push(`${STATE_LABELS[key]}：${value}`)
    }
  }
  if (stateLines.length) {
    lines.push(input.previousPath ? `【上一章状态】（${input.previousPath}）` : '【上一章状态】')
    lines.push(...stateLines)
  }
  if (!lines.length) return ''
  return lines.join('\n').slice(0, CHAPTER_CONTEXT_TEXT_MAX)
}
