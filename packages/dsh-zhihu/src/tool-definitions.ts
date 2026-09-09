import { defineTool } from '@deepseek-ai/dsh-tools'
import { reportExecuted, type ZhihuClientOptions } from './zhihu-client.ts'
import { ZHIHU_SEARCH_TOOL_NAME, ZHIHU_GLOBAL_SEARCH_TOOL_NAME, ZHIHU_HOT_LIST_TOOL_NAME, ZHIHU_ASK_TOOL_NAME, ZHIHU_KNOWLEDGE_SEARCH_TOOL_NAME } from './contracts.ts'
import { executeZhihuSearch, renderZhihuSearch, ZHIHU_SEARCH_DEFAULT_COUNT, ZHIHU_SEARCH_MAX_COUNT, type ZhihuSearchResult } from './search-api.ts'
import { ZHIHU_GLOBAL_SEARCH_VERSION, ZHIHU_GLOBAL_SEARCH_DEFAULT_COUNT, ZHIHU_GLOBAL_SEARCH_MAX_COUNT, ZHIHU_HOT_LIST_VERSION, ZHIHU_HOT_LIST_DEFAULT_LIMIT, ZHIHU_HOT_LIST_MAX_LIMIT, ZHIHU_ASK_VERSION, ZHIHU_ASK_TIMEOUT_MS, ZHIHU_KNOWLEDGE_SEARCH_VERSION, ZHIHU_KNOWLEDGE_SEARCH_DEFAULT_LIMIT, ZHIHU_KNOWLEDGE_SEARCH_MAX_LIMIT, ZHIHU_ASK_MODELS, ZhihuAskModel, ZHIHU_ASK_DEFAULT_MODEL, ZhihuToolOptions, ZhihuGlobalSearchDb, ZhihuGlobalSearchResult, executeZhihuGlobalSearch, renderZhihuGlobalSearch, ZhihuHotListItem, ZhihuHotListResult, executeZhihuHotList, renderZhihuHotList, ZhihuAskResult, executeZhihuAsk, renderZhihuAsk, ZhihuKnowledgeItem, ZhihuRecallScope, ZHIHU_RECALL_SCOPES, ZhihuKnowledgeSearchResult, normalizeRecallScopes, executeZhihuKnowledgeSearch, renderZhihuKnowledgeSearch } from './operations.ts'
export type CreateZhihuSearchToolOptions = ZhihuClientOptions & {
  /** Best-effort metering hook; invoked after every execution, failures included. */
  onExecuted?: (event: { ok: boolean; results: number }) => void
}

const SEARCH_ITEM_SCHEMA = {
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
} as const

export function createZhihuSearchTool(options: CreateZhihuSearchToolOptions = {}) {
  const { onExecuted, ...client } = options
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
            items: SEARCH_ITEM_SCHEMA,
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
      try {
        const result = await executeZhihuSearch(typed.query, typed.count ?? ZHIHU_SEARCH_DEFAULT_COUNT, {
          ...client,
          signal: exec.signal,
        })
        reportExecuted(onExecuted, { ok: true, results: result.items.length })
        return result
      } catch (error) {
        reportExecuted(onExecuted, { ok: false, results: 0 })
        throw error
      }
    },
  })
}

const OTHER_SEARCH_ITEM_SCHEMA = {
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
} as const

/** 包一层计量:成功报 results,失败报 ok:false 再原样抛出。 */
async function metered<T>(onExecuted: ZhihuToolOptions['onExecuted'], run: () => Promise<T>, results: (value: T) => number): Promise<T> {
  try {
    const value = await run()
    reportExecuted(onExecuted, { ok: true, results: results(value) })
    return value
  } catch (error) {
    reportExecuted(onExecuted, { ok: false, results: 0 })
    throw error
  }
}

export function createZhihuGlobalSearchTool(options: ZhihuToolOptions = {}) {
  const { onExecuted, ...client } = options
  return defineTool({
    name: ZHIHU_GLOBAL_SEARCH_TOOL_NAME,
    description: '调用知乎开放平台全网搜索（GET /api/v1/content/global_search）检索站外公开网页资料；结果仅作参考，不构成 canon，也不直接写入项目文件。',
    parameters: {
      query: { type: 'string', required: true, description: '搜索词，2-100 字符。' },
      count: { type: 'integer', description: `返回条数，1-${ZHIHU_GLOBAL_SEARCH_MAX_COUNT}，默认 ${ZHIHU_GLOBAL_SEARCH_DEFAULT_COUNT}。` },
      searchDb: { type: 'string', description: '检索库：all（默认）、realtime（实时）、static（静态）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          query: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          searchDb: { type: 'string', required: true },
          items: { type: 'array', required: true, items: OTHER_SEARCH_ITEM_SCHEMA },
          emptyReason: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: renderZhihuGlobalSearch(value as ZhihuGlobalSearchResult) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const typed = args as { query: string; count?: number; searchDb?: string }
      const searchDb: ZhihuGlobalSearchDb = typed.searchDb === 'realtime' || typed.searchDb === 'static' ? typed.searchDb : 'all'
      return await metered(onExecuted, () => executeZhihuGlobalSearch(
        typed.query,
        typed.count ?? ZHIHU_GLOBAL_SEARCH_DEFAULT_COUNT,
        searchDb,
        { ...client, signal: exec.signal },
      ), (result) => result.items.length)
    },
  })
}

export function createZhihuHotListTool(options: ZhihuToolOptions = {}) {
  const { onExecuted, ...client } = options
  return defineTool({
    name: ZHIHU_HOT_LIST_TOOL_NAME,
    description: '拉取知乎热榜（GET /api/v1/content/hot_list）了解当前社区热点；结果仅作题材与热点参考，不构成 canon，也不直接写入项目文件。',
    parameters: {
      limit: { type: 'integer', description: `返回条数，1-${ZHIHU_HOT_LIST_MAX_LIMIT}，默认 ${ZHIHU_HOT_LIST_DEFAULT_LIMIT}。` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          limit: { type: 'integer', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                url: { type: 'string', required: true },
                summary: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: renderZhihuHotList(value as ZhihuHotListResult) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const typed = args as { limit?: number }
      return await metered(onExecuted, () => executeZhihuHotList(
        typed.limit ?? ZHIHU_HOT_LIST_DEFAULT_LIMIT,
        { ...client, signal: exec.signal },
      ), (result) => result.items.length)
    },
  })
}

export function createZhihuAskTool(options: ZhihuToolOptions = {}) {
  const { onExecuted, ...client } = options
  return defineTool({
    name: ZHIHU_ASK_TOOL_NAME,
    description: '调用知乎直答（POST /v1/chat/completions，OpenAI 兼容）基于知乎社区内容生成综合回答；适合考据与背景调研。结果仅作参考，不构成 canon，也不直接写入项目文件。',
    parameters: {
      query: { type: 'string', required: true, description: '要问的问题。' },
      model: { type: 'string', description: 'zhida-thinking-1p5（默认，带思考过程）、zhida-fast-1p5（快，仅适合简单事实查询）或 zhida-agent（最慢最强，仅在明确要求时使用）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          query: { type: 'string', required: true },
          model: { type: 'string', required: true },
          content: { type: 'string', required: true },
          reasoning: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: renderZhihuAsk(value as ZhihuAskResult) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const typed = args as { query: string; model?: string }
      const model: ZhihuAskModel = (ZHIHU_ASK_MODELS as readonly string[]).includes(typed.model ?? '')
        ? (typed.model as ZhihuAskModel)
        : ZHIHU_ASK_DEFAULT_MODEL
      return await metered(onExecuted, () => executeZhihuAsk(
        typed.query,
        model,
        { ...client, signal: exec.signal },
      ), (result) => (result.content ? 1 : 0))
    },
  })
}

export function createZhihuKnowledgeSearchTool(options: ZhihuToolOptions = {}) {
  const { onExecuted, ...client } = options
  return defineTool({
    name: ZHIHU_KNOWLEDGE_SEARCH_TOOL_NAME,
    description: '检索知乎知识库（POST /api/v1/knowledge/search，RAG 片段），默认只查公开库；用户在知乎网页端上传过个人资料后可加 personal/subscription 召回。结果仅作背景参考，不构成 canon，也不直接写入项目文件。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词。' },
      limit: { type: 'integer', description: `返回条数，1-${ZHIHU_KNOWLEDGE_SEARCH_MAX_LIMIT}，默认 ${ZHIHU_KNOWLEDGE_SEARCH_DEFAULT_LIMIT}。` },
      recallScopes: {
        type: 'array',
        description: '召回范围：public（公开库，默认）、personal（个人库）、subscription（订阅库），可多选。',
        items: { type: 'string', enum: [...ZHIHU_RECALL_SCOPES] },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          query: { type: 'string', required: true },
          limit: { type: 'integer', required: true },
          recallScopes: { type: 'array', required: true, items: { type: 'string' } },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                docName: { type: 'string', required: true },
                originUrl: { type: 'string', required: true },
                snippets: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: renderZhihuKnowledgeSearch(value as ZhihuKnowledgeSearchResult) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const typed = args as { query: string; limit?: number; recallScopes?: unknown }
      return await metered(onExecuted, () => executeZhihuKnowledgeSearch(
        typed.query,
        typed.limit ?? ZHIHU_KNOWLEDGE_SEARCH_DEFAULT_LIMIT,
        normalizeRecallScopes(typed.recallScopes),
        { ...client, signal: exec.signal },
      ), (result) => result.items.length)
    },
  })
}
