import type { Context } from '@deepseek-ai/cordis'
import {
  createElement as e,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ZHIHU_CREDENTIAL_REF, ZHIHU_RPC_CHANNEL, type ZhihuRpcResult } from './contracts.ts'
import { createZhihuClientState, type ZhihuClientState } from './client-state.ts'
import { zhihuClientStyles } from './client-styles.ts'

export const name = 'dsh-zhihu-client'
export const inject = ['slots', 'connection', 'remote', 'remote.credentials'] as const

const SLOT_ID = 'zhihu'
const SLOT_ORDER = 120
const SLOT_LABEL = '知乎资料'

type RpcCaller = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
}

/** Wire view of one credential reference (structurally value-free). */
type CredentialView = { configured: boolean; source?: string; writable: boolean }

type CredentialsApi = {
  describe: (request: { refs: string[] }) => Promise<ZhihuRpcResult<{ credentials: Record<string, CredentialView> }>>
  set: (request: { ref: string; value: string }) => Promise<ZhihuRpcResult<Record<string, never>>>
  unset: (request: { ref: string }) => Promise<ZhihuRpcResult<Record<string, never>>>
}

type SlotHandle = {
  inject: (key: string, callback: () => unknown) => unknown
  register: (spec: { name: string; id?: string; order?: number; label?: string }, render: unknown) => unknown
}

type RemoteCredentials = {
  describe(refs: string[]): Promise<ZhihuRpcResult<Record<string, CredentialView>>>
  set(ref: string, value: string): Promise<ZhihuRpcResult<void | Record<string, never>>>
  unset(ref: string): Promise<ZhihuRpcResult<void | Record<string, never>>>
}

type ZhihuClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
  remote: { credentials: RemoteCredentials }
}

function wrapCredentials(remote: RemoteCredentials): CredentialsApi {
  return {
    async describe({ refs }) {
      const result = await remote.describe(refs)
      if (!result.ok) return result
      return { ok: true, value: { credentials: result.value } }
    },
    set: ({ ref, value }) => remote.set(ref, value) as Promise<ZhihuRpcResult<Record<string, never>>>,
    unset: ({ ref }) => remote.unset(ref) as Promise<ZhihuRpcResult<Record<string, never>>>,
  }
}

const ZHIHU_CONSOLE_URL = 'https://developer.zhihu.com'
const KB_MANAGE_URL = 'https://zhida.zhihu.com/repositories/square'

function injectStyles(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  const style = document.createElement('style')
  style.setAttribute('data-dsh-zhihu-styles', '')
  style.textContent = zhihuClientStyles
  document.head.appendChild(style)
  return style
}

/** Only http(s) links may render as anchors; anything else degrades to text. */
function safeUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null
}

type Failure = { kind: 'credential' | 'network' | 'request'; text: string }

/** Credential absence and transport failure read differently from a plain bad request. */
function failureOf(code: string, message: string): Failure {
  if (code === 'token-missing') {
    return { kind: 'credential', text: '未配置知乎 Access Token 或凭证不可用，请到「设置」页完成配置。' }
  }
  return { kind: 'request', text: `请求失败：${message}` }
}

function networkFailure(cause: unknown): Failure {
  return { kind: 'network', text: `网络或连接失败：${cause instanceof Error ? cause.message : String(cause)}` }
}

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

type Mode = 'search' | 'global' | 'hot' | 'knowledge' | 'ask'

const MODE_LABEL: Record<Mode, string> = {
  search: '站内搜索',
  global: '全网搜索',
  hot: '知乎热榜',
  knowledge: '知识库检索',
  ask: '直答',
}

const MODE_ENDPOINT: Record<Mode, string> = {
  search: 'search',
  global: 'global.search',
  hot: 'hot.list',
  knowledge: 'knowledge.search',
  ask: 'ask',
}

// Mirrors ZHIHU_ASK_MODELS in ./operations.ts; the backend validates the value
// and falls back to its own default when the model is unknown.
const ASK_MODELS = [
  { value: 'zhida-thinking-1p5', label: '思考' },
  { value: 'zhida-fast-1p5', label: '快速' },
  { value: 'zhida-agent', label: '智能体' },
] as const
type AskModel = (typeof ASK_MODELS)[number]['value']

const SCOPE_OPTIONS = [
  { value: 'public', label: '公开库' },
  { value: 'personal', label: '个人库' },
  { value: 'subscription', label: '订阅库' },
] as const
type RecallScope = (typeof SCOPE_OPTIONS)[number]['value']

type SearchItem = {
  title: string
  type: string
  url: string
  summary: string
  votes: number
  comments: number
  author: string
  editTime: string
}

type HotItem = { title: string; url: string; summary: string }
type KnowledgeItem = { docName: string; originUrl: string; snippets: string[] }
type AskAnswer = { query: string; model: string; content: string; reasoning: string }

type SearchOutcome =
  | { mode: 'search' | 'global'; items: SearchItem[]; emptyReason?: string }
  | { mode: 'hot'; items: HotItem[] }
  | { mode: 'knowledge'; items: KnowledgeItem[] }
  | { mode: 'ask'; answer: AskAnswer }

function objectItems(value: unknown): Record<string, unknown>[] | null {
  if (typeof value !== 'object' || value === null) return null
  const items = (value as { items?: unknown }).items
  if (!Array.isArray(items)) return null
  return items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function parseOutcome(mode: Mode, value: unknown): SearchOutcome | null {
  if (mode === 'ask') {
    if (typeof value !== 'object' || value === null) return null
    const row = value as Record<string, unknown>
    if (typeof row.content !== 'string') return null
    return {
      mode: 'ask',
      answer: {
        query: text(row.query),
        model: text(row.model),
        content: row.content,
        reasoning: text(row.reasoning),
      },
    }
  }
  const items = objectItems(value)
  if (items === null) return null
  if (mode === 'hot') {
    return {
      mode: 'hot',
      items: items.map((item) => ({ title: text(item.title, '(无标题)'), url: text(item.url), summary: text(item.summary) })),
    }
  }
  if (mode === 'knowledge') {
    return {
      mode: 'knowledge',
      items: items.map((item) => ({
        docName: text(item.docName, '(未命名文档)'),
        originUrl: text(item.originUrl),
        snippets: Array.isArray(item.snippets) ? item.snippets.filter((s): s is string => typeof s === 'string') : [],
      })),
    }
  }
  const emptyReason = typeof (value as { emptyReason?: unknown }).emptyReason === 'string'
    ? (value as { emptyReason: string }).emptyReason
    : undefined
  return {
    mode,
    emptyReason,
    items: items.map((item) => ({
      title: text(item.title, '(无标题)'),
      type: text(item.type, '内容'),
      url: text(item.url),
      summary: text(item.summary),
      votes: typeof item.votes === 'number' ? item.votes : 0,
      comments: typeof item.comments === 'number' ? item.comments : 0,
      author: text(item.author, '匿名'),
      editTime: text(item.editTime),
    })),
  }
}

function LinkOrText(props: { url: string; label: string; className?: string }): ReactNode {
  const url = safeUrl(props.url)
  if (!url) return e('span', { className: props.className }, props.label)
  return e('a', { className: props.className ?? 'zhihu-link', href: url, target: '_blank', rel: 'noreferrer' }, props.label)
}

function OutcomeView(props: { outcome: SearchOutcome; stale: boolean }): ReactNode {
  const { outcome, stale } = props
  let body: ReactNode = null
  let summary = ''
  if (outcome.mode === 'ask') {
    summary = `直答（${outcome.answer.model || '默认模型'}）`
    body = e('div', null,
      outcome.answer.reasoning
        ? e('details', { className: 'zhihu-ask-reasoning' },
          e('summary', null, '思考过程'),
          e('p', null, outcome.answer.reasoning),
        )
        : null,
      e('p', { className: 'zhihu-ask-content' }, outcome.answer.content),
    )
  } else if (outcome.items.length === 0) {
    const reason = outcome.mode === 'search' || outcome.mode === 'global' ? outcome.emptyReason : undefined
    return e('div', { 'data-testid': 'zhihu-results', className: 'zhihu-results' },
      stale ? e('div', { className: 'zhihu-stale', role: 'status' }, '查询已变化，以下内容对应旧查询，请重新搜索。') : null,
      e('p', { className: 'zhihu-results-summary' }, `未找到相关结果${reason ? `（${reason}）` : ''}。`),
    )
  } else if (outcome.mode === 'knowledge') {
    summary = `知识库检索共 ${outcome.items.length} 条`
    body = e('ul', { className: 'zhihu-result-list' },
      outcome.items.map((item, index) => e('li', { key: `${item.docName}:${index}`, className: 'zhihu-result-item' },
        e('span', { className: 'zhihu-result-title' }, item.docName),
        item.originUrl && safeUrl(item.originUrl)
          ? e(LinkOrText, { url: item.originUrl, label: item.originUrl })
          : null,
        ...item.snippets.map((snippet, snippetIndex) =>
          e('span', { key: snippetIndex, className: 'zhihu-result-snippet' }, snippet)),
      )),
    )
  } else if (outcome.mode === 'hot') {
    summary = `知乎热榜共 ${outcome.items.length} 条`
    body = e('ul', { className: 'zhihu-result-list' },
      outcome.items.map((item, index) => e('li', { key: `${index}`, className: 'zhihu-result-item' },
        e(LinkOrText, { url: item.url, label: item.title, className: 'zhihu-result-title zhihu-link' }),
        item.summary ? e('span', { className: 'zhihu-result-summary' }, item.summary) : null,
      )),
    )
  } else {
    summary = `${MODE_LABEL[outcome.mode]}共 ${outcome.items.length} 条`
    body = e('ul', { className: 'zhihu-result-list' },
      outcome.items.map((item, index) => e('li', { key: `${item.title}:${index}`, className: 'zhihu-result-item' },
        e(LinkOrText, { url: item.url, label: item.title, className: 'zhihu-result-title zhihu-link' }),
        e('span', { className: 'zhihu-result-meta' },
          `类型：${item.type}　作者：${item.author}　赞同 ${item.votes}　评论 ${item.comments}${item.editTime ? `　时间：${item.editTime}` : ''}`),
        item.summary ? e('span', { className: 'zhihu-result-summary' }, item.summary) : null,
      )),
    )
  }
  return e('div', { 'data-testid': 'zhihu-results', className: 'zhihu-results' },
    stale ? e('div', { className: 'zhihu-stale', role: 'status' }, '查询已变化，以下内容对应旧查询，请重新搜索。') : null,
    e('p', { className: 'zhihu-results-summary', 'aria-live': 'polite' }, summary),
    body,
  )
}

// ---------------------------------------------------------------------------
// 设置（凭证）
// ---------------------------------------------------------------------------

const LEGAL_API_KEY = /^[\x21-\x7E]+$/
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

function keyFailure(draft: string): 'blank' | 'illegal' | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'blank'
  if (ENV_LINE.test(value) || !LEGAL_API_KEY.test(value)) return 'illegal'
  return undefined
}

type CredentialLoad =
  | { status: 'loading' }
  | { status: 'ready'; credential: CredentialView | undefined }
  | { status: 'error'; error: string }

/**
 * Track mount lifetime so late resolves after tab change/close never touch
 * state. Setup re-marks alive so StrictMode effect replay (mount → cleanup →
 * setup) does not leave the flag stuck at false. Used only where the callee
 * (the credentials API) takes no AbortSignal — sections whose rpc.call accepts
 * a signal use a per-section gate instead.
 */
function useAlive() {
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  return alive
}

function SettingsSection(props: { credentials: CredentialsApi }): ReactNode {
  const { credentials } = props
  const alive = useAlive()
  const [state, setState] = useState<CredentialLoad>({ status: 'loading' })
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)

  const load = useCallback(async (): Promise<void> => {
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }))
    try {
      const result = await credentials.describe({ refs: [ZHIHU_CREDENTIAL_REF] })
      if (!alive.current) return
      if (!result.ok) { setState({ status: 'error', error: result.error.message }); return }
      setState({ status: 'ready', credential: result.value.credentials[ZHIHU_CREDENTIAL_REF] })
    } catch (cause) {
      if (!alive.current) return
      setState({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [credentials, alive])

  useEffect(() => { void load() }, [load])

  if (state.status === 'loading') {
    return e('section', { 'data-testid': 'zhihu-settings', 'aria-label': '知乎凭证设置' },
      e('p', { className: 'zhihu-status', role: 'status' }, '正在读取凭证状态…'),
    )
  }

  if (state.status === 'error') {
    return e('section', { 'data-testid': 'zhihu-settings', 'aria-label': '知乎凭证设置' },
      e('p', { className: 'zhihu-error', role: 'alert' },
        `读取失败：${state.error} `,
        e('button', { type: 'button', className: 'zhihu-button', onClick: () => void load() }, '重试'),
      ),
    )
  }

  const credential = state.credential
  const keyLocked = credential?.writable === false
  const configured = credential?.configured === true
  const draftFailure = keyFailure(keyDraft)
  const keyValue = keyDraft.trim()

  const statusText = keyLocked
    ? '由环境变量提供（只读）'
    : configured
      ? `已保存${credential?.source ? `（来源：${credential.source}）` : ''}`
      : '未配置'
  const dotClass = keyLocked
    ? 'zhihu-dot zhihu-dot-locked'
    : configured
      ? 'zhihu-dot zhihu-dot-configured'
      : 'zhihu-dot zhihu-dot-missing'
  const placeholder = keyLocked
    ? '由环境变量提供，无法在界面修改'
    : configured
      ? '已保存，输入新密钥可覆盖'
      : '粘贴知乎开放平台 Access Secret'

  const save = async (): Promise<void> => {
    if (keyLocked || draftFailure !== undefined || keyValue.length === 0 || busy) return
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await credentials.set({ ref: ZHIHU_CREDENTIAL_REF, value: keyValue })
      if (!alive.current) return
      if (!result.ok) { setFailure(result.error.message); return }
      setKeyDraft('')
      setNote('已保存。')
      await load()
    } catch (cause) {
      if (!alive.current) return
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    if (keyLocked || !configured || busy) return
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await credentials.unset({ ref: ZHIHU_CREDENTIAL_REF })
      if (!alive.current) return
      if (!result.ok) { setFailure(result.error.message); return }
      setKeyDraft('')
      setNote('已清除。')
      await load()
    } catch (cause) {
      if (!alive.current) return
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return e('section', { 'data-testid': 'zhihu-settings', 'aria-label': '知乎凭证设置' },
    configured ? null : e('div', { className: 'zhihu-guide' },
      e('h3', { className: 'zhihu-guide-title' }, '获取 Access Secret'),
      e('ol', { className: 'zhihu-guide-steps' },
        e('li', null,
          '打开 ',
          e('a', { className: 'zhihu-link', href: ZHIHU_CONSOLE_URL, target: '_blank', rel: 'noreferrer' }, 'developer.zhihu.com'),
          ' 并登录。',
        ),
        e('li', null, '在控制台创建应用或进入既有应用，复制 Access Secret。'),
        e('li', null, '粘贴到下方输入框并保存。'),
      ),
    ),
    e('dl', { className: 'zhihu-status-grid' },
      e('dt', { className: 'zhihu-status-label' }, '状态'),
      e('dd', { className: 'zhihu-status-value' },
        e('span', { className: dotClass, 'aria-hidden': true }),
        statusText,
      ),
    ),
    e('div', { className: 'zhihu-field' },
      e('label', { className: 'zhihu-field-label', htmlFor: 'zhihu-access-secret' }, 'Access Secret'),
      e('input', {
        id: 'zhihu-access-secret',
        type: 'password',
        autoComplete: 'off',
        className: 'zhihu-input',
        value: keyDraft,
        placeholder,
        'aria-invalid': draftFailure !== undefined,
        disabled: busy || keyLocked,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setKeyDraft(event.target.value),
      }),
      draftFailure === undefined
        ? e('p', { className: 'zhihu-hint' }, '密钥仅保存在本机凭证层，界面不会回显或记录明文。')
        : e('p', { className: 'zhihu-warning', role: 'alert' },
          draftFailure === 'blank' ? '密钥不能只包含空白字符。' : '密钥含有非法字符（应为可打印 ASCII，且不是 ENV 赋值行）。',
        ),
    ),
    failure !== undefined ? e('p', { className: 'zhihu-warning', role: 'alert' }, failure) : null,
    note !== undefined ? e('p', { className: 'zhihu-saved', role: 'status' }, note) : null,
    e('div', { className: 'zhihu-row' },
      e('button', {
        type: 'button',
        className: 'zhihu-button zhihu-button-danger',
        disabled: busy || keyLocked || !configured,
        onClick: () => void clear(),
      }, busy ? '处理中…' : '清除'),
      e('button', {
        type: 'button',
        className: 'zhihu-button zhihu-button-primary',
        disabled: busy || keyLocked || keyValue.length === 0 || draftFailure !== undefined,
        onClick: () => void save(),
      }, busy ? '保存中…' : '保存'),
    ),
  )
}

// ---------------------------------------------------------------------------
// 用量
// ---------------------------------------------------------------------------

const USAGE_DAYS = 30

type DailyUsage = { date: string; calls: number; failures: number; results: number }

function isUsageSummary(value: unknown): value is { days: DailyUsage[] } {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { days?: unknown }).days)
}

const CHART_WIDTH = 600
const CHART_HEIGHT = 120
const CHART_PAD_BOTTOM = 16

function UsageChart(props: { days: DailyUsage[] }): ReactNode {
  const days = props.days
  const maxCalls = Math.max(1, ...days.map((day) => day.calls))
  const slot = CHART_WIDTH / days.length
  const barWidth = Math.max(2, slot - 4)
  const plotHeight = CHART_HEIGHT - CHART_PAD_BOTTOM

  const bars = days.map((day, index) => {
    const x = index * slot + (slot - barWidth) / 2
    const failHeight = (day.failures / maxCalls) * plotHeight
    const okHeight = ((day.calls - day.failures) / maxCalls) * plotHeight
    const label = `${day.date.slice(5)}：调用 ${day.calls}，失败 ${day.failures}`
    const parts: ReactNode[] = []
    if (okHeight > 0) {
      parts.push(e('rect', { key: 'ok', className: 'zhihu-chart-bar-ok', x, y: plotHeight - okHeight, width: barWidth, height: okHeight }))
    }
    if (failHeight > 0) {
      parts.push(e('rect', { key: 'fail', className: 'zhihu-chart-bar-fail', x, y: plotHeight - okHeight - failHeight, width: barWidth, height: failHeight }))
    }
    return e('g', { key: day.date }, e('title', null, label), ...parts)
  })

  const ticks = [0, Math.floor(days.length / 2), days.length - 1].map((index) => {
    const day = days[index]
    if (!day) return null
    return e('text', {
      key: day.date,
      className: 'zhihu-chart-tick',
      x: index * slot + slot / 2,
      y: CHART_HEIGHT - 2,
      textAnchor: 'middle',
    }, day.date.slice(5))
  })

  return e('svg', {
    className: 'zhihu-chart',
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
    role: 'img',
    'aria-label': `近 ${USAGE_DAYS} 天知乎调用用量`,
    preserveAspectRatio: 'none',
  }, ...bars, ...ticks)
}

type UsageLoad =
  | { status: 'loading' }
  | { status: 'ready'; days: DailyUsage[] }
  | { status: 'error'; error: string }

function UsageSection(props: { rpc: RpcCaller }): ReactNode {
  const { rpc } = props
  const gateRef = useRef<ZhihuClientState | null>(null)
  if (!gateRef.current) gateRef.current = createZhihuClientState()
  const gate = gateRef.current
  const [state, setState] = useState<UsageLoad>({ status: 'loading' })

  // Unmount (tab change/panel close/slot collapse): abort the in-flight read.
  useEffect(() => () => gate.cancel(), [gate])

  // Every refresh supersedes the previous one (begin aborts it), so a late
  // response can never overwrite a newer refresh.
  const load = useCallback(async (): Promise<void> => {
    const { ticket, signal } = gate.begin()
    setState({ status: 'loading' })
    try {
      const raw = await rpc.call(ZHIHU_RPC_CHANNEL, 'usage.summary', { days: USAGE_DAYS }, signal)
      if (!gate.isCurrent(ticket)) return
      const result = raw as ZhihuRpcResult
      if (!result.ok) { setState({ status: 'error', error: result.error.message }); return }
      if (!isUsageSummary(result.value)) { setState({ status: 'error', error: '响应格式与契约不符。' }); return }
      setState({ status: 'ready', days: result.value.days })
    } catch (cause) {
      if (!gate.isCurrent(ticket)) return
      setState({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [gate, rpc])

  useEffect(() => { void load() }, [load])

  if (state.status === 'loading') {
    return e('section', { 'data-testid': 'zhihu-usage', 'aria-label': '知乎调用用量' },
      e('p', { className: 'zhihu-status', role: 'status' }, '正在读取用量…'),
    )
  }

  if (state.status === 'error') {
    return e('section', { 'data-testid': 'zhihu-usage', 'aria-label': '知乎调用用量' },
      e('p', { className: 'zhihu-error', role: 'alert' },
        `读取失败：${state.error} `,
        e('button', { type: 'button', className: 'zhihu-button', onClick: () => void load() }, '重试'),
      ),
    )
  }

  const hasAny = state.days.some((day) => day.calls > 0)
  return e('section', { 'data-testid': 'zhihu-usage', 'aria-label': '知乎调用用量' },
    e('p', { className: 'zhihu-hint' }, `近 ${USAGE_DAYS} 天知乎能力调用（成功段在下，失败段在上）。`),
    hasAny ? e(UsageChart, { days: state.days }) : e('p', { className: 'zhihu-status' }, '近 30 天暂无调用记录。'),
  )
}

// ---------------------------------------------------------------------------
// 知识库
// ---------------------------------------------------------------------------

type KnowledgeBase = { id: string; name: string; isDefault: boolean; contentCount: number }

function isKnowledgeBaseList(value: unknown): value is { bases: KnowledgeBase[] } {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { bases?: unknown }).bases)
}

/** 分块 base64,避免一次性展开大字符串。 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

const KB_ACCEPT = '.pdf,.md,.txt,.ppt,.pptx,.xlsx,.xls,.docx,.doc,.webp,.png,.jpg,.mobi,.epub,.csv,.azw3'
const KB_MAX_BYTES = 20 * 1024 * 1024

type KbListLoad =
  | { status: 'loading' }
  | { status: 'ready'; bases: KnowledgeBase[] }
  | { status: 'error'; failure: Failure }

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function KnowledgeSection(props: { rpc: RpcCaller }): ReactNode {
  const { rpc } = props
  const gateRef = useRef<ZhihuClientState | null>(null)
  if (!gateRef.current) gateRef.current = createZhihuClientState()
  const gate = gateRef.current
  const [list, setList] = useState<KbListLoad>({ status: 'loading' })
  const [baseId, setBaseId] = useState('')
  const [file, setFile] = useState<File | undefined>(undefined)
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  // Unmount (tab change/panel close/slot collapse): abort the in-flight read
  // or upload and stale its ticket.
  useEffect(() => () => gate.cancel(), [gate])

  // Every refresh supersedes the previous one (begin aborts it), so a late
  // response can never overwrite a newer refresh.
  const load = useCallback(async (): Promise<void> => {
    const { ticket, signal } = gate.begin()
    setList({ status: 'loading' })
    try {
      const raw = await rpc.call(ZHIHU_RPC_CHANNEL, 'knowledge.bases', {}, signal)
      if (!gate.isCurrent(ticket)) return
      const result = raw as ZhihuRpcResult
      if (!result.ok) { setList({ status: 'error', failure: failureOf(result.error.code, result.error.message) }); return }
      if (!isKnowledgeBaseList(result.value)) { setList({ status: 'error', failure: { kind: 'request', text: '响应格式与契约不符。' } }); return }
      setList({ status: 'ready', bases: result.value.bases })
    } catch (cause) {
      if (!gate.isCurrent(ticket)) return
      setList({ status: 'error', failure: networkFailure(cause) })
    }
  }, [gate, rpc])

  useEffect(() => { void load() }, [load])

  // 上传只能由用户显式点击触发：选中文件后先出现确认行，绝不自动上传。
  const upload = async (): Promise<void> => {
    if (!file || busy) return
    setFailure(undefined)
    setNote(undefined)
    if (file.size > KB_MAX_BYTES) { setFailure('文件超过 20 MB 上限。'); return }
    const { ticket, signal } = gate.begin()
    setBusy(true)
    try {
      const contentBase64 = toBase64(await file.arrayBuffer())
      // Reading bytes can span a close/tab switch; re-verify before any bytes
      // leave the machine.
      if (!gate.isCurrent(ticket)) return
      const raw = await rpc.call(ZHIHU_RPC_CHANNEL, 'knowledge.upload', {
        fileName: file.name,
        contentBase64,
        ...(baseId ? { knowledgeBaseId: baseId } : {}),
      }, signal)
      if (!gate.isCurrent(ticket)) return
      const result = raw as ZhihuRpcResult
      if (!result.ok) { setFailure(`上传失败：${result.error.message}`); return }
      setNote('已上传到知乎知识库。')
      setFile(undefined)
      setFileKey((key) => key + 1)
      await load()
    } catch (cause) {
      if (!gate.isCurrent(ticket)) return
      setFailure(`上传失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return e('section', { 'data-testid': 'zhihu-knowledge', 'aria-label': '知乎知识库' },
    e('p', { className: 'zhihu-hint' },
      '文件将上传到知乎云端知识库；也可在 ',
      e('a', { className: 'zhihu-link', href: KB_MANAGE_URL, target: '_blank', rel: 'noreferrer' }, 'zhida.zhihu.com/repositories/square'),
      ' 管理。',
    ),
    list.status === 'loading' ? e('p', { className: 'zhihu-status', role: 'status' }, '正在读取知识库列表…') : null,
    list.status === 'error' ? e('p', { className: 'zhihu-error', role: 'alert' },
      `${list.failure.text} `,
      list.failure.kind !== 'credential'
        ? e('button', { type: 'button', className: 'zhihu-button', onClick: () => void load() }, '重试')
        : null,
    ) : null,
    list.status === 'ready' ? e('div', { className: 'zhihu-field' },
      e('label', { className: 'zhihu-field-label', htmlFor: 'zhihu-kb-base' }, '目标知识库'),
      e('div', { className: 'zhihu-row' },
        e('select', {
          id: 'zhihu-kb-base',
          className: 'zhihu-select',
          value: baseId,
          disabled: busy,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => setBaseId(event.target.value),
        },
          e('option', { value: '' }, '默认知识库'),
          ...list.bases.map((base) => e('option', { key: base.id, value: base.id },
            `${base.name}${base.isDefault ? '（默认）' : ''} · ${base.contentCount} 篇`,
          )),
        ),
        e('button', { type: 'button', className: 'zhihu-button', disabled: busy, onClick: () => void load() }, '刷新'),
      ),
      list.bases.length === 0 ? e('p', { className: 'zhihu-hint' }, '暂无可用知识库。') : null,
    ) : null,
    list.status === 'ready' ? e('div', { className: 'zhihu-field' },
      e('label', { className: 'zhihu-field-label', htmlFor: 'zhihu-kb-file' }, '选择文件'),
      e('input', {
        key: fileKey,
        id: 'zhihu-kb-file',
        type: 'file',
        accept: KB_ACCEPT,
        className: 'zhihu-file',
        disabled: busy,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0]),
      }),
      e('p', { className: 'zhihu-hint' }, '支持 PDF / Markdown / Office / 电子书等格式，单文件不超过 20 MB。'),
    ) : null,
    list.status === 'ready' && file ? e('div', { className: 'zhihu-upload-confirm' },
      `确认将「${file.name}」（${formatSize(file.size)}）上传到${baseId ? '所选知识库' : '默认知识库'}？文件会进入知乎云端。`,
    ) : null,
    list.status === 'ready' ? e('div', { className: 'zhihu-row' },
      e('button', {
        type: 'button',
        className: 'zhihu-button zhihu-button-primary',
        disabled: busy || !file,
        onClick: () => void upload(),
      }, busy ? '上传中…' : '确认上传'),
    ) : null,
    note ? e('p', { className: 'zhihu-saved', role: 'status' }, note) : null,
    failure ? e('p', { className: 'zhihu-warning', role: 'alert' }, failure) : null,
  )
}

// ---------------------------------------------------------------------------
// 面板与插槽注册
// ---------------------------------------------------------------------------

type Tab = 'search' | 'settings' | 'usage' | 'knowledge'

const TAB_LABEL: Record<Tab, string> = {
  search: '搜索',
  settings: '设置',
  usage: '用量',
  knowledge: '知识库',
}

function ZhihuDock(props: { rpc: RpcCaller; credentials: CredentialsApi }) {
  const { rpc, credentials } = props
  const gateRef = useRef<ZhihuClientState | null>(null)
  if (!gateRef.current) gateRef.current = createZhihuClientState()
  const gate = gateRef.current
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('search')
  const [askModel, setAskModel] = useState<AskModel>('zhida-thinking-1p5')
  const [scopes, setScopes] = useState<RecallScope[]>(['public'])
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [failure, setFailure] = useState<Failure | null>(null)
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const [revision, setRevision] = useState(0)
  const [resultRevision, setResultRevision] = useState(0)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const queryRef = useRef<HTMLInputElement | null>(null)
  const wasOpen = useRef(false)

  // Focus management: opening lands in the query input; closing (button or
  // Escape) returns focus to the launcher.
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      queryRef.current?.focus()
    } else if (wasOpen.current) {
      wasOpen.current = false
      toggleRef.current?.focus()
    }
  }, [open])

  // Unmount (slot collapse, plugin unload): cancel the in-flight request.
  useEffect(() => () => gate.cancel(), [gate])

  const runSearch = useCallback(async () => {
    if (mode !== 'hot' && !query.trim()) return
    const { ticket, signal } = gate.begin()
    setPhase('loading')
    setFailure(null)
    const payload = mode === 'hot'
      ? { limit: 10 }
      : mode === 'ask'
        ? { query: query.trim(), model: askModel }
        : mode === 'knowledge'
          ? { query: query.trim(), limit: 5, recallScopes: scopes }
          : mode === 'global'
            ? { query: query.trim(), count: 10 }
            : { query: query.trim(), count: 5 }
    try {
      const response = await rpc.call(ZHIHU_RPC_CHANNEL, MODE_ENDPOINT[mode], payload, signal) as ZhihuRpcResult
      if (!gate.isCurrent(ticket)) return
      if (response.ok) {
        const parsed = parseOutcome(mode, response.value)
        if (!parsed) {
          setFailure({ kind: 'request', text: '响应格式与契约不符。' })
          setPhase('error')
          return
        }
        setOutcome(parsed)
        setResultRevision(ticket.revision)
        setPhase('done')
      } else if (response.error.code === 'cancelled') {
        setPhase('idle')
      } else {
        setFailure(failureOf(response.error.code, response.error.message))
        setPhase('error')
      }
    } catch (cause) {
      if (!gate.isCurrent(ticket)) return
      setFailure(networkFailure(cause))
      setPhase('error')
    }
  }, [gate, rpc, mode, query, askModel, scopes])

  // Input changes abort the in-flight request (noteInput aborts and stales
  // its ticket) and drop the UI back to idle so a rerun is possible; a stale
  // response arriving later is ignored by the ticket check. A completed result
  // stays visible but renders stale via the revision mismatch.
  const resetToIdle = () => {
    setPhase((current) => (current === 'loading' || current === 'error' ? 'idle' : current))
    setFailure(null)
  }

  const onQueryChange = (value: string) => {
    setQuery(value)
    setRevision(gate.noteInput())
    resetToIdle()
  }

  const onModeChange = (next: Mode) => {
    if (next === mode) return
    setRevision(gate.noteInput())
    setMode(next)
    resetToIdle()
  }

  const onTabChange = (next: Tab) => {
    if (next === tab) return
    gate.cancel()
    setPhase((current) => (current === 'loading' ? 'idle' : current))
    setTab(next)
  }

  const toggleScope = (scope: RecallScope) => {
    setRevision(gate.noteInput())
    resetToIdle()
    setScopes((current) => {
      const next = current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]
      return next.length > 0 ? next : current
    })
  }

  const onAskModelChange = (next: AskModel) => {
    if (next === askModel) return
    setRevision(gate.noteInput())
    setAskModel(next)
    resetToIdle()
  }

  const closePanel = useCallback(() => {
    gate.cancel()
    setPhase('idle')
    setOpen(false)
  }, [gate])

  const onPanelKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closePanel()
    }
  }

  const onQueryKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !isSearchDisabled()) {
      event.preventDefault()
      void runSearch()
    }
  }

  const isSearchDisabled = () => phase === 'loading' || (mode !== 'hot' && !query.trim())

  const stale = outcome !== null && resultRevision !== revision
  const searchDisabled = isSearchDisabled()

  // The toggle stays mounted as the launcher anchor whether the panel is open
  // or not: a host launcher rail lays out the dock wrapper inline, and the
  // open panel positions itself against that wrapper.
  return e('div', { className: 'zhihu-dock' },
    e('button', {
      type: 'button',
      ref: toggleRef,
      className: 'zhihu-toggle',
      'data-testid': 'zhihu-open',
      onClick: () => setOpen(true),
    }, SLOT_LABEL),
    open ? e('section', {
    className: 'zhihu-panel',
    'data-testid': 'zhihu-panel',
    'aria-label': '知乎资料',
    onKeyDown: onPanelKeyDown,
  },
    e('header', { className: 'zhihu-panel-header' },
      e('h2', { className: 'zhihu-panel-title' }, '知乎资料'),
      e('button', { type: 'button', className: 'zhihu-panel-close', onClick: closePanel }, '关闭'),
    ),
    e('div', { className: 'zhihu-tabs', role: 'tablist', 'aria-label': '知乎资料分区' },
      (Object.keys(TAB_LABEL) as Tab[]).map((key) => e('button', {
        key,
        type: 'button',
        role: 'tab',
        'aria-selected': tab === key,
        className: 'zhihu-tab',
        onClick: () => onTabChange(key),
      }, TAB_LABEL[key])),
    ),
    e('div', { className: 'zhihu-panel-body' },
      tab === 'search' ? e('div', { role: 'tabpanel', className: 'zhihu-field' },
        e('div', { className: 'zhihu-row' },
          e('select', {
            className: 'zhihu-select',
            'aria-label': '搜索方式',
            value: mode,
            onChange: (event: ChangeEvent<HTMLSelectElement>) => onModeChange(event.target.value as Mode),
          },
            (Object.keys(MODE_LABEL) as Mode[]).map((key) => e('option', { key, value: key }, MODE_LABEL[key])),
          ),
          mode === 'ask' ? e('select', {
            className: 'zhihu-select',
            'aria-label': '直答模型',
            value: askModel,
            onChange: (event: ChangeEvent<HTMLSelectElement>) => onAskModelChange(event.target.value as AskModel),
          },
            ASK_MODELS.map((model) => e('option', { key: model.value, value: model.value }, model.label)),
          ) : null,
        ),
        mode === 'knowledge' ? e('div', { className: 'zhihu-scopes' },
          SCOPE_OPTIONS.map((scope) => e('label', { key: scope.value, className: 'zhihu-scope' },
            e('input', {
              type: 'checkbox',
              checked: scopes.includes(scope.value),
              onChange: () => toggleScope(scope.value),
            }),
            scope.label,
          )),
        ) : null,
        e('input', {
          ref: queryRef,
          type: 'search',
          className: 'zhihu-input',
          'data-testid': 'zhihu-query',
          placeholder: mode === 'hot' ? '热榜无需关键词' : '输入关键词…',
          value: query,
          disabled: mode === 'hot',
          onChange: (event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value),
          onKeyDown: onQueryKeyDown,
        }),
        e('div', { className: 'zhihu-row' },
          e('button', {
            type: 'button',
            className: 'zhihu-button zhihu-button-primary',
            'data-testid': 'zhihu-search',
            disabled: searchDisabled,
            onClick: () => void runSearch(),
          }, phase === 'loading' ? '请求中…' : mode === 'hot' ? '获取热榜' : '搜索'),
          phase === 'loading'
            ? e('button', { type: 'button', className: 'zhihu-button', onClick: () => { gate.cancel(); setPhase('idle') } }, '取消')
            : null,
        ),
        phase === 'loading' ? e('div', { className: 'zhihu-status', role: 'status' }, '正在请求知乎…') : null,
        phase === 'error' && failure ? e('div', { className: 'zhihu-error', role: 'alert' }, failure.text) : null,
        phase === 'done' && outcome ? e(OutcomeView, { outcome, stale }) : null,
      ) : null,
      tab === 'settings' ? e(SettingsSection, { credentials }) : null,
      tab === 'usage' ? e(UsageSection, { rpc }) : null,
      tab === 'knowledge' ? e(KnowledgeSection, { rpc }) : null,
    ),
  ) : null,
  )
}

export function apply(ctx: Context): void {
  const style = injectStyles()
  // Styles live and die with the plugin fiber: unload/reload removes the node.
  if (style) ctx.effect(() => () => style.remove(), 'zhihu.styles')
  const client = ctx as ZhihuClientContext
  const render = () => e(ZhihuDock, { rpc: client.connection.rpc, credentials: wrapCredentials(client.remote.credentials) })
  // Official Web declares shell.overlay; the DSH Editor root declares
  // dsh-editor.extensions. inject() waits for the declaration, so each entry
  // goes live only in the host that actually provides the seat, and the
  // caller fiber's unload retracts both the wait and the contribution.
  client.slots.inject('shell.overlay', () =>
    client.slots.register({ name: 'shell.overlay', id: SLOT_ID, order: SLOT_ORDER, label: SLOT_LABEL }, render))
  client.slots.inject('dsh-editor.extensions', () =>
    client.slots.register({ name: 'dsh-editor.extensions', id: SLOT_ID, order: SLOT_ORDER, label: SLOT_LABEL }, render))
}
