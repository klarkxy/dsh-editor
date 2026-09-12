import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildUsageChartOption,
  collectModelSeries,
  formatUsageTooltip,
  modelDisplayName,
  modelTokens,
} from './client/settings-usage.tsx'

const theme = {
  axis: '#6b6a64',
  split: 'rgba(20, 20, 19, 0.08)',
  tooltipBg: '#fdfcf6',
  tooltipFg: '#141413',
}

describe('usage chart model series', () => {
  it('aggregates per-model totals across days, sorts by volume and assigns stable palette colors', () => {
    const days = [
      { date: '2025-01-01', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 0, byModel: {
        'openai/gpt-5': { inputTokens: 100, outputTokens: 50, requests: 2 },
        'minimax/m3': { inputTokens: 10, outputTokens: 5, cacheReadTokens: 30, requests: 1 },
      } },
      { date: '2025-01-02', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 0, byModel: {
        'openai/gpt-5': { inputTokens: 100, outputTokens: 60, cacheWriteTokens: 20, requests: 3 },
        'minimax/m3': { inputTokens: 10, outputTokens: 5, requests: 1 },
      } },
    ]
    const series = collectModelSeries(days)
    expect(series.map((item) => item.key)).toEqual(['openai/gpt-5', 'minimax/m3'])
    expect(series[0]).toMatchObject({ tokens: 330, requests: 5 })
    expect(series[1]).toMatchObject({ tokens: 60, requests: 2 })
    expect(series[0]!.color).not.toBe(series[1]!.color)
    expect(collectModelSeries(days).map((item) => item.color)).toEqual(series.map((item) => item.color))
    expect(collectModelSeries([{ date: '2025-01-03', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 1 }])).toEqual([])
    expect(series.every((item) => !/#a48fd0|#d08bb0|#c98a8a/i.test(item.color))).toBe(true)
  })

  it('builds stacked bars with honest zeros, readable axes, and exact tooltip totals', () => {
    const days = [
      { date: '2025-01-01', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 0, byModel: {} },
      { date: '2025-01-02', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 1, byModel: {
        'dsh-editor-custom/MiniMax-M3': { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, requests: 1 },
      } },
    ]
    const series = collectModelSeries(days)
    expect(modelTokens(days[1]!.byModel?.['dsh-editor-custom/MiniMax-M3'])).toBe(18)
    expect(modelDisplayName('dsh-editor-custom/MiniMax-M3')).toBe('MiniMax-M3')
    const option = buildUsageChartOption({
      days,
      series,
      theme,
      reduceMotion: true,
      formatNumber: (value) => String(value),
    })
    const stacked = option.series as Array<{ stack?: string; data: number[]; name: string }>
    expect(option.animation).toBe(false)
    expect(stacked).toHaveLength(1)
    expect(stacked[0]).toMatchObject({ stack: 'tokens', data: [0, 18], name: 'dsh-editor-custom/MiniMax-M3' })
    expect((option.yAxis as { min: number }).min).toBe(0)
    expect((option.yAxis as { max?: number }).max).toBeUndefined()
    const tooltip = formatUsageTooltip({
      date: '2025-01-02',
      rows: [{ key: 'dsh-editor-custom/MiniMax-M3', tokens: 18 }],
      total: 18,
      formatNumber: (value) => String(value),
    })
    expect(tooltip).toContain('2025-01-02')
    expect(tooltip).toContain('18')
    expect(tooltip).toContain('dsh-editor-custom/MiniMax-M3')
    expect(tooltip).toContain('<br/>')
    expect((option.tooltip as { confine?: boolean }).confine).toBe(true)
    const empty = buildUsageChartOption({
      days: [days[0]!],
      series: [],
      theme,
      reduceMotion: false,
      formatNumber: (value) => String(value),
    })
    expect((empty.yAxis as { max: number }).max).toBe(1)
    expect(empty.series).toEqual([])
  })

  it('escapes tooltip HTML, wraps lines, and shows the full model identity once', () => {
    const injected = 'third-provider/<b data-testid="chart-injected-model">test</b>'
    const html = formatUsageTooltip({
      date: '2025-01-02',
      rows: [{ key: injected, tokens: 12 }],
      total: 12,
      formatNumber: (value) => String(value),
    })
    expect(html).not.toContain('<b data-testid="chart-injected-model">')
    expect(html).toContain('&lt;b data-testid=&quot;chart-injected-model&quot;&gt;test&lt;/b&gt;')
    expect(html).toContain('<br/>')
    expect(html).not.toContain('\n')
    expect(html.split('third-provider/').length - 1).toBe(1)
    expect(html).toContain('12')
  })

  it('uses tree-shakeable ECharts and keeps an exact-data table beside the chart', () => {
    const source = readFileSync(new URL('./client/settings-usage.tsx', import.meta.url), 'utf8')
    expect(source).toContain("from 'echarts/core'")
    expect(source).toContain("from 'echarts/charts'")
    expect(source).toContain('SVGRenderer')
    expect(source).not.toMatch(/from 'echarts'/)
    expect(source).toContain('usage-chart-table')
    expect(source).toContain('usage.exactData')
    const styleSource = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8')
    expect(styleSource).toContain('.usage-chart-plot')
    expect(styleSource).toContain('.usage-chart-table')
    expect(styleSource).not.toContain('.usage-chart-segment')
  })
})
