import type { Context } from '@deepseek-ai/cordis'
import React, {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ZHIHU_CREDENTIAL_REF, ZHIHU_RPC_CHANNEL, type ZhihuRpcResult } from './contracts.ts'
import { createZhihuClientState, type ZhihuClientState } from './client-state.ts'
import { zhihuClientStyles } from './client-styles.ts'
import { dockEscapeKeyDown, hostComponentsFromRenderProps, renderSelect, zhihuQueryKeyDown, type HostDialog, type HostSelect } from './client-host-ui.tsx'

export const name = 'dsh-zhihu-client'
export const inject = ['slots', 'connection', 'remote', 'remote.credentials'] as const

const SLOT_ID = 'zhihu'
const SLOT_ORDER = 120
const SLOT_LABEL = '知乎资料'

/* 活动暗示:三点呼吸(参数改写自 Amicro pulse-dots,MIT);装饰 aria-hidden,
   关键帧在 client-styles.ts,reduced-motion 停循环后保留静态点。 */
const activityDots = () => <span className="zhihu-dots" aria-hidden="true">
  <i />
  <i />
  <i />
</span>

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
  return /^https?:\/\//i.test(url) ? url : null;
}

type Failure = { kind: 'credential' | 'network' | 'request'; text: string }

/** Credential absence and transport failure read differently from a plain bad request. */
function failureOf(code: string, message: string): Failure {
  if (code === 'token-missing') {
    return { kind: 'credential', text: '未配置知乎 Access Secret 或凭证不可用，请到「设置」页完成配置。' }
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
  if (!url) return (
    <span className={props.className}>
      {props.label}
    </span>
  );
  return (
    <a
      className={props.className ?? 'zhihu-link'}
      href={url}
      target="_blank"
      rel="noreferrer">
      {props.label}
    </a>
  );
}

function OutcomeView(props: { outcome: SearchOutcome; stale: boolean }): ReactNode {
  const { outcome, stale } = props
  let body: ReactNode = null
  let summary = ''
  if (outcome.mode === 'ask') {
    summary = `直答（${outcome.answer.model || '默认模型'}）`
    body = <div>
      {outcome.answer.reasoning
        ? <details className="zhihu-ask-reasoning">
        <summary>
          思考过程
        </summary>
        <p>
          {outcome.answer.reasoning}
        </p>
      </details>
        : null}
      <p className="zhihu-ask-content">
        {outcome.answer.content}
      </p>
    </div>
  } else if (outcome.items.length === 0) {
    const reason = outcome.mode === 'search' || outcome.mode === 'global' ? outcome.emptyReason : undefined
    return (
      <div data-testid="zhihu-results" className="zhihu-results">
        {stale ? <div className="zhihu-stale" role="status">
          查询已变化，以下内容对应旧查询，请重新搜索。
        </div> : null}
        <p className="zhihu-results-summary">
          {`未找到相关结果${reason ? `（${reason}）` : ''}。`}
        </p>
      </div>
    );
  } else if (outcome.mode === 'knowledge') {
    summary = `知识库检索共 ${outcome.items.length} 条`
    body = <ul className="zhihu-result-list">
      {outcome.items.map((item, index) => <li key={`${item.docName}:${index}`} className="zhihu-result-item">
        <span className="zhihu-result-title">
          {item.docName}
        </span>
        {item.originUrl && safeUrl(item.originUrl)
          ? <LinkOrText url={item.originUrl} label={item.originUrl} />
          : null}
        {item.snippets.map((snippet, snippetIndex) =>
          <span key={snippetIndex} className="zhihu-result-snippet">
            {snippet}
          </span>)}
      </li>)}
    </ul>
  } else if (outcome.mode === 'hot') {
    summary = `知乎热榜共 ${outcome.items.length} 条`
    body = <ul className="zhihu-result-list">
      {outcome.items.map((item, index) => <li key={`${index}`} className="zhihu-result-item">
        <LinkOrText
          url={item.url}
          label={item.title}
          className="zhihu-result-title zhihu-link" />
        {item.summary ? <span className="zhihu-result-summary">
          {item.summary}
        </span> : null}
      </li>)}
    </ul>
  } else {
    summary = `${MODE_LABEL[outcome.mode]}共 ${outcome.items.length} 条`
    body = <ul className="zhihu-result-list">
      {outcome.items.map((item, index) => <li key={`${item.title}:${index}`} className="zhihu-result-item">
        <LinkOrText
          url={item.url}
          label={item.title}
          className="zhihu-result-title zhihu-link" />
        <span className="zhihu-result-meta">
          {`类型：${item.type}　作者：${item.author}　赞同 ${item.votes}　评论 ${item.comments}${item.editTime ? `　时间：${item.editTime}` : ''}`}
        </span>
        {item.summary ? <span className="zhihu-result-summary">
          {item.summary}
        </span> : null}
      </li>)}
    </ul>
  }
  return (
    <div data-testid="zhihu-results" className="zhihu-results">
      {stale ? <div className="zhihu-stale" role="status">
        查询已变化，以下内容对应旧查询，请重新搜索。
      </div> : null}
      <p className="zhihu-results-summary" aria-live="polite">
        {summary}
      </p>
      {body}
    </div>
  );
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
    return (
      <section data-testid="zhihu-settings" aria-label="知乎凭证设置">
        <p className="zhihu-status" role="status">
          {activityDots()}
          正在读取凭证状态…
        </p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section data-testid="zhihu-settings" aria-label="知乎凭证设置">
        <p className="zhihu-error" role="alert">
          {`读取失败：${state.error} `}
          <button type="button" className="zhihu-button" onClick={() => void load()}>
            重试
          </button>
        </p>
      </section>
    );
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

  return (
    <section data-testid="zhihu-settings" aria-label="知乎凭证设置">
      {configured ? null : <div className="zhihu-guide">
        <h3 className="zhihu-guide-title">
          获取 Access Secret
        </h3>
        <ol className="zhihu-guide-steps">
          <li>
            {'打开 '}
            <a
              className="zhihu-link"
              href={ZHIHU_CONSOLE_URL}
              target="_blank"
              rel="noreferrer">
              developer.zhihu.com
            </a>
            {' 并登录。'}
          </li>
          <li>
            在控制台创建应用或进入既有应用，复制 Access Secret。
          </li>
          <li>
            粘贴到下方输入框并保存。
          </li>
        </ol>
      </div>}
      <dl className="zhihu-status-grid">
        <dt className="zhihu-status-label">
          状态
        </dt>
        <dd className="zhihu-status-value">
          <span className={dotClass} aria-hidden={true} />
          {statusText}
        </dd>
      </dl>
      <div className="zhihu-field">
        <label className="zhihu-field-label" htmlFor="zhihu-access-secret">
          Access Secret
        </label>
        <input
          id="zhihu-access-secret"
          type="password"
          autoComplete="off"
          className="zhihu-input"
          value={keyDraft}
          placeholder={placeholder}
          aria-invalid={draftFailure !== undefined}
          disabled={busy || keyLocked}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyDraft(event.target.value)} />
        {draftFailure === undefined
          ? null
          : <p className="zhihu-warning" role="alert">
          {draftFailure === 'blank' ? '密钥不能只包含空白字符。' : '密钥含有非法字符（应为可打印 ASCII，且不是 ENV 赋值行）。'}
        </p>}
      </div>
      {failure !== undefined ? <p className="zhihu-warning" role="alert">
        {failure}
      </p> : null}
      {note !== undefined ? <p className="zhihu-saved" role="status">
        {note}
      </p> : null}
      <div className="zhihu-row">
        <button
          type="button"
          className="zhihu-button zhihu-button-danger"
          disabled={busy || keyLocked || !configured}
          onClick={() => void clear()}>
          {busy ? <Fragment>
            {activityDots()}
            处理中…
          </Fragment> : '清除'}
        </button>
        <button
          type="button"
          className="zhihu-button zhihu-button-primary"
          disabled={busy || keyLocked || keyValue.length === 0 || draftFailure !== undefined}
          onClick={() => void save()}>
          {busy ? <Fragment>
            {activityDots()}
            保存中…
          </Fragment> : '保存'}
        </button>
      </div>
    </section>
  );
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

/** Local calendar day, kept in the client bundle so it does not pull the node usage domain. */
function localDayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** `2026-09-15` → `9/15`, so axis labels stay short and do not clip. */
export function formatUsageDate(date: string): string {
  const parts = date.split('-')
  if (parts.length !== 3) return date
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || day < 1) return date
  return `${month}/${day}`
}

export type UsageTotals = {
  todayCalls: number
  calls: number
  failures: number
  results: number
  active: DailyUsage[]
}

export function summarizeUsage(days: readonly DailyUsage[], today: string): UsageTotals {
  let todayCalls = 0
  let calls = 0
  let failures = 0
  let results = 0
  const active: DailyUsage[] = []
  for (const day of days) {
    calls += day.calls
    failures += day.failures
    results += day.results
    if (day.date === today) todayCalls = day.calls
    if (day.calls > 0) active.push(day)
  }
  return { todayCalls, calls, failures, results, active: active.slice().reverse() }
}

const TICK_MIN_GAP = 3

/** Sparse windows label active days; nearby ticks collapse so labels do not overlap. */
export function usageChartTicks(days: readonly { calls: number }[]): number[] {
  const last = days.length - 1
  if (last < 0) return []
  if (last === 0) return [0]
  const chosen: number[] = []
  const accept = (index: number): void => {
    if (chosen.some((item) => Math.abs(item - index) < TICK_MIN_GAP)) return
    chosen.push(index)
  }
  const lastHasCalls = (days[last]?.calls ?? 0) > 0
  if (lastHasCalls) accept(last)
  accept(0)
  const active = days
    .map((day, index) => ({ index, calls: day.calls }))
    .filter((row) => row.calls > 0)
    .sort((left, right) => right.calls - left.calls || left.index - right.index)
  if (active.length > 0 && active.length <= 6) {
    for (const row of active) accept(row.index)
  } else {
    accept(Math.round(last / 3))
    accept(Math.round((2 * last) / 3))
  }
  if (!lastHasCalls) accept(last)
  return chosen.sort((left, right) => left - right)
}

function usageYTicks(maxCalls: number): number[] {
  if (maxCalls <= 1) return [0, 1]
  if (maxCalls === 2) return [0, 1, 2]
  const mid = Math.round(maxCalls / 2)
  return mid === 0 || mid === maxCalls ? [0, maxCalls] : [0, mid, maxCalls]
}

const CHART_WIDTH = 600
const CHART_HEIGHT = 176
const CHART_PAD = { top: 20, right: 12, bottom: 24, left: 36 }

function UsageChart(props: { days: DailyUsage[]; totals: UsageTotals }): ReactNode {
  const days = props.days
  const maxCalls = Math.max(1, ...days.map((day) => day.calls))
  const plotLeft = CHART_PAD.left
  const plotRight = CHART_WIDTH - CHART_PAD.right
  const plotTop = CHART_PAD.top
  const plotBottom = CHART_HEIGHT - CHART_PAD.bottom
  const plotWidth = plotRight - plotLeft
  const plotHeight = plotBottom - plotTop
  const slot = plotWidth / days.length
  const barWidth = Math.max(2, Math.min(14, slot - 2))

  const grid = usageYTicks(maxCalls).map((value) => {
    const y = plotBottom - (value / maxCalls) * plotHeight
    return (
      <g key={`y-${value}`}>
        <line className="zhihu-chart-grid" x1={plotLeft} x2={plotRight} y1={y} y2={y} />
        <text
          className="zhihu-chart-axis"
          x={plotLeft - 6}
          y={y}
          textAnchor="end"
          dominantBaseline="middle">
          {String(value)}
        </text>
      </g>
    );
  })

  const bars = days.map((day, index) => {
    const x = plotLeft + index * slot + (slot - barWidth) / 2
    const okCalls = Math.max(0, day.calls - day.failures)
    const failHeight = (day.failures / maxCalls) * plotHeight
    const okHeight = (okCalls / maxCalls) * plotHeight
    const label = `${day.date}：调用 ${day.calls} 次，成功 ${okCalls} 次，失败 ${day.failures} 次，结果 ${day.results} 条`
    const parts: ReactNode[] = [
      <rect
        key="hit"
        className="zhihu-chart-hit"
        x={plotLeft + index * slot}
        y={plotTop}
        width={slot}
        height={plotHeight} />,
    ]
    if (okHeight > 0) {
      parts.push(<rect
        key="ok"
        className="zhihu-chart-bar-ok"
        x={x}
        y={plotBottom - okHeight}
        width={barWidth}
        height={okHeight} />)
    }
    if (failHeight > 0) {
      parts.push(<rect
        key="fail"
        className="zhihu-chart-bar-fail"
        x={x}
        y={plotBottom - okHeight - failHeight}
        width={barWidth}
        height={failHeight} />)
    }
    if (day.calls > 0) {
      parts.push(<text
        key="n"
        className="zhihu-chart-value"
        x={x + barWidth / 2}
        y={plotBottom - okHeight - failHeight - 4}
        textAnchor="middle">
        {String(day.calls)}
      </text>)
    }
    return (
      <g key={day.date}>
        <title>
          {label}
        </title>
        {parts}
      </g>
    );
  })

  const last = days.length - 1
  const ticks = usageChartTicks(days).map((index) => {
    const day = days[index]
    if (!day) return null
    const anchor = index === 0 ? 'start' : index === last ? 'end' : 'middle'
    const tickX = index === 0 ? plotLeft : index === last ? plotRight : plotLeft + index * slot + slot / 2
    return (
      <text
        key={`x-${day.date}-${index}`}
        className="zhihu-chart-tick"
        x={tickX}
        y={CHART_HEIGHT - 6}
        textAnchor={anchor}>
        {formatUsageDate(day.date)}
      </text>
    );
  })

  return (
    <svg
      className="zhihu-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label={`近 ${USAGE_DAYS} 天知乎工具调用 ${props.totals.calls} 次，失败 ${props.totals.failures} 次，结果 ${props.totals.results} 条`}>
      {grid}
      {bars}
      {ticks}
    </svg>
  );
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
    return (
      <section data-testid="zhihu-usage" aria-label="知乎调用用量">
        <p className="zhihu-status" role="status">
          {activityDots()}
          正在读取用量…
        </p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section data-testid="zhihu-usage" aria-label="知乎调用用量">
        <p className="zhihu-error" role="alert">
          {`读取失败：${state.error} `}
          <button type="button" className="zhihu-button" onClick={() => void load()}>
            重试
          </button>
        </p>
      </section>
    );
  }

  const totals = summarizeUsage(state.days, localDayKey())
  const hasAny = totals.calls > 0
  return (
    <section className="zhihu-usage" data-testid="zhihu-usage" aria-label="知乎调用用量">
      <p className="zhihu-usage-intro">
        本机搜索、问答、热榜和知识库的调用次数，不是知乎官方配额或费用。
      </p>
      <div className="zhihu-usage-cards">
        <UsageCard label="今日调用" value={totals.todayCalls} unit="次" />
        <UsageCard label={`近 ${USAGE_DAYS} 天`} value={totals.calls} unit="次" />
        <UsageCard label="失败" value={totals.failures} unit="次" />
        <UsageCard label="结果条数" value={totals.results} unit="条" />
      </div>
      {hasAny ? <Fragment>
        <h3 className="zhihu-usage-heading">
          每日调用次数
        </h3>
        <UsageChart days={state.days} totals={totals} />
        <ul className="zhihu-usage-legend">
          <li>
            <span className="zhihu-chart-chip zhihu-chart-chip-ok" aria-hidden="true" />
            成功
          </li>
          <li>
            <span className="zhihu-chart-chip zhihu-chart-chip-fail" aria-hidden="true" />
            失败
          </li>
        </ul>
        <h3 className="zhihu-usage-heading">
          有记录的日期
        </h3>
        <div className="zhihu-usage-table-wrap">
          <table className="zhihu-usage-table">
            <thead>
              <tr>
                <th scope="col">
                  日期
                </th>
                <th scope="col">
                  调用
                </th>
                <th scope="col">
                  成功
                </th>
                <th scope="col">
                  失败
                </th>
                <th scope="col">
                  结果条数
                </th>
              </tr>
            </thead>
            <tbody>
              {totals.active.map((day) => <tr key={day.date}>
                <th scope="row">
                  {day.date}
                </th>
                <td>
                  {String(day.calls)}
                </td>
                <td>
                  {String(Math.max(0, day.calls - day.failures))}
                </td>
                <td>
                  {String(day.failures)}
                </td>
                <td>
                  {String(day.results)}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </Fragment> : <p className="zhihu-status">
        近 30 天暂无调用记录。
      </p>}
    </section>
  );
}

function UsageCard(props: { label: string; value: number; unit: string }): ReactNode {
  return (
    <div className="zhihu-usage-card">
      <span className="zhihu-usage-card-label">
        {props.label}
      </span>
      <span className="zhihu-usage-card-value">
        {String(props.value)}
        <span className="zhihu-usage-card-unit">
          {props.unit}
        </span>
      </span>
    </div>
  );
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

function KnowledgeSection(props: { rpc: RpcCaller; Select?: HostSelect }): ReactNode {
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

  return (
    <section data-testid="zhihu-knowledge" aria-label="知乎知识库">
      <p>
        <a
          className="zhihu-link"
          href={KB_MANAGE_URL}
          target="_blank"
          rel="noreferrer">
          管理知识库
        </a>
      </p>
      {list.status === 'loading' ? <p className="zhihu-status" role="status">
        {activityDots()}
        正在读取知识库列表…
      </p> : null}
      {list.status === 'error' ? <p className="zhihu-error" role="alert">
        {`${list.failure.text} `}
        {list.failure.kind !== 'credential'
          ? <button type="button" className="zhihu-button" onClick={() => void load()}>
          重试
        </button>
          : null}
      </p> : null}
      {list.status === 'ready' ? <div className="zhihu-field">
        <label className="zhihu-field-label" htmlFor="zhihu-kb-base">
          目标知识库
        </label>
        <div className="zhihu-row">
          {renderSelect(props.Select, {
            value: baseId,
            disabled: busy,
            'aria-label': '目标知识库',
            onChange: setBaseId,
            options: [
              { value: '', label: '默认知识库' },
              ...list.bases.map((base) => ({
                value: base.id,
                label: `${base.name}${base.isDefault ? '（默认）' : ''} · ${base.contentCount} 篇`,
              })),
            ],
          }, 'zhihu-select')}
          <button
            type="button"
            className="zhihu-button"
            disabled={busy}
            onClick={() => void load()}>
            刷新
          </button>
        </div>
        {list.bases.length === 0 ? <p className="zhihu-hint">
          暂无可用知识库。
        </p> : null}
      </div> : null}
      {list.status === 'ready' ? <div className="zhihu-field">
        <label className="zhihu-field-label" htmlFor="zhihu-kb-file">
          选择文件
        </label>
        <input
          key={fileKey}
          id="zhihu-kb-file"
          type="file"
          accept={KB_ACCEPT}
          className="zhihu-file"
          disabled={busy}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0])} />
      </div> : null}
      {list.status === 'ready' && file ? <div className="zhihu-upload-confirm">
        {`确认将「${file.name}」（${formatSize(file.size)}）上传到${baseId ? '所选知识库' : '默认知识库'}？文件会进入知乎云端。`}
      </div> : null}
      {list.status === 'ready' ? <div className="zhihu-row">
        <button
          type="button"
          className="zhihu-button zhihu-button-primary"
          disabled={busy || !file}
          onClick={() => void upload()}>
          {busy ? <Fragment>
            {activityDots()}
            上传中…
          </Fragment> : '确认上传'}
        </button>
      </div> : null}
      {note ? <p className="zhihu-saved" role="status">
        {note}
      </p> : null}
      {failure ? <p className="zhihu-warning" role="alert">
        {failure}
      </p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 面板与插槽注册
// ---------------------------------------------------------------------------

type Tab = 'search' | 'settings' | 'usage' | 'knowledge'
type ZhihuSurface = 'overlay' | 'settings'

const TAB_LABEL: Record<Tab, string> = {
  search: '搜索',
  settings: '设置',
  usage: '用量',
  knowledge: '知识库',
}

const OVERLAY_TABS: Tab[] = ['search', 'settings', 'usage', 'knowledge']
const SETTINGS_TABS: Tab[] = ['settings', 'usage', 'knowledge', 'search']

function tabLabel(tab: Tab, surface: ZhihuSurface): string {
  if (tab === 'search' && surface === 'settings') return '连接测试'
  return TAB_LABEL[tab]
}

function ZhihuDock(props: { rpc: RpcCaller; credentials: CredentialsApi; Select?: HostSelect; Dialog?: HostDialog; surface?: ZhihuSurface }) {
  const { rpc, credentials, Select, Dialog } = props
  const surface: ZhihuSurface = props.surface === 'settings' ? 'settings' : 'overlay'
  const tabs = surface === 'settings' ? SETTINGS_TABS : OVERLAY_TABS
  const gateRef = useRef<ZhihuClientState | null>(null)
  if (!gateRef.current) gateRef.current = createZhihuClientState()
  const gate = gateRef.current
  const [open, setOpen] = useState(surface === 'settings')
  const [tab, setTab] = useState<Tab>(surface === 'settings' ? 'settings' : 'search')
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

  // Standalone dock owns focus return. Host Dialog restores the invoker itself.
  // Settings embed is already inside the host settings dialog.
  useEffect(() => {
    if (Dialog || surface === 'settings') return
    if (open) {
      wasOpen.current = true
      queryRef.current?.focus()
    } else if (wasOpen.current) {
      wasOpen.current = false
      toggleRef.current?.focus()
    }
  }, [open, Dialog, surface])

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
    dockEscapeKeyDown(event, { loading: phase === 'loading', close: closePanel })
  }

  const onQueryKeyDown = (event: KeyboardEvent) => {
    zhihuQueryKeyDown(event, { disabled: isSearchDisabled(), search: () => { void runSearch() } })
  }

  const isSearchDisabled = () => phase === 'loading' || (mode !== 'hot' && !query.trim())

  const stale = outcome !== null && resultRevision !== revision
  const searchDisabled = isSearchDisabled()

  const tablist = <div key="tabs" className="zhihu-tabs" role="tablist" aria-label="知乎资料分区">
    {tabs.map((key) => <button
      key={key}
      type="button"
      role="tab"
      aria-selected={tab === key}
      className="zhihu-tab"
      onClick={() => onTabChange(key)}>
      {tabLabel(key, surface)}
    </button>)}
  </div>
  const body = <div key="body" className="zhihu-panel-body">
    {tab === 'search' ? <div role="tabpanel" className="zhihu-field">
      <div className="zhihu-row">
        {renderSelect(Select, {
          'aria-label': '搜索方式',
          value: mode,
          onChange: (next) => onModeChange(next as Mode),
          options: (Object.keys(MODE_LABEL) as Mode[]).map((key) => ({ value: key, label: MODE_LABEL[key] })),
        }, 'zhihu-select')}
        {mode === 'ask' ? renderSelect(Select, {
          'aria-label': '直答模型',
          value: askModel,
          onChange: (next) => onAskModelChange(next as AskModel),
          options: ASK_MODELS.map((model) => ({ value: model.value, label: model.label })),
        }, 'zhihu-select') : null}
      </div>
      {mode === 'knowledge' ? <div className="zhihu-scopes">
        {SCOPE_OPTIONS.map((scope) => <label key={scope.value} className="zhihu-scope">
          <input
            type="checkbox"
            checked={scopes.includes(scope.value)}
            onChange={() => toggleScope(scope.value)} />
          {scope.label}
        </label>)}
      </div> : null}
      <input
        ref={queryRef}
        type="search"
        className="zhihu-input"
        data-testid="zhihu-query"
        placeholder={mode === 'hot' ? '热榜无需关键词' : '输入关键词…'}
        value={query}
        disabled={mode === 'hot'}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value)}
        onKeyDown={onQueryKeyDown} />
      <div className="zhihu-row">
        <button
          type="button"
          className="zhihu-button zhihu-button-primary"
          data-testid="zhihu-search"
          disabled={searchDisabled}
          onClick={() => void runSearch()}>
          {phase === 'loading' ? <Fragment>
            {activityDots()}
            请求中…
          </Fragment> : mode === 'hot' ? '获取热榜' : '搜索'}
        </button>
        {phase === 'loading'
          ? <button
          type="button"
          className="zhihu-button"
          onClick={() => { gate.cancel(); setPhase('idle') }}>
          取消
        </button>
          : null}
      </div>
      {phase === 'idle' && mode !== 'hot' && !query.trim() ? <div className="zhihu-status" role="status">
        输入关键词后搜索。
      </div> : null}
      {phase === 'loading' ? <div className="zhihu-status" role="status">
        {activityDots()}
        正在请求知乎…
      </div> : null}
      {phase === 'error' && failure ? <div className="zhihu-error" role="alert">
        {failure.text}
      </div> : null}
      {phase === 'done' && outcome ? <OutcomeView outcome={outcome} stale={stale} /> : null}
    </div> : null}
    {tab === 'settings' ? <SettingsSection credentials={credentials} /> : null}
    {tab === 'usage' ? <UsageSection rpc={rpc} /> : null}
    {tab === 'knowledge' ? <KnowledgeSection rpc={rpc} Select={Select} /> : null}
  </div>
  const inner = [
    <header key="header" className="zhihu-panel-header">
      <h2 className="zhihu-panel-title">
        知乎资料
      </h2>
      <button
        type="button"
        className="zhihu-panel-close"
        disabled={phase === 'loading'}
        onClick={closePanel}>
        关闭
      </button>
    </header>,
    tablist,
    body,
  ]

  if (surface === 'settings') {
    return (
      <div
        className="zhihu-settings-embed"
        data-testid="zhihu-settings-embed"
        aria-label={SLOT_LABEL}>
        {tablist}
        {body}
      </div>
    );
  }

  // The toggle stays mounted as the launcher anchor. Host Dialog stays mounted
  // while closed so CSS exit can run; standalone unmounts the dock panel.
  return (
    <div className="zhihu-dock">
      <button
        type="button"
        ref={toggleRef}
        className="zhihu-toggle"
        data-testid="zhihu-open"
        onClick={() => setOpen(true)}>
        {SLOT_LABEL}
      </button>
      {Dialog
        ? <Dialog
        open={open}
        onOpenChange={(next: boolean) => { if (!next) closePanel(); else setOpen(true) }}
        title="知乎资料"
        className="file-dialog zhihu-panel"
        overlayClassName="file-dialog-overlay"
        dismissible={phase !== 'loading'}
        initialFocusRef={queryRef}>
        <div data-testid="zhihu-panel" className="zhihu-panel-inner">
          {inner}
        </div>
      </Dialog>
        : open
          ? <section
        className="zhihu-panel"
        data-testid="zhihu-panel"
        aria-label="知乎资料"
        onKeyDown={onPanelKeyDown}>
        {inner}
      </section>
          : null}
    </div>
  );
}

export function apply(ctx: Context): void {
  const style = injectStyles()
  // Styles live and die with the plugin fiber: unload/reload removes the node.
  if (style) ctx.effect(() => () => style.remove(), 'zhihu.styles')
  const client = ctx as ZhihuClientContext
  const overlayRender = (props: unknown) => <ZhihuDock
    rpc={client.connection.rpc}
    credentials={wrapCredentials(client.remote.credentials)}
    surface="overlay"
    {...hostComponentsFromRenderProps(props)} />
  const settingsRender = (props: unknown) => {
    const { Select } = hostComponentsFromRenderProps(props)
    return (
      <ZhihuDock
        rpc={client.connection.rpc}
        credentials={wrapCredentials(client.remote.credentials)}
        surface="settings"
        Select={Select} />
    );
  }
  // Official Web declares shell.overlay. Desktop settings consume the
  // structural seat dsh-editor.settings.zhihu (literal, no shell import).
  // inject() waits for the declaration, so each entry goes live only in the
  // host that actually provides the seat, and unload retracts both.
  client.slots.inject('shell.overlay', () =>
    client.slots.register({ name: 'shell.overlay', id: SLOT_ID, order: SLOT_ORDER, label: SLOT_LABEL }, overlayRender))
  client.slots.inject('dsh-editor.settings.zhihu', () =>
    client.slots.register({ name: 'dsh-editor.settings.zhihu', id: SLOT_ID, order: SLOT_ORDER, label: SLOT_LABEL }, settingsRender))
}
