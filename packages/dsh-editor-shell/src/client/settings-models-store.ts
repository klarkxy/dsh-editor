/**
 * Models settings page store: pure logic shared by the editor and its tests.
 * Mirrors the wire/host semantics of the upstream `dsh-client-ui-settings-models`
 * package without pulling React or DOM concerns into the shell layer. The page
 * reads its data from the host's `settings.describe` and `llm.providers`
 * answers, joins them with `credentials.describe`, and lets the caller drive
 * edits through {@link pathOps} — the editor itself is responsible for owning
 * the keystroke buffer, this module only knows how to diff and validate.
 */
import type {
  ConfigurableProviderView,
  CredentialView,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '../dsh-compat.ts'

export function providerIdOf(entry: ConfigurableProviderView): string {
  const provider = entry['provider']
  if (typeof provider === 'string' && provider.length > 0) return provider
  const id = entry['id']
  return typeof id === 'string' && id.length > 0 ? id : 'provider'
}

/** Printable ASCII minus space: the same charset the host's key normalizer uses. */
export const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/**
 * A pasted `NAME=value` environment line. Upper-cased head keeps real `sk-` keys
 * out of the false positive, and `[^=]` after the `=` keeps base64 padding
 * (`ABCD==`) from looking like an assignment. Runs only at the keystroke
 * boundary — a key that legitimately takes this shape would be silently rejected
 * here, but every other layer rejects it too, so there is no path through.
 */
export const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

/** Whether a value is wrapped in one matching pair of quote characters. */
export function isQuoted(value: string): boolean {
  const first = value[0]
  if (first !== '"' && first !== "'" && first !== '`') return false
  return value.length > 1 && value.endsWith(first)
}

/**
 * Judge the key input's current value. An empty field is not a failure (the
 * card opens with it empty even when a key is stored, where it means keep the
 * stored one); a field of only whitespace IS a failure so typed input is never
 * silently dropped.
 */
export function apiKeyFailure(draft: string): 'keyBlank' | 'keyIllegalCharacters' | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'keyBlank'
  if (ENV_LINE.test(value) || isQuoted(value)) return 'keyIllegalCharacters'
  if (!LEGAL_API_KEY.test(value)) return 'keyIllegalCharacters'
  return undefined
}

/**
 * Derive the conventional credential reference for a provider route. The v1
 * page never asks for an environment-variable name, so a typed key stores
 * under this derived reference and the profile records it as `apiKeyEnv`.
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Subset of `ctx.settingsSchema` the store needs. The host owns the real
 * schemastery-backed implementation; tests pass a small in-memory walk so the
 * diff/validate logic stays decoupled from the schema runtime.
 */
export type SettingsSchemaOps = {
  /** Re-instantiate a `Schema` from a serialized `Schema.toJSON()` envelope. */
  rehydrate(serialized: unknown): unknown
  /** Read the descriptor at a path inside the rehydrated schema. */
  nodeAtPath(root: unknown, path: string[]): { type?: string; list?: unknown[] } | undefined
  /** Resolve a path against a settings layer (value/base/user). */
  getPath(value: unknown, path: string[]): unknown
  /** True when every segment of `path` is present in the given layer. */
  hasPath(value: unknown, path: string[]): boolean
}

/** One joined row the editor renders: provider entry + its settings address + its credential view. */
export type ProviderRow = {
  entry: ConfigurableProviderView
  configured: boolean
  removable: boolean
  apiKeyEnv: string | undefined
  credential: CredentialView | undefined
}

/** The credential reference a resolved profile names, or undefined when the profile has no `apiKeyEnv`. */
export function apiKeyEnvOf(
  namespace: SettingsNamespaceView | undefined,
  path: string[],
  schema: SettingsSchemaOps,
): string | undefined {
  if (namespace === undefined) return undefined
  const profile = schema.getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** The credential reference a row resolves keys through. */
export function refFor(
  namespace: SettingsNamespaceView | undefined,
  path: string[],
  provider: string,
  schema: SettingsSchemaOps,
): string {
  if (namespace !== undefined) {
    const named = apiKeyEnvOf(namespace, path, schema)
    if (named !== undefined) return named
  }
  return deriveKeyRef(provider)
}

/**
 * Join the provider directory, the settings namespace mirror, and the
 * referenced credentials into the rows the page renders. `namespaces` and
 * `credentials` are read by `settingsNs`/credential ref respectively; an
 * absent namespace marks the row unconfigured and an absent credential (after
 * a failed describe) is left undefined so the editor can show its own error.
 */
export function joinProviderRows(
  providers: ConfigurableProviderView[],
  namespaces: Map<string, SettingsNamespaceView>,
  credentials: Record<string, CredentialView>,
  schema: SettingsSchemaOps,
): ProviderRow[] {
  return providers.map((entry) => {
    const namespace = namespaces.get(entry.settingsNs)
    const apiKeyEnv = apiKeyEnvOf(namespace, entry.settingsPath, schema)
    const ref = apiKeyEnv ?? deriveKeyRef(providerIdOf(entry))
    return {
      entry,
      configured:
        namespace !== undefined &&
        (entry.settingsPath.length === 0 || schema.getPath(namespace.value, entry.settingsPath) !== undefined),
      removable:
        namespace !== undefined &&
        entry.settingsPath.length > 0 &&
        schema.hasPath(namespace.user, entry.settingsPath) &&
        !schema.hasPath(namespace.base, entry.settingsPath),
      apiKeyEnv,
      credential: credentials[ref],
    }
  })
}

/**
 * The DeepSeek account provider row: sign-in goes through the host's
 * `remote.account` namespace (browser PKCE), not an API-key editor. The row
 * carries no credential reference; `AccountPresence` is the live answer the
 * account stream reported, `undefined` when the remote is unavailable or has
 * not answered yet.
 */
export const ACCOUNT_PROVIDER = 'deepseek-account'

export function isAccountRow(row: ProviderRow): boolean {
  return providerIdOf(row.entry) === ACCOUNT_PROVIDER
}

export type AccountPresence = 'signed-in' | 'signed-out' | undefined

/** Whether a row can serve model requests as it stands. */
export function providerUsable(row: ProviderRow, account?: AccountPresence): boolean {
  if (isAccountRow(row)) return row.entry.active !== false && account === 'signed-in'
  if (row.entry.active === false) return false
  if (row.apiKeyEnv === undefined) return true
  return row.credential?.configured === true
}

/** The status dot a row shows next to its name: configured, missing, or no dot. */
export function credentialDot(row: ProviderRow, account?: AccountPresence): 'configured' | 'missing' | null {
  if (isAccountRow(row)) {
    if (account === 'signed-in') return 'configured'
    if (account === 'signed-out') return 'missing'
    return null
  }
  if (row.credential?.configured === true) return 'configured'
  if (row.apiKeyEnv !== undefined && row.credential?.configured === false) return 'missing'
  return null
}

/* Whether a row is the first-run setup posture: the only existing row whose
   empty settingsPath is the whole section, and only while no other row can
   already serve requests. The account row never takes the API-key setup card. */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (isAccountRow(row)) return false
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

/** Rows the "add" picker offers: not yet configured, and addressing a known namespace. */
export function addableRows(rows: ProviderRow[]): ProviderRow[] {
  return rows.filter((row) => !row.configured && row.entry.settingsNs !== '')
}

/**
 * The editor layout the owning namespace selects. `llm-deepseek` uses the
 * curated model-catalog editor; `llm-pi-ai` uses the protocol/route editor;
 * anything else is a third-party namespace the page does not own.
 */
export function layoutOf(ns: string): 'deepseek' | 'pi-ai' | 'unknown' {
  if (ns === 'llm-deepseek') return 'deepseek'
  if (ns === 'llm-pi-ai') return 'pi-ai'
  return 'unknown'
}

/**
 * Any route key walks a dict schema to the same profile node, so the lookup
 * names one that cannot collide with a configured route. The choices come
 * from the namespace's own schema so they cannot drift from the ones the
 * adapter actually accepts.
 */
export const PROBE_ROUTE = '\0probe'

export function protocolChoices(namespace: SettingsNamespaceView | undefined, schema: SettingsSchemaOps): string[] {
  if (namespace === undefined) return []
  const list = schema.nodeAtPath(schema.rehydrate(namespace.schema), ['providers', PROBE_ROUTE, 'api'])
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list
    .map((entry) => (entry as { value?: unknown } | null | undefined)?.value)
    .filter((value): value is string => typeof value === 'string')
}

/**
 * The minimal path ops carrying `after` over `before`, both as the card sees
 * them. Only keys the card observed are named; fields absent from both sides
 * produce no op, which is why edits are path-addressed rather than a rebuilt
 * section.
 */
export function pathOps(base: string[], before: unknown, after: Record<string, unknown>): SettingsPathOpView[] {
  const previous =
    typeof before === 'object' && before !== null && !Array.isArray(before) ? (before as Record<string, unknown>) : {}
  const ops: SettingsPathOpView[] = []
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    ops.push({ op: 'set', path: [...base, key], value })
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] })
  }
  return ops
}

/** One model row as the catalog editor carries it; loosely typed because the wire does not constrain it. */
export type ModelDraft = {
  id?: unknown
  name?: unknown
  contextWindow?: unknown
  maxTokens?: unknown
}

/*
 * 思考强度档位:host(pi-ai)允许手工声明的模型携带 reasoningEfforts
 * —— 键是可选择的档位,值是发给端点的线协议拼写,只有 off 可以留空
 * (不思考 = 不带参数)。编辑器与聊天面板的兜底共用这套约定俗成的
 * 六档;不认识的参数由上游端点自行忽略。用户在设置文档里手写的其它
 * 拼写标记为 custom,界面只读不覆盖。
 */
export const STANDARD_REASONING_EFFORTS: Readonly<Record<string, string | null>> = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

export type ReasoningChoice = 'off' | 'standard' | 'custom'

/** Classify one model draft's reasoningEfforts for the editor select. */
export function reasoningChoiceOf(model: Record<string, unknown>): ReasoningChoice {
  const value = model['reasoningEfforts']
  if (value === undefined || value === false) return 'off'
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'custom'
  const entries = Object.entries(value)
  const standard = Object.entries(STANDARD_REASONING_EFFORTS)
  return entries.length === standard.length && standard.every(([key, wire]) => (value as Record<string, unknown>)[key] === wire)
    ? 'standard'
    : 'custom'
}

/** The reasoningEfforts value a choice writes; `undefined` clears the field (patch() deletes undefined keys). */
export function reasoningEffortsFor(choice: ReasoningChoice): Record<string, string | null> | undefined {
  return choice === 'standard' ? { ...STANDARD_REASONING_EFFORTS } : undefined
}

/*
 * models.dev 自动补全：CatalogFacts 是 `models.catalog.lookup` 应答的精简形状
 * （宿主侧定义见 ../models-catalog.ts）。补全只填空字段，字段名按提供方族
 * 映射——pi-ai 的模型条目用 `input` / `reasoningEfforts`，llm-deepseek 的
 * `DeepSeekCatalogModel` 用 `inputModalities`（schema 含 contextWindow 与
 * maxTokens，已对照 rc.5 制品核实），其它命名空间的模型 schema 未知，只补
 * 容量两个公共字段。
 */
export type ModelFamily = 'pi-ai' | 'deepseek' | 'other'

export type CatalogFacts = {
  contextWindow?: number
  maxTokens?: number
  input?: ('text' | 'image')[]
  reasoning?: false | { efforts: string[]; canDisable: boolean }
}

export function inputFieldFor(family: ModelFamily): 'input' | 'inputModalities' | undefined {
  if (family === 'pi-ai') return 'input'
  if (family === 'deepseek') return 'inputModalities'
  return undefined
}

/** Gemini 只接受四档推理等级；其余档位的 Effort 值会让请求失败。 */
export const GEMINI_REASONING_EFFORTS: ReadonlySet<string> = new Set(['minimal', 'low', 'medium', 'high'])

/* pi-ai 模型条目 reasoningEfforts 的合法键——rc.5 制品
   `dsh-llm-pi-ai/lib/index.js` 的 THINKING_LEVELS(off | minimal | low |
   medium | high | xhigh | max)去掉 off;off 是禁用槽,不算 effort 等级。
   宿主 schema 是 z.dict(string|null, union(THINKING_LEVELS)),键必须在
   集合内,值是线协议拼写(只有 off 可以是 null)。 */
export const REASONING_EFFORT_KEYS: ReadonlySet<string> = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/**
 * The reasoningEfforts map a catalog `reasoning` fact writes. `false` writes
 * nothing: an empty field already renders as the un-declared state. models.dev
 * 的 `none` 表示该模型可以关掉思考,写成 `off: 'none'`;其余值只在本身
 * 是合法键时才写成 key:value,不认识的丢弃。有 toggle 而没有 none 才写
 * `off: null`;既有 toggle 又有 none 时以 `off: 'none'` 为准。过滤后没有
 * 任何非 off 档位时整个字段不写——宿主拒绝只有 off 的 reasoningEfforts。
 */
export function reasoningEffortsFromCatalog(
  api: string | undefined,
  reasoning: { efforts: string[]; canDisable: boolean } | undefined,
): Record<string, string | null> | undefined {
  if (reasoning === undefined) return undefined
  const efforts = api === 'google-generative-ai'
    ? reasoning.efforts.filter((effort) => GEMINI_REASONING_EFFORTS.has(effort))
    : reasoning.efforts
  const levels = efforts.filter((effort) => effort !== 'none' && REASONING_EFFORT_KEYS.has(effort))
  if (levels.length === 0) return undefined
  const map: Record<string, string | null> = {}
  if (efforts.includes('none')) map['off'] = 'none'
  else if (reasoning.canDisable) map['off'] = null
  for (const level of levels) map[level] = level
  return map
}

export type CatalogField = 'context' | 'max' | 'input' | 'reasoning'

/**
 * The draft patch one catalog fact contributes to a model row. Only empty
 * fields are patched — a value the author or discovery already set always
 * wins — and every write still lands in the draft until the card is saved.
 */
export function catalogFill(
  model: Record<string, unknown>,
  family: ModelFamily,
  api: string | undefined,
  facts: CatalogFacts,
): { patch: Record<string, unknown>; fields: CatalogField[] } {
  const patch: Record<string, unknown> = {}
  const fields: CatalogField[] = []
  if (facts.contextWindow !== undefined && model['contextWindow'] === undefined) {
    patch['contextWindow'] = facts.contextWindow
    fields.push('context')
  }
  if (facts.maxTokens !== undefined && model['maxTokens'] === undefined) {
    patch['maxTokens'] = facts.maxTokens
    fields.push('max')
  }
  const inputKey = inputFieldFor(family)
  if (inputKey !== undefined && facts.input !== undefined && model[inputKey] === undefined) {
    patch[inputKey] = [...facts.input]
    fields.push('input')
  }
  if (family === 'pi-ai' && model['reasoningEfforts'] === undefined && facts.reasoning !== undefined && facts.reasoning !== false) {
    const efforts = reasoningEffortsFromCatalog(api, facts.reasoning)
    if (efforts !== undefined) {
      patch['reasoningEfforts'] = efforts
      fields.push('reasoning')
    }
  }
  return { patch, fields }
}

/** Convert a schema-validated catalog value into records without dropping hidden fields. */
export function modelDrafts(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {},
  )
}

/** One validation failure: the offending row's index and the i18n key to surface. */
export type ModelFailure = {
  index: number
  key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid' | 'modelMaxTokensInvalid'
}

/**
 * Validate the constraints the serialized schema cannot express: required id,
 * unique id, and the numeric fields being positive integers. The first
 * offending row wins, in declaration order, so the editor can scroll the user
 * to it.
 */
export function validateModels(value: unknown): ModelFailure | undefined {
  if (value === undefined) return undefined
  const models = modelDrafts(value)
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    const id = model['id']
    const trimmed = typeof id === 'string' ? id.trim() : undefined
    if (trimmed === undefined || trimmed.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(trimmed)) return { index, key: 'modelIdDuplicate' }
    seen.add(trimmed)
    const name = model['name']
    if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    const contextWindow = model['contextWindow']
    if (contextWindow !== undefined && (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return { index, key: 'modelContextInvalid' }
    }
    const maxTokens = model['maxTokens']
    if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
  }
  return undefined
}

/**
 * A route id usable as a settings key AND as the stem of a credential name.
 * `deriveKeyRef` upper-cases the id and replaces every non-alphanumeric run
 * with `_`, and a credential reference is a POSIX shell identifier, which
 * cannot start with a digit. A digit-leading id would pass every check this
 * card makes and then fail at the credential seam with a regex the user
 * cannot act on.
 */
export const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Judge the route id input's current value. Empty is not a failure (the user
 * has not started typing); once non-empty, must match the pattern and must
 * not collide with an already-configured route.
 */
export function routeFailure(route: string, taken: string[]): 'routeInvalid' | 'routeTaken' | undefined {
  if (route.length === 0) return undefined
  if (!ROUTE_PATTERN.test(route)) return 'routeInvalid'
  if (taken.includes(route)) return 'routeTaken'
  return undefined
}

/* ── 添加接口卡片用的纯逻辑：URL 规范化、路由/名称推导、失败分类 ── */

/* 常见兼容网关会把「接口路径」当 Base URL 贴出来；发现请求自己会再拼这些
   后缀,所以录入时把结尾的调用路径剥掉,只留真正的 Base URL。 */
const LISTING_PATH_SUFFIXES = ['/chat/completions', '/completions', '/responses', '/messages', '/models']

/**
 * Whether a hostname sits on the local network: `localhost`, `*.localhost`,
 * `*.local`, single-label hosts, the IPv6 loopback and the private IPv4
 * ranges (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16).
 */
export function isLocalNetworkHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === '' || host === '::1') return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (ip !== null) {
    const a = Number(ip[1])
    const b = Number(ip[2])
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  return !host.includes('.')
}

/**
 * Only loopback hosts (`localhost`, `*.localhost`, `127/8`, `::1`) auto-default
 * schemeless inputs to plaintext `http://`. Non-loopback LAN addresses default
 * to `https://` unless the caller explicitly specifies `http://`.
 */
export function isLoopbackHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1' || host === '0000:0000:0000:0000:0000:0000:0000:0001') return true
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ip !== null) {
    const octets = [Number(ip[1]), Number(ip[2]), Number(ip[3]), Number(ip[4])]
    return octets[0] === 127 && octets.every((octet) => octet >= 0 && octet <= 255)
  }
  return false
}

function isValidIpv6Literal(candidate: string): boolean {
  if (!candidate.includes(':')) return false
  try {
    const parsed = new URL(`http://[${candidate}]`)
    return parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
  } catch {
    return false
  }
}

/* 没写协议时从输入开头还原主机名并按需为裸 IPv6 补方括号:`host:port/path`、
   `[v6]:port`、`::1/v1` 和 `::1:11434/v1` 都可安全交给 URL 解析与 isLoopbackHost。 */
function parseSchemelessAuthority(url: string): { host: string; authorityWithRest: string } {
  const sep = url.search(/[/?#]/)
  const head = sep === -1 ? url : url.slice(0, sep)
  const rest = sep === -1 ? '' : url.slice(sep)
  if (head.startsWith('[')) {
    const end = head.indexOf(']')
    return { host: end === -1 ? head.slice(1) : head.slice(1, end), authorityWithRest: url }
  }
  const first = head.indexOf(':')
  if (first === -1) return { host: head, authorityWithRest: url }
  const second = head.indexOf(':', first + 1)
  if (second === -1) return { host: head.slice(0, first), authorityWithRest: url }
  const last = head.lastIndexOf(':')
  const addr = head.slice(0, last)
  const port = head.slice(last + 1)
  if (/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535 && isValidIpv6Literal(addr) && isLoopbackHost(addr)) {
    return { host: addr, authorityWithRest: `[${addr}]:${port}${rest}` }
  }
  if (isValidIpv6Literal(head)) return { host: head, authorityWithRest: `[${head}]${rest}` }
  if (/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535 && isValidIpv6Literal(addr)) {
    return { host: addr, authorityWithRest: `[${addr}]:${port}${rest}` }
  }
  return { host: head, authorityWithRest: url }
}

/**
 * The Base URL a typed/pasted value denotes. When the scheme is missing it
 * adds `http://` only for loopback hosts (see isLoopbackHost) and `https://`
 * otherwise, wraps schemeless bare IPv6 literals in brackets, drops trailing
 * slashes, and repeatedly strips a trailing API call path
 * (`/v1/chat/completions` → `/v1`; for `anthropic-messages`, also strips
 * trailing `/v1` since the upstream Anthropic client appends `/v1/messages`).
 * Query strings are left alone.
 */
export function normalizeBaseURL(raw: string, protocol?: string): string {
  let url = raw.trim()
  if (url === '') return ''
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    if (url.startsWith('/')) return ''
    const { host, authorityWithRest } = parseSchemelessAuthority(url)
    url = `${isLoopbackHost(host) ? 'http' : 'https'}://${authorityWithRest}`
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url.replace(/\/+$/, '')
  }
  if (!parsed.host) return url.replace(/\/+$/, '')
  let pathname = parsed.pathname.replace(/\/+$/, '')
  for (;;) {
    const lower = pathname.toLowerCase()
    const suffix = LISTING_PATH_SUFFIXES.find((tail) => lower.endsWith(tail))
    if (suffix === undefined) break
    pathname = pathname.slice(0, pathname.length - suffix.length).replace(/\/+$/, '')
  }
  if (protocol === 'anthropic-messages' && pathname.toLowerCase().endsWith('/v1')) {
    pathname = pathname.slice(0, pathname.length - '/v1'.length).replace(/\/+$/, '')
  }
  return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`
}

/**
 * Synchronous endpoint URL validity shared between Connect and Save so manual
 * model mode cannot submit empty, non-HTTP(S), or hostless URLs.
 */
export function isValidEndpointBaseURL(raw: string, protocol?: string): boolean {
  const normalized = normalizeBaseURL(raw, protocol)
  if (normalized === '') return false
  try {
    const parsed = new URL(normalized)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.trim() !== ''
  } catch {
    return false
  }
}

/* 第二级公共后缀:域名像 foo.example.com.cn 时,路由取 example 而不是 com。 */
const SECOND_LEVEL_TLDS: ReadonlySet<string> = new Set(['com', 'co', 'net', 'org', 'ac', 'gov', 'edu'])

/* IPv4 字面量、IPv6(hostname 带冒号)和单段主机名都按本地服务算。 */
function localHostname(hostname: string): boolean {
  return hostname === '' || hostname.includes(':') || !hostname.includes('.') || /^\d+(\.\d+){3}$/.test(hostname)
}

/* 剥掉顶级域和常见的第二级公共后缀后剩下的最后一段。 */
function hostBaseLabel(hostname: string): string {
  const labels = hostname.split('.')
  labels.pop()
  if (labels.length >= 2 && SECOND_LEVEL_TLDS.has(labels[labels.length - 1]!)) labels.pop()
  return labels[labels.length - 1] ?? ''
}

/* 路由 id 必须同时是合法的设置键和凭据名前缀(见 ROUTE_PATTERN 的注释)。 */
function sanitizeRouteLabel(label: string): string {
  const cleaned = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (cleaned === '') return 'custom'
  return /^[a-z]/.test(cleaned) ? cleaned : `p-${cleaned}`
}

/**
 * The route a new provider gets from its Base URL: the host's base label
 * (api.moonshot.cn → moonshot, open.bigmodel.cn → bigmodel), `local` for IP
 * literals and single-label hosts, `custom` when nothing can be derived.
 * Collisions with `taken` resolve by appending -2, -3, …
 */
export function deriveRoute(baseURL: string, taken: string[]): string {
  let base = 'custom'
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase()
    base = localHostname(hostname) ? 'local' : sanitizeRouteLabel(hostBaseLabel(hostname))
  } catch { /* unparseable input keeps the custom base */ }
  let route = base
  for (let n = 2; taken.includes(route); n += 1) route = `${base}-${n}`
  return route
}

/**
 * The display name prefilled for a new provider: the capitalized host label
 * (api.moonshot.cn → Moonshot). Returns undefined for local and IP hosts —
 * a raw `host:port` is no friendlier name, so callers should substitute a
 * localized service label instead.
 */
export function deriveDisplayName(baseURL: string): string | undefined {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    return 'Custom'
  }
  const hostname = url.hostname.toLowerCase()
  if (localHostname(hostname)) return undefined
  const base = hostBaseLabel(hostname)
  if (base === '') return url.host
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/* 兼容 OpenAI/Anthropic 的客户端没有密钥就拒绝发请求,而免密钥的服务(常见
   于本机网关)会忽略这份值;作者留空密钥时写入占位串,让这类服务也能直接
   对话。 */
export const NO_KEY_PLACEHOLDER = 'no-key'

export type DiscoveryFailureKind = 'key' | 'address' | 'network' | 'unsupported' | 'other'

/**
 * Classify a `discoverModels` failure by the pi-ai adapter's upstream
 * LlmError wording (src/discovery.ts in dsh-llm-pi-ai) so the card can show
 * an actionable message instead of the wire text. The RPC may wrap or drop
 * the upstream code, so both `code` and `message` are consulted.
 */
export function discoveryFailureKind(message: string, code?: string): DiscoveryFailureKind {
  if (code === 'INVALID_CREDENTIAL'
    || /answered 401|answered 403|check the API key|API key is blank|characters no HTTP header can carry/i.test(message)) {
    return 'key'
  }
  if (code === 'DISCOVERY_UNSUPPORTED' || /has no model listing this build can read/.test(message)) return 'unsupported'
  if (/answered 404|did not answer with JSON|neither a "data" array|has no "models" array/.test(message)) return 'address'
  if (/could not reach/.test(message)) return 'network'
  return 'other'
}

/** Split a pasted model-id list on commas, whitespace and CJK separators, deduped in order. */
export function parseModelIds(text: string): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const part of text.split(/[\s,，、]+/)) {
    const id = part.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** Most compatible gateways speak openai-completions; it lists first without reordering the rest. */
export function protocolOrder(protocols: string[]): string[] {
  if (!protocols.includes('openai-completions')) return [...protocols]
  return ['openai-completions', ...protocols.filter((value) => value !== 'openai-completions')]
}
