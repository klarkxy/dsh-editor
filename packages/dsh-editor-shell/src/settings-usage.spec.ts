import { describe, expect, it } from 'vitest'
import {
  buildUsageChartOption,
  collectModelSeries,
  formatCompactNumber,
  formatUsageTooltip,
  logTokens,
  modelDisplayName,
  modelTokens,
  usageLogFromSummary,
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
    expect(series.map((item) => item.color)).toEqual(['--indigo-9', '--teal-9'])
    expect(collectModelSeries(days).map((item) => item.color)).toEqual(series.map((item) => item.color))
    expect(collectModelSeries([{ date: '2025-01-03', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 1 }])).toEqual([])
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

  it('compacts counts with K / M / T after the stated thresholds', () => {
    expect(formatCompactNumber(0)).toBe('0')
    expect(formatCompactNumber(999)).toBe('999')
    expect(formatCompactNumber(1000)).toBe('1K')
    expect(formatCompactNumber(1500)).toBe('1.5K')
    expect(formatCompactNumber(51064)).toBe('51K')
    expect(formatCompactNumber(999_999)).toBe('1000K')
    expect(formatCompactNumber(1_000_000)).toBe('1M')
    expect(formatCompactNumber(1_250_000)).toBe('1.3M')
    expect(formatCompactNumber(1_000_000_000_000)).toBe('1T')
  })

  it('lists request log newest first and totals tokens the same way as the chart', () => {
    const log = usageLogFromSummary({
      days: [],
      log: [
        { at: '2026-09-17T01:00:00.000Z', model: 'custom/MiniMax-M3', inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0 },
        { at: '2026-09-17T03:00:00.000Z', model: 'custom/other', inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ],
    })
    expect(log.map((row) => row.model)).toEqual(['custom/other', 'custom/MiniMax-M3'])
    expect(logTokens(log[1]!)).toBe(125)
  })
})
