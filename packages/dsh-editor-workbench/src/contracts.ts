import { AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorPreferences } from './author-preferences.ts'

export { AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorPreferences } from './author-preferences.ts'

/** Loopback-only Host RPC channel for desktop workspace lifecycle operations. */
export const WORKBENCH_RPC_CHANNEL = '/dsh-editor-workbench'

export type WorkbenchEndpoint =
  | 'project.inspect'
  | 'project.createHome'
  | 'project.init'
  | 'project.prepareIndex'
  | 'project.overview'
  | 'chapter.statusSet'
  | 'structure.groupCreate'
  | 'context.compile'
  | 'project.importProbe'
  | 'project.importApply'
  | 'project.importCleanup'
  | 'snapshot.list'
  | 'snapshot.create'
  | 'snapshot.restoreProbe'
  | 'snapshot.restoreApply'
  | 'snapshot.restoreCleanup'
  | 'file.rename'
  | 'file.moveManuscript'
  | 'file.readBinary'
  | 'archive.list'
  | 'archive.apply'
  | 'archive.restore'
  | 'proposal.prepare'
  | 'proposal.apply'

export type ProjectInitResponse = { created: string[]; skipped: string[] }
export type ProjectInspectionResponse = { hasVisibleEntries: boolean; textFiles: string[]; indexReady: boolean }
export type WorkbenchPathResponse = { path: string; version?: string; metadataWarning?: string }
export type ChapterStatus = 'draft' | 'revising' | 'final'
export type ChapterSummary = {
  path: string
  title: string
  status: ChapterStatus
  chars: number
  empty: boolean
  excerpt: string
  modifiedAt: string | null
}
export type OutlineSummary = {
  path: string
  title: string
  chars: number
  excerpt: string
  modifiedAt: string | null
}
export type ProjectOverview = {
  statusRevision: string | null
  chapters: ChapterSummary[]
  outlines: OutlineSummary[]
  totals: {
    chapters: number
    chars: number
    byStatus: Record<ChapterStatus, number>
  }
  recent: ChapterSummary | null
  truncated: boolean
  skipped: number
}
export type ImportProbeResponse = {
  state: 'none' | 'ready' | 'blocked' | 'recoverable' | 'complete'
  token?: string
  receiptId?: string
  files: number
  bytes: number
  skipped: Array<{ path: string; reason: 'hidden' | 'symlink' | 'other' | 'nonText' }>
  preview: string[]
  message?: string
}
export type SnapshotResponse = { snapshotId: string; label?: string; createdAt: string; files: number; bytes: number; excluded: number }
export type RestoreProbeResponse = {
  state: 'none' | 'ready' | 'blocked' | 'recoverable' | 'complete'
  token?: string
  receiptId?: string
  snapshotId?: string
  files: number
  bytes: number
  excluded: Array<{ path: string; reason: 'hidden' | 'generated' | 'other' }>
  preview: string[]
  message?: string
}
export type ArchiveResponse = {
  archiveId: string
  path: string
  createdAt: string
  bytes: number
  state: 'archived' | 'pending-archive' | 'pending-restore' | 'restored' | 'blocked'
  version?: string
  message?: string
  metadataWarning?: string
}
export type ArchiveListResponse = { items: ArchiveResponse[]; invalid: number }

export type WorkbenchRequestMap = {
  'project.inspect': { workspacePath: string }
  'project.createHome': { title: string }
  'project.init': { sessionId: string; newProject: boolean }
  'project.prepareIndex': { sessionId: string }
  'project.overview': { sessionId: string }
  'chapter.statusSet': { sessionId: string; path: string; status: ChapterStatus; expectedStatusRevision: string | null }
  'structure.groupCreate': { sessionId: string; path: string }
  'context.compile': { sessionId: string; userRequest: string; activePath?: string; authorPreferences?: string }
  'project.importProbe': { targetSessionId: string; sourceSessionId?: string }
  'project.importApply': { targetSessionId: string; sourceSessionId: string; probeToken: string }
  'project.importCleanup': { targetSessionId: string; receiptId: string }
  'snapshot.list': { sessionId: string }
  'snapshot.create': { sessionId: string; label?: string }
  'snapshot.restoreProbe': { targetSessionId: string; sourceSessionId?: string; snapshotId?: string }
  'snapshot.restoreApply': { targetSessionId: string; sourceSessionId: string; snapshotId: string; token: string }
  'snapshot.restoreCleanup': { targetSessionId: string; receiptId: string }
  'file.rename': { sessionId: string; path: string; newName: string; expectedVersion: string }
  'file.moveManuscript': { sessionId: string; path: string; targetDirectory: string; expectedVersion: string }
  'file.readBinary': { sessionId: string; path: string }
  'archive.list': { sessionId: string }
  'archive.apply': { sessionId: string; path?: string; expectedVersion?: string; archiveId?: string }
  'archive.restore': { sessionId: string; archiveId: string; expectedVersion?: string }
  'proposal.prepare': { sessionId: string; proposal: ProposalPayload }
  'proposal.apply': { sessionId: string; proposal: ProposalPayload; expectedVersions?: Record<string, string> }
}

export type WorkbenchResponseMap = {
  'project.inspect': ProjectInspectionResponse
  'project.createHome': WorkbenchPathResponse
  'project.init': ProjectInitResponse
  'project.prepareIndex': ProjectInitResponse
  'project.overview': ProjectOverview
  'chapter.statusSet': ProjectOverview
  'structure.groupCreate': WorkbenchPathResponse
  'context.compile': ProjectContextCompilation
  'project.importProbe': ImportProbeResponse
  'project.importApply': { imported: number; skipped: number }
  'project.importCleanup': { removed: number }
  'snapshot.list': SnapshotResponse[]
  'snapshot.create': SnapshotResponse
  'snapshot.restoreProbe': RestoreProbeResponse
  'snapshot.restoreApply': { restored: number; skipped: number; complete: true }
  'snapshot.restoreCleanup': { removed: number }
  'file.rename': Required<WorkbenchPathResponse>
  'file.moveManuscript': Required<WorkbenchPathResponse>
  'file.readBinary': { base64: string; mime: string }
  'archive.list': ArchiveListResponse
  'archive.apply': ArchiveResponse
  'archive.restore': ArchiveResponse
  'proposal.prepare': { split?: ProposalSplitPlan; merge?: ProposalMergePlan; renames?: ProposalRenamesPlan }
  'proposal.apply': ProposalApplyResult
}

export type ProposalRename = { from: string; to: string }
export type ProposalPayload =
  | { marker: 'dsh-editor.proposal'; version: 1; kind: 'split'; summary: string; path: string; anchor: string; newPath: string }
  | { marker: 'dsh-editor.proposal'; version: 1; kind: 'merge'; summary: string; path: string; sourcePath: string }
  | { marker: 'dsh-editor.proposal'; version: 1; kind: 'renames'; summary: string; renames: ProposalRename[] }
export type ProposalSplitPlan = { kind: 'split'; version: string; before: string; after: string; headChars: number; tailChars: number }
export type ProposalMergePlan = { kind: 'merge'; versions: { path: string; sourcePath: string }; pathChars: number; sourceChars: number }
export type ProposalRenamesPlan = { kind: 'renames'; versions: Record<string, string>; entries: ProposalRename[] }
export type ProposalApplyResult = { applied: string[]; failed?: { from: string; reason: string }; snapshotDir?: string }

export type WorkbenchRpcIssue = { code: 'custom'; path: string[]; message: string }
export type WorkbenchRpcError =
  | { code: 'bad-request'; message: string; details: { issues: WorkbenchRpcIssue[] } }
  | { code: 'cancelled'; message: string; details: Record<string, never> }
  | { code: 'session-not-found'; message: string; details: { sessionId: string } }
  | { code: 'workspace-attach-failed'; message: string; details: { sessionId: string; workspaceId: string } }
  | { code: 'workspace-not-found'; message: string; details: { workspaceId: string } }
  | { code: 'workspace-invalid-path'; message: string; details: { path: string } }
  | { code: 'directory-unreadable'; message: string; details: { path: string } }
  | { code: 'directory-exists'; message: string; details: { path: string } }
  | { code: 'internal'; message: string; details: Record<string, never> }
export type WorkbenchRpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: WorkbenchRpcError }

/** Maximum payload size for `file.readBinary`, in bytes. */
export const FILE_READ_BINARY_MAX_BYTES = 20 * 1024 * 1024

/** Extension → MIME type for `file.readBinary`. Keys are lowercase, leading dot included. */
export const FILE_READ_BINARY_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

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
export type ProjectContextReceiptBundle = { sources: ProjectContextReceipt[]; scan?: WorldbookScanSummary; authorPreferencesChars?: number }
export type ProjectContextSource = ProjectContextReceipt & { text?: string }
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
  user_request: string
}
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

function withoutBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text
}

function hasExplicitFrontmatter(text: string): boolean {
  const source = withoutBom(text)
  return source.startsWith('---\n') || source.startsWith('---\r\n')
}

function parseTriggerValue(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const inner = trimmed.slice(1, -1)
    if (trimmed.startsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed)
        return typeof parsed === 'string' ? parsed : undefined
      } catch { return undefined }
    }
    return inner.replace(/''/g, "'")
  }
  return trimmed
}

function splitInlineTriggers(value: string): string[] | undefined {
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
    if (escaped) { escaped = false; continue }
    if (quote === '"' && char === '\\') { escaped = true; continue }
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === ',') { parts.push(body.slice(start, index)); start = index + 1 }
  }
  if (quote) return undefined
  parts.push(body.slice(start))
  const parsed = parts.map(parseTriggerValue)
  return parsed.every((item): item is string => item !== undefined) ? parsed : undefined
}

function validTriggers(values: string[]): string[] | undefined {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    const folded = value.toLowerCase()
    if (!value || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) return undefined
    if (!seen.has(folded)) { unique.push(value); seen.add(folded) }
  }
  return unique.length > 0 && unique.length <= 16 ? unique : undefined
}

export function parseWorldbookFrontmatter(path: string, text: string): ParsedWorldbook | undefined {
  const source = withoutBom(text)
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    const legacy = path.replace(/^世界书\//, '').replace(/\.md$/i, '')
    const triggers = validTriggers([legacy])
    return triggers ? { enabled: true, priority: 0, triggers } : undefined
  }
  const close = /\r?\n---(?:\r?\n|$)/g
  close.lastIndex = source.indexOf('\n') + 1
  const match = close.exec(source)
  if (!match || match.index > 4_096) return undefined
  const body = source.slice(source.indexOf('\n') + 1, match.index)
  const lines = body.split(/\r?\n/)
  let enabled = true
  let priority = 0
  let triggers: string[] | undefined
  let sawTriggers = false
  let sawEnabled = false
  let sawPriority = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (!line.trim() || /^\s*#/.test(line)) continue
    if (/^\s/.test(line)) return undefined
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!field) return undefined
    const key = field[1]!
    const value = field[2]!
    if (key === 'triggers') {
      if (sawTriggers) return undefined
      sawTriggers = true
      if (value.trim()) triggers = splitInlineTriggers(value)
      else {
        const values: string[] = []
        while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1]!)) {
          const parsed = parseTriggerValue(lines[++index]!.replace(/^\s+-\s+/, ''))
          if (parsed === undefined) return undefined
          values.push(parsed)
        }
        triggers = values
      }
      if (!triggers) return undefined
    } else if (key === 'enabled') {
      if (sawEnabled || (value !== 'true' && value !== 'false')) return undefined
      sawEnabled = true
      enabled = value === 'true'
    } else if (key === 'priority') {
      if (sawPriority || !/^-?\d+$/.test(value)) return undefined
      sawPriority = true
      priority = Number(value)
      if (!Number.isSafeInteger(priority) || priority < -100 || priority > 100) return undefined
    } else return undefined
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
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const source = withoutBom(text)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  let body = source
  let comments: string[] = []
  if (hasExplicitFrontmatter(text)) {
    if (!parseWorldbookFrontmatter('世界书/编辑中.md', text)) throw new Error('invalid worldbook frontmatter')
    const close = /\r?\n---(?:\r?\n|$)/g
    close.lastIndex = source.indexOf('\n') + 1
    const match = close.exec(source)
    if (!match || match.index > 4_096) throw new Error('invalid worldbook frontmatter')
    comments = source.slice(source.indexOf('\n') + 1, match.index).split(/\r?\n/).filter((line) => /^\s*#/.test(line))
    body = source.slice(match.index + match[0].length)
  }
  const header = [
    '---',
    ...comments,
    `triggers: [${triggers.map((trigger) => JSON.stringify(trigger)).join(', ')}]`,
    `enabled: ${input.enabled ? 'true' : 'false'}`,
    `priority: ${input.priority}`,
    '---',
  ].join(newline)
  return `${bom}${header}${newline}${body}`
}

function stripText(sources: ProjectContextSource[]): ProjectContextReceipt[] {
  return sources.map(({ text: _text, ...source }) => source)
}

function bumpScan(scan: WorldbookScanSummary, key: keyof WorldbookScanSummary, maximum: number): void {
  scan[key] = Math.min(maximum, scan[key] + 1)
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
  const envelope: ProjectContextEnvelopeV2 = {
    schema: PROJECT_CONTEXT_SCHEMA,
    version: PROJECT_CONTEXT_CURRENT_VERSION,
    project_context: { sources, scan },
    ...(authorPreferences ? { author_preferences: authorPreferences } : {}),
    user_request: userRequest,
  }
  return { envelope, serialized: JSON.stringify(envelope), receipt: { sources: stripText(sources), scan, ...(authorPreferences ? { authorPreferencesChars: authorPreferences.length } : {}) } }
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

function validateV2(envelope: ProjectContextEnvelopeV2): boolean {
  if (envelope.author_preferences !== undefined && (typeof envelope.author_preferences !== 'string'
    || !envelope.author_preferences || envelope.author_preferences.length > AUTHOR_PREFERENCES_MAX_CHARS
    || envelope.author_preferences !== normalizeAuthorPreferences(envelope.author_preferences))) return false
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

export function parseProjectContextEnvelope(text: string): ProjectContextEnvelope | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const envelope = value as Partial<ProjectContextEnvelope>
  if (envelope.schema !== PROJECT_CONTEXT_SCHEMA || typeof envelope.user_request !== 'string') return undefined
  if (!envelope.project_context || typeof envelope.project_context !== 'object' || Array.isArray(envelope.project_context)) return undefined
  const sources = (envelope.project_context as { sources?: unknown }).sources
  if (!Array.isArray(sources)) return undefined
  if (envelope.version === PROJECT_CONTEXT_VERSION) {
    if ('author_preferences' in envelope) return undefined
    if (sources.length !== PROJECT_CONTEXT_SOURCE_PATHS.length || !validateFixed(sources as ProjectContextSource[], false, true)) return undefined
    return envelope as ProjectContextEnvelopeV1
  }
  if (envelope.version === PROJECT_CONTEXT_CURRENT_VERSION && validateV2(envelope as ProjectContextEnvelopeV2)) return envelope as ProjectContextEnvelopeV2
  return undefined
}

export function projectContextReceipt(envelope: ProjectContextEnvelope): ProjectContextReceiptBundle {
  return {
    sources: stripText(envelope.project_context.sources),
    ...(envelope.version === PROJECT_CONTEXT_CURRENT_VERSION ? { scan: envelope.project_context.scan } : {}),
    ...(envelope.version === PROJECT_CONTEXT_CURRENT_VERSION && envelope.author_preferences ? { authorPreferencesChars: envelope.author_preferences.length } : {}),
  }
}
