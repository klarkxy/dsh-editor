export type YamlScalar = string
export type CardRelation = { to: string; kind: string }

export type CharacterCardFields = {
  name?: string
  aliases?: string[]
  role?: string
  gender?: string
  age?: string
  faction?: string
  tags?: string[]
  status?: string
  relations?: CardRelation[]
  summary?: string
}

export type WorldbookCardFields = {
  triggers?: string[]
  enabled?: boolean
  priority?: number
  category?: string
  tags?: string[]
  summary?: string
}

export type CardMetaFields = CharacterCardFields & WorldbookCardFields

const HEADER_MAX = 4_096
const TRIGGER_MAX_LEN = 64
const TRIGGER_MAX_COUNT = 16

export function withoutBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text
}

export function hasExplicitFrontmatter(text: string): boolean {
  const source = withoutBom(text)
  return source.startsWith('---\n') || source.startsWith('---\r\n')
}

export function detectNewline(text: string): '\n' | '\r\n' {
  return withoutBom(text).includes('\r\n') ? '\r\n' : '\n'
}

export type SplitFrontmatter = {
  bom: string
  newline: '\n' | '\r\n'
  explicit: boolean
  closed: boolean
  header: string
  body: string
}

export function splitFrontmatter(text: string): SplitFrontmatter {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const source = withoutBom(text)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { bom, newline, explicit: false, closed: false, header: '', body: source }
  }
  const close = /\r?\n---(?:\r?\n|$)/g
  close.lastIndex = source.indexOf('\n') + 1
  const match = close.exec(source)
  if (!match || match.index > HEADER_MAX) {
    return { bom, newline, explicit: true, closed: false, header: '', body: source }
  }
  return {
    bom,
    newline,
    explicit: true,
    closed: true,
    header: source.slice(source.indexOf('\n') + 1, match.index),
    body: source.slice(match.index + match[0].length),
  }
}

export function parseYamlScalar(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const inner = trimmed.slice(1, -1)
    if (trimmed.startsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed)
        return typeof parsed === 'string' ? parsed : undefined
      } catch {
        return undefined
      }
    }
    return inner.replace(/''/g, "'")
  }
  return trimmed
}

export function splitInlineList(value: string): string[] | undefined {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined
  const body = trimmed.slice(1, -1)
  if (!body.trim()) return []
  const parts: string[] = []
  let quote = ''
  let escaped = false
  let start = 0
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ',') {
      parts.push(body.slice(start, index))
      start = index + 1
    }
  }
  if (quote) return undefined
  parts.push(body.slice(start))
  const parsed = parts.map(parseYamlScalar)
  return parsed.every((item): item is string => item !== undefined) ? parsed : undefined
}

export function validWorldbookTriggers(values: string[]): string[] | undefined {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    const folded = value.toLowerCase()
    if (!value || value.length > TRIGGER_MAX_LEN || /[\u0000-\u001f\u007f]/.test(value)) return undefined
    if (!seen.has(folded)) {
      unique.push(value)
      seen.add(folded)
    }
  }
  return unique.length > 0 && unique.length <= TRIGGER_MAX_COUNT ? unique : undefined
}

export function normalizeStringList(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    if (typeof raw !== 'string') return undefined
    const value = raw.trim()
    if (!value || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) return undefined
    const folded = value.toLowerCase()
    if (seen.has(folded)) continue
    seen.add(folded)
    unique.push(value)
  }
  return unique
}

export type FrontmatterItem =
  | { kind: 'comment'; raw: string }
  | { kind: 'blank'; raw: string }
  | { kind: 'field'; key: string; raw: string }

export function parseFrontmatterItems(header: string): FrontmatterItem[] | undefined {
  const lines = header.split(/\r?\n/)
  const items: FrontmatterItem[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (!line.trim()) {
      items.push({ kind: 'blank', raw: line })
      continue
    }
    if (/^\s*#/.test(line)) {
      items.push({ kind: 'comment', raw: line })
      continue
    }
    if (/^\s/.test(line)) return undefined
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!field) return undefined
    const key = field[1]!
    const rawLines = [line]
    if (!field[2]!.trim()) {
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1]!) && lines[index + 1]!.trim()) {
        rawLines.push(lines[++index]!)
      }
    }
    items.push({ kind: 'field', key, raw: rawLines.join('\n') })
  }
  return items
}

function fieldValue(raw: string): string {
  const line = raw.split(/\r?\n/, 1)[0] ?? raw
  const field = /^[A-Za-z][\w-]*:\s*(.*)$/.exec(line)
  return field?.[1] ?? ''
}

function fieldBlockLines(raw: string): string[] {
  const lines = raw.split(/\r?\n/)
  return lines.slice(1)
}

function parseStringField(raw: string): string | undefined {
  const inline = fieldValue(raw)
  if (!inline.trim()) return undefined
  return parseYamlScalar(inline)
}

export function parseStringListField(raw: string): string[] | undefined {
  const inline = fieldValue(raw)
  if (inline.trim()) return splitInlineList(inline)
  const values: string[] = []
  for (const line of fieldBlockLines(raw)) {
    if (!/^\s+-\s+/.test(line)) return undefined
    const parsed = parseYamlScalar(line.replace(/^\s+-\s+/, ''))
    if (parsed === undefined) return undefined
    values.push(parsed)
  }
  return values
}

function parseRelationItem(lines: string[]): CardRelation | undefined {
  let to: string | undefined
  let kind: string | undefined
  for (const line of lines) {
    const field = /^\s+(?:-\s+)?([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!field) return undefined
    const key = field[1]!
    const value = parseYamlScalar(field[2] ?? '')
    if (value === undefined) return undefined
    if (key === 'to') to = value
    else if (key === 'kind') kind = value
    else return undefined
  }
  return to && kind ? { to, kind } : undefined
}

export function parseRelationsField(raw: string): CardRelation[] | undefined {
  const inline = fieldValue(raw)
  if (inline.trim()) {
    const objects = splitInlineObjectList(inline)
    return objects
  }
  const lines = fieldBlockLines(raw)
  if (lines.length === 0) return []
  const items: CardRelation[] = []
  let current: string[] = []
  const flush = (): boolean => {
    if (current.length === 0) return true
    const parsed = parseRelationItem(current)
    current = []
    if (!parsed) return false
    items.push(parsed)
    return true
  }
  for (const line of lines) {
    if (/^\s+-\s+/.test(line)) {
      if (!flush()) return undefined
      current = [line]
      continue
    }
    if (current.length === 0 || !/^\s+/.test(line)) return undefined
    current.push(line)
  }
  if (!flush()) return undefined
  return items
}

function splitInlineObjectList(value: string): CardRelation[] | undefined {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined
  const body = trimmed.slice(1, -1).trim()
  if (!body) return []
  const items: CardRelation[] = []
  const objectRe = /\{\s*to:\s*([^,}]+?)\s*,\s*kind:\s*([^}]+?)\s*\}/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = objectRe.exec(body))) {
    const gap = body.slice(cursor, match.index).trim()
    if (gap && gap !== ',') return undefined
    const to = parseYamlScalar(match[1] ?? '')
    const kind = parseYamlScalar(match[2] ?? '')
    if (!to || !kind) return undefined
    items.push({ to, kind })
    cursor = match.index + match[0].length
  }
  const tail = body.slice(cursor).trim()
  if (tail && tail !== ',') return undefined
  return items.length > 0 || !body ? items : undefined
}

export function parseBooleanField(raw: string): boolean | undefined {
  const value = fieldValue(raw).trim()
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export function parseIntegerField(raw: string): number | undefined {
  const value = fieldValue(raw).trim()
  if (!/^-?\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export type ParsedFrontmatterDocument = {
  split: SplitFrontmatter
  items: FrontmatterItem[]
}

export function parseFrontmatterDocument(text: string): ParsedFrontmatterDocument | undefined {
  const split = splitFrontmatter(text)
  if (!split.explicit) return { split, items: [] }
  if (!split.closed) return undefined
  const items = parseFrontmatterItems(split.header)
  if (!items) return undefined
  return { split, items }
}

const CHARACTER_KEYS = new Set(['name', 'aliases', 'role', 'gender', 'age', 'faction', 'tags', 'status', 'relations', 'summary'])
const WORLDBOOK_KEYS = new Set(['triggers', 'enabled', 'priority', 'category', 'tags', 'summary'])

export function parseCharacterFields(items: readonly FrontmatterItem[]): CharacterCardFields {
  const fields: CharacterCardFields = {}
  const seen = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'field' || !CHARACTER_KEYS.has(item.key) || seen.has(item.key)) continue
    seen.add(item.key)
    if (item.key === 'aliases' || item.key === 'tags') {
      const values = normalizeStringList(parseStringListField(item.raw) ?? [])
      if (values) fields[item.key] = values
      continue
    }
    if (item.key === 'relations') {
      const relations = parseRelationsField(item.raw)
      if (relations) fields.relations = relations
      continue
    }
    const value = parseStringField(item.raw)
    if (value !== undefined) (fields as Record<string, string>)[item.key] = value
  }
  return fields
}

export function parseWorldbookFields(items: readonly FrontmatterItem[], path: string): WorldbookCardFields {
  const fields: WorldbookCardFields = {}
  const seen = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'field' || !WORLDBOOK_KEYS.has(item.key) || seen.has(item.key)) continue
    seen.add(item.key)
    if (item.key === 'triggers' || item.key === 'tags') {
      const values = parseStringListField(item.raw)
      if (item.key === 'triggers') {
        const triggers = values ? validWorldbookTriggers(values) : undefined
        if (triggers) fields.triggers = triggers
      } else {
        const tags = normalizeStringList(values ?? [])
        if (tags) fields.tags = tags
      }
      continue
    }
    if (item.key === 'enabled') {
      const enabled = parseBooleanField(item.raw)
      if (enabled !== undefined) fields.enabled = enabled
      continue
    }
    if (item.key === 'priority') {
      const priority = parseIntegerField(item.raw)
      if (priority !== undefined && priority >= -100 && priority <= 100) fields.priority = priority
      continue
    }
    const value = parseStringField(item.raw)
    if (value !== undefined) (fields as Record<string, string>)[item.key] = value
  }
  if (!fields.triggers) {
    const stem = path.split('/').at(-1)?.replace(/\.md$/i, '').trim().slice(0, TRIGGER_MAX_LEN)
    const fallback = stem ? validWorldbookTriggers([stem]) : undefined
    if (fallback) fields.triggers = fallback
  }
  if (fields.enabled === undefined) fields.enabled = true
  if (fields.priority === undefined) fields.priority = 0
  return fields
}

export function parseCharacterCardFrontmatter(path: string, text: string): CharacterCardFields {
  const document = parseFrontmatterDocument(text)
  if (!document) {
    return { name: filenameStem(path) }
  }
  const fields = parseCharacterFields(document.items)
  if (!fields.name) fields.name = filenameStem(path)
  return fields
}

export function parseWorldbookCardFrontmatter(path: string, text: string): WorldbookCardFields {
  const document = parseFrontmatterDocument(text)
  if (!document) {
    const stem = filenameStem(path)
    return { triggers: validWorldbookTriggers([stem]) ?? [stem || '设定'], enabled: true, priority: 0 }
  }
  return parseWorldbookFields(document.items, path)
}

export function filenameStem(path: string): string {
  return path.split('/').at(-1)?.replace(/\.md$/i, '').trim() || ''
}

export function extractCardSummary(text: string, frontmatterSummary?: string): string {
  if (frontmatterSummary?.trim()) return frontmatterSummary.trim().slice(0, 120)
  const body = splitFrontmatter(text).body
  const lines = body.replace(/^\uFEFF/, '').split(/\r?\n/)
  const paragraph: string[] = []
  for (const line of lines) {
    if (/^\s{0,3}#+(?:\s|$)/.test(line)) {
      if (paragraph.length) break
      continue
    }
    if (!line.trim()) {
      if (paragraph.length) break
      continue
    }
    paragraph.push(line.trim())
  }
  return paragraph.join('').slice(0, 120)
}

function quoteNeeded(value: string): boolean {
  if (!value) return true
  if (/[\u0000-\u001f\u007f]/.test(value)) return true
  if (/[#:[\]{},&*!|>'"%@`]/.test(value)) return true
  if (/^\s|\s$/.test(value)) return true
  if (/^(true|false|null|~)$/i.test(value)) return true
  if (/^-?\d+(\.\d+)?$/.test(value)) return true
  if (value.includes(': ') || value.startsWith('- ') || value.startsWith('?')) return true
  return false
}

export function formatYamlScalar(value: string): string {
  return quoteNeeded(value) ? JSON.stringify(value) : value
}

export function formatYamlList(values: readonly string[]): string {
  return `[${values.map((item) => formatYamlScalar(item)).join(', ')}]`
}

export function formatRelations(relations: readonly CardRelation[]): string {
  if (relations.length === 0) return '[]'
  const lines = relations.map((item) => `  - to: ${formatYamlScalar(item.to)}\n    kind: ${formatYamlScalar(item.kind)}`)
  return `\n${lines.join('\n')}`
}

export function serializeYamlField(key: string, value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return `${key}: ${value ? 'true' : 'false'}`
  if (typeof value === 'number' && Number.isSafeInteger(value)) return `${key}: ${value}`
  if (typeof value === 'string') return `${key}: ${formatYamlScalar(value)}`
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`
    if (value.every((item) => typeof item === 'string')) return `${key}: ${formatYamlList(value)}`
    if (value.every((item) => item && typeof item === 'object' && 'to' in item && 'kind' in item)) {
      return `${key}:${formatRelations(value as CardRelation[])}`
    }
  }
  return undefined
}

const CHARACTER_ORDER = ['name', 'aliases', 'role', 'gender', 'age', 'faction', 'tags', 'status', 'relations', 'summary'] as const
const WORLDBOOK_ORDER = ['triggers', 'enabled', 'priority', 'category', 'tags', 'summary'] as const
const ALL_ORDER = [...CHARACTER_ORDER, 'triggers', 'enabled', 'priority', 'category'] as const

function fieldKeysFor(values: CardMetaFields): string[] {
  const keys = new Set<string>()
  for (const key of ALL_ORDER) {
    if (values[key as keyof CardMetaFields] !== undefined) keys.add(key)
  }
  return [...keys]
}

export function mergeCardFields(
  current: CardMetaFields,
  patch: Partial<CardMetaFields>,
): CardMetaFields {
  return { ...current, ...sanitizeCardFields(patch) }
}

export function sanitizeCardFields(input: unknown): Partial<CardMetaFields> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const raw = input as Record<string, unknown>
  const out: Partial<CardMetaFields> = {}
  const takeString = (key: keyof CardMetaFields) => {
    if (!(key in raw)) return
    const value = raw[key]
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed && !/[\u0000-\u001f\u007f]/.test(trimmed) && trimmed.length <= 240) (out as Record<string, string>)[key] = trimmed
  }
  takeString('name')
  takeString('role')
  takeString('gender')
  takeString('age')
  takeString('faction')
  takeString('status')
  takeString('category')
  takeString('summary')
  if ('aliases' in raw) {
    const aliases = normalizeStringList(raw.aliases)
    if (aliases) out.aliases = aliases
  }
  if ('tags' in raw) {
    const tags = normalizeStringList(raw.tags)
    if (tags) out.tags = tags
  }
  if ('triggers' in raw) {
    const triggers = Array.isArray(raw.triggers) && raw.triggers.every((item) => typeof item === 'string')
      ? validWorldbookTriggers(raw.triggers)
      : undefined
    if (triggers) out.triggers = triggers
  }
  if ('enabled' in raw && typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  if ('priority' in raw && typeof raw.priority === 'number' && Number.isSafeInteger(raw.priority) && raw.priority >= -100 && raw.priority <= 100) {
    out.priority = raw.priority
  }
  if ('relations' in raw && Array.isArray(raw.relations)) {
    const relations: CardRelation[] = []
    for (const item of raw.relations) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const row = item as { to?: unknown; kind?: unknown }
      if (typeof row.to !== 'string' || typeof row.kind !== 'string') continue
      const to = row.to.trim()
      const kind = row.kind.trim()
      if (!to || !kind || /[\u0000-\u001f\u007f]/.test(to) || /[\u0000-\u001f\u007f]/.test(kind)) continue
      relations.push({ to, kind })
    }
    out.relations = relations
  }
  return out
}

export function applyFrontmatterFields(text: string, patch: Partial<CardMetaFields>): string {
  const split = splitFrontmatter(text)
  const newline = split.newline
  const items = split.explicit && split.closed ? parseFrontmatterItems(split.header) ?? [] : []
  const current = {
    ...parseCharacterFields(items),
    ...parseWorldbookFields(items, '世界书/编辑中.md'),
  }
  if (!items.some((item) => item.kind === 'field' && item.key === 'triggers')) delete current.triggers
  if (!items.some((item) => item.kind === 'field' && item.key === 'enabled')) delete current.enabled
  if (!items.some((item) => item.kind === 'field' && item.key === 'priority')) delete current.priority
  const next = mergeCardFields(current, patch)
  const written = new Set<string>()
  const lines: string[] = []
  for (const item of items) {
    if (item.kind === 'comment' || item.kind === 'blank') {
      lines.push(item.raw)
      continue
    }
    if (next[item.key as keyof CardMetaFields] !== undefined) {
      const serialized = serializeYamlField(item.key, next[item.key as keyof CardMetaFields])
      if (serialized) {
        lines.push(...serialized.split('\n'))
        written.add(item.key)
        continue
      }
    }
    if (patch[item.key as keyof CardMetaFields] === undefined) {
      lines.push(...item.raw.split(/\r?\n/))
      written.add(item.key)
    }
  }
  for (const key of fieldKeysFor(next)) {
    if (written.has(key)) continue
    const serialized = serializeYamlField(key, next[key as keyof CardMetaFields])
    if (serialized) lines.push(...serialized.split('\n'))
  }
  const header = ['---', ...lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')), '---'].join(newline)
  return `${split.bom}${header}${newline}${split.explicit && split.closed ? split.body : split.body}`
}

export function serializeCardFrontmatter(fields: CardMetaFields, newline: '\n' | '\r\n' = '\n'): string {
  return applyFrontmatterFields(`---${newline}---${newline}`, fields)
}

export function parseSerializedCardFields(text: string): CardMetaFields {
  const document = parseFrontmatterDocument(text)
  if (!document) return {}
  const character = parseCharacterFields(document.items)
  const worldbook = parseWorldbookFields(document.items, '世界书/roundtrip.md')
  const fields: CardMetaFields = { ...character }
  if (document.items.some((item) => item.kind === 'field' && item.key === 'triggers')) fields.triggers = worldbook.triggers
  if (document.items.some((item) => item.kind === 'field' && item.key === 'enabled')) fields.enabled = worldbook.enabled
  if (document.items.some((item) => item.kind === 'field' && item.key === 'priority')) fields.priority = worldbook.priority
  if (worldbook.category) fields.category = worldbook.category
  if (worldbook.tags) fields.tags = worldbook.tags
  if (worldbook.summary) fields.summary = worldbook.summary
  delete fields.name
  if (character.name) fields.name = character.name
  return fields
}
