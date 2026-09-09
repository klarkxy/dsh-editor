/**
 * 知乎开放平台的其余写作向能力:全网搜索、热榜、直答、公开知识库检索。
 * 共享 ./zhihu-client.ts 的鉴权、超时、信封解析与计量;每个工具只做参数收敛、
 * 结果规整与渲染。结果一律只作社区参考,不构成 canon,也不写入项目文件。
 *
 * 端点（来源：github.com/klarkxy/zhihu-search，src/zhihu_search/upstream/http_client.py）：
 *   - 全网搜索:GET /api/v1/content/global_search?Query&Count(<=20)&SearchDB(all|realtime|static)
 *   - 热榜:GET /api/v1/content/hot_list?Limit(<=30)
 *   - 直答:POST /v1/chat/completions(OpenAI 兼容,非信封;模型 zhida-fast-1p5 / zhida-thinking-1p5)
 *   - 知识库检索:POST /api/v1/knowledge/search { Query, Limit(<=10), RecallScopes }
 */
import {
  ZHIHU_ASK_TOOL_NAME,
  ZHIHU_GLOBAL_SEARCH_TOOL_NAME,
  ZHIHU_HOT_LIST_TOOL_NAME,
  ZHIHU_KNOWLEDGE_SEARCH_TOOL_NAME,
} from './contracts.ts'
import {
  normalizeSearchItem,
  parseZhihuEnvelope,
  reportExecuted,
  zhihuFetchJson,
  ZhihuSearchError,
  type ZhihuClientOptions,
  type ZhihuSearchExecuted,
  type ZhihuSearchItem,
} from './zhihu-client.ts'

export const ZHIHU_GLOBAL_SEARCH_VERSION = 1
export const ZHIHU_GLOBAL_SEARCH_DEFAULT_COUNT = 10
export const ZHIHU_GLOBAL_SEARCH_MAX_COUNT = 20
export const ZHIHU_HOT_LIST_VERSION = 1
export const ZHIHU_HOT_LIST_DEFAULT_LIMIT = 10
export const ZHIHU_HOT_LIST_MAX_LIMIT = 30
export const ZHIHU_ASK_VERSION = 1
export const ZHIHU_ASK_TIMEOUT_MS = 120_000
export const ZHIHU_KNOWLEDGE_SEARCH_VERSION = 1
export const ZHIHU_KNOWLEDGE_SEARCH_DEFAULT_LIMIT = 5
export const ZHIHU_KNOWLEDGE_SEARCH_MAX_LIMIT = 10

const GLOBAL_SEARCH_PATH = '/api/v1/content/global_search'
const HOT_LIST_PATH = '/api/v1/content/hot_list'
const ASK_PATH = '/v1/chat/completions'
const KNOWLEDGE_SEARCH_PATH = '/api/v1/knowledge/search'

export const ZHIHU_ASK_MODELS = ['zhida-fast-1p5', 'zhida-thinking-1p5', 'zhida-agent'] as const
export type ZhihuAskModel = (typeof ZHIHU_ASK_MODELS)[number]
/** 直答的价值在于比本机模型更强的综合考据,默认用思考档;fast 只配简单事实查询。 */
export const ZHIHU_ASK_DEFAULT_MODEL: ZhihuAskModel = 'zhida-thinking-1p5'

export type ZhihuToolOptions = ZhihuClientOptions & {
  /** Best-effort metering hook; invoked after every execution, failures included. */
  onExecuted?: (event: ZhihuSearchExecuted) => void
}

function clampInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  if (n < 1) return 1
  if (n > max) return max
  return n
}

function requireQuery(query: string, hint: string): string {
  const trimmed = query.trim()
  if (!trimmed) throw new ZhihuSearchError('BAD_RESPONSE', hint)
  return trimmed
}

function objectItems(data: unknown, key = 'Items'): Record<string, unknown>[] {
  const row = (data ?? {}) as Record<string, unknown>
  const items = row[key]
  return Array.isArray(items) ? items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : []
}

// ---------------------------------------------------------------------------
// 全网搜索
// ---------------------------------------------------------------------------

export type ZhihuGlobalSearchDb = 'all' | 'realtime' | 'static'

export type ZhihuGlobalSearchResult = {
  version: typeof ZHIHU_GLOBAL_SEARCH_VERSION
  query: string
  count: number
  searchDb: ZhihuGlobalSearchDb
  items: ZhihuSearchItem[]
  emptyReason?: string
}

export async function executeZhihuGlobalSearch(
  query: string,
  count: number,
  searchDb: ZhihuGlobalSearchDb,
  options: ZhihuClientOptions = {},
): Promise<ZhihuGlobalSearchResult> {
  const trimmed = requireQuery(query, '搜索词不能为空。')
  const resolvedCount = clampInt(count, ZHIHU_GLOBAL_SEARCH_DEFAULT_COUNT, ZHIHU_GLOBAL_SEARCH_MAX_COUNT)
  const body = await zhihuFetchJson(GLOBAL_SEARCH_PATH, {
    params: { Query: trimmed, Count: String(resolvedCount), SearchDB: searchDb },
  }, '知乎全网搜索', options)
  const data = parseZhihuEnvelope(body) as { Items?: unknown; EmptyReason?: unknown }
  return {
    version: ZHIHU_GLOBAL_SEARCH_VERSION,
    query: trimmed,
    count: resolvedCount,
    searchDb,
    items: objectItems(data).map(normalizeSearchItem),
    emptyReason: typeof data.EmptyReason === 'string' ? data.EmptyReason : undefined,
  }
}

export function renderZhihuGlobalSearch(result: ZhihuGlobalSearchResult): string {
  if (result.items.length === 0) {
    return `全网搜索「${result.query}」无结果${result.emptyReason ? `（${result.emptyReason}）` : ''}。`
  }
  const lines: string[] = [`全网搜索「${result.query}」共 ${result.items.length} 条：`, '']
  result.items.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.title}](${item.url || '（无链接）'})`)
    lines.push(`   - 类型：${item.type}　作者：${item.author}`)
    if (item.summary) lines.push(`   - 摘要：${item.summary}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

// ---------------------------------------------------------------------------
// 热榜
// ---------------------------------------------------------------------------

export type ZhihuHotListItem = {
  title: string
  url: string
  summary: string
}

export type ZhihuHotListResult = {
  version: typeof ZHIHU_HOT_LIST_VERSION
  limit: number
  items: ZhihuHotListItem[]
}

const ZHIHU_HOT_LIST_SUMMARY_MAX_CHARS = 200

function normalizeHotItem(raw: Record<string, unknown>): ZhihuHotListItem {
  const summary = typeof raw.Summary === 'string' ? raw.Summary.trim() : ''
  return {
    title: typeof raw.Title === 'string' && raw.Title.length > 0 ? raw.Title : '(无标题)',
    url: typeof raw.Url === 'string' ? raw.Url : '',
    summary: summary.length > ZHIHU_HOT_LIST_SUMMARY_MAX_CHARS ? `${summary.slice(0, ZHIHU_HOT_LIST_SUMMARY_MAX_CHARS)}…` : summary,
  }
}

export async function executeZhihuHotList(limit: number, options: ZhihuClientOptions = {}): Promise<ZhihuHotListResult> {
  const resolvedLimit = clampInt(limit, ZHIHU_HOT_LIST_DEFAULT_LIMIT, ZHIHU_HOT_LIST_MAX_LIMIT)
  const body = await zhihuFetchJson(HOT_LIST_PATH, {
    params: { Limit: String(resolvedLimit) },
  }, '知乎热榜', options)
  const items = objectItems(parseZhihuEnvelope(body)).map(normalizeHotItem)
  return { version: ZHIHU_HOT_LIST_VERSION, limit: resolvedLimit, items }
}

export function renderZhihuHotList(result: ZhihuHotListResult): string {
  if (result.items.length === 0) return '知乎热榜为空。'
  const lines: string[] = ['知乎热榜：', '']
  result.items.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.title}](${item.url || '（无链接）'})`)
    if (item.summary) lines.push(`   - ${item.summary}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

// ---------------------------------------------------------------------------
// 直答（OpenAI 兼容,非信封）
// ---------------------------------------------------------------------------

export type ZhihuAskResult = {
  version: typeof ZHIHU_ASK_VERSION
  query: string
  model: ZhihuAskModel
  content: string
  reasoning: string
}

export async function executeZhihuAsk(
  query: string,
  model: ZhihuAskModel,
  options: ZhihuClientOptions = {},
): Promise<ZhihuAskResult> {
  const trimmed = requireQuery(query, '直答问题不能为空。')
  const body = await zhihuFetchJson(ASK_PATH, {
    method: 'POST',
    body: { model, messages: [{ role: 'user', content: trimmed }], stream: false },
  }, '知乎直答', { ...options, timeoutMs: options.timeoutMs ?? ZHIHU_ASK_TIMEOUT_MS })
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ZhihuSearchError('BAD_RESPONSE', '知乎直答响应不是 OpenAI 兼容格式。')
  }
  const payload = body as {
    error?: { message?: unknown }
    choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>
  }
  if (payload.error) {
    const msg = typeof payload.error.message === 'string' ? payload.error.message : '未知错误'
    throw new ZhihuSearchError('HTTP_ERROR', `知乎直答返回错误：${msg}`)
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
  const message = choice?.message ?? {}
  const content = typeof message.content === 'string' ? message.content.trim() : ''
  const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : ''
  if (!content) throw new ZhihuSearchError('BAD_RESPONSE', '知乎直答返回为空。')
  return { version: ZHIHU_ASK_VERSION, query: trimmed, model, content, reasoning }
}

export function renderZhihuAsk(result: ZhihuAskResult): string {
  const parts: string[] = []
  if (result.reasoning) parts.push(`【思考过程】\n${result.reasoning}`)
  parts.push(result.content)
  return `知乎直答「${result.query}」：\n\n${parts.join('\n\n')}`
}

// ---------------------------------------------------------------------------
// 公开知识库检索
// ---------------------------------------------------------------------------

export type ZhihuKnowledgeItem = {
  docName: string
  originUrl: string
  snippets: string[]
}

export type ZhihuRecallScope = 'personal' | 'subscription' | 'public'
export const ZHIHU_RECALL_SCOPES: readonly ZhihuRecallScope[] = ['personal', 'subscription', 'public']

export type ZhihuKnowledgeSearchResult = {
  version: typeof ZHIHU_KNOWLEDGE_SEARCH_VERSION
  query: string
  limit: number
  recallScopes: ZhihuRecallScope[]
  items: ZhihuKnowledgeItem[]
}

function normalizeKnowledgeItem(raw: Record<string, unknown>): ZhihuKnowledgeItem {
  const content = raw.Content
  const snippets = Array.isArray(content)
    ? content.map((snippet) => String(snippet).trim()).filter((snippet) => snippet.length > 0)
    : []
  return {
    docName: typeof raw.DocName === 'string' && raw.DocName.length > 0 ? raw.DocName : '(未命名文档)',
    originUrl: typeof raw.OriginUrl === 'string' ? raw.OriginUrl : '',
    snippets,
  }
}

/** 收敛召回范围:只保留合法档位、去重;为空或未提供时回退公开库。 */
export function normalizeRecallScopes(value: unknown): ZhihuRecallScope[] {
  if (!Array.isArray(value)) return ['public']
  const scopes = [...new Set(value.filter((scope): scope is ZhihuRecallScope => typeof scope === 'string' && (ZHIHU_RECALL_SCOPES as readonly string[]).includes(scope)))]
  return scopes.length > 0 ? scopes : ['public']
}

export async function executeZhihuKnowledgeSearch(
  query: string,
  limit: number,
  recallScopes: ZhihuRecallScope[],
  options: ZhihuClientOptions = {},
): Promise<ZhihuKnowledgeSearchResult> {
  const trimmed = requireQuery(query, '知识库检索词不能为空。')
  const resolvedLimit = clampInt(limit, ZHIHU_KNOWLEDGE_SEARCH_DEFAULT_LIMIT, ZHIHU_KNOWLEDGE_SEARCH_MAX_LIMIT)
  const body = await zhihuFetchJson(KNOWLEDGE_SEARCH_PATH, {
    method: 'POST',
    body: { Query: trimmed, Limit: resolvedLimit, RecallScopes: recallScopes },
  }, '知乎知识库检索', { ...options, timeoutMs: options.timeoutMs ?? 30_000 })
  const items = objectItems(parseZhihuEnvelope(body)).map(normalizeKnowledgeItem)
  return { version: ZHIHU_KNOWLEDGE_SEARCH_VERSION, query: trimmed, limit: resolvedLimit, recallScopes, items }
}

export function renderZhihuKnowledgeSearch(result: ZhihuKnowledgeSearchResult): string {
  if (result.items.length === 0) return `知乎知识库检索「${result.query}」无匹配结果。`
  const lines: string[] = [`知乎知识库检索「${result.query}」共 ${result.items.length} 条：`, '']
  result.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.docName}`)
    if (item.originUrl) lines.push(`   - 来源：${item.originUrl}`)
    for (const snippet of item.snippets) lines.push(`   - ${snippet}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------

