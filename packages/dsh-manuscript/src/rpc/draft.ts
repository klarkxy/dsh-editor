import { randomUUID, createHash } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { normalizeWorkspaceRelative } from './paths.ts'
import { MAX_TEXT_BYTES } from './files.ts'

export type ManuscriptDraft = {
  path: string
  text: string
  baseText: string
  baseVersion: string
  ownerId: string
  revision: string
  updatedAt: string
}

export class DraftInputError extends Error {
  constructor(message: string, readonly code: 'PATH_REQUIRED' | 'TEXT_TOO_LARGE' | 'BASE_VERSION_REQUIRED' | 'OWNER_INVALID') {
    super(message)
    this.name = 'DraftInputError'
  }
}

const draftRowSchema = z.object({
  workspacePath: z.string(), path: z.string(), text: z.string(), baseText: z.string(), baseVersion: z.string(),
  // Optional fields preserve existing on-disk drafts as recoverable legacy entries.
  ownerId: z.string().optional(), revision: z.string().optional(), updatedAt: z.string().optional(),
})
type DraftRow = z.infer<typeof draftRowSchema>
export const draftDomainSpec = defineDomain({
  name: 'dsh_editor_drafts', version: 1,
  tables: { drafts: domainTable<string, DraftRow>(draftRowSchema) },
})
export interface DraftTableLike {
  get(key: string): DraftRow | undefined
  entries(): IterableIterator<[string, DraftRow]>
  put(key: string, value: DraftRow): Promise<void>
  delete(key: string): Promise<boolean>
}
export interface DraftStore {
  get(workspacePath: string, payload: Record<string, unknown>): ManuscriptDraft | null
  list(workspacePath: string, payload: Record<string, unknown>): ManuscriptDraft[]
  put(workspacePath: string, payload: Record<string, unknown>): Promise<{ stored: true; revision: string }>
  delete(workspacePath: string, payload: Record<string, unknown>): Promise<{ deleted: boolean }>
}
function text(payload: Record<string, unknown>, key: string): string { return typeof payload[key] === 'string' ? payload[key] : '' }
function pathFrom(payload: Record<string, unknown>): string {
  const raw = text(payload, 'path')
  if (!raw) throw new DraftInputError('draft path is required', 'PATH_REQUIRED')
  const relative = normalizeWorkspaceRelative(raw)
  if (relative === '.') throw new DraftInputError('draft path is required', 'PATH_REQUIRED')
  return relative
}
function ownerFrom(payload: Record<string, unknown>): string {
  const owner = payload.ownerId ?? ''
  if (typeof owner !== 'string' || (owner !== '' && !/^[a-zA-Z0-9_-]{1,100}$/.test(owner))) {
    throw new DraftInputError('draft owner is invalid', 'OWNER_INVALID')
  }
  return owner
}
function key(workspacePath: string, relative: string, owner: string): string {
  const base = `${encodeURIComponent(workspacePath)}|${encodeURIComponent(relative)}`
  return owner ? `${base}|${owner}` : base
}
function view(row: DraftRow): ManuscriptDraft {
  return {
    path: row.path, text: row.text, baseText: row.baseText, baseVersion: row.baseVersion,
    ownerId: row.ownerId ?? '', updatedAt: row.updatedAt ?? '',
    revision: row.revision ?? createHash('sha256').update(JSON.stringify(row)).digest('hex'),
  }
}

export function createDraftStore(table: DraftTableLike): DraftStore {
  // Storage writes are asynchronous; serialize the compare-and-delete with puts.
  let tail: Promise<unknown> = Promise.resolve()
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation)
    tail = result.catch(() => undefined)
    return result
  }
  return {
    get(workspacePath, payload) {
      const row = table.get(key(workspacePath, pathFrom(payload), ownerFrom(payload)))
      return row?.workspacePath === workspacePath ? view(row) : null
    },
    list(workspacePath, payload) {
      const relative = pathFrom(payload)
      ownerFrom(payload)
      return [...table.entries()].filter(([, row]) => row.workspacePath === workspacePath && row.path === relative)
        .map(([, row]) => view(row)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.ownerId.localeCompare(b.ownerId))
    },
    async put(workspacePath, payload) {
      const relative = pathFrom(payload)
      const ownerId = ownerFrom(payload)
      const textValue = text(payload, 'text'), baseText = text(payload, 'baseText'), baseVersion = text(payload, 'baseVersion')
      if (!baseVersion) throw new DraftInputError('draft base version is required', 'BASE_VERSION_REQUIRED')
      if (new TextEncoder().encode(textValue).byteLength > MAX_TEXT_BYTES || new TextEncoder().encode(baseText).byteLength > MAX_TEXT_BYTES) {
        throw new DraftInputError(`draft text exceeds ${MAX_TEXT_BYTES} bytes`, 'TEXT_TOO_LARGE')
      }
      return mutate(async () => {
        const revision = randomUUID()
        await table.put(key(workspacePath, relative, ownerId), { workspacePath, path: relative, text: textValue, baseText, baseVersion, ownerId, revision, updatedAt: new Date().toISOString() })
        return { stored: true as const, revision }
      })
    },
    async delete(workspacePath, payload) {
      const id = key(workspacePath, pathFrom(payload), ownerFrom(payload))
      const revision = text(payload, 'revision')
      return mutate(async () => {
        const row = table.get(id)
        if (!row || !revision || view(row).revision !== revision) return { deleted: false }
        return { deleted: await table.delete(id) }
      })
    },
  }
}