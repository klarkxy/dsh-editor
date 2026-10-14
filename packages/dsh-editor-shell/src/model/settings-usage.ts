import { format } from 'echarts/core'
import type { EChartsCoreOption } from 'echarts/core'
import type { RpcResult } from '../dsh-compat.ts'
import { intlLocale, t } from '../i18n/index.ts'


export const USAGE_DAYS = 30
export const RECENT_DAYS = 7
const MODEL_PALETTE = ['--dsh-ui-chart-1', '--dsh-ui-chart-2', '--dsh-ui-chart-3', '--dsh-ui-chart-4', '--dsh-ui-chart-5', '--dsh-ui-chart-6', '--dsh-ui-chart-7', '--dsh-ui-chart-8']

export type ModelUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  requests?: number
}

export type UsageLogEntry = {
  at: string
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type DailyUsage = {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  requests: number
  byModel?: Record<string, ModelUsage>
  events?: UsageLogEntry[]
}

export type UsageSummary = {
  days: DailyUsage[]
  log?: UsageLogEntry[]
}

export type ChartTheme = {
  axis: string
  split: string
  tooltipBg: string
  tooltipFg: string
}

export function text() {
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
    log: t('usage.log'),
    logEmpty: t('usage.logEmpty'),
  }
}

/** Compact token/request counts in the UI locale (zh: 万/亿, en: K/M/B/T). */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat(intlLocale(), { notation: 'compact' }).format(value)
}

export function formatNumber(value: number): string {
  return formatCompactNumber(value)
}

export function logTokens(entry: UsageLogEntry): number {
  return (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0) + (entry.cacheReadTokens ?? 0) + (entry.cacheWriteTokens ?? 0)
}

export function formatUsageLogTime(at: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  return new Intl.DateTimeFormat(intlLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

export function usageLogFromSummary(summary: UsageSummary): UsageLogEntry[] {
  if (Array.isArray(summary.log)) {
    return [...summary.log].sort((left, right) => right.at.localeCompare(left.at))
  }
  const events = summary.days.flatMap((day) => day.events ?? [])
  return events.sort((left, right) => right.at.localeCompare(left.at))
}

export function failureMessage(result: RpcResult<unknown>): string {
  const error = (result as { error?: { message?: string } }).error
  return error?.message ?? t('common.requestFailed')
}

export function todayKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isUsageSummary(value: unknown): value is UsageSummary {
  if (typeof value !== 'object' || value === null) return false
  const days = (value as { days?: unknown }).days
  return Array.isArray(days)
}

/** 单个模型一天的总 tokens:输入+输出+缓存读写。 */
export function modelTokens(usage: ModelUsage | undefined): number {
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

export function dayTotal(day: DailyUsage, series: readonly ModelSeries[]): number {
  return series.reduce((sum, item) => sum + modelTokens(day.byModel?.[item.key]), 0)
}

export function modelDisplayName(key: string): string {
  const parts = key.split('/')
  return parts[parts.length - 1] || key
}

export function formatUsageTooltip(input: {
  date: string
  rows: readonly { key: string; tokens: number }[]
  total: number
  formatNumber(value: number): string
}): string {
  const header = `${format.encodeHTML(input.date)} · ${format.encodeHTML(input.formatNumber(input.total))} ${format.encodeHTML(t('usage.tokens'))}`
  const lines = [header]
  for (const row of input.rows) {
    if (!row.tokens) continue
    lines.push(`${format.encodeHTML(row.key)}: ${format.encodeHTML(input.formatNumber(row.tokens))}`)
  }
  return lines.join('<br/>')
}

export function buildUsageChartOption(input: {
  days: readonly DailyUsage[]
  series: readonly ModelSeries[]
  theme: ChartTheme
  reduceMotion: boolean
  formatNumber(value: number): string
}): EChartsCoreOption {
  const { days, series, theme, reduceMotion } = input
  const totals = days.map((day) => dayTotal(day, series))
  const peak = Math.max(0, ...totals)
  return {
    aria: { enabled: true, label: { description: [
      t('usage.recent7'),
      ...days.map((day, index) => day.date + ': ' + input.formatNumber(totals[index] ?? 0) + ' ' + t('usage.tokens')),
    ].join('。') } },
    animation: !reduceMotion,
    color: series.map((item) => item.color),
    grid: { left: 4, right: 8, top: 28, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
      className: 'usage-chart-tooltip',
      extraCssText: 'max-width:min(280px,calc(100% - 16px));white-space:normal;overflow-wrap:anywhere;word-break:break-word;',
      backgroundColor: theme.tooltipBg,
      borderColor: theme.split,
      textStyle: { color: theme.tooltipFg },
      formatter: (raw: unknown) => {
        const params = Array.isArray(raw) ? raw : [raw]
        const first = params[0] as { dataIndex?: number; axisValue?: string } | undefined
        const index = typeof first?.dataIndex === 'number' ? first.dataIndex : 0
        const day = days[index]
        if (!day) return ''
        return formatUsageTooltip({
          date: day.date,
          rows: series.map((item) => ({ key: item.key, tokens: modelTokens(day.byModel?.[item.key]) })),
          total: totals[index] ?? 0,
          formatNumber: input.formatNumber,
        })
      },
    },
    xAxis: {
      type: 'category',
      data: days.map((day) => day.date.slice(5).replace('-', '/')),
      axisLabel: { color: theme.axis },
      axisLine: { lineStyle: { color: theme.split } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: t('usage.tokens'),
      min: 0,
      max: peak === 0 ? 1 : undefined,
      splitNumber: 4,
      axisLabel: { color: theme.axis, formatter: (value: number) => input.formatNumber(value) },
      splitLine: { lineStyle: { color: theme.split } },
      nameTextStyle: { color: theme.axis },
    },
    series: series.map((item) => ({
      name: item.key,
      type: 'bar' as const,
      stack: 'tokens',
      data: days.map((day) => modelTokens(day.byModel?.[item.key])),
      itemStyle: { color: item.color },
      barMaxWidth: 36,
      barMinHeight: 0,
    })),
  }
}
