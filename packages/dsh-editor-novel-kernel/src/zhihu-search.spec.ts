import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  ZHIHU_SEARCH_DEFAULT_COUNT,
  ZHIHU_SEARCH_MAX_COUNT,
  ZHIHU_SEARCH_TOOL_NAME,
  ZHIHU_SEARCH_VERSION,
  createZhihuSearchTool,
  executeZhihuSearch,
  renderZhihuSearch,
  resolveZhihuToken,
  ZhihuSearchError,
  type ZhihuSearchFetcher,
} from './zhihu-search.ts'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual, readFile: vi.fn() }
})

const readFileMock = vi.mocked(readFile)

const ENVELOPE = (items: unknown[], code = 0, message = 'success') => ({ Code: code, Message: message, Data: { Items: items } })

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

function makeFetcher(handler: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Awaited<ReturnType<ZhihuSearchFetcher>>): ZhihuSearchFetcher {
  return (input, init) => Promise.resolve(handler(typeof input === 'string' ? input : (input as URL).toString(), init as { headers?: Record<string, string>; signal?: AbortSignal }))
}

describe('zhihu_search', () => {
  beforeEach(() => {
    readFileMock.mockReset()
  })
  afterEach(() => {
    readFileMock.mockReset()
  })

  describe('resolveZhihuToken', () => {
    it('prefers ZHIHU_ACCESS_TOKEN over other sources', async () => {
      readFileMock.mockResolvedValue(JSON.stringify({ access_secret: 'ffffffffffffffff' }))
      const token = await resolveZhihuToken({ ZHIHU_ACCESS_TOKEN: 'primarytoken1', ZHIHU_ACCESS_SECRET: 'fallbacktok1' })
      expect(token).toEqual({ token: 'primarytoken1', source: 'env-primary' })
      expect(readFileMock).not.toHaveBeenCalled()
    })

    it('falls back to ZHIHU_ACCESS_SECRET when primary env is missing', async () => {
      readFileMock.mockResolvedValue(JSON.stringify({ access_secret: 'ffffffffffffffff' }))
      const token = await resolveZhihuToken({ ZHIHU_ACCESS_TOKEN: '', ZHIHU_ACCESS_SECRET: 'fallbacktok1' })
      expect(token).toEqual({ token: 'fallbacktok1', source: 'env-fallback' })
      expect(readFileMock).not.toHaveBeenCalled()
    })

    it('reads ~/.config/zhihu-search/credentials.json when env vars are empty', async () => {
      readFileMock.mockResolvedValue(JSON.stringify({ access_secret: 'filetoken1234' }))
      const token = await resolveZhihuToken({ ZHIHU_ACCESS_TOKEN: '   ', ZHIHU_ACCESS_SECRET: undefined })
      expect(token).toEqual({ token: 'filetoken1234', source: 'file' })
      expect(readFileMock).toHaveBeenCalledTimes(1)
    })

    it('prefers resolveCredential over env and file when it returns a valid token', async () => {
      readFileMock.mockResolvedValue(JSON.stringify({ access_secret: 'filetoken1234' }))
      const resolveCredential = vi.fn(async () => 'credentialtoken1')
      const token = await resolveZhihuToken(
        { ZHIHU_ACCESS_TOKEN: 'primarytoken1', ZHIHU_ACCESS_SECRET: 'fallbacktok1' },
        { resolveCredential },
      )
      expect(token).toEqual({ token: 'credentialtoken1', source: 'credential' })
      expect(resolveCredential).toHaveBeenCalledTimes(1)
      expect(readFileMock).not.toHaveBeenCalled()
    })

    it('falls through to env when resolveCredential returns undefined', async () => {
      readFileMock.mockResolvedValue(JSON.stringify({ access_secret: 'filetoken1234' }))
      const token = await resolveZhihuToken(
        { ZHIHU_ACCESS_TOKEN: 'primarytoken1' },
        { resolveCredential: async () => undefined },
      )
      expect(token).toEqual({ token: 'primarytoken1', source: 'env-primary' })
      expect(readFileMock).not.toHaveBeenCalled()
    })

    it('falls through to env when resolveCredential returns a malformed value', async () => {
      readFileMock.mockResolvedValue(JSON.stringify({ access_secret: 'filetoken1234' }))
      const token = await resolveZhihuToken(
        { ZHIHU_ACCESS_TOKEN: 'primarytoken1' },
        { resolveCredential: async () => 'short' },
      )
      expect(token).toEqual({ token: 'primarytoken1', source: 'env-primary' })
      expect(readFileMock).not.toHaveBeenCalled()
    })

    it('preserves the env → file fallback when no resolveCredential is injected', async () => {
      // Sanity check: omitting resolveCredential keeps the old two-stage fallback intact.
      const fromEnv = await resolveZhihuToken({ ZHIHU_ACCESS_TOKEN: 'primarytoken1' })
      expect(fromEnv).toEqual({ token: 'primarytoken1', source: 'env-primary' })

      readFileMock.mockResolvedValue(JSON.stringify({ access_secret: 'filetoken1234' }))
      const fromFile = await resolveZhihuToken({})
      expect(fromFile).toEqual({ token: 'filetoken1234', source: 'file' })
    })

    it('throws TOKEN_MISSING pointing at the settings UI when no source has a token', async () => {
      readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      await expect(
        resolveZhihuToken({}, { resolveCredential: async () => undefined }),
      ).rejects.toMatchObject({
        name: 'ZhihuSearchError',
        code: 'TOKEN_MISSING',
        message: expect.stringContaining('设置'),
      })
    })
  })

  describe('executeZhihuSearch', () => {
    const token = { token: 'primarytoken1', source: 'env-primary' as const }

    it('returns the parsed envelope items with a 1-10 count clamp', async () => {
      const items = [
        {
          Title: '提问：知乎写作工具对比',
          ContentType: 'question',
          Url: 'https://www.zhihu.com/question/1',
          ContentText: '有人用过 dsh-editor 吗？'.repeat(40),
          VoteUpCount: 12,
          CommentCount: 4,
          AuthorName: '某位读者',
          AuthorityLevel: 'Lv4',
          EditTime: 1_700_000_000,
        },
      ]
      const fetcher = makeFetcher((url, init) => {
        expect(url).toContain('/api/v1/content/zhihu_search?Query=')
        expect(url).toContain(`Count=${ZHIHU_SEARCH_MAX_COUNT}`)
        expect(init?.headers?.Authorization).toBe(`Bearer ${token.token}`)
        expect(typeof init?.headers?.['X-Request-Timestamp']).toBe('string')
        return jsonResponse(ENVELOPE(items))
      })
      const result = await executeZhihuSearch('  dsh-editor  ', 99, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token } })
      expect(result.version).toBe(ZHIHU_SEARCH_VERSION)
      expect(result.query).toBe('dsh-editor')
      expect(result.count).toBe(ZHIHU_SEARCH_MAX_COUNT)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.title).toBe('提问：知乎写作工具对比')
      expect(result.items[0]?.summary.length).toBeLessThanOrEqual(201)
    })

    it('clamps zero and negative counts to 1', async () => {
      const fetcher = makeFetcher((url) => {
        const u = new URL(url)
        expect(u.searchParams.get('Count')).toBe('1')
        return jsonResponse(ENVELOPE([]))
      })
      const result = await executeZhihuSearch('空', 0, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token } })
      expect(result.count).toBe(1)
      expect(result.items).toEqual([])
    })

    it('defaults count to ZHIHU_SEARCH_DEFAULT_COUNT when missing', async () => {
      const fetcher = makeFetcher((url) => {
        const u = new URL(url)
        expect(u.searchParams.get('Count')).toBe(String(ZHIHU_SEARCH_DEFAULT_COUNT))
        return jsonResponse(ENVELOPE([]))
      })
      const result = await executeZhihuSearch('default', Number.NaN, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token } })
      expect(result.count).toBe(ZHIHU_SEARCH_DEFAULT_COUNT)
    })

    it('returns HTTP_ERROR with status when the API responds non-2xx', async () => {
      const fetcher = makeFetcher(() => jsonResponse(null, { ok: false, status: 401 }))
      await expect(executeZhihuSearch('x', 5, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token } })).rejects.toMatchObject({
        name: 'ZhihuSearchError',
        code: 'HTTP_ERROR',
        status: 401,
      })
    })

    it('surfaces the upstream Message when the envelope Code is non-zero', async () => {
      const fetcher = makeFetcher(() => jsonResponse({ Code: 40101, Message: 'token expired', Data: {} }))
      await expect(executeZhihuSearch('x', 5, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token } })).rejects.toMatchObject({
        name: 'ZhihuSearchError',
        code: 'HTTP_ERROR',
        message: expect.stringContaining('token expired'),
      })
    })

    it('filters non-object Items entries before normalization', async () => {
      const fetcher = makeFetcher(() => jsonResponse({ Code: 0, Data: { Items: ['not-an-object', null, [1, 2]] } }))
      const result = await executeZhihuSearch('x', 5, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token } })
      expect(result.items).toEqual([])
    })

    it('falls back to default fields when an item omits known properties', async () => {
      const fetcher = makeFetcher(() => jsonResponse({ Code: 0, Data: { Items: [{ extra: 'only' }] } }))
      const result = await executeZhihuSearch('x', 5, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token } })
      expect(result.items).toEqual([{
        title: '(无标题)', type: '内容', url: '', summary: '', votes: 0, comments: 0, author: '匿名', authority: '?', editTime: '',
      }])
    })

    it('returns TIMEOUT when the request is aborted before completion', async () => {
      const fetcher: ZhihuSearchFetcher = (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
      await expect(executeZhihuSearch('x', 5, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token }, timeoutMs: 50 })).rejects.toMatchObject({
        name: 'ZhihuSearchError',
        code: 'TIMEOUT',
      })
    })

    it('rejects an empty query before issuing any network call', async () => {
      const fetcher = vi.fn<ZhihuSearchFetcher>()
      await expect(executeZhihuSearch('   ', 5, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token } })).rejects.toBeInstanceOf(ZhihuSearchError)
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('returns a Chinese empty reason when the API says no items', async () => {
      const fetcher = makeFetcher(() => jsonResponse({ Code: 0, Message: 'ok', Data: { Items: [], EmptyReason: '关键词被过滤' } }))
      const result = await executeZhihuSearch('x', 5, { fetcher, env: { ZHIHU_ACCESS_TOKEN: token.token } })
      expect(result.emptyReason).toBe('关键词被过滤')
    })
  })

  describe('renderZhihuSearch', () => {
    it('renders a single-item list with metadata and summary', () => {
      const markdown = renderZhihuSearch({
        version: ZHIHU_SEARCH_VERSION,
        query: 'dsh-editor',
        count: 1,
        items: [{
          title: '提问', type: 'question', url: 'https://www.zhihu.com/q/1',
          summary: '简介', votes: 3, comments: 1, author: '读者', authority: 'Lv3', editTime: '1700000000',
        }],
      })
      expect(markdown).toContain('知乎站内搜索「dsh-editor」共 1 条')
      expect(markdown).toContain('[提问](https://www.zhihu.com/q/1)')
      expect(markdown).toContain('作者：读者')
      expect(markdown).toContain('赞同 3')
      expect(markdown).toContain('摘要：简介')
    })

    it('renders an empty state with a reason when no items came back', () => {
      expect(renderZhihuSearch({
        version: ZHIHU_SEARCH_VERSION, query: '无果', count: 5, items: [], emptyReason: '关键词被过滤',
      })).toBe('知乎站内搜索「无果」无结果（关键词被过滤）。')
    })
  })

  describe('createZhihuSearchTool', () => {
    it('registers the canonical tool name and returns a Markdown content block', () => {
      const tool = createZhihuSearchTool({ env: { ZHIHU_ACCESS_TOKEN: 'primarytoken1' } })
      expect(tool.name).toBe(ZHIHU_SEARCH_TOOL_NAME)
      const blocks = (tool as unknown as { output: { render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> } }).output.render(
        { query: 'q', count: 1 },
        {
          version: ZHIHU_SEARCH_VERSION,
          query: 'q',
          count: 1,
          items: [{ title: 't', type: 'x', url: 'u', summary: 's', votes: 0, comments: 0, author: 'a', authority: 'b', editTime: '0' }],
        },
      )
      expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('知乎站内搜索「q」共 1 条') }])
    })
  })
})
