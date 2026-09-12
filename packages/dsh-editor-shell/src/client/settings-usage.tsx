/**
 * 用量设置页:通过 `/manuscript` 通道的 `usage.summary` RPC 拉取本地用量数据,
 * 渲染今日概览与近 7 日分模型堆叠柱状图。后端契约见任务说明:
 *   value = { days: DailyUsage[] }, DailyUsage = { date, inputTokens, outputTokens,
 *   cacheReadTokens, cacheWriteTokens, reasoningTokens, requests, byModel }
 */
import { createElement as e, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { format, init, use } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'
import { useReducedMotion } from 'motion/react'
import type { RpcResult } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { formatNumber as formatLocaleNumber, t, useLocale } from '../i18n/index.ts'

use([BarChart, GridComponent, TooltipComponent, AriaComponent, SVGRenderer])

const USAGE_DAYS = 30
const RECENT_DAYS = 7

/* 模型配色:纸/墨可用的闷蓝、赭、绿,按近 7 日总量降序分配,柱子与图例同色同序。 */
const MODEL_PALETTE = ['#7c9ecb', '#d9a05b', '#8fbf8f', '#6b9e8a', '#c4a574', '#5f8aa8', '#9bb07a', '#b8956a']

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

export type ChartTheme = {
  axis: string
  split: string
  tooltipBg: string
  tooltipFg: string
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
    aria: { enabled: true },
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

function readChartTheme(node: HTMLElement): ChartTheme {
  const styles = getComputedStyle(node)
  return {
    axis: styles.getPropertyValue('--meta').trim() || '#6b6a64',
    split: styles.getPropertyValue('--hairline').trim() || 'rgba(20, 20, 19, 0.08)',
    tooltipBg: styles.getPropertyValue('--surface').trim() || '#fdfcf6',
    tooltipFg: styles.getPropertyValue('--fg').trim() || '#141413',
  }
}

function UsageChart(props: { days: readonly DailyUsage[]; series: readonly ModelSeries[] }): ReactNode {
  const locale = useLocale()
  const reduceMotion = Boolean(useReducedMotion())
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<EChartsType | null>(null)

  const option = useMemo(() => buildUsageChartOption({
    days: props.days,
    series: props.series,
    theme: {
      axis: '#6b6a64',
      split: 'rgba(20, 20, 19, 0.08)',
      tooltipBg: '#fdfcf6',
      tooltipFg: '#141413',
    },
    reduceMotion,
    formatNumber,
  }), [props.days, props.series, reduceMotion, locale])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const sync = () => {
      if (disposed) return
      const box = host.getBoundingClientRect()
      if (box.width < 8 || box.height < 8) return
      const themed = buildUsageChartOption({
        days: props.days,
        series: props.series,
        theme: readChartTheme(host),
        reduceMotion,
        formatNumber,
      })
      if (!chartRef.current) {
        chartRef.current = init(host, undefined, { renderer: 'svg' })
      } else {
        chartRef.current.resize()
      }
      chartRef.current.setOption(themed, { notMerge: true })
    }
    const resize = new ResizeObserver(() => sync())
    resize.observe(host)
    const theme = new MutationObserver(() => sync())
    const root = globalThis.document?.documentElement
    if (root) theme.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    sync()
    return () => {
      disposed = true
      resize.disconnect()
      theme.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [option, props.days, props.series, reduceMotion])

  return e('div', { className: 'usage-chart' },
    e('div', {
      ref: hostRef,
      className: 'usage-chart-plot',
      role: 'img',
      'aria-label': t('usage.chartAria'),
    }),
    e('ul', { className: 'usage-chart-legend' },
      props.series.map((item) => e('li', { key: item.key, title: item.key },
        e('span', { className: 'usage-chart-chip', style: { background: item.color }, 'aria-hidden': 'true' }),
        e('span', { className: 'usage-chart-model' }, modelDisplayName(item.key)),
        e('span', { className: 'usage-chart-meta' }, t('usage.legend', { tokens: formatNumber(item.tokens), requests: formatNumber(item.requests) })),
      )),
    ),
    e('details', { className: 'usage-chart-table' },
      e('summary', null, t('usage.exactData')),
      e('table', null,
        e('caption', { className: 'sr-only' }, t('usage.chartAria')),
        e('thead', null,
          e('tr', null,
            e('th', { scope: 'col' }, t('usage.recent7')),
            ...props.series.map((item) => e('th', { key: item.key, scope: 'col', title: item.key }, modelDisplayName(item.key))),
            e('th', { scope: 'col' }, t('usage.dayTotal')),
          ),
        ),
        e('tbody', null,
          props.days.map((day) => e('tr', { key: day.date },
            e('th', { scope: 'row' }, day.date),
            ...props.series.map((item) => e('td', { key: item.key }, formatNumber(modelTokens(day.byModel?.[item.key])))),
            e('td', null, formatNumber(dayTotal(day, props.series))),
          )),
        ),
      ),
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
    e('section', { className: 'usage-today settings-block', 'aria-label': text().todayHeading },
      e('h3', { className: 'usage-section-title settings-block-title' }, text().todayHeading),
      e('div', { className: 'usage-cards' },
        e(Card, { label: text().cacheHit, value: today?.cacheReadTokens ?? 0 }),
        e(Card, { label: text().input, value: today?.inputTokens ?? 0 }),
        e(Card, { label: text().output, value: today?.outputTokens ?? 0 }),
        e(Card, { label: text().requests, value: today?.requests ?? 0 }),
      ),
    ),
    e('section', { className: 'usage-recent settings-block', 'aria-label': text().recentHeading },
      e('h3', { className: 'usage-section-title settings-block-title' }, text().recentHeading),
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
