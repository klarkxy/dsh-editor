/**
 * 用量设置页:通过 `/manuscript` 通道的 `usage.summary` RPC 拉取本地用量数据,
 * 渲染今日概览与近 7 日分模型堆叠柱状图。后端契约见任务说明:
 *   value = { days: DailyUsage[] }, DailyUsage = { date, inputTokens, outputTokens,
 *   cacheReadTokens, cacheWriteTokens, reasoningTokens, requests, byModel }
 */
import { createElement as e, useEffect, useState, type ReactNode } from 'react'
import type { RpcResult } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { formatNumber as formatLocaleNumber, t, useLocale } from '../i18n/index.ts'

const USAGE_DAYS = 30
const RECENT_DAYS = 7

/* 模型配色:固定调色板,按近 7 日总量降序分配,柱子与图例同色同序。 */
const MODEL_PALETTE = ['#7c9ecb', '#d9a05b', '#8fbf8f', '#c98a8a', '#a48fd0', '#6fb3b3', '#d08bb0', '#b5b56a']

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

function text() {
  return {
  intro: t('usage.intro'),
  todayHeading: t('usage.today'),
  recentHeading: t('usage.recent7'),
  cacheHit: t('usage.cacheHit'),
  input: t('usage.input'),
  output: t('usage.output'),
  requests: t('usage.requests'),
  empty: t('usage.empty'),
  loading: t('zhihu.reading'),
  loadFailed: t('usage.loadFailed'),
  retry: t('common.retry'),
  loadFailedPrefix: t('usage.loadFailedPrefix'),
  note: t('usage.note'),
  }
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return formatLocaleNumber(Math.round(value))
}

function failureMessage(result: RpcResult<unknown>): string {
  const error = (result as { error?: { message?: string } }).error
  return error?.message ?? t('common.requestFailed')
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

/** 单个模型一天的总 tokens:输入+输出+缓存读写。 */
function modelTokens(usage: ModelUsage | undefined): number {
  if (!usage) return 0
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

export type ModelSeries = { key: string; tokens: number; requests: number; color: string }

/** 汇总近 7 日出现过的模型,按总量降序分配调色板颜色,保证柱子与图例同色同序。 */
export function collectModelSeries(days: readonly DailyUsage[]): ModelSeries[] {
  const totals = new Map<string, { tokens: number; requests: number }>()
  for (const day of days) {
    for (const [key, usage] of Object.entries(day.byModel ?? {})) {
      const entry = totals.get(key) ?? { tokens: 0, requests: 0 }
      entry.tokens += modelTokens(usage)
      entry.requests += usage?.requests ?? 0
      totals.set(key, entry)
    }
  }
  return [...totals.entries()]
    .sort((left, right) => right[1].tokens - left[1].tokens || left[0].localeCompare(right[0]))
    .map(([key, value], index) => ({ key, ...value, color: MODEL_PALETTE[index % MODEL_PALETTE.length] }))
}

function dayTotal(day: DailyUsage, series: readonly ModelSeries[]): number {
  return series.reduce((sum, item) => sum + modelTokens(day.byModel?.[item.key]), 0)
}

/** 近 7 日分模型堆叠柱状图,纯 div 实现,不引入图表库。 */
function UsageChart(props: { days: readonly DailyUsage[]; series: readonly ModelSeries[] }): ReactNode {
  const peak = Math.max(1, ...props.days.map((day) => dayTotal(day, props.series)))
  return e('div', { className: 'usage-chart' },
    e('div', { className: 'usage-chart-plot', role: 'img', 'aria-label': t('usage.chartAria') },
      props.days.map((day) => {
        const total = dayTotal(day, props.series)
        return e('div', { className: 'usage-chart-day', key: day.date },
          e('span', { className: 'usage-chart-value' }, total ? formatNumber(total) : ''),
          e('div', { className: 'usage-chart-bar', title: t('usage.barTitle', { date: day.date, total: formatNumber(total) }) },
            props.series.map((item) => {
              const value = modelTokens(day.byModel?.[item.key])
              if (!value) return null
              return e('span', {
                key: item.key,
                className: 'usage-chart-segment',
                style: { height: `${(value / peak) * 100}%`, background: item.color },
                title: `${item.key}: ${formatNumber(value)} tokens`,
              })
            }),
          ),
          e('span', { className: 'usage-chart-date' }, day.date.slice(5).replace('-', '/')),
        )
      }),
    ),
    e('ul', { className: 'usage-chart-legend' },
      props.series.map((item) => e('li', { key: item.key },
        e('span', { className: 'usage-chart-chip', style: { background: item.color }, 'aria-hidden': 'true' }),
        e('span', { className: 'usage-chart-model' }, item.key),
        e('span', { className: 'usage-chart-meta' }, t('usage.legend', { tokens: formatNumber(item.tokens), requests: formatNumber(item.requests) })),
      )),
    ),
  )
}

export function SettingsUsageSection(props: { ctx: ShellContext }): ReactNode {
  useLocale()
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
        setState({ status: 'error', error: t('usage.contract') })
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
    return e('section', { className: 'usage-page', 'aria-label': t('settings.usage') },
      e(Header, null),
      e('p', { className: 'usage-status', role: 'status' }, text().loading),
    )
  }

  if (state.status === 'error') {
    return e('section', { className: 'usage-page', 'aria-label': t('settings.usage') },
      e(Header, null),
      e('p', { className: 'usage-error', role: 'alert' },
        `${text().loadFailedPrefix}${state.error}`,
        e('button', { type: 'button', className: 'usage-button', onClick: () => void load() }, text().retry),
      ),
    )
  }

  return e(Loaded, { summary: state.summary })
}

function Header(): ReactNode {
  return e('header', { className: 'usage-header' },
    e('h2', { className: 'usage-title' }, t('settings.usage')),
    e('p', { className: 'usage-intro' }, text().intro),
  )
}

function Loaded(props: { summary: UsageSummary }): ReactNode {
  const { summary } = props
  const today = summary.days.find((day) => day.date === todayKey())
  const recent = summary.days.slice(-RECENT_DAYS)
  const series = collectModelSeries(recent)
  const hasAny = recent.some((day) => day.requests > 0)

  return e('section', { className: 'usage-page', 'aria-label': t('settings.usage') },
    e(Header, null),
    e('section', { className: 'usage-today', 'aria-label': text().todayHeading },
      e('h3', { className: 'usage-section-title' }, text().todayHeading),
      e('div', { className: 'usage-cards' },
        e(Card, { label: text().cacheHit, value: today?.cacheReadTokens ?? 0 }),
        e(Card, { label: text().input, value: today?.inputTokens ?? 0 }),
        e(Card, { label: text().output, value: today?.outputTokens ?? 0 }),
        e(Card, { label: text().requests, value: today?.requests ?? 0 }),
      ),
    ),
    e('section', { className: 'usage-recent', 'aria-label': text().recentHeading },
      e('h3', { className: 'usage-section-title' }, text().recentHeading),
      !hasAny || series.length === 0
        ? e('p', { className: 'usage-empty' }, text().empty)
        : e(UsageChart, { days: recent, series }),
    ),
    e('p', { className: 'usage-footnote' }, text().note),
  )
}

function Card(props: { label: string; value: number }): ReactNode {
  return e('div', { className: 'usage-card' },
    e('span', { className: 'usage-card-label' }, props.label),
    e('span', { className: 'usage-card-value' }, formatNumber(props.value)),
  )
}
