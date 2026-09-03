import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { collectModelSeries } from './client/settings-usage.tsx'

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
    /* 调色板按序分配且稳定 */
    expect(series[0]!.color).not.toBe(series[1]!.color)
    expect(collectModelSeries(days).map((item) => item.color)).toEqual(series.map((item) => item.color))
    /* 没有 byModel 的日子不报错,空数据得到空序列 */
    expect(collectModelSeries([{ date: '2025-01-03', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 1 }])).toEqual([])
  })

  it('renders the stacked bar chart instead of the dry table', () => {
    const source = readFileSync(new URL('./client/settings-usage.tsx', import.meta.url), 'utf8')
    expect(source).toContain('usage-chart')
    expect(source).toContain('collectModelSeries')
    expect(source).not.toContain('usage-table')
    const styleSource = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8')
    expect(styleSource).toContain('.usage-chart-plot')
    expect(styleSource).toContain('.usage-chart-segment')
    expect(styleSource).not.toContain('.usage-table')
  })
})
