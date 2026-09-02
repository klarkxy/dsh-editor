/**
 * 用量设置页:通过 `/manuscript` 通道的 `usage.summary` RPC 拉取本地用量数据,
 * 渲染今日概览与近 7 日明细。后端契约见任务说明:
 *   value = { days: DailyUsage[] }, DailyUsage = { date, inputTokens, outputTokens,
 *   cacheReadTokens, cacheWriteTokens, reasoningTokens, requests, byModel }
 */
import { createElement as e, useEffect, useState, type ReactNode } from 'react'
import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { ShellContext } from './shared.ts'

const USAGE_DAYS = 30
const RECENT_DAYS = 7
const LOCALE = 'zh-CN'

type ModelUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  requests?: number
}

type DailyUsage = {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  requests: number
  byModel?: Record<string, ModelUsage>
}

type UsageSummary = {
  days: DailyUsage[]
}

const TEXT = {
  intro: '本机过去 30 天的模型调用统计。',
  todayHeading: '今日',
  recentHeading: '近 7 日',
  cacheHit: '缓存命中',
  input: '输入',
  output: '输出',
  requests: '请求',
  empty: '还没有模型调用记录。',
  loading: '正在读取…',
  loadFailed: '读取用量失败',
  retry: '重试',
  loadFailedPrefix: '加载失败:',
  note: '仅统计本机用量;不含费用估算。',
  colDate: '日期',
  colInput: '输入',
  colOutput: '输出',
  colCache: '缓存命中',
  colRequests: '请求',
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString(LOCALE)
}

function failureMessage(result: RpcResult<unknown>): string {
  const error = (result as { error?: { message?: string } }).error
  return error?.message ?? '请求失败'
}

function todayKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isUsageSummary(value: unknown): value is UsageSummary {
  if (typeof value !== 'object' || value === null) return false
  const days = (value as { days?: unknown }).days
  return Array.isArray(days)
}

export function SettingsUsageSection(props: { ctx: ShellContext }): ReactNode {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; summary: UsageSummary }
    | { status: 'error'; error: string }
  >({ status: 'loading' })

  const load = async (): Promise<void> => {
    setState({ status: 'loading' })
    try {
      const raw = await props.ctx.connection.rpc.call('/manuscript', 'usage.summary', { days: USAGE_DAYS })
      const result = raw as RpcResult<unknown>
      if (!result.ok) {
        setState({ status: 'error', error: failureMessage(result) })
        return
      }
      if (!isUsageSummary(result.value)) {
        setState({ status: 'error', error: '返回数据格式不符合契约' })
        return
      }
      setState({ status: 'ready', summary: result.value })
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  useEffect(() => {
    void load()
  }, [props.ctx])

  if (state.status === 'loading') {
    return e('section', { className: 'usage-page', 'aria-label': '用量' },
      e(Header, null),
      e('p', { className: 'usage-status', role: 'status' }, TEXT.loading),
    )
  }

  if (state.status === 'error') {
    return e('section', { className: 'usage-page', 'aria-label': '用量' },
      e(Header, null),
      e('p', { className: 'usage-error', role: 'alert' },
        `${TEXT.loadFailedPrefix}${state.error}`,
        e('button', { type: 'button', className: 'usage-button', onClick: () => void load() }, TEXT.retry),
      ),
    )
  }

  return e(Loaded, { summary: state.summary })
}

function Header(): ReactNode {
  return e('header', { className: 'usage-header' },
    e('h2', { className: 'usage-title' }, '用量'),
    e('p', { className: 'usage-intro' }, TEXT.intro),
  )
}

function Loaded(props: { summary: UsageSummary }): ReactNode {
  const { summary } = props
  const today = summary.days.find((day) => day.date === todayKey())
  const recent = summary.days.slice(-RECENT_DAYS).reverse()
  const hasAny = summary.days.some((day) => day.requests > 0)

  return e('section', { className: 'usage-page', 'aria-label': '用量' },
    e(Header, null),
    e('section', { className: 'usage-today', 'aria-label': TEXT.todayHeading },
      e('h3', { className: 'usage-section-title' }, TEXT.todayHeading),
      e('div', { className: 'usage-cards' },
        e(Card, { label: TEXT.cacheHit, value: today?.cacheReadTokens ?? 0 }),
        e(Card, { label: TEXT.input, value: today?.inputTokens ?? 0 }),
        e(Card, { label: TEXT.output, value: today?.outputTokens ?? 0 }),
        e(Card, { label: TEXT.requests, value: today?.requests ?? 0 }),
      ),
    ),
    e('section', { className: 'usage-recent', 'aria-label': TEXT.recentHeading },
      e('h3', { className: 'usage-section-title' }, TEXT.recentHeading),
      !hasAny || recent.length === 0
        ? e('p', { className: 'usage-empty' }, TEXT.empty)
        : e('table', { className: 'usage-table' },
            e('thead', null,
              e('tr', null,
                e('th', { scope: 'col' }, TEXT.colDate),
                e('th', { scope: 'col' }, TEXT.colInput),
                e('th', { scope: 'col' }, TEXT.colOutput),
                e('th', { scope: 'col' }, TEXT.colCache),
                e('th', { scope: 'col' }, TEXT.colRequests),
              ),
            ),
            e('tbody', null,
              recent.map((day) => e('tr', { key: day.date },
                e('th', { scope: 'row' }, day.date),
                e('td', null, formatNumber(day.inputTokens)),
                e('td', null, formatNumber(day.outputTokens)),
                e('td', null, formatNumber(day.cacheReadTokens)),
                e('td', null, formatNumber(day.requests)),
              )),
            ),
          ),
    ),
    e('p', { className: 'usage-footnote' }, TEXT.note),
  )
}

function Card(props: { label: string; value: number }): ReactNode {
  return e('div', { className: 'usage-card' },
    e('span', { className: 'usage-card-label' }, props.label),
    e('span', { className: 'usage-card-value' }, formatNumber(props.value)),
  )
}
