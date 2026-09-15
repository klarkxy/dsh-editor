/** Browser-safe WritingProposal V2 contract. No host or Node imports. */

export const WRITING_PROPOSAL_MARKER = 'dsh-editor.proposal'
export const WRITING_PROPOSAL_VERSION = 2
export const WRITING_PROPOSE_TOOL_NAME = 'writing_propose'

export const WRITING_PROPOSAL_BASIS_MAX = 16
export const WRITING_PROPOSAL_PATH_MAX_CHARS = 512
export const WRITING_PROPOSAL_VERSION_MAX_CHARS = 512
export const WRITING_PROPOSAL_LABEL_MAX_CHARS = 120
export const WRITING_PROPOSAL_RENAMES_MAX = 50

export class WritingProposalError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID' | 'STALE',
  ) {
    super(message)
    this.name = 'WritingProposalError'
  }
}

export type WritingProposalBasis = {
  path: string
  version: string
  label?: string
}

export type WritingProposalRename = { from: string; to: string; version: string }

export type WritingProposalV2 = {
  marker: typeof WRITING_PROPOSAL_MARKER
  version: typeof WRITING_PROPOSAL_VERSION
  summary: string
  basis?: WritingProposalBasis[]
} & (
  | { kind: 'edit'; path: string; oldText: string; newText: string; targetVersion: string }
  | { kind: 'create'; path: string; text: string }
  | { kind: 'split'; path: string; anchor: string; newPath: string; targetVersion: string }
  | { kind: 'merge'; path: string; sourcePath: string; targetVersion: string; sourceVersion: string }
  | { kind: 'renames'; renames: WritingProposalRename[] }
)

const WRITING_PROPOSAL_KINDS = ['edit', 'create', 'split', 'merge', 'renames'] as const

const ALLOWED_KEYS: Record<(typeof WRITING_PROPOSAL_KINDS)[number], readonly string[]> = {
  edit: ['marker', 'version', 'kind', 'path', 'summary', 'oldText', 'newText', 'targetVersion', 'basis'],
  create: ['marker', 'version', 'kind', 'path', 'summary', 'text', 'basis'],
  split: ['marker', 'version', 'kind', 'path', 'summary', 'anchor', 'newPath', 'targetVersion', 'basis'],
  merge: ['marker', 'version', 'kind', 'path', 'summary', 'sourcePath', 'targetVersion', 'sourceVersion', 'basis'],
  renames: ['marker', 'version', 'kind', 'summary', 'renames', 'basis'],
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Non-empty bounded version string from a versioned read receipt. Distinct from optional basis[]. */
export function parseWritingReceiptVersion(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new WritingProposalError(`${field} must be a non-empty version string from a versioned read receipt`, 'INVALID')
  }
  const version = value.trim()
  if (!version) {
    throw new WritingProposalError(`${field} must be a non-empty version string from a versioned read receipt`, 'INVALID')
  }
  if (version.length > WRITING_PROPOSAL_VERSION_MAX_CHARS) {
    throw new WritingProposalError(`${field} must be at most ${WRITING_PROPOSAL_VERSION_MAX_CHARS} characters`, 'INVALID')
  }
  return version
}

function aliasedString(args: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    if (typeof args[name] === 'string') return args[name]
  }
  return ''
}

/** Project-relative path: no absolute/device/NUL/traversal; not the workspace root. */
export function projectRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WritingProposalError('path must be a project-relative file', 'INVALID')
  }
  if (value.includes('\0')) throw new WritingProposalError('path contains NUL', 'INVALID')
  if (value.length > WRITING_PROPOSAL_PATH_MAX_CHARS) {
    throw new WritingProposalError(`path must be at most ${WRITING_PROPOSAL_PATH_MAX_CHARS} characters`, 'INVALID')
  }
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.includes(':')) {
    throw new WritingProposalError('absolute and device paths are not allowed', 'INVALID')
  }
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new WritingProposalError('path escapes workspace', 'INVALID')
    parts.push(part)
  }
  if (parts.length === 0) throw new WritingProposalError('path must be a project-relative file', 'INVALID')
  return parts.join('/')
}

export const WRITING_PROPOSAL_GENERATED_DIRECTORIES = ['build', 'coverage', 'dist', 'node_modules', 'out', 'target'] as const
export const WRITING_V2_CREATE = true as const

export function isWritingV2Create(value: { writingV2?: unknown } | null | undefined): boolean {
  return value?.writingV2 === WRITING_V2_CREATE
}

function hasHiddenSegment(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.'))
}

export function isWritingProposalGeneratedPath(path: string): boolean {
  return path.split('/').some((part) => (
    WRITING_PROPOSAL_GENERATED_DIRECTORIES as readonly string[]
  ).includes(part.toLocaleLowerCase()))
}

function visibleTargetPath(value: unknown): string {
  const path = projectRelativePath(value)
  if (hasHiddenSegment(path)) {
    throw new WritingProposalError('proposals cannot target hidden path segments', 'INVALID')
  }
  if (isWritingProposalGeneratedPath(path)) {
    throw new WritingProposalError('proposals cannot target generated directories', 'INVALID')
  }
  if (!/\.(md|txt)$/i.test(path)) {
    throw new WritingProposalError('proposals only accept visible project-relative Markdown or text files', 'INVALID')
  }
  return path
}

const EDIT_ARG_ALIASES = ['old_text', 'old_string', 'new_text', 'new_string'] as const

function assertCanonicalEnvelope(args: Record<string, unknown>): void {
  if ('marker' in args && args.marker !== WRITING_PROPOSAL_MARKER) {
    throw new WritingProposalError('proposal marker is invalid', 'INVALID')
  }
  if ('version' in args && args.version !== WRITING_PROPOSAL_VERSION) {
    throw new WritingProposalError('proposal version is invalid', 'INVALID')
  }
}

function assertAllowedKeys(args: Record<string, unknown>, kind: (typeof WRITING_PROPOSAL_KINDS)[number]): void {
  const allowed = new Set<string>(ALLOWED_KEYS[kind])
  if (kind === 'edit') {
    for (const alias of EDIT_ARG_ALIASES) allowed.add(alias)
  }
  if (Object.keys(args).some((key) => !allowed.has(key))) {
    throw new WritingProposalError('proposal contains unsupported fields', 'INVALID')
  }
}

function cleanRenames(value: unknown): WritingProposalRename[] {
  if (!Array.isArray(value)) throw new WritingProposalError('renames requires 1-50 entries', 'INVALID')
  if (value.length < 1 || value.length > WRITING_PROPOSAL_RENAMES_MAX) {
    throw new WritingProposalError('renames requires 1-50 entries', 'INVALID')
  }
  const out: WritingProposalRename[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new WritingProposalError('renames entries must be objects', 'INVALID')
    }
    const row = entry as Record<string, unknown>
    if (Object.keys(row).some((key) => key !== 'from' && key !== 'to' && key !== 'version')) {
      throw new WritingProposalError('renames entries only accept from, to, and version', 'INVALID')
    }
    const from = visibleTargetPath(row.from)
    const to = visibleTargetPath(row.to)
    const version = parseWritingReceiptVersion(row.version, 'renames version')
    if (from === to) throw new WritingProposalError('renames entries must change the path', 'INVALID')
    if (seen.has(from) || seen.has(to)) throw new WritingProposalError('renames entries must not overlap', 'INVALID')
    seen.add(from)
    seen.add(to)
    out.push({ from, to, version })
  }
  return out
}

export function parseWritingProposalBasis(value: unknown): WritingProposalBasis[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new WritingProposalError('basis must be an array', 'INVALID')
  if (value.length === 0) return undefined
  if (value.length > WRITING_PROPOSAL_BASIS_MAX) {
    throw new WritingProposalError(`basis is limited to ${WRITING_PROPOSAL_BASIS_MAX} sources`, 'INVALID')
  }
  const out: WritingProposalBasis[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new WritingProposalError('basis entries must be objects', 'INVALID')
    }
    const row = entry as Record<string, unknown>
    const extra = Object.keys(row).some((key) => key !== 'path' && key !== 'version' && key !== 'label')
    if (extra) throw new WritingProposalError('basis entries only accept path, version, and optional label', 'INVALID')
    const path = visibleTargetPath(row.path)
    const version = typeof row.version === 'string' ? row.version.trim() : ''
    if (!version) throw new WritingProposalError('basis version is required', 'INVALID')
    if (version.length > WRITING_PROPOSAL_VERSION_MAX_CHARS) {
      throw new WritingProposalError(`basis version must be at most ${WRITING_PROPOSAL_VERSION_MAX_CHARS} characters`, 'INVALID')
    }
    if (seen.has(path)) throw new WritingProposalError('basis paths must be unique', 'INVALID')
    seen.add(path)
    const item: WritingProposalBasis = { path, version }
    if (row.label !== undefined) {
      if (typeof row.label !== 'string') throw new WritingProposalError('basis label must be a string', 'INVALID')
      const label = row.label.trim()
      if (!label) throw new WritingProposalError('basis label must be non-empty when present', 'INVALID')
      if (label.length > WRITING_PROPOSAL_LABEL_MAX_CHARS) {
        throw new WritingProposalError(`basis label must be at most ${WRITING_PROPOSAL_LABEL_MAX_CHARS} characters`, 'INVALID')
      }
      item.label = label
    }
    out.push(item)
  }
  return out
}

export function isWritingProposalV2(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).marker === WRITING_PROPOSAL_MARKER
    && (value as Record<string, unknown>).version === WRITING_PROPOSAL_VERSION
}

/** Validates and normalizes a domain-agnostic V2 proposal. Does not write files. */
export function parseWritingProposal(args: Record<string, unknown>): WritingProposalV2 {
  const kind = cleanString(args.kind)
  const summary = cleanString(args.summary).trim()
  if (!(WRITING_PROPOSAL_KINDS as readonly string[]).includes(kind) || !summary) {
    throw new WritingProposalError('kind and summary are required', 'INVALID')
  }
  const typedKind = kind as (typeof WRITING_PROPOSAL_KINDS)[number]
  assertCanonicalEnvelope(args)
  assertAllowedKeys(args, typedKind)
  const basis = parseWritingProposalBasis(args.basis)
  const common = {
    marker: WRITING_PROPOSAL_MARKER,
    version: WRITING_PROPOSAL_VERSION,
    summary,
    ...(basis ? { basis } : {}),
  } as const
  if (typedKind === 'renames') {
    return { ...common, kind: typedKind, renames: cleanRenames(args.renames) }
  }
  const path = visibleTargetPath(args.path)
  if (typedKind === 'split') {
    const anchor = cleanString(args.anchor)
    const newPath = visibleTargetPath(args.newPath)
    if (!anchor.trim()) throw new WritingProposalError('split requires anchor', 'INVALID')
    if (newPath === path) throw new WritingProposalError('newPath must differ from path', 'INVALID')
    return {
      ...common,
      kind: typedKind,
      path,
      anchor,
      newPath,
      targetVersion: parseWritingReceiptVersion(args.targetVersion, 'targetVersion'),
    }
  }
  if (typedKind === 'merge') {
    const sourcePath = visibleTargetPath(args.sourcePath)
    if (sourcePath === path) throw new WritingProposalError('sourcePath must differ from path', 'INVALID')
    return {
      ...common,
      kind: typedKind,
      path,
      sourcePath,
      targetVersion: parseWritingReceiptVersion(args.targetVersion, 'targetVersion'),
      sourceVersion: parseWritingReceiptVersion(args.sourceVersion, 'sourceVersion'),
    }
  }
  if (typedKind === 'edit') {
    const oldText = aliasedString(args, ['oldText', 'old_text', 'old_string'])
    const newText = aliasedString(args, ['newText', 'new_text', 'new_string'])
    if (oldText === newText) throw new WritingProposalError('edit requires different oldText and newText', 'INVALID')
    return {
      ...common,
      kind: typedKind,
      path,
      oldText,
      newText,
      targetVersion: parseWritingReceiptVersion(args.targetVersion, 'targetVersion'),
    }
  }
  const text = cleanString(args.text)
  if (!text) throw new WritingProposalError('create requires text', 'INVALID')
  return { ...common, kind: 'create', path, text }
}

/** Parses a serialized V2 tool result. Returns undefined for V1 or malformed payloads. */
export function parseWritingProposalMarker(text: string): WritingProposalV2 | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isWritingProposalV2(value)) return undefined
  const row = value as Record<string, unknown>
  const kind = row.kind
  if (typeof kind !== 'string' || !(kind in ALLOWED_KEYS)) return undefined
  if (typeof row.summary !== 'string') return undefined
  if (kind !== 'renames' && typeof row.path !== 'string') return undefined
  if (kind === 'edit' && (typeof row.oldText !== 'string' || typeof row.newText !== 'string' || typeof row.targetVersion !== 'string')) return undefined
  if (kind === 'create' && typeof row.text !== 'string') return undefined
  if (kind === 'split' && (typeof row.anchor !== 'string' || typeof row.newPath !== 'string' || typeof row.targetVersion !== 'string')) return undefined
  if (kind === 'merge' && (typeof row.sourcePath !== 'string' || typeof row.targetVersion !== 'string' || typeof row.sourceVersion !== 'string')) return undefined
  if (kind === 'renames') {
    if (!Array.isArray(row.renames)) return undefined
    if (row.renames.some((entry) => !entry || typeof entry !== 'object' || typeof (entry as { version?: unknown }).version !== 'string')) {
      return undefined
    }
  }
  const allowed = new Set(ALLOWED_KEYS[kind as keyof typeof ALLOWED_KEYS])
  if (Object.keys(row).some((key) => !allowed.has(key))) return undefined
  try {
    const parsed = parseWritingProposal(row)
    if (parsed.summary !== row.summary) return undefined
    if (parsed.kind !== 'renames' && 'path' in parsed && parsed.path !== row.path) return undefined
    if ((parsed.kind === 'edit' || parsed.kind === 'split') && parsed.targetVersion !== row.targetVersion) return undefined
    if (parsed.kind === 'merge' && (parsed.targetVersion !== row.targetVersion || parsed.sourceVersion !== row.sourceVersion)) return undefined
    if (parsed.kind === 'renames') {
      const raw = row.renames as Array<{ from?: unknown; to?: unknown; version?: unknown }>
      if (parsed.renames.some((entry, index) => entry.version !== raw[index]?.version)) return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}
