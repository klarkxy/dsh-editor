import { mkdtempSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModelsCatalog, factsFor, indexFromPayload, resolveShellHome, type CatalogIndex } from './models-catalog.ts'

/* models.dev api.json 的真实条目摘录（T:/modelsdev.json，2026-11）：deepseek
   的 effort+toggle、无 reasoning 的图像模型与只有 toggle 的档位。 */
const PAYLOAD = {
  deepseek: {
    models: {
      'deepseek-flash': {
        id: 'deepseek-flash',
        reasoning: true,
        reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }],
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 1048576, output: 393216 },
      },
      'deepseek-v4-pro': {
        id: 'deepseek-v4-pro',
        reasoning: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1000000, output: 393216 },
      },
      plain: {
        id: 'plain',
        reasoning: false,
        modalities: { input: ['text'] },
        limit: { context: 64000, output: 8000 },
      },
      'toggle-only': {
        id: 'toggle-only',
        reasoning: true,
        reasoning_options: [{ type: 'toggle' }],
        modalities: { input: ['text'] },
        limit: { context: 64000, output: 8000 },
      },
      'effort-locked': {
        id: 'effort-locked',
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
        modalities: { input: ['text'] },
        limit: { context: 64000, output: 8000 },
      },
      'image-only': {
        id: 'image-only',
        reasoning: false,
        modalities: { input: ['image'], output: ['text'] },
        limit: { context: 64000, output: 8000 },
      },
      audio: {
        id: 'audio',
        reasoning: false,
        modalities: { input: ['text', 'audio'] },
        limit: { context: 64000, output: 8000 },
      },
    },
  },
  'acme-mirror': {
    models: {
      'deepseek-flash': {
        id: 'deepseek-flash',
        reasoning: true,
        modalities: { input: ['text'] },
        limit: { context: 1048576, output: 393216 },
      },
    },
  },
  'acme-a': {
    models: {
      shared: { id: 'shared', reasoning: false, modalities: { input: ['text'] }, limit: { context: 100, output: 10 } },
    },
  },
  'acme-b': {
    models: {
      shared: { id: 'shared', reasoning: false, modalities: { input: ['text'] }, limit: { context: 100, output: 10 } },
    },
  },
  'acme-c': {
    models: {
      shared: { id: 'shared', reasoning: false, modalities: { input: ['text'] }, limit: { context: 200, output: 20 } },
    },
  },
}

const INDEX = indexFromPayload(PAYLOAD)

/* 每个夹具写进自己的临时目录,运行后统一删除,不留文件。 */
const specDirs: string[] = []
afterEach(async () => {
  await Promise.all(specDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function specDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'models-dev-'))
  specDirs.push(dir)
  return dir
}

function catalogFixture(overrides: Partial<Parameters<typeof createModelsCatalog>[0]> = {}) {
  let clock = 1_000_000
  const fetcher = vi.fn(async () => new Response(JSON.stringify(PAYLOAD)))
  const catalog = createModelsCatalog({
    fetcher: fetcher as unknown as typeof fetch,
    cacheFile: overrides.cacheFile ?? join(specDir(), 'models-dev-index.json'),
    now: () => clock,
    ...overrides,
  })
  return { catalog, fetcher, advance: (ms: number) => { clock += ms } }
}

describe('indexFromPayload', () => {
  it('maps limit, modalities and reasoning shapes to CatalogFacts', () => {
    const flash = INDEX['deepseek']!['deepseek-flash']!
    expect(flash.contextWindow).toBe(1048576)
    expect(flash.maxTokens).toBe(393216)
    expect(flash.input).toEqual(['text', 'image'])
    expect(flash.reasoning).toEqual({ efforts: ['low', 'high', 'max'], canDisable: true })
    // reasoning 无 options → 标准档位、可关
    expect(INDEX['deepseek']!['deepseek-v4-pro']!.reasoning).toEqual({
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'], canDisable: true,
    })
    // 只有 toggle → 标准档位、可关
    expect(INDEX['deepseek']!['toggle-only']!.reasoning).toEqual({
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'], canDisable: true,
    })
    // 只有 effort → 声明档位、不可关
    expect(INDEX['deepseek']!['effort-locked']!.reasoning).toEqual({ efforts: ['low', 'high'], canDisable: false })
    expect(INDEX['deepseek']!['plain']!.reasoning).toBe(false)
    // image-only input 保留；非 text/image 被过滤后至少一项才保留
    expect(INDEX['deepseek']!['image-only']!.input).toEqual(['image'])
    expect(INDEX['deepseek']!['audio']!.input).toEqual(['text'])
  })

  it('lowercases provider and model keys', () => {
    const index = indexFromPayload({ OpenAI: { models: { 'GPT-5': { limit: { context: 1 } } } } })
    expect(index['openai']!['gpt-5']!.contextWindow).toBe(1)
  })
})

describe('factsFor matching', () => {
  it('prefers the scoped provider, full id before stripped id', () => {
    expect(factsFor(INDEX, 'deepseek', 'deepseek-flash')).toBe(INDEX['deepseek']!['deepseek-flash'])
    expect(factsFor(INDEX, 'deepseek', 'deepseek/deepseek-flash')).toBe(INDEX['deepseek']!['deepseek-flash'])
    expect(factsFor(INDEX, 'acme-mirror', 'deepseek-flash')).toBe(INDEX['acme-mirror']!['deepseek-flash'])
  })

  it('falls back to cross-provider search for unknown provider ids', () => {
    expect(factsFor(INDEX, 'acme-gateway', 'deepseek/deepseek-flash')).toBe(INDEX['deepseek']!['deepseek-flash'])
  })

  it('prefers first-party providers over mirrors', () => {
    expect(factsFor(INDEX, undefined, 'deepseek-flash')).toBe(INDEX['deepseek']!['deepseek-flash'])
  })

  it('uses the majority (contextWindow, maxTokens) group without a first-party hit', () => {
    const facts = factsFor(INDEX, undefined, 'shared')
    expect(facts).toBe(INDEX['acme-a']!['shared'])
  })

  it('falls back to global matching when the scoped provider lacks the id', () => {
    const index = indexFromPayload({
      openai: { models: { 'gpt-5': { limit: { context: 1, output: 2 } } } },
      moonshotai: { models: { 'kimi-k2': { limit: { context: 262144, output: 32768 } } } },
    })
    // 自定义网关的 provider id 恰好叫 openai;该 provider 下没有 kimi-k2 时仍能查到。
    expect(factsFor(index, 'openai', 'kimi-k2')).toBe(index['moonshotai']!['kimi-k2'])
    expect(factsFor(index, 'openai', 'kimi/kimi-k2')).toBe(index['moonshotai']!['kimi-k2'])
  })

  it('breaks majority ties by provider id order', () => {
    const index = indexFromPayload({
      'b-vendor': { models: { m: { limit: { context: 1, output: 2 } } } },
      'a-vendor': { models: { m: { limit: { context: 1, output: 2 } } } },
    })
    expect(factsFor(index, undefined, 'm')).toBe(index['a-vendor']!['m'])
  })
})

describe('models.catalog.lookup', () => {

  it('validates the request shape', async () => {
    const { catalog } = catalogFixture()
    expect(await catalog.handle(undefined)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await catalog.handle({ ids: 'x' })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await catalog.handle({ ids: [''] })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await catalog.handle({ ids: ['x'.repeat(201)] })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await catalog.handle({ ids: Array.from({ length: 201 }, (_, i) => `m${i}`) }))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await catalog.handle({ provider: 42, ids: ['m'] })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('answers facts and omits unknown ids', async () => {
    const { catalog } = catalogFixture()
    const result = await catalog.handle({ provider: 'deepseek', ids: ['deepseek-flash', 'nope'] })
    expect(result).toMatchObject({ ok: true, value: { stale: false } })
    const value = (result as { value: { models: Record<string, unknown> } }).value
    expect(Object.keys(value.models)).toEqual(['deepseek-flash'])
  })

  it('serves memory within the TTL without refetching, refetches after it', async () => {
    const { catalog, fetcher, advance } = catalogFixture()
    await catalog.handle({ ids: ['deepseek-flash'] })
    await catalog.handle({ ids: ['plain'] })
    expect(fetcher).toHaveBeenCalledTimes(1)
    advance(24 * 60 * 60 * 1000 + 1)
    await catalog.handle({ ids: ['plain'] })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight fetch between concurrent lookups', async () => {
    const { catalog, fetcher } = catalogFixture()
    await Promise.all([
      catalog.handle({ ids: ['a'] }),
      catalog.handle({ ids: ['b'] }),
      catalog.handle({ ids: ['c'] }),
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('falls back to the expired cache with stale when refresh fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'models-dev-'))
    specDirs.push(dir)
    const cacheFile = join(dir, 'models-dev-index.json')
    const index: CatalogIndex = { acme: { m1: { contextWindow: 100 } } }
    await writeFile(cacheFile, JSON.stringify({ fetchedAt: new Date(500).toISOString(), index }))
    const fetcher = vi.fn(async () => { throw new Error('offline') })
    const catalog = createModelsCatalog({
      fetcher: fetcher as unknown as typeof fetch,
      cacheFile,
      // 500ms 的缓存此刻早已过期：过期缓存仍在，刷新失败才走 stale 回退。
      now: () => 500 + 24 * 60 * 60 * 1000 + 1,
    })
    const result = await catalog.handle({ ids: ['m1', 'm2'] })
    expect(result).toMatchObject({
      ok: true,
      value: { fetchedAt: new Date(500).toISOString(), stale: true, models: { m1: { contextWindow: 100 } } },
    })
  })

  it('treats an unusable payload as a failed fetch and keeps the old cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'models-dev-'))
    specDirs.push(dir)
    const cacheFile = join(dir, 'models-dev-index.json')
    const index: CatalogIndex = { acme: { m1: { contextWindow: 100 } } }
    await writeFile(cacheFile, JSON.stringify({ fetchedAt: new Date(500).toISOString(), index }))
    // 结构变了/错误页:provider 壳子还在但一个可用模型都解析不出来。
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ acme: { models: {} } })))
    const catalog = createModelsCatalog({
      fetcher: fetcher as unknown as typeof fetch,
      cacheFile,
      now: () => 500 + 24 * 60 * 60 * 1000 + 1,
    })
    const result = await catalog.handle({ ids: ['m1'] })
    expect(result).toMatchObject({
      ok: true,
      value: { fetchedAt: new Date(500).toISOString(), stale: true, models: { m1: { contextWindow: 100 } } },
    })
    const kept = JSON.parse(await readFile(cacheFile, 'utf8')) as { index: CatalogIndex }
    expect(kept.index).toEqual(index)
  })

  it('treats entries with only empty facts as unusable too', async () => {
    const dir = specDir()
    const cacheFile = join(dir, 'models-dev-index.json')
    // 条目还在但一个字段都解析不出来(modalities/limit/reasoning 全空)——
    // 与「没有可用模型」同等,不写缓存、有旧缓存就 stale、没有就 network。
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      acme: { models: { hollow: { id: 'hollow', modalities: { input: [], output: [] }, limit: {} } } },
    })))
    const catalog = createModelsCatalog({ fetcher: fetcher as unknown as typeof fetch, cacheFile })
    expect(await catalog.handle({ ids: ['hollow'] })).toMatchObject({ ok: false, error: { code: 'network' } })
  })

  it('reports a network error when the payload has no usable models and nothing is cached', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'not found' })))
    const catalog = createModelsCatalog({
      fetcher: fetcher as unknown as typeof fetch,
      cacheFile: join(specDir(), 'models-dev-index.json'),
    })
    expect(await catalog.handle({ ids: ['m1'] })).toMatchObject({ ok: false, error: { code: 'network' } })
  })

  it('reports a network error when nothing is cached', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline') })
    const catalog = createModelsCatalog({
      fetcher: fetcher as unknown as typeof fetch,
      cacheFile: join(specDir(), 'models-dev-index.json'),
    })
    expect(await catalog.handle({ ids: ['m1'] })).toMatchObject({
      ok: false,
      error: { code: 'network', message: '暂时无法连接 models.dev，请稍后重试或手动填写。' },
    })
  })

  it('rejects responses beyond the size bound', async () => {
    const fetcher = vi.fn(async () => new Response('x'.repeat(64), { headers: { 'content-length': '64' } }))
    const catalog = createModelsCatalog({
      fetcher: fetcher as unknown as typeof fetch,
      cacheFile: join(specDir(), 'models-dev-index.json'),
      maxBytes: 8,
    })
    expect(await catalog.handle({ ids: ['m1'] })).toMatchObject({ ok: false, error: { code: 'network' } })
  })

  it('rejects an oversized body the headers understated', async () => {
    const fetcher = vi.fn(async () => new Response('x'.repeat(64), { headers: { 'content-length': '4' } }))
    const catalog = createModelsCatalog({
      fetcher: fetcher as unknown as typeof fetch,
      cacheFile: join(specDir(), 'models-dev-index.json'),
      maxBytes: 8,
    })
    expect(await catalog.handle({ ids: ['m1'] })).toMatchObject({ ok: false, error: { code: 'network' } })
  })
})

describe('resolveShellHome', () => {
  it('prefers DSH_HOME, then the profile layout, then the user home', () => {
    expect(resolveShellHome({ DSH_HOME: ' /data/dsh ' } as NodeJS.ProcessEnv, [], '/u', undefined)).toBe('/data/dsh')
    const root = resolve('/data/home')
    const moduleUrl = pathToFileURL(join(root, 'profiles', 'dsh-editor', 'bundled-packages', 'node_modules', 'dsh-editor-shell', 'lib', 'index.js')).href
    expect(resolveShellHome({} as NodeJS.ProcessEnv, [], '/u', moduleUrl)).toBe(root)
    expect(resolveShellHome({} as NodeJS.ProcessEnv, [], '/u', undefined)).toBe(join('/u', '.dsh-editor'))
  })
})
