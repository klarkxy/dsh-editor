/**
 * 项目内全文检索工具（只读）。
 *
 * 设计说明：
 *   - 与 project_knowledge 同一条注入路径：cwd 来自 exec.agent.session.header.cwd，
 *     fs 由 index.ts 适配注入，单元测试传内存 stub；不把 host fs 直接耦合进来。
 *   - 只扫项目内 Markdown：递归遍历工作区时跳过所有隐藏段（.dsh-editor 等），
 *     只匹配 .md 文件；path 参数可把范围收窄到某个子目录或单文件。
 *   - 命中带路径、行号与上下文片段；总量封顶 50 条 / 200 个文件，防止超大项目撑爆上下文。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { NOVEL_SEARCH_TOOL_NAME } from './contracts.ts'

export { NOVEL_SEARCH_TOOL_NAME } from './contracts.ts'
export const NOVEL_SEARCH_VERSION = 1
export const NOVEL_SEARCH_MAX_MATCHES = 50
export const NOVEL_SEARCH_MAX_FILES = 200
export const NOVEL_SEARCH_CONTEXT_CHARS = 120

export type SearchFsTarget = { targetKey: string; displayPath: string }
export type SearchDirEntry = { name: string; type: 'file' | 'directory' | 'other' }
export type SearchFs = {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<SearchFsTarget>
  readText(target: SearchFsTarget, signal?: AbortSignal): Promise<string>
  listDir(target: SearchFsTarget, signal?: AbortSignal): Promise<SearchDirEntry[]>
}

export type NovelSearchMatch = { path: string; line: number; excerpt: string }
export type NovelSearchResult = {
  version: typeof NOVEL_SEARCH_VERSION
  query: string
  matches: NovelSearchMatch[]
  scannedFiles: number
  truncated: boolean
}

export class NovelSearchError extends Error {
  readonly code: 'INVALID_ARGS' | 'UNREADABLE'
  constructor(code: NovelSearchError['code'], message: string) {
    super(message)
    this.name = 'NovelSearchError'
    this.code = code
  }
}

function safeRelativeScope(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\0')) return false
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes(':')) return false
  const parts = path.split('/')
  if (parts.includes('..') || parts.some((part) => part.startsWith('.') && part !== '.')) return false
  return true
}

export function normalizeNovelSearchArguments(args: Readonly<Record<string, unknown>>): { query: string; path?: string } {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) throw new NovelSearchError('INVALID_ARGS', 'novel_search 需要非空 query')
  const path = args.path === undefined ? undefined : args.path
  if (path !== undefined && !safeRelativeScope(path)) throw new NovelSearchError('INVALID_ARGS', 'path 必须是工作区相对路径')
  return { query, path: typeof path === 'string' ? path.replace(/\\/g, '/') : undefined }
}

async function collectMarkdownFiles(fs: SearchFs, scope: string, cwd: string, signal: AbortSignal, out: string[]): Promise<void> {
  if (out.length >= NOVEL_SEARCH_MAX_FILES) return
  if (/\.md$/i.test(scope)) { out.push(scope); return }
  const target = await fs.resolve(scope || '.', { cwd, signal })
  let entries: SearchDirEntry[]
  try {
    entries = await fs.listDir(target, signal)
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= NOVEL_SEARCH_MAX_FILES) return
    if (entry.name.startsWith('.')) continue
    const relative = scope ? `${scope}/${entry.name}` : entry.name
    if (entry.type === 'directory') await collectMarkdownFiles(fs, relative, cwd, signal, out)
    else if (entry.type === 'file' && /\.md$/i.test(entry.name)) out.push(relative)
  }
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let at = 0; at < index; at += 1) if (text[at] === '\n') line += 1
  return line
}

function excerptOf(text: string, index: number, length: number): string {
  const start = Math.max(0, index - NOVEL_SEARCH_CONTEXT_CHARS)
  const end = Math.min(text.length, index + length + NOVEL_SEARCH_CONTEXT_CHARS)
  const clipped = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${clipped}${end < text.length ? '…' : ''}`
}

export async function runNovelSearch(
  args: { query: string; path?: string },
  fs: SearchFs,
  options: { signal: AbortSignal; cwd: string },
): Promise<NovelSearchResult> {
  const files: string[] = []
  await collectMarkdownFiles(fs, args.path ?? '', options.cwd, options.signal, files)
  const needle = args.query.toLowerCase()
  const matches: NovelSearchMatch[] = []
  let scanned = 0
  for (const relative of files) {
    if (matches.length >= NOVEL_SEARCH_MAX_MATCHES) break
    let text: string
    try {
      text = await fs.readText(await fs.resolve(relative, { cwd: options.cwd, signal: options.signal }), options.signal)
    } catch {
      continue
    }
    scanned += 1
    const haystack = text.toLowerCase()
    let index = haystack.indexOf(needle)
    while (index >= 0 && matches.length < NOVEL_SEARCH_MAX_MATCHES) {
      matches.push({ path: relative, line: lineOf(text, index), excerpt: excerptOf(text, index, args.query.length) })
      index = haystack.indexOf(needle, index + needle.length)
    }
  }
  return {
    version: NOVEL_SEARCH_VERSION,
    query: args.query,
    matches,
    scannedFiles: scanned,
    truncated: matches.length >= NOVEL_SEARCH_MAX_MATCHES || files.length >= NOVEL_SEARCH_MAX_FILES,
  }
}

export function renderNovelSearch(result: NovelSearchResult): string {
  if (result.matches.length === 0) return `在 ${result.scannedFiles} 个 Markdown 文件中没有找到「${result.query}」。`
  const lines = [`「${result.query}」命中 ${result.matches.length} 处（扫描 ${result.scannedFiles} 个文件${result.truncated ? '，结果已截断' : ''}）：`, '']
  for (const match of result.matches) {
    lines.push(`- ${match.path}:${match.line} ${match.excerpt}`)
  }
  return lines.join('\n')
}

export function createNovelSearchTool(options: { fs: SearchFs }) {
  if (!options.fs) throw new NovelSearchError('UNREADABLE', 'novel_search 需要注入 fs')
  return defineTool({
    name: NOVEL_SEARCH_TOOL_NAME,
    description: '项目内 Markdown 全文检索（只读）。返回带行号与上下文的命中片段；命中后应再用 read 阅读原文。',
    parameters: {
      query: { type: 'string', required: true, description: '要检索的词或短语。' },
      path: { type: 'string', description: '可选，把范围限定在某个子目录或单个 .md 文件。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          query: { type: 'string', required: true },
          matches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                line: { type: 'integer', required: true },
                excerpt: { type: 'string', required: true },
              },
            },
          },
          scannedFiles: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: renderNovelSearch(value as NovelSearchResult) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const normalized = normalizeNovelSearchArguments(args as Readonly<Record<string, unknown>>)
      const cwd = exec.agent?.session?.header?.cwd
      if (typeof cwd !== 'string' || cwd.length === 0) {
        throw new NovelSearchError('UNREADABLE', 'novel_search 需要当前 agent 会话工作目录')
      }
      return await runNovelSearch(normalized, options.fs, { signal: exec.signal, cwd })
    },
  })
}
