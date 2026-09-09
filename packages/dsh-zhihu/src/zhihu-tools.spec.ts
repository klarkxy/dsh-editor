import { describe, expect, it, vi } from 'vitest'
import type { ZhihuSearchFetcher } from './zhihu-client.ts'
import {
  createZhihuAskTool,
  createZhihuGlobalSearchTool,
  createZhihuHotListTool,
  createZhihuKnowledgeSearchTool,
  executeZhihuAsk,
  executeZhihuGlobalSearch,
  executeZhihuHotList,
  executeZhihuKnowledgeSearch,
  normalizeRecallScopes,
  renderZhihuAsk,
  renderZhihuHotList,
  renderZhihuKnowledgeSearch,
} from './zhihu-tools.ts'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual, readFile: vi.fn() }
})

const ENV = { ZHIHU_ACCESS_TOKEN: 'primarytoken1' }
const ENVELOPE = (data: unknown, code = 0, message = 'success') => ({ Code: code, Message: message, Data: data })

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Awaited<ReturnType<ZhihuSearchFetcher>> {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  return {
    ok,
    status,
    async text() { return JSON.stringify(body) },
    async json() { return body },
  }
}

function makeFetcher(
  handler: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Awaited<ReturnType<ZhihuSearchFetcher>>,
): ZhihuSearchFetcher {
  return (input, init) => Promise.resolve(handler(
    typeof input === 'string' ? input : String(input),
    init as { method?: string; headers?: Record<string, string>; body?: string },
  ))
}

const execSignal = { signal: new AbortController().signal }

describe('zhihu_global_search', () => {
  it('hits the global_search endpoint with clamped count and SearchDB', async () => {
    const fetcher = makeFetcher((url) => {
      const u = new URL(url)
      expect(u.pathname).toBe('/api/v1/content/global_search')
      expect(u.searchParams.get('Query')).toBe('写作工具')
      expect(u.searchParams.get('Count')).toBe('20')
      expect(u.searchParams.get('SearchDB')).toBe('realtime')
      return jsonResponse(ENVELOPE({ Items: [{ Title: 't', ContentType: 'article', Url: 'u', ContentText: 's' }] }))
    })
    const result = await executeZhihuGlobalSearch(' 写作工具 ', 99, 'realtime', { fetcher, env: ENV })
    expect(result.count).toBe(20)
    expect(result.searchDb).toBe('realtime')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.title).toBe('t')
  })

  it('rejects blank queries and envelope errors', async () => {
    await expect(executeZhihuGlobalSearch('  ', 5, 'all', { env: ENV })).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    const fetcher = makeFetcher(() => jsonResponse(ENVELOPE({}, 40101, 'token expired')))
    await expect(executeZhihuGlobalSearch('x', 5, 'all', { fetcher, env: ENV })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      message: expect.stringContaining('token expired'),
    })
  })

  it('meters executions through onExecuted', async () => {
    const events: Array<{ ok: boolean; results: number }> = []
    const fetcher = makeFetcher(() => jsonResponse(ENVELOPE({ Items: [{ Title: 't' }, { Title: 'u' }] })))
    const tool = createZhihuGlobalSearchTool({ fetcher, env: ENV, onExecuted: (event) => events.push(event) })
    const execute = tool.execute as unknown as (args: unknown, exec: { signal: AbortSignal }) => Promise<{ items: unknown[] }>
    const result = await execute({ query: 'q' }, execSignal)
    expect(result.items).toHaveLength(2)
    expect(events).toEqual([{ ok: true, results: 2 }])
  })
})

describe('zhihu_hot_list', () => {
  it('hits the hot_list endpoint with clamped limit and normalizes items', async () => {
    const fetcher = makeFetcher((url) => {
      const u = new URL(url)
      expect(u.pathname).toBe('/api/v1/content/hot_list')
      expect(u.searchParams.get('Limit')).toBe('30')
      return jsonResponse(ENVELOPE({ Items: [{ Title: '热点', Url: 'https://www.zhihu.com/q/1', Summary: '  热榜摘要  ' }] }))
    })
    const result = await executeZhihuHotList(99, { fetcher, env: ENV })
    expect(result.limit).toBe(30)
    expect(result.items[0]).toEqual({ title: '热点', url: 'https://www.zhihu.com/q/1', summary: '热榜摘要' })
  })

  it('renders ranked markdown and an empty state', () => {
    expect(renderZhihuHotList({ version: 1, limit: 10, items: [] })).toBe('知乎热榜为空。')
    const text = renderZhihuHotList({ version: 1, limit: 1, items: [{ title: '热点', url: 'u', summary: 's' }] })
    expect(text).toContain('1. [热点](u)')
    expect(text).toContain('- s')
  })

  it('meters failures through onExecuted and rethrows', async () => {
    const events: Array<{ ok: boolean; results: number }> = []
    const fetcher = makeFetcher(() => jsonResponse(null, { ok: false, status: 500 }))
    const tool = createZhihuHotListTool({ fetcher, env: ENV, onExecuted: (event) => events.push(event) })
    const execute = tool.execute as unknown as (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>
    await expect(execute({}, execSignal)).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 500 })
    expect(events).toEqual([{ ok: false, results: 0 }])
  })
})

describe('zhihu_ask', () => {
  it('posts an OpenAI-compatible request and reads content plus reasoning', async () => {
    const fetcher = makeFetcher((url, init) => {
      expect(new URL(url).pathname).toBe('/v1/chat/completions')
      expect(init?.method).toBe('POST')
      const body = JSON.parse(init?.body ?? '{}') as { model: string; messages: Array<{ role: string; content: string }>; stream: boolean }
      expect(body.model).toBe('zhida-thinking-1p5')
      expect(body.messages).toEqual([{ role: 'user', content: '伏笔怎么埋' }])
      expect(body.stream).toBe(false)
      return jsonResponse({
        id: 'cmpl-1',
        model: 'zhida-thinking-1p5',
        choices: [{ message: { content: '  可以这样埋。 ', reasoning_content: ' 先想冲突。 ' }, finish_reason: 'stop' }],
      })
    })
    const result = await executeZhihuAsk(' 伏笔怎么埋 ', 'zhida-thinking-1p5', { fetcher, env: ENV })
    expect(result.content).toBe('可以这样埋。')
    expect(result.reasoning).toBe('先想冲突。')
  })

  it('surfaces the OpenAI error payload and empty answers', async () => {
    const withError = makeFetcher(() => jsonResponse({ error: { message: 'quota exceeded' } }))
    await expect(executeZhihuAsk('q', 'zhida-fast-1p5', { fetcher: withError, env: ENV })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      message: expect.stringContaining('quota exceeded'),
    })
    const empty = makeFetcher(() => jsonResponse({ choices: [{ message: { content: '  ' } }] }))
    await expect(executeZhihuAsk('q', 'zhida-fast-1p5', { fetcher: empty, env: ENV })).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('renders reasoning before the final answer', () => {
    const text = renderZhihuAsk({ version: 1, query: 'q', model: 'zhida-thinking-1p5', content: '最终答案', reasoning: '推演过程' })
    expect(text).toContain('【思考过程】')
    expect(text.indexOf('推演过程')).toBeLessThan(text.indexOf('最终答案'))
  })

  it('defaults to the thinking model and accepts the agent tier when explicit', async () => {
    const seen: string[] = []
    const fetcher = makeFetcher((_url, init) => {
      const body = JSON.parse(init?.body ?? '{}') as { model: string }
      seen.push(body.model)
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })
    const tool = createZhihuAskTool({ fetcher, env: ENV })
    const execute = tool.execute as unknown as (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>
    await execute({ query: 'q' }, execSignal)
    await execute({ query: 'q', model: 'zhida-agent' }, execSignal)
    await execute({ query: 'q', model: 'not-a-model' }, execSignal)
    expect(seen).toEqual(['zhida-thinking-1p5', 'zhida-agent', 'zhida-thinking-1p5'])
  })
})

describe('zhihu_knowledge_search', () => {
  it('posts to the knowledge search endpoint with the public recall scope by default', async () => {
    const fetcher = makeFetcher((url, init) => {
      expect(new URL(url).pathname).toBe('/api/v1/knowledge/search')
      const body = JSON.parse(init?.body ?? '{}') as { Query: string; Limit: number; RecallScopes: string[] }
      expect(body).toEqual({ Query: '民国海军', Limit: 10, RecallScopes: ['public'] })
      return jsonResponse(ENVELOPE({
        Items: [{ DocName: '海军考据', OriginUrl: 'https://zhida.zhihu.com/x', Content: ['片段一', '  ', '片段二'] }],
      }))
    })
    const result = await executeZhihuKnowledgeSearch(' 民国海军 ', 99, ['public'], { fetcher, env: ENV })
    expect(result.limit).toBe(10)
    expect(result.items[0]).toEqual({
      docName: '海军考据',
      originUrl: 'https://zhida.zhihu.com/x',
      snippets: ['片段一', '片段二'],
    })
  })

  it('normalizes recall scopes and falls back to public', async () => {
    // schema 层先按 enum 拦截非法档位;normalizeRecallScopes 兜底去重与空值。
    expect(normalizeRecallScopes(['personal', 'personal'])).toEqual(['personal'])
    expect(normalizeRecallScopes([])).toEqual(['public'])
    expect(normalizeRecallScopes('public')).toEqual(['public'])
    expect(normalizeRecallScopes(undefined)).toEqual(['public'])

    const fetcher = makeFetcher((_url, init) => {
      const body = JSON.parse(init?.body ?? '{}') as { RecallScopes: string[] }
      expect(body.RecallScopes).toEqual(['personal', 'subscription'])
      return jsonResponse(ENVELOPE({ Items: [] }))
    })
    const tool = createZhihuKnowledgeSearchTool({ fetcher, env: ENV })
    const execute = tool.execute as unknown as (args: unknown, exec: { signal: AbortSignal }) => Promise<{ recallScopes: string[] }>
    const result = await execute({ query: 'q', recallScopes: ['personal', 'subscription'] }, execSignal)
    expect(result.recallScopes).toEqual(['personal', 'subscription'])
  })

  it('renders snippets with sources and an empty state', () => {
    expect(renderZhihuKnowledgeSearch({ version: 1, query: 'q', limit: 5, recallScopes: ['public'], items: [] })).toBe('知乎知识库检索「q」无匹配结果。')
    const text = renderZhihuKnowledgeSearch({
      version: 1,
      query: 'q',
      limit: 5,
      recallScopes: ['public'],
      items: [{ docName: '文档', originUrl: 'u', snippets: ['片段'] }],
    })
    expect(text).toContain('1. 文档')
    expect(text).toContain('来源：u')
    expect(text).toContain('- 片段')
  })
})
