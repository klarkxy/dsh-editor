/**
 * 知乎开放平台站内搜索工具。
 *
 * 端点调研结论（来源：github.com/klarkxy/zhihu-search，src/zhihu_search/upstream/http_client.py）：
 *   - 知乎站内搜索：GET /api/v1/content/zhihu_search?Query=<q>&Count=<n>
 *   - count 上限 10
 *   - 响应信封：{ Code, Message, Data }；Code 非 0 表示业务错误。
 *   - Data.Items: 每条 { Title, ContentType, Url, ContentText, VoteUpCount,
 *     CommentCount, AuthorName, AuthorityLevel, EditTime }。
 *
 * 鉴权、超时、信封解析与计量走 ./zhihu-client.ts 的共享实现；此处只保留
 * 站内搜索的参数收敛、结果规整与工具定义。
 */
import { ZHIHU_SEARCH_TOOL_NAME } from './contracts.ts'
import {
  normalizeSearchItem,
  parseZhihuEnvelope,
  reportExecuted,
  zhihuFetchJson,
  ZhihuSearchError,
  type ZhihuClientOptions,
  type ZhihuSearchItem,
} from './zhihu-client.ts'

export { ZHIHU_SEARCH_TOOL_NAME } from './contracts.ts'
export {
  resolveZhihuToken,
  ZhihuSearchError,
  type ZhihuSearchExecuted,
  type ZhihuSearchFetcher,
  type ZhihuSearchItem,
  type ZhihuSearchResolveOptions,
  type ZhihuSearchToken,
} from './zhihu-client.ts'
export const ZHIHU_SEARCH_VERSION = 1
export const ZHIHU_SEARCH_DEFAULT_COUNT = 5
export const ZHIHU_SEARCH_MAX_COUNT = 10
export const ZHIHU_SEARCH_TIMEOUT_MS = 15_000
export const ZHIHU_SUMMARY_MAX_CHARS = 200

const ZHIHU_SEARCH_PATH = '/api/v1/content/zhihu_search'

export type ZhihuSearchResult = {
  version: typeof ZHIHU_SEARCH_VERSION
  query: string
  count: number
  items: ZhihuSearchItem[]
  emptyReason?: string
}

export type ZhihuSearchExecuteOptions = ZhihuClientOptions

function clampCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : ZHIHU_SEARCH_DEFAULT_COUNT
  if (n < 1) return 1
  if (n > ZHIHU_SEARCH_MAX_COUNT) return ZHIHU_SEARCH_MAX_COUNT
  return n
}

function filterItems(data: unknown): { items: Record<string, unknown>[]; emptyReason?: string } {
  const row = (data ?? {}) as { Items?: unknown; EmptyReason?: unknown }
  const items = Array.isArray(row.Items) ? row.Items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : []
  const emptyReason = typeof row.EmptyReason === 'string' ? row.EmptyReason : undefined
  return { items, emptyReason }
}

export async function executeZhihuSearch(
  query: string,
  count: number,
  options: ZhihuSearchExecuteOptions = {},
): Promise<ZhihuSearchResult> {
  const trimmed = query.trim()
  if (!trimmed) throw new ZhihuSearchError('BAD_RESPONSE', '搜索词不能为空。')
  const resolvedCount = clampCount(count)
  const body = await zhihuFetchJson(ZHIHU_SEARCH_PATH, {
    params: { Query: trimmed, Count: String(resolvedCount) },
  }, '知乎搜索', options)
  const { items, emptyReason } = filterItems(parseZhihuEnvelope(body))
  return {
    version: ZHIHU_SEARCH_VERSION,
    query: trimmed,
    count: resolvedCount,
    items: items.map(normalizeSearchItem),
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

