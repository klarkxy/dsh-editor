/**
 * 知乎开放平台站内搜索工具。
 *
 * 端点调研结论（来源：github.com/klarkxy/zhihu-search，src/zhihu_search/upstream/http_client.py）：
 *   - Base URL: https://developer.zhihu.com
 *   - 知乎站内搜索：GET /api/v1/content/zhihu_search?Query=<q>&Count=<n>
 *   - count 上限 10
 *   - Headers:
 *       Authorization: Bearer <access_secret>
 *       X-Request-Timestamp: <unix 秒>
 *       Accept: application/json
 *   - 响应信封：{ Code, Message, Data }；Code 非 0 表示业务错误。
 *   - Data.Items: 每条 { Title, ContentType, Url, ContentText, VoteUpCount,
 *     CommentCount, AuthorName, AuthorityLevel, EditTime }。
 *
 * Token 解析顺序（按本工具的契约，**不**把 token 放进 schema 参数）：
 *   1. 可选的 credential 解析器（应用设置界面把 Access Secret 写入
 *      `ZHIHU_ACCESS_TOKEN` 后，通过 `ctx.credentials.resolve` 取回）；命中即返回，
 *      source 标记为 `credential`。
 *   2. 环境变量 ZHIHU_ACCESS_TOKEN（任务规约）
 *   3. 环境变量 ZHIHU_ACCESS_SECRET（zhihu-search CLI 同名变量）
 *   4. ~/.config/zhihu-search/credentials.json 的 access_secret 字段
 *      （Windows 下解析为 C:\Users\<user>\.config\zhihu-search\credentials.json）
 * 都没有则返回 isError 并附中文配置指引。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ZHIHU_SEARCH_TOOL_NAME } from './contracts.ts'

export { ZHIHU_SEARCH_TOOL_NAME } from './contracts.ts'
export const ZHIHU_SEARCH_VERSION = 1
export const ZHIHU_SEARCH_DEFAULT_COUNT = 5
export const ZHIHU_SEARCH_MAX_COUNT = 10
export const ZHIHU_SEARCH_TIMEOUT_MS = 15_000
export const ZHIHU_SUMMARY_MAX_CHARS = 200

const ZHIHU_BASE_URL = 'https://developer.zhihu.com'
const ZHIHU_SEARCH_PATH = '/api/v1/content/zhihu_search'
const ZHIHU_CREDENTIALS_PRIMARY = 'ZHIHU_ACCESS_TOKEN'
const ZHIHU_CREDENTIALS_FALLBACK = 'ZHIHU_ACCESS_SECRET'
const ZHIHU_CREDENTIALS_FILE = join(homedir(), '.config', 'zhihu-search', 'credentials.json')

export type ZhihuSearchItem = {
  title: string
  type: string
  url: string
  summary: string
  votes: number
  comments: number
  author: string
  authority: string
  editTime: string
}

export type ZhihuSearchResult = {
  version: typeof ZHIHU_SEARCH_VERSION
  query: string
  count: number
  items: ZhihuSearchItem[]
  emptyReason?: string
}

type TokenSource = 'credential' | 'env-primary' | 'env-fallback' | 'file'

export type ZhihuSearchToken = { token: string; source: TokenSource }

export type ZhihuSearchFetcher = (input: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
  json(): Promise<unknown>
}>

const globalFetch: ZhihuSearchFetcher | undefined = typeof globalThis !== 'undefined' && typeof (globalThis as { fetch?: unknown }).fetch === 'function'
  ? (input, init) => {
      const f = (globalThis as { fetch: typeof globalThis.fetch }).fetch
      return f(input as Parameters<typeof f>[0], init as Parameters<typeof f>[1] | undefined) as unknown as ReturnType<ZhihuSearchFetcher>
    }
  : undefined

function looksLikeToken(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 8 && trimmed.length <= 256
}

async function readCredentialsFile(path: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as { access_secret?: unknown } | null
    if (parsed && typeof parsed === 'object' && typeof parsed.access_secret === 'string' && looksLikeToken(parsed.access_secret)) {
      return parsed.access_secret.trim()
    }
  } catch {
    // 文件不存在或 JSON 解析失败都不算硬错误，让上层回退到 isError 提示
  }
  return undefined
}

export type ZhihuSearchResolveOptions = {
  /** Resolve the Access Secret via host-managed credentials (e.g. the settings UI). */
  resolveCredential?: () => Promise<string | undefined>
}

export async function resolveZhihuToken(
  env: NodeJS.ProcessEnv = process.env,
  options: ZhihuSearchResolveOptions = {},
): Promise<ZhihuSearchToken> {
  if (options.resolveCredential) {
    const fromCredential = (await options.resolveCredential())?.trim()
    if (fromCredential && looksLikeToken(fromCredential)) {
      return { token: fromCredential, source: 'credential' }
    }
  }
  const primary = env[ZHIHU_CREDENTIALS_PRIMARY]?.trim()
  if (primary && looksLikeToken(primary)) return { token: primary, source: 'env-primary' }
  const fallback = env[ZHIHU_CREDENTIALS_FALLBACK]?.trim()
  if (fallback && looksLikeToken(fallback)) return { token: fallback, source: 'env-fallback' }
  const fromFile = await readCredentialsFile(ZHIHU_CREDENTIALS_FILE)
  if (fromFile) return { token: fromFile, source: 'file' }
  throw new ZhihuSearchError('TOKEN_MISSING', [
    '未找到知乎 Access Secret。请在 设置 → 知乎 中填写；',
    `也可设置环境变量 ${ZHIHU_CREDENTIALS_PRIMARY} 或写入 ~/.config/zhihu-search/credentials.json。`,
  ].join(''))
}

export class ZhihuSearchError extends Error {
  readonly code: 'TOKEN_MISSING' | 'HTTP_ERROR' | 'TIMEOUT' | 'BAD_RESPONSE'
  readonly status?: number
  constructor(code: ZhihuSearchError['code'], message: string, status?: number) {
    super(message)
    this.name = 'ZhihuSearchError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

function clampCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : ZHIHU_SEARCH_DEFAULT_COUNT
  if (n < 1) return 1
  if (n > ZHIHU_SEARCH_MAX_COUNT) return ZHIHU_SEARCH_MAX_COUNT
  return n
}

function truncateSummary(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

function normalizeItem(raw: Record<string, unknown>): ZhihuSearchItem {
  const summary = typeof raw.ContentText === 'string' ? raw.ContentText : ''
  return {
    title: typeof raw.Title === 'string' && raw.Title.length > 0 ? raw.Title : '(无标题)',
    type: typeof raw.ContentType === 'string' && raw.ContentType.length > 0 ? raw.ContentType : '内容',
    url: typeof raw.Url === 'string' ? raw.Url : '',
    summary: truncateSummary(summary.trim(), ZHIHU_SUMMARY_MAX_CHARS),
    votes: typeof raw.VoteUpCount === 'number' ? raw.VoteUpCount : 0,
    comments: typeof raw.CommentCount === 'number' ? raw.CommentCount : 0,
    author: typeof raw.AuthorName === 'string' && raw.AuthorName.length > 0 ? raw.AuthorName : '匿名',
    authority: typeof raw.AuthorityLevel === 'string' && raw.AuthorityLevel.length > 0 ? raw.AuthorityLevel : '?',
    editTime: typeof raw.EditTime === 'number' ? String(raw.EditTime) : '',
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

export type ZhihuSearchExecuteOptions = {
  fetcher?: ZhihuSearchFetcher
  signal?: AbortSignal
  /** Allows tests to bypass process env; defaults to process.env. */
  env?: NodeJS.ProcessEnv
  /** Resolve the Access Secret via host-managed credentials (e.g. the settings UI). */
  resolveCredential?: () => Promise<string | undefined>
  /** Override the request timeout in ms. Defaults to {@link ZHIHU_SEARCH_TIMEOUT_MS}. */
  timeoutMs?: number
}

export async function executeZhihuSearch(
  query: string,
  count: number,
  options: ZhihuSearchExecuteOptions = {},
): Promise<ZhihuSearchResult> {
  const trimmed = query.trim()
  if (!trimmed) throw new ZhihuSearchError('BAD_RESPONSE', '搜索词不能为空。')
  const resolvedCount = clampCount(count)
  const token = await resolveZhihuToken(options.env, { resolveCredential: options.resolveCredential })
  const fetcher = options.fetcher ?? globalFetch
  if (!fetcher) throw new ZhihuSearchError('BAD_RESPONSE', '当前环境没有可用的 fetch。')

  const url = new URL(ZHIHU_SEARCH_PATH, ZHIHU_BASE_URL)
  url.searchParams.set('Query', trimmed)
  url.searchParams.set('Count', String(resolvedCount))

  const timeout = options.timeoutMs ?? ZHIHU_SEARCH_TIMEOUT_MS
  const controller = new AbortController()
  const linked = options.signal
  const onAbort = () => controller.abort(linked?.reason)
  if (linked) {
    if (linked.aborted) controller.abort(linked.reason)
    else linked.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error('zhihu_search timeout')), timeout)
  let response: Awaited<ReturnType<ZhihuSearchFetcher>>
  try {
    response = await fetcher(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      throw new ZhihuSearchError('TIMEOUT', `知乎搜索超时（${timeout}ms），请稍后再试。`)
    }
    throw new ZhihuSearchError('BAD_RESPONSE', `知乎搜索失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    if (linked) linked.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    throw new ZhihuSearchError('HTTP_ERROR', `知乎搜索返回 HTTP ${response.status}。`, response.status)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new ZhihuSearchError('BAD_RESPONSE', `知乎响应不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ZhihuSearchError('BAD_RESPONSE', '知乎响应缺少 {Code,Message,Data} 信封。')
  }
  const envelope = body as { Code?: unknown; Message?: unknown; Data?: unknown }
  const code = Number(envelope.Code)
  if (!Number.isFinite(code) || code !== 0) {
    const msg = typeof envelope.Message === 'string' ? envelope.Message : '未知错误'
    throw new ZhihuSearchError('HTTP_ERROR', `知乎开放平台返回错误（code=${envelope.Code ?? '?'}）：${msg}`)
  }
  const data = (envelope.Data ?? {}) as { Items?: unknown; EmptyReason?: unknown }
  const items = Array.isArray(data.Items) ? data.Items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : []
  const emptyReason = typeof data.EmptyReason === 'string' ? data.EmptyReason : undefined
  return {
    version: ZHIHU_SEARCH_VERSION,
    query: trimmed,
    count: resolvedCount,
    items: items.map(normalizeItem),
    emptyReason,
  }
}

export function renderZhihuSearch(result: ZhihuSearchResult): string {
  if (result.items.length === 0) {
    return `知乎站内搜索「${result.query}」无结果${result.emptyReason ? `（${result.emptyReason}）` : ''}。`
  }
  const lines: string[] = [`知乎站内搜索「${result.query}」共 ${result.items.length} 条：`, '']
  result.items.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.title}](${item.url || '（无链接）'})`)
    lines.push(`   - 类型：${item.type}　作者：${item.author}　权威：${item.authority}`)
    if (item.editTime) lines.push(`   - 时间：${item.editTime}`)
    lines.push(`   - 赞同 ${item.votes}　评论 ${item.comments}`)
    if (item.summary) lines.push(`   - 摘要：${item.summary}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

export type CreateZhihuSearchToolOptions = {
  fetcher?: ZhihuSearchFetcher
  /** Override env for token resolution; defaults to process.env. */
  env?: NodeJS.ProcessEnv
  /** Resolve the Access Secret via host-managed credentials (e.g. the settings UI). */
  resolveCredential?: () => Promise<string | undefined>
}

export function createZhihuSearchTool(options: CreateZhihuSearchToolOptions = {}) {
  const fetcher = options.fetcher
  const env = options.env
  const resolveCredential = options.resolveCredential
  return defineTool({
    name: ZHIHU_SEARCH_TOOL_NAME,
    description: '调用知乎开放平台站内搜索（GET /api/v1/content/zhihu_search）拉取社区证据；结果仅作社区/读者反馈参考，不构成 canon，也不直接写入项目文件。',
    parameters: {
      query: { type: 'string', required: true, description: '搜索词，2-100 字符。' },
      count: { type: 'integer', description: `返回条数，1-${ZHIHU_SEARCH_MAX_COUNT}，默认 ${ZHIHU_SEARCH_DEFAULT_COUNT}。` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          query: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                type: { type: 'string', required: true },
                url: { type: 'string', required: true },
                summary: { type: 'string', required: true },
                votes: { type: 'integer', required: true },
                comments: { type: 'integer', required: true },
                author: { type: 'string', required: true },
                authority: { type: 'string', required: true },
                editTime: { type: 'string', required: true },
              },
            },
          },
          emptyReason: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: renderZhihuSearch(value as ZhihuSearchResult) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const typed = args as { query: string; count?: number }
      return await executeZhihuSearch(typed.query, typed.count ?? ZHIHU_SEARCH_DEFAULT_COUNT, {
        fetcher,
        env,
        resolveCredential,
        signal: exec.signal,
      })
    },
  })
}
