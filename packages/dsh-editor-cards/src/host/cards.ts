import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createTextFile,
  FileOpError,
  listDirStrict,
  normalizeWorkspaceRelative,
  readTextFile,
  readTextFileLimited,
  writeTextFile,
} from 'dsh-manuscript/host-api'
import type {
  CardKind,
  CardReferenceHit,
  CardsCreateResponse,
  CardsListKind,
  CardsListResponse,
  CardsMetaSetResponse,
  CardsReferencesResponse,
  CharacterCard,
  WorldbookCard,
} from 'dsh-editor-cards/contracts'
import {
  applyFrontmatterFields,
  extractCardSummary,
  filenameStem,
  parseCharacterCardFrontmatter,
  parseWorldbookCardFrontmatter,
  sanitizeCardFields,
  type CardMetaFields,
} from 'dsh-editor-workspace-kit/frontmatter'
import {
  createVisibleDirectory,
  isGeneratedPath,
  isHiddenPath,
  LifecycleError,
  MAX_FILES,
  validateEntryName,
  type OverviewAccess,
} from 'dsh-editor-workspace-kit'

export const CHARACTER_ROOT = '人物卡'
export const WORLDBOOK_ROOT = '世界书'
export const MANUSCRIPT_ROOT = '正文'
export const CARD_REFERENCES_MAX_HITS = 200

const MAX_TOTAL_BYTES = 100_000_000
const MAX_TEXT_BYTES = 2_000_000
const MAX_DIRECTORIES = 2_000
const MAX_DIRECTORY_ENTRIES = 10_000
const MAX_DEPTH = 12

export class CardsError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'BLOCKED' | 'INVALID_PATH' | 'INVALID' | 'IO' | 'EXISTS' | 'STALE',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CardsError'
  }
}

function pathCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function byteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function generated(relative: string): boolean {
  return isGeneratedPath(relative)
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function safeRoot(root: string): Promise<string> {
  const resolved = path.resolve(root)
  let state: import('node:fs').Stats
  try {
    state = await fs.lstat(resolved)
  } catch (error) {
    throw new CardsError('workspace root is unavailable', 'IO', { cause: error })
  }
  if (state.isSymbolicLink() || !state.isDirectory()) throw new CardsError('workspace root is unsafe', 'BLOCKED')
  return await fs.realpath(resolved)
}

async function mtimeReader(root: string): Promise<(relative: string) => Promise<string | null>> {
  const canonicalRoot = await safeRoot(root)
  return async (relative: string): Promise<string | null> => {
    const normalized = normalizeWorkspaceRelative(relative)
    let cursor = path.resolve(root)
    const parts = normalized.split('/')
    for (let index = 0; index < parts.length; index++) {
      cursor = path.join(cursor, parts[index]!)
      let state: import('node:fs').Stats
      try {
        state = await fs.lstat(cursor)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw new CardsError('failed to inspect project document', 'IO', { cause: error })
      }
      if (state.isSymbolicLink() || (index < parts.length - 1 ? !state.isDirectory() : !state.isFile())) {
        throw new CardsError('project document path is unsafe', 'BLOCKED')
      }
    }
    let canonicalParent: string
    try {
      canonicalParent = await fs.realpath(path.dirname(cursor))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new CardsError('failed to inspect project document', 'IO', { cause: error })
    }
    if (!isInside(canonicalRoot, canonicalParent)) throw new CardsError('project document path escapes workspace', 'BLOCKED')
    const state = await fs.lstat(cursor)
    if (state.isSymbolicLink() || !state.isFile()) throw new CardsError('project document path is unsafe', 'BLOCKED')
    return new Date(state.mtimeMs).toISOString()
  }
}

function assertWritable(access: OverviewAccess): void {
  if (access.mode === 'read-only') throw new CardsError('project folder is read-only', 'READ_ONLY')
}

export function parseCardsListKind(value: unknown): CardsListKind {
  if (value === 'character' || value === 'worldbook' || value === 'all') return value
  throw new CardsError('kind must be character, worldbook, or all', 'INVALID')
}

export function parseCardKind(value: unknown): CardKind {
  if (value === 'character' || value === 'worldbook') return value
  throw new CardsError('kind must be character or worldbook', 'INVALID')
}

export function cardAreaPath(relative: string, expected?: CardKind): { path: string; kind: CardKind } {
  let normalized: string
  try {
    normalized = normalizeWorkspaceRelative(relative)
  } catch (error) {
    throw new CardsError('card path is invalid', 'INVALID_PATH', { cause: error })
  }
  if (normalized !== relative.replace(/\\/g, '/') || normalized === '.' || !/\.md$/i.test(normalized)) {
    throw new CardsError('card path is invalid', 'INVALID_PATH')
  }
  const parts = normalized.split('/')
  if (isHiddenPath(normalized) || isGeneratedPath(normalized)) {
    throw new CardsError('card path is invalid', 'INVALID_PATH')
  }
  const kind = parts[0] === CHARACTER_ROOT ? 'character' : parts[0] === WORLDBOOK_ROOT ? 'worldbook' : undefined
  if (!kind || parts.length < 2) throw new CardsError('card path must be in 人物卡 or 世界书', 'INVALID_PATH')
  if (expected && kind !== expected) throw new CardsError('card path does not match kind', 'INVALID_PATH')
  return { path: normalized, kind }
}

export function cardFileStem(title: string): string {
  let name = title.trim()
  if (name.toLocaleLowerCase().endsWith('.md')) name = name.slice(0, -3).trim()
  try {
    return validateEntryName(name)
  } catch (error) {
    throw new CardsError('card title is invalid', 'INVALID_PATH', { cause: error })
  }
}

export function assertCardFields(input: unknown): Partial<CardMetaFields> {
  if (input === undefined) return {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CardsError('card fields are invalid', 'INVALID')
  }
  const raw = input as Record<string, unknown>
  const strings = ['name', 'role', 'gender', 'age', 'faction', 'status', 'category', 'summary'] as const
  for (const key of strings) {
    if (key in raw && typeof raw[key] !== 'string') throw new CardsError(`card field ${key} is invalid`, 'INVALID')
  }
  for (const key of ['aliases', 'tags', 'triggers'] as const) {
    if (key in raw && (!Array.isArray(raw[key]) || (raw[key] as unknown[]).some((item) => typeof item !== 'string'))) {
      throw new CardsError(`card field ${key} is invalid`, 'INVALID')
    }
  }
  if ('enabled' in raw && typeof raw.enabled !== 'boolean') throw new CardsError('card field enabled is invalid', 'INVALID')
  if ('priority' in raw && (typeof raw.priority !== 'number' || !Number.isSafeInteger(raw.priority) || raw.priority < -100 || raw.priority > 100)) {
    throw new CardsError('card field priority is invalid', 'INVALID')
  }
  if ('relations' in raw) {
    if (!Array.isArray(raw.relations)) throw new CardsError('card field relations is invalid', 'INVALID')
    for (const item of raw.relations) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CardsError('card field relations is invalid', 'INVALID')
      const row = item as { to?: unknown; kind?: unknown }
      if (typeof row.to !== 'string' || typeof row.kind !== 'string') throw new CardsError('card field relations is invalid', 'INVALID')
    }
  }
  if ('triggers' in raw) {
    const sanitized = sanitizeCardFields({ triggers: raw.triggers })
    if (!sanitized.triggers) throw new CardsError('card field triggers is invalid', 'INVALID')
  }
  return sanitizeCardFields(raw)
}

export function cardReferenceTerms(kind: CardKind, path: string, text: string): string[] {
  if (kind === 'character') {
    const fields = parseCharacterCardFrontmatter(path, text)
    return uniqueTerms([fields.name ?? filenameStem(path), ...(fields.aliases ?? [])])
  }
  const fields = parseWorldbookCardFrontmatter(path, text)
  return uniqueTerms(fields.triggers?.length ? fields.triggers : [filenameStem(path)])
}

function uniqueTerms(values: string[]): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    terms.push(value)
  }
  return terms.sort((left, right) => right.length - left.length || left.localeCompare(right, 'zh-CN'))
}

export function locateOffset(text: string, start: number): { line: number; column: number } {
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

export function lineExcerpt(text: string, start: number, end: number): string {
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

export function findLiteralHits(text: string, terms: readonly string[], path: string, limit: number): CardReferenceHit[] {
  const ordered = uniqueTerms([...terms])
  const hits: CardReferenceHit[] = []
  let index = 0
  while (index < text.length && hits.length < limit) {
    let matched: { start: number; end: number } | undefined
    for (const term of ordered) {
      if (!term || !text.startsWith(term, index)) continue
      matched = { start: index, end: index + term.length }
      break
    }
    if (matched) {
      const { line, column } = locateOffset(text, matched.start)
      hits.push({
        path,
        line,
        column,
        start: matched.start,
        end: matched.end,
        excerpt: lineExcerpt(text, matched.start, matched.end),
      })
      index = matched.end
    } else {
      index++
    }
  }
  return hits
}

type WalkLimits = { files: number; bytes: number; directories: number; entries: number; truncated: boolean; skipped: number }
type LoadedText = { path: string; text: string; version: string }

function emptyLimits(): WalkLimits {
  return { files: 0, bytes: 0, directories: 0, entries: 0, truncated: false, skipped: 0 }
}

async function walkArea(
  access: OverviewAccess,
  root: string,
  extensions: RegExp,
  limits: WalkLimits,
): Promise<LoadedText[]> {
  const files: LoadedText[] = []
  const queue = [root]
  while (queue.length && !limits.truncated) {
    const directory = queue.shift()!
    if (++limits.directories > MAX_DIRECTORIES) {
      limits.truncated = true
      limits.skipped++
      break
    }
    let entries
    try {
      entries = await listDirStrict(access.files, directory)
    } catch (error) {
      if (directory === root && error instanceof FileOpError && error.code === 'NOT_FOUND') break
      limits.skipped++
      continue
    }
    for (const entry of entries) {
      if (++limits.entries > MAX_DIRECTORY_ENTRIES) {
        limits.truncated = true
        limits.skipped++
        break
      }
      const relative = `${directory}/${entry.name}`
      if (entry.name.startsWith('.') || generated(relative)) {
        limits.skipped++
        continue
      }
      if (entry.type === 'directory') {
        if (relative.split('/').length > MAX_DEPTH) {
          limits.skipped++
          continue
        }
        queue.push(relative)
        continue
      }
      if (entry.type !== 'file' || !extensions.test(entry.name)) {
        limits.skipped++
        continue
      }
      if (limits.files >= MAX_FILES || limits.bytes >= MAX_TOTAL_BYTES) {
        limits.truncated = true
        break
      }
      try {
        const loaded = await readTextFileLimited(access.files, relative, Math.min(MAX_TEXT_BYTES, MAX_TOTAL_BYTES - limits.bytes))
        const bytes = byteSize(loaded.text)
        if (limits.bytes + bytes > MAX_TOTAL_BYTES) {
          limits.truncated = true
          limits.skipped++
          break
        }
        limits.files++
        limits.bytes += bytes
        files.push({ path: relative, text: loaded.text, version: loaded.version })
      } catch (error) {
        limits.skipped++
        if (error instanceof FileOpError && error.code === 'TOO_LARGE' && MAX_TOTAL_BYTES - limits.bytes <= MAX_TEXT_BYTES) {
          limits.truncated = true
          break
        }
      }
    }
  }
  files.sort((left, right) => pathCompare(left.path, right.path))
  return files
}

function toCharacterCard(file: LoadedText, modifiedAt: string | null): CharacterCard {
  const frontmatter = parseCharacterCardFrontmatter(file.path, file.text)
  const title = frontmatter.name?.trim() || filenameStem(file.path)
  return {
    path: file.path,
    title,
    frontmatter,
    summary: extractCardSummary(file.text, frontmatter.summary),
    version: file.version,
    modifiedAt,
  }
}

function toWorldbookCard(file: LoadedText, modifiedAt: string | null): WorldbookCard {
  const frontmatter = parseWorldbookCardFrontmatter(file.path, file.text)
  return {
    path: file.path,
    title: filenameStem(file.path),
    frontmatter,
    summary: extractCardSummary(file.text, frontmatter.summary),
    version: file.version,
    modifiedAt,
  }
}

export async function listCards(input: { access: OverviewAccess; kind: unknown }): Promise<CardsListResponse> {
  const kind = parseCardsListKind(input.kind)
  const modifiedAt = await mtimeReader(input.access.path)
  const limits = emptyLimits()
  const characters: CharacterCard[] = []
  const worldbook: WorldbookCard[] = []
  if (kind === 'character' || kind === 'all') {
    for (const file of await walkArea(input.access, CHARACTER_ROOT, /\.md$/i, limits)) {
      characters.push(toCharacterCard(file, await modifiedAt(file.path)))
    }
  }
  if ((kind === 'worldbook' || kind === 'all') && !limits.truncated) {
    for (const file of await walkArea(input.access, WORLDBOOK_ROOT, /\.md$/i, limits)) {
      worldbook.push(toWorldbookCard(file, await modifiedAt(file.path)))
    }
  }
  characters.sort((left, right) => pathCompare(left.path, right.path))
  worldbook.sort((left, right) => pathCompare(left.path, right.path))
  return {
    characters,
    worldbook,
    scannedFiles: limits.files,
    skipped: limits.skipped,
    truncated: limits.truncated,
  }
}

export async function setCardMeta(input: {
  access: OverviewAccess
  path: string
  version: string
  fields: unknown
}): Promise<CardsMetaSetResponse> {
  assertWritable(input.access)
  const { path: relative } = cardAreaPath(input.path)
  if (!input.version) throw new CardsError('file version is required', 'STALE')
  const fields = assertCardFields(input.fields)
  let loaded
  try {
    loaded = await readTextFile(input.access.files, relative)
  } catch (error) {
    if (error instanceof FileOpError && (error.code === 'NOT_FOUND' || error.code === 'NOT_TEXT')) {
      throw new CardsError('card path was not found', 'INVALID_PATH', { cause: error })
    }
    throw error
  }
  if (loaded.version !== input.version) throw new CardsError('file changed on disk', 'STALE')
  const next = applyFrontmatterFields(loaded.text, fields)
  try {
    const written = await writeTextFile(input.access.files, relative, next, input.version)
    return { path: relative, version: written.version }
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'STALE') throw new CardsError('file changed on disk', 'STALE', { cause: error })
    throw error
  }
}

export async function listCardReferences(input: {
  access: OverviewAccess
  path: string
}): Promise<CardsReferencesResponse> {
  const { path: relative, kind } = cardAreaPath(input.path)
  let card
  try {
    card = await readTextFile(input.access.files, relative)
  } catch (error) {
    if (error instanceof FileOpError && (error.code === 'NOT_FOUND' || error.code === 'NOT_TEXT')) {
      throw new CardsError('card path was not found', 'INVALID_PATH', { cause: error })
    }
    throw error
  }
  const terms = cardReferenceTerms(kind, relative, card.text)
  const limits = emptyLimits()
  const files = await walkArea(input.access, MANUSCRIPT_ROOT, /\.(md|txt)$/i, limits)
  const hits: CardReferenceHit[] = []
  for (const file of files) {
    if (hits.length >= CARD_REFERENCES_MAX_HITS) {
      limits.truncated = true
      break
    }
    hits.push(...findLiteralHits(file.text, terms, file.path, CARD_REFERENCES_MAX_HITS - hits.length))
  }
  return {
    terms,
    hits,
    scannedFiles: files.length,
    truncated: limits.truncated || hits.length >= CARD_REFERENCES_MAX_HITS,
  }
}

async function ensureCardRoot(access: OverviewAccess, root: typeof CHARACTER_ROOT | typeof WORLDBOOK_ROOT): Promise<void> {
  try {
    await listDirStrict(access.files, root)
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') {
      try {
        await createVisibleDirectory({ root: access.path, mode: access.mode, relative: root, signal: access.files.signal })
      } catch (dirError) {
        if (dirError instanceof LifecycleError) {
          throw new CardsError(dirError.message, dirError.code === 'READ_ONLY' || dirError.code === 'EXISTS' || dirError.code === 'INVALID_PATH' || dirError.code === 'IO' || dirError.code === 'BLOCKED' ? dirError.code : 'IO', { cause: dirError })
        }
        throw dirError
      }
      return
    }
    throw error
  }
}

export async function createCard(input: {
  access: OverviewAccess
  kind: unknown
  title: string
  fields?: unknown
}): Promise<CardsCreateResponse> {
  assertWritable(input.access)
  const kind = parseCardKind(input.kind)
  const stem = cardFileStem(input.title)
  const fields = assertCardFields(input.fields)
  const relative = `${kind === 'character' ? CHARACTER_ROOT : WORLDBOOK_ROOT}/${stem}.md`
  const defaults: CardMetaFields = kind === 'character'
    ? { ...fields, name: fields.name ?? stem }
    : { enabled: true, priority: 0, ...fields, triggers: fields.triggers ?? [stem] }
  const body = `# ${stem}\n`
  const text = applyFrontmatterFields(body, defaults)
  await ensureCardRoot(input.access, kind === 'character' ? CHARACTER_ROOT : WORLDBOOK_ROOT)
  try {
    const created = await createTextFile(input.access.files, relative, text)
    return { path: relative, version: created.version }
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'EXISTS') throw new CardsError('card already exists', 'EXISTS', { cause: error })
    throw error
  }
}
