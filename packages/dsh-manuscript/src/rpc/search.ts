import path from 'node:path'
import type { WorkspaceFileContext } from './files.ts'
import { FileOpError, listDirStrict, readTextFile } from './files.ts'

const MAX_QUERY_CHARS = 120
const MAX_FILES = 2_000
const MAX_TOTAL_BYTES = 100_000_000
const MAX_RESULTS = 200
const GENERATED_DIRECTORIES = new Set(['build', 'coverage', 'dist', 'node_modules', 'out', 'target'])

export type SearchScope = 'project' | 'manuscript'

export type SearchHit = {
  path: string
  line: number
  column: number
  start: number
  end: number
  excerpt: string
  version: string
}

export type SearchResponse = {
  query: string
  scope: SearchScope
  results: SearchHit[]
  scannedFiles: number
  scannedBytes: number
  skipped: number
  truncated: boolean
}

export class SearchError extends Error {
  constructor(
    message: string,
    readonly code: 'BAD_QUERY' | 'IO',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SearchError'
  }
}

function normal(value: string): string {
  return value.split(path.sep).join('/')
}

function hidden(value: string): boolean {
  return value.split('/').some((part) => part.startsWith('.'))
}

function generated(value: string): boolean {
  return value.split('/').some((part) => GENERATED_DIRECTORIES.has(part.toLocaleLowerCase()))
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function literalPattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
}

function validateQuery(query: string): string {
  if (typeof query !== 'string') throw new SearchError('search query must be text', 'BAD_QUERY')
  const value = query.trim()
  if (!value || value.length > MAX_QUERY_CHARS || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new SearchError('search query is empty, too long, or contains control characters', 'BAD_QUERY')
  }
  return value
}

function lineExcerpt(line: string, start: number, length: number): string {
  const left = Math.max(0, start - 44)
  const right = Math.min(line.length, start + length + 64)
  return `${left > 0 ? '…' : ''}${line.slice(left, right).trim()}${right < line.length ? '…' : ''}`
}

export async function searchWorkspaceText(input: {
  files: WorkspaceFileContext
  query: string
  scope?: SearchScope
}): Promise<SearchResponse> {
  const query = validateQuery(input.query)
  const scope: SearchScope = input.scope === 'manuscript' ? 'manuscript' : 'project'
  const queue = [scope === 'manuscript' ? '正文' : '']
  const results: SearchHit[] = []
  let scannedFiles = 0
  let scannedBytes = 0
  let skipped = 0
  let truncated = false

  while (queue.length && !truncated) {
    const directory = queue.shift()!
    let entries
    try {
      entries = await listDirStrict(input.files, directory || '.')
    } catch (error) {
      if (scope === 'manuscript' && directory === '正文' && error instanceof FileOpError && error.code === 'NOT_FOUND') {
        return { query, scope, results, scannedFiles, scannedBytes, skipped, truncated }
      }
      throw error
    }
    for (const entry of entries) {
      const relative = normal(path.join(directory, entry.name))
      if (hidden(relative) || generated(relative)) {
        skipped++
        continue
      }
      if (entry.type === 'directory') {
        queue.push(relative)
        continue
      }
      if (entry.type !== 'file' || !/\.(md|txt)$/i.test(entry.name)) {
        skipped++
        continue
      }
      if (scannedFiles >= MAX_FILES) {
        truncated = true
        break
      }
      let loaded
      try {
        loaded = await readTextFile(input.files, relative)
      } catch (error) {
        if (error instanceof FileOpError && (error.code === 'TOO_LARGE' || error.code === 'NOT_TEXT')) {
          skipped++
          continue
        }
        throw error
      }
      const fileBytes = bytes(loaded.text)
      if (scannedBytes + fileBytes > MAX_TOTAL_BYTES) {
        truncated = true
        break
      }
      scannedFiles++
      scannedBytes += fileBytes

      const lines = loaded.text.split('\n')
      let absoluteOffset = 0
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex]!.replace(/\r$/, '')
        const pattern = literalPattern(query)
        let match: RegExpExecArray | null
        while ((match = pattern.exec(line))) {
          results.push({
            path: relative,
            line: lineIndex + 1,
            column: match.index + 1,
            start: absoluteOffset + match.index,
            end: absoluteOffset + match.index + match[0].length,
            excerpt: lineExcerpt(line, match.index, match[0].length),
            version: loaded.version,
          })
          if (results.length >= MAX_RESULTS) {
            truncated = true
            break
          }
          if (match[0].length === 0) pattern.lastIndex++
        }
        if (truncated) break
        absoluteOffset += lines[lineIndex]!.length + 1
      }
    }
  }

  results.sort((left, right) => left.path.localeCompare(right.path, 'zh-CN', { numeric: true }) || left.start - right.start)
  return { query, scope, results, scannedFiles, scannedBytes, skipped, truncated }
}
