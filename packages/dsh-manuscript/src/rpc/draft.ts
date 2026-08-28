import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { normalizeWorkspaceRelative, PathConfineError } from './paths.ts'
import { MAX_TEXT_BYTES } from './files.ts'

export type ManuscriptDraft = {
  path: string
  text: string
  baseText: string
  baseVersion: string
}

export class DraftInputError extends Error {
  constructor(message: string, readonly code: 'PATH_REQUIRED' | 'TEXT_TOO_LARGE' | 'BASE_VERSION_REQUIRED') {
    super(message)
    this.name = 'DraftInputError'
  }
}

const draftRowSchema = z.object({
  workspacePath: z.string(),
  path: z.string(),
  text: z.string(),
  baseText: z.string(),
  baseVersion: z.string(),
})

export const draftDomainSpec = defineDomain({
  name: 'dsh_editor_drafts',
  version: 1,
  tables: { drafts: domainTable<string, z.infer<typeof draftRowSchema>>(draftRowSchema) },
})

export interface DraftTableLike {
  get(key: string): z.infer<typeof draftRowSchema> | undefined
  put(key: string, value: z.infer<typeof draftRowSchema>): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface DraftStore {
  get(workspacePath: string, payload: Record<string, unknown>): ManuscriptDraft | null
  put(workspacePath: string, payload: Record<string, unknown>): Promise<{ stored: true }>
  delete(workspacePath: string, payload: Record<string, unknown>): Promise<{ deleted: boolean }>
}

function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function pathFrom(payload: Record<string, unknown>): string {
  const raw = text(payload, 'path')
  if (!raw) throw new DraftInputError('draft path is required', 'PATH_REQUIRED')
  try {
    const path = normalizeWorkspaceRelative(raw)
    if (path === '.') throw new DraftInputError('draft path is required', 'PATH_REQUIRED')
    return path
  } catch (error) {
    if (error instanceof PathConfineError) throw error
    throw error
  }
}

function key(workspacePath: string, path: string): string {
  return `${encodeURIComponent(workspacePath)}|${encodeURIComponent(path)}`
}

/** A storage-domain table is durable; this adapter adds manuscript validation and workspace isolation. */
export function createDraftStore(table: DraftTableLike): DraftStore {
  return {
    get(workspacePath, payload) {
      const row = table.get(key(workspacePath, pathFrom(payload)))
      if (!row || row.workspacePath !== workspacePath) return null
      return { path: row.path, text: row.text, baseText: row.baseText, baseVersion: row.baseVersion }
    },
    async put(workspacePath, payload) {
      const path = pathFrom(payload)
      const textValue = text(payload, 'text')
      const baseText = text(payload, 'baseText')
      const baseVersion = text(payload, 'baseVersion')
      if (!baseVersion) throw new DraftInputError('draft base version is required', 'BASE_VERSION_REQUIRED')
      if (bytes(textValue) > MAX_TEXT_BYTES || bytes(baseText) > MAX_TEXT_BYTES) {
        throw new DraftInputError(`draft text exceeds ${MAX_TEXT_BYTES} bytes`, 'TEXT_TOO_LARGE')
      }
      await table.put(key(workspacePath, path), { workspacePath, path, text: textValue, baseText, baseVersion })
      return { stored: true }
    },
    async delete(workspacePath, payload) {
      return { deleted: await table.delete(key(workspacePath, pathFrom(payload))) }
    },
  }
}
