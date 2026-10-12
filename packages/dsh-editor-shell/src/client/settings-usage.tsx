/**
 * 用量设置页:通过 `/manuscript` 通道的 `usage.summary` RPC 拉取本地用量数据,
 * 渲染今日概览与近 7 日分模型堆叠柱状图。后端契约见任务说明:
 *   value = { days: DailyUsage[] }, DailyUsage = { date, inputTokens, outputTokens,
 *   cacheReadTokens, cacheWriteTokens, reasoningTokens, requests, byModel }
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Button, Callout, Card, Flex, Grid, Heading, Text } from '@radix-ui/themes'
import { init, use } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import { useReducedMotion } from 'motion/react'
import type { RpcResult } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { ActivitySkeleton } from './ui/index.ts'
import { t, useLocale } from '../i18n/index.ts'
import {
  buildUsageChartOption,
  collectModelSeries,
  failureMessage,
  formatNumber,
  formatUsageLogTime,
  isUsageSummary,
  logTokens,
  modelDisplayName,
  text,
  todayKey,
  usageLogFromSummary,
  RECENT_DAYS,
  USAGE_DAYS,
  type ChartTheme,
  type DailyUsage,
  type ModelSeries,
  type UsageSummary,
} from '../model/settings-usage.ts'

use([BarChart, GridComponent, TooltipComponent, AriaComponent, SVGRenderer])


function cssColor(token: string): string {
  return token.startsWith('--') ? `var(${token})` : token
}

function resolveToken(styles: CSSStyleDeclaration, token: string): string {
  if (!token.startsWith('--')) return token
  return styles.getPropertyValue(token).trim() || cssColor(token)
}

function readChartTheme(node: HTMLElement): ChartTheme {
  const styles = getComputedStyle(node)
  return {
    axis: styles.getPropertyValue('--gray-11').trim(),
    split: styles.getPropertyValue('--gray-a5').trim(),
    tooltipBg: styles.getPropertyValue('--color-panel-solid').trim(),
    tooltipFg: styles.getPropertyValue('--gray-12').trim(),
  }
}

function resolveSeries(node: HTMLElement, series: readonly ModelSeries[]): ModelSeries[] {
  const styles = getComputedStyle(node)
  return series.map((item) => ({ ...item, color: resolveToken(styles, item.color) }))
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
      axis: 'var(--gray-11)',
      split: 'var(--gray-a5)',
      tooltipBg: 'var(--color-panel-solid)',
      tooltipFg: 'var(--gray-12)',
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
        series: resolveSeries(host, props.series),
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

  return (
    <Flex className="usage-chart" direction="column" gap="3" minWidth="0">
      <Box
        ref={hostRef}
        className="usage-chart-plot"
        role="img"
        aria-label={t('usage.chartAria')} />
      <Flex asChild wrap="wrap" gap="4" m="0" p="0">
        <ul className="usage-chart-legend">
          {props.series.map((item) => <li key={item.key} title={item.key}>
            <span
              className="usage-chart-chip"
              style={{ background: cssColor(item.color) }}
              aria-hidden="true" />
            <Text size="1" weight="medium" className="usage-chart-model">
              {modelDisplayName(item.key)}
            </Text>
            <Text size="1" color="gray" className="usage-chart-meta">
              {t('usage.legend', { tokens: formatNumber(item.tokens), requests: formatNumber(item.requests) })}
            </Text>
          </li>)}
        </ul>
      </Flex>
    </Flex>
  );
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
    return (
      <section className="usage-page" aria-label={t('settings.usage')}>
        <Header />
        <Box className="usage-status" role="status" aria-live="polite">
          <ActivitySkeleton lines={5} className="usage-loading" />
          <span className="sr-only">
            {text().loading}
          </span>
        </Box>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="usage-page" aria-label={t('settings.usage')}>
        <Header />
        <Callout.Root color="red" role="alert" className="usage-error">
          <Callout.Text>
            {`${text().loadFailedPrefix}${state.error}`}
          </Callout.Text>
          <Button type="button" variant="soft" color="gray" className="usage-button" onClick={() => void load()}>
            {text().retry}
          </Button>
        </Callout.Root>
      </section>
    );
  }

  return <Loaded summary={state.summary} />;
}

function Header(): ReactNode {
  return null
}

function Loaded(props: { summary: UsageSummary }): ReactNode {
  const { summary } = props
  const today = summary.days.find((day) => day.date === todayKey())
  const recent = summary.days.slice(-RECENT_DAYS)
  const series = collectModelSeries(recent)
  const hasAny = recent.some((day) => day.requests > 0)
  const log = usageLogFromSummary(summary)

  return (
    <section className="usage-page" aria-label={t('settings.usage')}>
      <Header />
      <section className="usage-today settings-block" aria-label={text().todayHeading}>
        <Heading as="h3" size="3" className="usage-section-title settings-block-title" mb="3">
          {text().todayHeading}
        </Heading>
        <Grid className="usage-cards" columns={{ initial: '2', sm: '4' }} gap="3">
          <UsageStatCard label={text().cacheHit} value={today?.cacheReadTokens ?? 0} />
          <UsageStatCard label={text().input} value={today?.inputTokens ?? 0} />
          <UsageStatCard label={text().output} value={today?.outputTokens ?? 0} />
          <UsageStatCard label={text().requests} value={today?.requests ?? 0} />
        </Grid>
      </section>
      <section className="usage-recent settings-block" aria-label={text().recentHeading}>
        <Heading as="h3" size="3" className="usage-section-title settings-block-title" mb="3">
          {text().recentHeading}
        </Heading>
        {!hasAny || series.length === 0
          ? <Text size="2" color="gray" className="usage-empty">
          {text().empty}
        </Text>
          : <UsageChart days={recent} series={series} />}
      </section>
      <section className="usage-log settings-block" aria-label={text().log}>
        <Heading as="h3" size="3" className="usage-section-title settings-block-title" mb="3">
          {text().log}
        </Heading>
        {log.length === 0
          ? <Text size="2" color="gray" className="usage-empty">
          {text().logEmpty}
        </Text>
          : <ul className="usage-log-list">
          {log.map((entry, index) => <li key={`${entry.at}-${entry.model}-${index}`} className="usage-log-row">
            <Text size="1" color="gray" className="usage-log-time">
              {formatUsageLogTime(entry.at)}
            </Text>
            <Text size="2" weight="medium" className="usage-log-model" title={entry.model}>
              {modelDisplayName(entry.model)}
            </Text>
            <Text size="2" className="usage-log-tokens">
              {formatNumber(logTokens(entry))}
            </Text>
          </li>)}
        </ul>}
      </section>
    </section>
  );
}

function UsageStatCard(props: { label: string; value: number }): ReactNode {
  return (
    <Card className="usage-card">
      <Flex direction="column" gap="2">
        <Text size="1" color="gray" className="usage-card-label">
          {props.label}
        </Text>
        <Text size="5" weight="bold" className="usage-card-value">
          {formatNumber(props.value)}
        </Text>
      </Flex>
    </Card>
  );
}
