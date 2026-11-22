/**
 * `models.catalog.lookup` host endpoint: answers model facts from the public
 * models.dev catalog. Network is touched only when a lookup arrives — never
 * at plugin load. Results are reduced to a compact index cached 24h on disk
 * (`<DSH_HOME>/cache/dsh-editor/models-dev-index.json`) and in memory; stale
 * disk data answers when a refresh fails.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type CatalogFacts = {
  contextWindow?: number
  maxTokens?: number
  input?: ('text' | 'image')[]
  reasoning?: false | { efforts: string[]; canDisable: boolean }
}

/** `{ [providerIdLower]: { [modelIdLower]: CatalogFacts } }`. */
export type CatalogIndex = Record<string, Record<string, CatalogFacts>>

export type ModelsCatalogLookupValue = {
  fetchedAt: string
  stale: boolean
  models: Record<string, CatalogFacts>
}

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

const MODELS_DEV_URL = 'https://models.dev/api.json'
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_IDS = 200
const MAX_ID_LENGTH = 200
const FIRST_PARTY: readonly string[] = [
  'openai', 'anthropic', 'google', 'deepseek', 'moonshotai', 'zai', 'alibaba', 'xai', 'mistral',
]
/* STANDARD_REASONING_EFFORTS without `off`: models.dev lists no `off` level,
   a toggle option (or absent options) means the effort can be left unset. */
const DEFAULT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/* --- DSH home resolution -------------------------------------------------
 * Mirrors packages/dsh-editor-plugins/src/paths.ts (resolvePluginPaths):
 * the shell package must not import that private sibling, so the same DSH
 * profile-layout rules are repeated here with the `dsh-editor-shell`
 * marker. Keep in sync if the layout rules change there. */
const PROFILE_NAME = /^[A-Za-z0-9._-]+$/
const SHELL_MARKERS = [`${sep}node_modules${sep}dsh-editor-shell${sep}`, '/node_modules/dsh-editor-shell/']
const RETAINED_TREES = new Set(['bundled-packages', 'runtime-links'])

function shellRootFromFile(file: string): string | undefined {
  const lower = file.toLowerCase()
  let index = -1
  for (const marker of SHELL_MARKERS) {
    const found = lower.lastIndexOf(marker.toLowerCase())
    if (found > index) index = found
  }
  return index === -1 ? undefined : file.slice(0, index)
}

function canonicalizeProfileDir(candidate: string): string | undefined {
  let dir = candidate
  while (RETAINED_TREES.has(basename(dir))) {
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  while (true) {
    const parent = dirname(dir)
    if (parent === dir) break
    const base = basename(dir)
    const parentBase = basename(parent)
    if (base === 'node_modules' || base === '.pnpm' || parentBase === '.pnpm') {
      dir = parent
      continue
    }
    break
  }
  return basename(dirname(dir)) === 'profiles' ? dir : undefined
}

function profileDirFromShellModule(moduleUrl: string): string | undefined {
  try {
    const root = shellRootFromFile(fileURLToPath(moduleUrl))
    return root ? canonicalizeProfileDir(root) : undefined
  } catch {
    return undefined
  }
}

export function resolveShellHome(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  homeDirectory: string | undefined = homedir(),
  moduleUrl: string | undefined = import.meta.url,
): string {
  const explicitHome = env.DSH_HOME?.trim()
  if (explicitHome) return explicitHome
  const discoveredDir = moduleUrl ? profileDirFromShellModule(moduleUrl) : undefined
  if (discoveredDir) return dirname(dirname(discoveredDir))
  const flag = argv.indexOf('--profile')
  const profile = flag >= 0 && argv[flag + 1] && PROFILE_NAME.test(argv[flag + 1]) ? argv[flag + 1] : 'dsh-editor'
  return join(homeDirectory ?? homedir(), profile === 'dsh-editor' ? '.dsh-editor' : '.dsh')
}
/* --- end mirrored path rules ------------------------------------------- */

type CacheRecord = { fetchedAt: string; index: CatalogIndex }

type CachedEntry = CacheRecord & { fetchedAtMs: number }

export type ModelsCatalogDeps = {
  fetcher?: typeof fetch
  cacheFile?: string
  maxBytes?: number
  ttlMs?: number
  now?: () => number
}

async function readBodyBounded(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('models.dev 响应超出大小上限')
  }
  if (res.body === null) throw new Error('models.dev 响应没有内容')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('models.dev 响应超出大小上限')
      chunks.push(value)
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function fetchPayload(fetcher: typeof fetch, maxBytes: number, caller: AbortSignal | undefined): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('models.dev 请求超时')), FETCH_TIMEOUT_MS)
  const onAbort = () => controller.abort(caller?.reason)
  caller?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetcher(MODELS_DEV_URL, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`models.dev 返回 HTTP ${res.status}`)
    const body = await readBodyBounded(res, maxBytes)
    return JSON.parse(body) as unknown
  } finally {
    clearTimeout(timer)
    caller?.removeEventListener('abort', onAbort)
  }
}

function factsFromEntry(entry: unknown): CatalogFacts | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const record = entry as Record<string, unknown>
  const facts: CatalogFacts = {}
  const limit = record['limit']
  if (typeof limit === 'object' && limit !== null) {
    const context = (limit as Record<string, unknown>)['context']
    const output = (limit as Record<string, unknown>)['output']
    if (typeof context === 'number' && Number.isFinite(context) && context > 0) facts.contextWindow = context
    if (typeof output === 'number' && Number.isFinite(output) && output > 0) facts.maxTokens = output
  }
  const modalities = record['modalities']
  if (typeof modalities === 'object' && modalities !== null) {
    const input = (modalities as Record<string, unknown>)['input']
    if (Array.isArray(input)) {
      const kept = input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
      if (kept.length > 0) facts.input = kept
    }
  }
  const reasoning = record['reasoning']
  if (reasoning === false) {
    facts.reasoning = false
  } else if (reasoning === true) {
    const options = record['reasoning_options']
    if (!Array.isArray(options)) {
      facts.reasoning = { efforts: [...DEFAULT_EFFORTS], canDisable: true }
    } else {
      const effort = options.find((option) =>
        typeof option === 'object' && option !== null && (option as Record<string, unknown>)['type'] === 'effort')
      const values = effort === undefined ? undefined : (effort as Record<string, unknown>)['values']
      const efforts = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : []
      const canDisable = options.some((option) =>
        typeof option === 'object' && option !== null && (option as Record<string, unknown>)['type'] === 'toggle')
      facts.reasoning = { efforts: efforts.length > 0 ? efforts : [...DEFAULT_EFFORTS], canDisable }
    }
  }
  return facts
}

export function indexFromPayload(payload: unknown): CatalogIndex {
  const index: CatalogIndex = {}
  if (typeof payload !== 'object' || payload === null) return index
  for (const [providerId, providerEntry] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof providerEntry !== 'object' || providerEntry === null) continue
    const models = (providerEntry as Record<string, unknown>)['models']
    if (typeof models !== 'object' || models === null) continue
    const table: Record<string, CatalogFacts> = {}
    for (const [modelId, entry] of Object.entries(models as Record<string, unknown>)) {
      const facts = factsFromEntry(entry)
      if (facts !== undefined) table[modelId.toLowerCase()] = facts
    }
    index[providerId.toLowerCase()] = table
  }
  return index
}

function pickHit(hits: Array<{ provider: string; facts: CatalogFacts }>): CatalogFacts | undefined {
  if (hits.length === 0) return undefined
  for (const firstParty of FIRST_PARTY) {
    const hit = hits.find((entry) => entry.provider === firstParty)
    if (hit !== undefined) return hit.facts
  }
  const groups = new Map<string, Array<{ provider: string; facts: CatalogFacts }>>()
  for (const hit of hits) {
    const signature = `${hit.facts.contextWindow ?? ''},${hit.facts.maxTokens ?? ''}`
    const group = groups.get(signature)
    if (group === undefined) groups.set(signature, [hit])
    else group.push(hit)
  }
  const best = Math.max(...[...groups.values()].map((group) => group.length))
  const providers = [...groups.values()]
    .filter((group) => group.length === best)
    .flat()
    .map((hit) => hit.provider)
    .sort()
  return hits.find((hit) => hit.provider === providers[0])?.facts
}

/** Match one id inside the reduced index. Keys are lowercase; `provider` is the card's provider id. */
export function factsFor(index: CatalogIndex, provider: string | undefined, id: string): CatalogFacts | undefined {
  const key = id.toLowerCase()
  const slash = key.lastIndexOf('/')
  const stripped = slash >= 0 ? key.slice(slash + 1) : undefined
  if (provider !== undefined && provider !== '') {
    const scoped = index[provider.toLowerCase()]
    const direct = scoped?.[key] ?? (stripped === undefined ? undefined : scoped?.[stripped])
    // Provider 命中索引但名下没有该 id 时仍走全局匹配:自定义网关的
    // provider id 可能与上游 provider 重名(如自建网关叫 "openai")。
    if (direct !== undefined) return direct
  }
  const hits: Array<{ provider: string; facts: CatalogFacts }> = []
  for (const [providerId, models] of Object.entries(index)) {
    const facts = models[key]
    if (facts !== undefined) hits.push({ provider: providerId, facts })
  }
  if (hits.length > 0) return pickHit(hits)
  if (stripped === undefined) return undefined
  for (const [providerId, models] of Object.entries(index)) {
    const facts = models[stripped]
    if (facts !== undefined) hits.push({ provider: providerId, facts })
  }
  return pickHit(hits)
}

function badRequest(message: string): RpcResult<ModelsCatalogLookupValue> {
  return { ok: false, error: { code: 'bad-request', message, details: {} } }
}

export function createModelsCatalog(deps: ModelsCatalogDeps = {}) {
  const fetcher = deps.fetcher ?? globalThis.fetch
  const cacheFile = deps.cacheFile ?? join(resolveShellHome(), 'cache', 'dsh-editor', 'models-dev-index.json')
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS
  const now = deps.now ?? Date.now

  let memory: CachedEntry | undefined
  let cacheRead: Promise<CachedEntry | undefined> | undefined
  let refreshing: Promise<CachedEntry> | undefined
  let lastFailureAt: number | undefined
  let lastFailure: unknown

  const readDiskCache = async (): Promise<CachedEntry | undefined> => {
    try {
      const parsed = JSON.parse(await readFile(cacheFile, 'utf8')) as Partial<CacheRecord>
      if (typeof parsed.fetchedAt !== 'string' || typeof parsed.index !== 'object' || parsed.index === null) return undefined
      const fetchedAtMs = Date.parse(parsed.fetchedAt)
      if (!Number.isFinite(fetchedAtMs)) return undefined
      return { fetchedAt: parsed.fetchedAt, fetchedAtMs, index: parsed.index }
    } catch {
      return undefined
    }
  }

  const writeDiskCache = async (record: CacheRecord): Promise<void> => {
    try {
      await mkdir(dirname(cacheFile), { recursive: true })
      const temp = `${cacheFile}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify(record)}\n`, 'utf8')
      await rename(temp, cacheFile)
    } catch {
      /* Cache persistence is best-effort; the in-memory copy still serves. */
    }
  }

  const diskCache = (): Promise<CachedEntry | undefined> => cacheRead ??= readDiskCache()

  const refresh = (): Promise<CachedEntry> => refreshing ??= (async () => {
    try {
      const payload = await fetchPayload(fetcher, maxBytes, undefined)
      const index = indexFromPayload(payload)
      // 结构变了或拿到错误页时一个可用模型都解析不出来——按拉取失败处理,
      // 不覆盖内存与磁盘缓存,让 stale 回退或 network 错误生效。条目存在
      // 但一个字段都没解析出来(空 facts)同样不可用。
      const usable = Object.values(index).some((table) =>
        Object.values(table).some((facts) => Object.keys(facts).length > 0))
      if (!usable) throw new Error('models.dev payload contained no usable model entries')
      const record: CachedEntry = {
        fetchedAt: new Date(now()).toISOString(),
        fetchedAtMs: now(),
        index,
      }
      memory = record
      lastFailureAt = undefined
      lastFailure = undefined
      await writeDiskCache({ fetchedAt: record.fetchedAt, index: record.index })
      return record
    } finally {
      refreshing = undefined
    }
  })()

  const ensureIndex = async (): Promise<{ entry: CachedEntry; stale: boolean }> => {
    if (memory === undefined) memory = await diskCache()
    if (memory !== undefined && now() - memory.fetchedAtMs < ttlMs) return { entry: memory, stale: false }
    /* 刷新刚失败时,FETCH_TIMEOUT_MS 内不再打网络:批量采纳的后续
       批次会立刻拿到同一失败或 stale 缓存,而不是再叠一次 15s 超时。 */
    if (lastFailureAt !== undefined && now() - lastFailureAt < FETCH_TIMEOUT_MS) {
      if (memory !== undefined) return { entry: memory, stale: true }
      throw lastFailure
    }
    try {
      return { entry: await refresh(), stale: false }
    } catch (error) {
      lastFailureAt = now()
      lastFailure = error
      if (memory !== undefined) return { entry: memory, stale: true }
      throw error
    }
  }

  const handle = async (payload: unknown, signal?: AbortSignal): Promise<RpcResult<ModelsCatalogLookupValue>> => {
    if (typeof payload !== 'object' || payload === null) return badRequest('请求格式不正确')
    const request = payload as Record<string, unknown>
    const provider = request['provider']
    if (provider !== undefined && (typeof provider !== 'string' || provider.length > MAX_ID_LENGTH)) {
      return badRequest('provider 不合法')
    }
    const ids = request['ids']
    if (!Array.isArray(ids)) return badRequest('ids 必须是数组')
    const unique = new Set<string>()
    for (const id of ids) {
      if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) return badRequest('模型 id 不合法')
      unique.add(id)
    }
    if (unique.size > MAX_IDS) return badRequest('一次最多查询 200 个模型')
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    let indexed: { entry: CachedEntry; stale: boolean }
    try {
      indexed = await ensureIndex()
    } catch {
      return {
        ok: false,
        error: { code: 'network', message: '暂时无法连接 models.dev，请稍后重试或手动填写。', details: {} },
      }
    }
    const models: Record<string, CatalogFacts> = {}
    for (const id of unique) {
      const facts = factsFor(indexed.entry.index, provider as string | undefined, id)
      if (facts !== undefined) models[id] = facts
    }
    return { ok: true, value: { fetchedAt: indexed.entry.fetchedAt, stale: indexed.stale, models } }
  }

  return { handle }
}
