import { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from '../author-preferences.ts'
import {
  CHAPTER_BEATS_MAX,
  CHAPTER_BEAT_MAX_CHARS,
  CHAPTER_STATE_KEYS,
  CHAPTER_STATE_MAX_TOTAL_CHARS,
  parseChapterMeta,
  type ChapterStateFields,
} from '../chapter-meta.ts'
import {
  applyFrontmatterFields,
  hasExplicitFrontmatter,
  parseBooleanField,
  parseFrontmatterDocument,
  parseIntegerField,
  parseStringListField,
  splitFrontmatter,
  validWorldbookTriggers,
} from '../frontmatter.ts'

export const PROJECT_CONTEXT_SCHEMA = 'dsh-editor.project-context'
export const PROJECT_CONTEXT_VERSION = 1
export const PROJECT_CONTEXT_CURRENT_VERSION = 2
export const PROJECT_CONTEXT_SOURCE_PATHS = [
  '项目总览.md',
  '大纲/总纲.md',
  '人物卡/人物索引.md',
  '世界书/设定总汇.md',
  '.dsh-editor/作品索引.md',
] as const
export const PROJECT_CONTEXT_MAX_CHARS_PER_FILE = 4_000
export const PROJECT_CONTEXT_MAX_TOTAL_CHARS = 12_000
export const WORLDBOOK_MAX_CHARS_PER_FILE = 3_000
export const WORLDBOOK_MAX_TOTAL_CHARS = 6_000

export type ProjectContextStatus = 'included' | 'missing' | 'error'
export type WorldbookMatchedBy = 'task' | 'saved-document' | 'both'
export type WorldbookScanSummary = {
  scanned: number
  unmatched: number
  disabled: number
  invalid: number
  limits: number
  readErrors: number
}
export type ProjectContextReceipt = {
  path: string
  kind?: 'fixed' | 'worldbook'
  version?: string
  includedChars: number
  status: ProjectContextStatus
  truncated: boolean
  priority?: number
  matchedBy?: WorldbookMatchedBy
  matchedTriggers?: string[]
}
export type ProjectContextReceiptBundle = {
  sources: ProjectContextReceipt[]
  scan?: WorldbookScanSummary
  authorPreferencesChars?: number
  authorMemoryChars?: number
  chapterContext?: { path: string; beats: number; previousPath?: string }
}
export type ProjectContextSource = ProjectContextReceipt & { text?: string }
export type ProjectChapterContext = {
  path: string
  beats?: string[]
  previous?: { path: string; state: ChapterStateFields }
}
export type ProjectContextEnvelopeV1 = {
  schema: typeof PROJECT_CONTEXT_SCHEMA
  version: typeof PROJECT_CONTEXT_VERSION
  project_context: { sources: ProjectContextSource[] }
  user_request: string
}
export type ProjectContextEnvelopeV2 = {
  schema: typeof PROJECT_CONTEXT_SCHEMA
  version: typeof PROJECT_CONTEXT_CURRENT_VERSION
  project_context: { sources: ProjectContextSource[]; scan: WorldbookScanSummary }
  author_preferences?: string
  author_memory?: string
  chapter_context?: ProjectChapterContext
  user_request: string
}
export type EditorTaskEnvelope = { schema: typeof PROJECT_CONTEXT_SCHEMA; version: 3; user_request: string; active_path?: string }
export type TaskContextCompilation = { envelope: EditorTaskEnvelope; serialized: string; receipt: ProjectContextReceiptBundle }
export type ProjectContextEnvelope = ProjectContextEnvelopeV1 | ProjectContextEnvelopeV2
export type ProjectContextReadResult =
  | { ok: true; value: { text: string; version: string } }
  | { ok: false; error?: { code?: string; message?: string } }
export type ProjectContextCompilation = { envelope: ProjectContextEnvelope; serialized: string; receipt: ProjectContextReceiptBundle }
export type WorldbookCandidate = { path: string; text: string; version: string }

const EMPTY_SCAN: WorldbookScanSummary = { scanned: 0, unmatched: 0, disabled: 0, invalid: 0, limits: 0, readErrors: 0 }

function isMissing(result: Exclude<ProjectContextReadResult, { ok: true }>): boolean {
  return /not[- _]found|missing/i.test(`${result.error?.code ?? ''} ${result.error?.message ?? ''}`)
}

async function compileFixedSources(
  read: (path: typeof PROJECT_CONTEXT_SOURCE_PATHS[number]) => Promise<ProjectContextReadResult>,
  includeKind: boolean,
): Promise<ProjectContextSource[]> {
  let remaining = PROJECT_CONTEXT_MAX_TOTAL_CHARS
  const sources: ProjectContextSource[] = []
  for (const path of PROJECT_CONTEXT_SOURCE_PATHS) {
    try {
      const result = await read(path)
      if (!result.ok) {
        sources.push({ path, ...(includeKind ? { kind: 'fixed' as const } : {}), includedChars: 0, status: isMissing(result) ? 'missing' : 'error', truncated: false })
        continue
      }
      const text = result.value.text
      const includedChars = Math.min(text.length, PROJECT_CONTEXT_MAX_CHARS_PER_FILE, remaining)
      sources.push({
        path,
        ...(includeKind ? { kind: 'fixed' as const } : {}),
        version: result.value.version,
        includedChars,
        status: 'included',
        truncated: includedChars < text.length,
        text: text.slice(0, includedChars),
      })
      remaining -= includedChars
    } catch {
      sources.push({ path, ...(includeKind ? { kind: 'fixed' as const } : {}), includedChars: 0, status: 'error', truncated: false })
    }
  }
  return sources
}

/** Legacy V1 compiler retained so historical sessions remain readable. */
export async function compileProjectContext(
  userRequest: string,
  read: (path: typeof PROJECT_CONTEXT_SOURCE_PATHS[number]) => Promise<ProjectContextReadResult>,
): Promise<ProjectContextCompilation> {
  const sources = await compileFixedSources(read, false)
  const envelope: ProjectContextEnvelopeV1 = {
    schema: PROJECT_CONTEXT_SCHEMA,
    version: PROJECT_CONTEXT_VERSION,
    project_context: { sources },
    user_request: userRequest,
  }
  return { envelope, serialized: JSON.stringify(envelope), receipt: { sources: stripText(sources) } }
}

type ParsedWorldbook = { enabled: boolean; priority: number; triggers: string[] }
export type WorldbookEditorMetadata = ParsedWorldbook & { valid: boolean; explicit: boolean }

export function formatWorldbookTriggerLines(triggers: readonly string[]): string {
  return triggers.join('\n')
}

export function parseWorldbookTriggerLines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

const validTriggers = validWorldbookTriggers

export function parseWorldbookFrontmatter(path: string, text: string): ParsedWorldbook | undefined {
  if (!hasExplicitFrontmatter(text)) {
    const legacy = path.replace(/^世界书\//, '').replace(/\.md$/i, '')
    const triggers = validTriggers([legacy])
    return triggers ? { enabled: true, priority: 0, triggers } : undefined
  }
  const document = parseFrontmatterDocument(text)
  if (!document) return undefined
  let enabled = true
  let priority = 0
  let triggers: string[] | undefined
  let sawTriggers = false
  let sawEnabled = false
  let sawPriority = false
  for (const item of document.items) {
    if (item.kind !== 'field') continue
    if (item.key === 'triggers') {
      if (sawTriggers) return undefined
      sawTriggers = true
      const values = parseStringListField(item.raw)
      if (!values) return undefined
      triggers = values
    } else if (item.key === 'enabled') {
      if (sawEnabled) return undefined
      const parsed = parseBooleanField(item.raw)
      if (parsed === undefined) return undefined
      sawEnabled = true
      enabled = parsed
    } else if (item.key === 'priority') {
      if (sawPriority) return undefined
      const parsed = parseIntegerField(item.raw)
      if (parsed === undefined || parsed < -100 || parsed > 100) return undefined
      sawPriority = true
      priority = parsed
    }
  }
  const checked = sawTriggers && triggers ? validTriggers(triggers) : undefined
  return checked ? { enabled, priority, triggers: checked } : undefined
}

export function worldbookEditorMetadata(path: string, text: string): WorldbookEditorMetadata {
  const explicit = hasExplicitFrontmatter(text)
  const parsed = parseWorldbookFrontmatter(path, text)
  if (parsed) return { ...parsed, valid: true, explicit }
  if (!explicit) {
    const fallback = path.split('/').at(-1)?.replace(/\.md$/i, '').trim().slice(0, 64) || '设定'
    return { triggers: [fallback], enabled: true, priority: 0, valid: true, explicit: false }
  }
  return { triggers: [], enabled: false, priority: 0, valid: false, explicit: true }
}

/** Rewrites only the bounded metadata header and preserves the document body byte-for-byte. */
export function writeWorldbookFrontmatter(
  text: string,
  input: { triggers: string[]; enabled: boolean; priority: number },
): string {
  const triggers = validTriggers(input.triggers)
  if (!triggers) throw new Error('invalid worldbook triggers')
  if (!Number.isSafeInteger(input.priority) || input.priority < -100 || input.priority > 100) {
    throw new Error('invalid worldbook priority')
  }
  if (hasExplicitFrontmatter(text)) {
    if (!parseWorldbookFrontmatter('世界书/编辑中.md', text)) throw new Error('invalid worldbook frontmatter')
    const split = splitFrontmatter(text)
    if (!split.closed) throw new Error('invalid worldbook frontmatter')
  }
  return applyFrontmatterFields(text, { triggers, enabled: input.enabled, priority: input.priority })
}

function stripText(sources: ProjectContextSource[]): ProjectContextReceipt[] {
  return sources.map(({ text: _text, ...source }) => source)
}

function bumpScan(scan: WorldbookScanSummary, key: keyof WorldbookScanSummary, maximum: number): void {
  scan[key] = Math.min(maximum, scan[key] + 1)
}

function isManuscriptChapterPath(path: string): boolean {
  if (!/^正文\/[^\u0000-\u001f\\]+\.(md|txt)$/i.test(path)) return false
  return path.split('/').every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.'))
}

function envelopeBeats(path: string, text: string | undefined): string[] | undefined {
  if (!/\.md$/i.test(path) || !text) return undefined
  const beats = parseChapterMeta(text)?.beats
  if (!beats?.length) return undefined
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of beats) {
    const value = raw.trim()
    if (!value || value.length > CHAPTER_BEAT_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(value)) continue
    const folded = value.toLowerCase()
    if (seen.has(folded)) continue
    seen.add(folded)
    out.push(value)
    if (out.length >= CHAPTER_BEATS_MAX) break
  }
  return out.length ? out : undefined
}

function envelopePreviousState(state: ChapterStateFields | undefined): ChapterStateFields | undefined {
  if (!state) return undefined
  const next: ChapterStateFields = {}
  let total = 0
  for (const key of CHAPTER_STATE_KEYS) {
    const value = state[key]?.trim()
    if (!value || value.length > CHAPTER_STATE_MAX_TOTAL_CHARS || /[\u0000-\u001f\u007f]/.test(value)) continue
    if (total + value.length > CHAPTER_STATE_MAX_TOTAL_CHARS) return undefined
    next[key] = value
    total += value.length
  }
  if (total === 0 || total > CHAPTER_STATE_MAX_TOTAL_CHARS) return undefined
  return next
}

function envelopePrevious(previous?: { path: string; text: string }): ProjectChapterContext['previous'] | undefined {
  if (!previous || !/\.md$/i.test(previous.path) || !isManuscriptChapterPath(previous.path)) return undefined
  const state = envelopePreviousState(parseChapterMeta(previous.text)?.state)
  return state ? { path: previous.path, state } : undefined
}

function buildChapterContext(options: {
  path?: string
  text?: string
  previous?: { path: string; text: string }
}): ProjectChapterContext | undefined {
  if (!options.path || !isManuscriptChapterPath(options.path)) return undefined
  const beats = envelopeBeats(options.path, options.text)
  const previous = envelopePrevious(options.previous)
  if (!beats && !previous) return undefined
  return {
    path: options.path,
    ...(beats ? { beats } : {}),
    ...(previous ? { previous } : {}),
  }
}

function receiptChapterContext(ctx: ProjectChapterContext): NonNullable<ProjectContextReceiptBundle['chapterContext']> {
  return {
    path: ctx.path,
    beats: ctx.beats?.length ?? 0,
    ...(ctx.previous ? { previousPath: ctx.previous.path } : {}),
  }
}

export async function compileProjectContextV2(
  userRequest: string,
  read: (path: typeof PROJECT_CONTEXT_SOURCE_PATHS[number]) => Promise<ProjectContextReadResult>,
  options: {
    candidates: WorldbookCandidate[]
    activePath?: string
    savedDocumentText?: string
    scan?: Partial<WorldbookScanSummary>
    authorPreferences?: string
    authorMemory?: string
    chapterContext?: { path: string; text?: string; previous?: { path: string; text: string } }
  },
): Promise<ProjectContextCompilation> {
  const fixed = await compileFixedSources(read, true)
  const scan: WorldbookScanSummary = { ...EMPTY_SCAN, ...options.scan }
  const taskHaystack = `${userRequest}\n${options.activePath ?? ''}`.toLowerCase()
  const savedHaystack = (options.savedDocumentText ?? '').slice(0, 8_000).toLowerCase()
  const matched: Array<WorldbookCandidate & ParsedWorldbook & { matchedBy: WorldbookMatchedBy; matchedTriggers: string[] }> = []
  for (const candidate of options.candidates) {
    const config = parseWorldbookFrontmatter(candidate.path, candidate.text)
    if (!config) { bumpScan(scan, 'invalid', 64); continue }
    if (!config.enabled) { bumpScan(scan, 'disabled', 64); continue }
    const taskHits = config.triggers.filter((trigger) => taskHaystack.includes(trigger.toLowerCase()))
    const savedHits = config.triggers.filter((trigger) => savedHaystack.includes(trigger.toLowerCase()))
    const hits = validTriggers([...taskHits, ...savedHits])
    if (!hits) { bumpScan(scan, 'unmatched', 64); continue }
    matched.push({
      ...candidate,
      ...config,
      matchedBy: taskHits.length && savedHits.length ? 'both' : taskHits.length ? 'task' : 'saved-document',
      matchedTriggers: hits,
    })
  }
  matched.sort((left, right) => right.priority - left.priority || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  let remaining = WORLDBOOK_MAX_TOTAL_CHARS
  const dynamic: ProjectContextSource[] = []
  for (const item of matched) {
    if (remaining <= 0) { bumpScan(scan, 'limits', 1_024); continue }
    const includedChars = Math.min(item.text.length, WORLDBOOK_MAX_CHARS_PER_FILE, remaining)
    remaining -= includedChars
    dynamic.push({
      path: item.path,
      kind: 'worldbook',
      version: item.version,
      includedChars,
      status: 'included',
      truncated: includedChars < item.text.length,
      priority: item.priority,
      matchedBy: item.matchedBy,
      matchedTriggers: item.matchedTriggers,
      text: item.text.slice(0, includedChars),
    })
  }
  const sources = [...fixed, ...dynamic]
  const authorPreferences = normalizeAuthorPreferences(options.authorPreferences)
  const authorMemory = normalizeAuthorMemory(options.authorMemory)
  const chapter_context = buildChapterContext(options.chapterContext ?? {
    path: options.activePath,
    text: options.savedDocumentText,
  })
  const envelope: ProjectContextEnvelopeV2 = {
    schema: PROJECT_CONTEXT_SCHEMA,
    version: PROJECT_CONTEXT_CURRENT_VERSION,
    project_context: { sources, scan },
    ...(authorPreferences ? { author_preferences: authorPreferences } : {}),
    ...(authorMemory ? { author_memory: authorMemory } : {}),
    ...(chapter_context ? { chapter_context } : {}),
    user_request: userRequest,
  }
  return {
    envelope,
    serialized: JSON.stringify(envelope),
    receipt: {
      sources: stripText(sources),
      scan,
      ...(authorPreferences ? { authorPreferencesChars: authorPreferences.length } : {}),
      ...(authorMemory ? { authorMemoryChars: authorMemory.length } : {}),
      ...(chapter_context ? { chapterContext: receiptChapterContext(chapter_context) } : {}),
    },
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isScan(value: unknown): value is WorldbookScanSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const scan = value as Partial<WorldbookScanSummary>
  return isNonNegativeInteger(scan.scanned) && scan.scanned <= 64
    && isNonNegativeInteger(scan.unmatched) && scan.unmatched <= 64
    && isNonNegativeInteger(scan.disabled) && scan.disabled <= 64
    && isNonNegativeInteger(scan.invalid) && scan.invalid <= 64
    && isNonNegativeInteger(scan.limits) && scan.limits <= 1_024
    && isNonNegativeInteger(scan.readErrors) && scan.readErrors <= 1_024
}

function isBaseSource(value: unknown, allowLegacyZeroWithoutText = false): value is ProjectContextSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<ProjectContextSource>
  if (typeof item.path !== 'string' || !isNonNegativeInteger(item.includedChars)
    || (item.status !== 'included' && item.status !== 'missing' && item.status !== 'error')
    || typeof item.truncated !== 'boolean' || (item.version !== undefined && typeof item.version !== 'string')) return false
  if (item.status === 'included') {
    if (typeof item.version !== 'string') return false
    if (typeof item.text === 'string') return item.text.length === item.includedChars
    return allowLegacyZeroWithoutText && item.includedChars === 0 && item.text === undefined
  }
  return item.includedChars === 0 && item.truncated === false && item.text === undefined && item.version === undefined
}

function validateFixed(sources: ProjectContextSource[], withKind: boolean, allowLegacyZeroWithoutText = false): boolean {
  if (sources.length < PROJECT_CONTEXT_SOURCE_PATHS.length) return false
  let total = 0
  for (let index = 0; index < PROJECT_CONTEXT_SOURCE_PATHS.length; index++) {
    const source = sources[index]!
    if (!isBaseSource(source, allowLegacyZeroWithoutText) || source.path !== PROJECT_CONTEXT_SOURCE_PATHS[index]) return false
    if (withKind ? source.kind !== 'fixed' : source.kind !== undefined) return false
    if (source.includedChars > PROJECT_CONTEXT_MAX_CHARS_PER_FILE) return false
    total += source.includedChars
  }
  return total <= PROJECT_CONTEXT_MAX_TOTAL_CHARS
}

function isChapterBeats(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CHAPTER_BEATS_MAX) return false
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || !item || item.length > CHAPTER_BEAT_MAX_CHARS
      || /[\u0000-\u001f\u007f]/.test(item) || item !== item.trim()) return false
    const folded = item.toLowerCase()
    if (seen.has(folded)) return false
    seen.add(folded)
  }
  return true
}

function isChapterState(value: unknown): value is ChapterStateFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (!keys.length) return false
  let total = 0
  for (const key of keys) {
    if (!(CHAPTER_STATE_KEYS as readonly string[]).includes(key)) return false
    const item = (value as Record<string, unknown>)[key]
    if (typeof item !== 'string' || !item || item !== item.trim()
      || item.length > CHAPTER_STATE_MAX_TOTAL_CHARS || /[\u0000-\u001f\u007f]/.test(item)) return false
    total += item.length
  }
  return total <= CHAPTER_STATE_MAX_TOTAL_CHARS
}

function isChapterContext(value: unknown): value is ProjectChapterContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ctx = value as Record<string, unknown>
  if (Object.keys(ctx).some((key) => key !== 'path' && key !== 'beats' && key !== 'previous')) return false
  if (typeof ctx.path !== 'string' || !isManuscriptChapterPath(ctx.path)) return false
  if (ctx.beats !== undefined) {
    if (!/\.md$/i.test(ctx.path) || !isChapterBeats(ctx.beats)) return false
  }
  if (ctx.previous !== undefined) {
    if (!ctx.previous || typeof ctx.previous !== 'object' || Array.isArray(ctx.previous)) return false
    const previous = ctx.previous as Record<string, unknown>
    if (Object.keys(previous).some((key) => key !== 'path' && key !== 'state')) return false
    if (typeof previous.path !== 'string' || !isManuscriptChapterPath(previous.path) || !/\.md$/i.test(previous.path)
      || !isChapterState(previous.state)) return false
  }
  return ctx.beats !== undefined || ctx.previous !== undefined
}

function validateV2(envelope: ProjectContextEnvelopeV2): boolean {
  if (envelope.author_preferences !== undefined && (typeof envelope.author_preferences !== 'string'
    || !envelope.author_preferences || envelope.author_preferences.length > AUTHOR_PREFERENCES_MAX_CHARS
    || envelope.author_preferences !== normalizeAuthorPreferences(envelope.author_preferences))) return false
  if (envelope.author_memory !== undefined && (typeof envelope.author_memory !== 'string'
    || !envelope.author_memory || envelope.author_memory.length > AUTHOR_MEMORY_MAX_CHARS
    || envelope.author_memory !== normalizeAuthorMemory(envelope.author_memory))) return false
  if (envelope.chapter_context !== undefined && !isChapterContext(envelope.chapter_context)) return false
  const sources = envelope.project_context.sources
  if (sources.length > PROJECT_CONTEXT_SOURCE_PATHS.length + 64 || !validateFixed(sources, true) || !isScan(envelope.project_context.scan)) return false
  const seen = new Set<string>()
  let dynamicTotal = 0
  let previousDynamic: ProjectContextSource | undefined
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!
    if (seen.has(source.path)) return false
    seen.add(source.path)
    if (index < PROJECT_CONTEXT_SOURCE_PATHS.length) continue
    if (!isBaseSource(source) || source.kind !== 'worldbook' || source.status !== 'included') return false
    const segments = source.path.split('/')
    if (!/^世界书\/[^\u0000-\u001f\\]+\.md$/i.test(source.path) || source.path.toLowerCase() === '世界书/设定总汇.md'.toLowerCase()
      || segments.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return false
    if (!Number.isInteger(source.priority) || source.priority! < -100 || source.priority! > 100) return false
    if (source.matchedBy !== 'task' && source.matchedBy !== 'saved-document' && source.matchedBy !== 'both') return false
    const checkedTriggers = Array.isArray(source.matchedTriggers) ? validTriggers(source.matchedTriggers) : undefined
    if (!checkedTriggers || checkedTriggers.length !== source.matchedTriggers!.length) return false
    if (source.includedChars > WORLDBOOK_MAX_CHARS_PER_FILE) return false
    if (previousDynamic && (previousDynamic.priority! < source.priority!
      || (previousDynamic.priority === source.priority && previousDynamic.path > source.path))) return false
    previousDynamic = source
    dynamicTotal += source.includedChars
  }
  return dynamicTotal <= WORLDBOOK_MAX_TOTAL_CHARS
}

export function parseProjectContextEnvelope(text: string): ProjectContextEnvelope | EditorTaskEnvelope | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const task = value as Partial<EditorTaskEnvelope>
  if (task.schema === PROJECT_CONTEXT_SCHEMA && task.version === 3) {
    if (typeof task.user_request !== 'string' || Object.keys(task).some(key => !['schema', 'version', 'user_request', 'active_path'].includes(key))) return undefined
    if (task.active_path !== undefined && (typeof task.active_path !== 'string' || !task.active_path || !/\.(md|txt)$/i.test(task.active_path) || /^[\\/]|^[a-z]:/i.test(task.active_path) || /[\\\u0000-\u001f]/.test(task.active_path) || task.active_path.split('/').some(part => !part || part.startsWith('.')))) return undefined
    return task as EditorTaskEnvelope
  }
  const envelope = value as Partial<ProjectContextEnvelope>
  if (envelope.schema !== PROJECT_CONTEXT_SCHEMA || typeof envelope.user_request !== 'string') return undefined
  if (!envelope.project_context || typeof envelope.project_context !== 'object' || Array.isArray(envelope.project_context)) return undefined
  const sources = (envelope.project_context as { sources?: unknown }).sources
  if (!Array.isArray(sources)) return undefined
  if (envelope.version === PROJECT_CONTEXT_VERSION) {
    if ('author_preferences' in envelope) return undefined
    if ('author_memory' in envelope) return undefined
    if ('chapter_context' in envelope) return undefined
    if (sources.length !== PROJECT_CONTEXT_SOURCE_PATHS.length || !validateFixed(sources as ProjectContextSource[], false, true)) return undefined
    return envelope as ProjectContextEnvelopeV1
  }
  if (envelope.version === PROJECT_CONTEXT_CURRENT_VERSION && validateV2(envelope as ProjectContextEnvelopeV2)) return envelope as ProjectContextEnvelopeV2
  return undefined
}

export function projectContextReceipt(envelope: ProjectContextEnvelope | EditorTaskEnvelope): ProjectContextReceiptBundle {
  if (envelope.version === 3) return { sources: [] }
  return {
    sources: stripText(envelope.project_context.sources),
    ...(envelope.version === PROJECT_CONTEXT_CURRENT_VERSION ? { scan: envelope.project_context.scan } : {}),
    ...(envelope.version === PROJECT_CONTEXT_CURRENT_VERSION && envelope.author_preferences ? { authorPreferencesChars: envelope.author_preferences.length } : {}),
    ...(envelope.version === PROJECT_CONTEXT_CURRENT_VERSION && envelope.author_memory ? { authorMemoryChars: envelope.author_memory.length } : {}),
    ...(envelope.version === PROJECT_CONTEXT_CURRENT_VERSION && envelope.chapter_context
      ? { chapterContext: receiptChapterContext(envelope.chapter_context) }
      : {}),
  }
}
