/** Synthetic usage fixtures; no vendor credentials or requests. */
export function usageFixture(kind = 'mixed') {
  const keys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 6 + i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const days = keys.map(date => ({ date, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 0, byModel: {} }))
  const add = (i, model, inputTokens, outputTokens, cacheReadTokens, requests) => {
    const m = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens: 0, requests }
    days[i].byModel[model] = m
    for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'requests']) days[i][k] += m[k]
  }
  if (kind !== 'empty') add(6, 'dsh-editor-custom/MiniMax-M3', 18363, 2185, 30516, 4)
  if (kind === 'markup') add(6, 'third-provider/<b data-testid="chart-injected-model">test</b>', 100, 0, 0, 1)
  if (kind === 'mixed') {
    add(1, 'dsh-editor-custom/MiniMax-M3', 500, 300, 200, 1)
    add(2, 'dsh-editor-custom/MiniMax-M3', 4000, 1000, 3000, 2)
    add(2, 'second-provider/a-very-long-model-name-for-responsive-layout-verification', 1000, 500, 500, 1)
    add(4, 'second-provider/a-very-long-model-name-for-responsive-layout-verification', 10000, 5000, 5000, 3)
    add(5, 'dsh-editor-custom/MiniMax-M3', 500, 300, 200, 1)
    add(5, 'second-provider/a-very-long-model-name-for-responsive-layout-verification', 2000, 1000, 1000, 1)
    add(6, 'second-provider/a-very-long-model-name-for-responsive-layout-verification', 15000, 4000, 7000, 2)
  }
  return { days }
}
