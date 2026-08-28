export const PROJECT_CONTEXT_SCHEMA = 'dsh-editor.project-context'
export const PROJECT_CONTEXT_VERSION = 1
export const PROJECT_CONTEXT_SOURCE_PATHS = [
  '项目总览.md',
  '大纲/总纲.md',
  '人物卡/人物索引.md',
  '世界书/设定总汇.md',
  '.dsh-editor/作品索引.md',
] as const
export const PROJECT_CONTEXT_MAX_CHARS_PER_FILE = 4_000
export const PROJECT_CONTEXT_MAX_TOTAL_CHARS = 12_000

export type ProjectContextStatus = 'included' | 'missing' | 'error'
export type ProjectContextReceipt = {
  path: string
  version?: string
  includedChars: number
  status: ProjectContextStatus
  truncated: boolean
}
export type ProjectContextSource = ProjectContextReceipt & { text?: string }
export type ProjectContextEnvelope = {
  schema: typeof PROJECT_CONTEXT_SCHEMA
  version: typeof PROJECT_CONTEXT_VERSION
  project_context: { sources: ProjectContextSource[] }
  user_request: string
}
export type ProjectContextReadResult =
  | { ok: true; value: { text: string; version: string } }
  | { ok: false; error?: { code?: string; message?: string } }
export type ProjectContextCompilation = { envelope: ProjectContextEnvelope; serialized: string; receipt: ProjectContextReceipt[] }

function isMissing(result: Exclude<ProjectContextReadResult, { ok: true }>): boolean {
  return /not[- ]found|missing/i.test(`${result.error?.code ?? ''} ${result.error?.message ?? ''}`)
}

/** File contents stay JSON string data and are never interpolated into the request. */
export async function compileProjectContext(
  userRequest: string,
  read: (path: typeof PROJECT_CONTEXT_SOURCE_PATHS[number]) => Promise<ProjectContextReadResult>,
): Promise<ProjectContextCompilation> {
  let remaining = PROJECT_CONTEXT_MAX_TOTAL_CHARS
  const sources: ProjectContextSource[] = []
  for (const path of PROJECT_CONTEXT_SOURCE_PATHS) {
    try {
      const result = await read(path)
      if (!result.ok) {
        sources.push({ path, includedChars: 0, status: isMissing(result) ? 'missing' : 'error', truncated: false })
        continue
      }
      const text = result.value.text
      const includedChars = Math.min(text.length, PROJECT_CONTEXT_MAX_CHARS_PER_FILE, remaining)
      const source: ProjectContextSource = {
        path, version: result.value.version, includedChars, status: 'included', truncated: includedChars < text.length,
      }
      if (includedChars > 0) source.text = text.slice(0, includedChars)
      sources.push(source)
      remaining -= includedChars
    } catch {
      sources.push({ path, includedChars: 0, status: 'error', truncated: false })
    }
  }
  const envelope: ProjectContextEnvelope = {
    schema: PROJECT_CONTEXT_SCHEMA,
    version: PROJECT_CONTEXT_VERSION,
    project_context: { sources },
    user_request: userRequest,
  }
  return { envelope, serialized: JSON.stringify(envelope), receipt: sources.map(({ text: _text, ...item }) => item) }
}

function isReceipt(value: unknown): value is ProjectContextReceipt {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ProjectContextReceipt>
  return typeof item.path === 'string'
    && (item.status === 'included' || item.status === 'missing' || item.status === 'error')
    && typeof item.includedChars === 'number' && Number.isInteger(item.includedChars) && item.includedChars >= 0
    && typeof item.truncated === 'boolean' && (item.version === undefined || typeof item.version === 'string')
    && (!Object.hasOwn(item, 'text') || typeof (item as ProjectContextSource).text === 'string')
}

export function parseProjectContextEnvelope(text: string): ProjectContextEnvelope | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  if (!value || typeof value !== 'object') return undefined
  const envelope = value as Partial<ProjectContextEnvelope>
  if (envelope.schema !== PROJECT_CONTEXT_SCHEMA || envelope.version !== PROJECT_CONTEXT_VERSION || typeof envelope.user_request !== 'string') return undefined
  if (!envelope.project_context || typeof envelope.project_context !== 'object' || Array.isArray(envelope.project_context)) return undefined
  const sources = (envelope.project_context as { sources?: unknown }).sources
  if (!Array.isArray(sources) || sources.length !== PROJECT_CONTEXT_SOURCE_PATHS.length) return undefined
  if (!sources.every((source, index) => isReceipt(source) && source.path === PROJECT_CONTEXT_SOURCE_PATHS[index])) return undefined
  return envelope as ProjectContextEnvelope
}

export function projectContextReceipt(envelope: ProjectContextEnvelope): ProjectContextReceipt[] {
  return envelope.project_context.sources.map(({ text: _text, ...item }) => item)
}
