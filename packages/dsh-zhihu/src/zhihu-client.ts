/**
 * 知乎开放平台共享请求层:Access Secret 解析、超时封装、信封解析与执行计量。
 *
 * 端点规范（来源：github.com/klarkxy/zhihu-search，src/zhihu_search/upstream/http_client.py）：
 *   - Base URL: https://developer.zhihu.com
 *   - 公共 Headers: Authorization: Bearer <access_secret>、X-Request-Timestamp、Accept
 *   - 除直答外的 REST 接口返回 {Code, Message, Data} 信封,Code 非 0 表示业务错误。
 *
 * Token 解析顺序（按契约,**不**把 token 放进 schema 参数）：
 *   1. 可选的 credential 解析器（应用设置界面写入 `ZHIHU_ACCESS_TOKEN` 后,
 *      通过 `ctx.credentials.resolve` 取回）;命中即返回,source 标记为 `credential`。
 *   2. 环境变量 ZHIHU_ACCESS_TOKEN
 *   3. 环境变量 ZHIHU_ACCESS_SECRET（zhihu-search CLI 同名变量）
 *   4. ~/.config/zhihu-search/credentials.json 的 access_secret 字段
 * 都没有则抛出带中文配置指引的 TOKEN_MISSING。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const ZHIHU_BASE_URL = 'https://developer.zhihu.com'
export const ZHIHU_DEFAULT_TIMEOUT_MS = 15_000
export const ZHIHU_SUMMARY_MAX_CHARS = 200

const ZHIHU_CREDENTIALS_PRIMARY = 'ZHIHU_ACCESS_TOKEN'
const ZHIHU_CREDENTIALS_FALLBACK = 'ZHIHU_ACCESS_SECRET'
const ZHIHU_CREDENTIALS_FILE = join(homedir(), '.config', 'zhihu-search', 'credentials.json')

type TokenSource = 'credential' | 'env-primary' | 'env-fallback' | 'file'

export type ZhihuSearchToken = { token: string; source: TokenSource }

export type ZhihuSearchFetcher = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string | FormData; signal?: AbortSignal }) => Promise<{
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

/** Metering payload emitted after each zhihu tool execution. */
export type ZhihuSearchExecuted = { ok: boolean; results: number }

/** Metering must never break the tool itself. */
export function reportExecuted(hook: ((event: ZhihuSearchExecuted) => void) | undefined, event: ZhihuSearchExecuted): void {
  if (!hook) return
  try {
    hook(event)
  } catch {
    // Best-effort metering; swallow hook failures.
  }
}

export type ZhihuClientOptions = ZhihuSearchResolveOptions & {
  fetcher?: ZhihuSearchFetcher
  /** Allows tests to bypass process env; defaults to process.env. */
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  /** Override the request timeout in ms. Defaults to {@link ZHIHU_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/**
 * 发起一次带鉴权与超时的知乎请求,返回解析后的 JSON 原文(信封由调用方处理)。
 * `label` 用于中文错误文案,如「知乎搜索」「知乎热榜」。
 */
export async function zhihuFetchJson(
  path: string,
  init: { method?: 'GET' | 'POST'; params?: Record<string, string>; body?: unknown; formData?: FormData },
  label: string,
  options: ZhihuClientOptions = {},
): Promise<unknown> {
  const token = await resolveZhihuToken(options.env, { resolveCredential: options.resolveCredential })
  const fetcher = options.fetcher ?? globalFetch
  if (!fetcher) throw new ZhihuSearchError('BAD_RESPONSE', '当前环境没有可用的 fetch。')

  const url = new URL(path, ZHIHU_BASE_URL)
  for (const [key, value] of Object.entries(init.params ?? {})) url.searchParams.set(key, value)

  const method = init.method ?? (init.formData || init.body !== undefined ? 'POST' : 'GET')
  const timeout = options.timeoutMs ?? ZHIHU_DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const linked = options.signal
  const onAbort = () => controller.abort(linked?.reason)
  if (linked) {
    if (linked.aborted) controller.abort(linked.reason)
    else linked.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error('zhihu request timeout')), timeout)
  let response: Awaited<ReturnType<ZhihuSearchFetcher>>
  try {
    response = await fetcher(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token.token}`,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        Accept: 'application/json',
        // multipart 的 Content-Type(含 boundary)由 fetch 自动生成,不能手写。
        ...(method === 'POST' && !init.formData ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: controller.signal,
      ...(init.formData ? { body: init.formData } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      throw new ZhihuSearchError('TIMEOUT', `${label}超时（${timeout}ms），请稍后再试。`)
    }
    throw new ZhihuSearchError('BAD_RESPONSE', `${label}失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    if (linked) linked.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    throw new ZhihuSearchError('HTTP_ERROR', `${label}返回 HTTP ${response.status}。`, response.status)
  }

  try {
    return await response.json()
  } catch (error) {
    throw new ZhihuSearchError('BAD_RESPONSE', `${label}响应不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 解析 {Code, Message, Data} 信封,Code 非 0 抛出 HTTP_ERROR;返回 Data(缺省为 {})。 */
export function parseZhihuEnvelope(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ZhihuSearchError('BAD_RESPONSE', '知乎响应缺少 {Code,Message,Data} 信封。')
  }
  const envelope = body as { Code?: unknown; Message?: unknown; Data?: unknown }
  const code = Number(envelope.Code)
  if (!Number.isFinite(code) || code !== 0) {
    const msg = typeof envelope.Message === 'string' ? envelope.Message : '未知错误'
    throw new ZhihuSearchError('HTTP_ERROR', `知乎开放平台返回错误（code=${envelope.Code ?? '?'}）：${msg}`)
  }
  return envelope.Data ?? {}
}

function truncateSummary(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

/** 搜索类接口（站内/全网）共用的条目结构。 */
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

export function normalizeSearchItem(raw: Record<string, unknown>): ZhihuSearchItem {
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
