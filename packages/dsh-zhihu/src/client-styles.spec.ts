import { describe, expect, it } from 'vitest'
import { zhihuClientStyles } from './client-styles.ts'

const HOST_DARK = 'html:not([data-theme]) body[data-ds-dark-theme]'
const ROOT_INK = ':root[data-theme="ink"]'
const ROOTS = [
  '.zhihu-dock',
  '.zhihu-toggle',
  '.zhihu-panel',
  '.dsh-ui.zhihu-panel',
] as const

describe('zhihu standalone theme selectors', () => {
  it('reads ordinary DSH dark and keeps the desktop ink contract', () => {
    for (const root of ROOTS) {
      expect(zhihuClientStyles).toContain(`${HOST_DARK} ${root}`)
      expect(zhihuClientStyles).toContain(`${ROOT_INK} ${root}`)
    }
    expect(zhihuClientStyles).not.toMatch(/@media\s*\(\s*prefers-color-scheme/)
  })

  it('resets host link background on self-contained result titles', () => {
    expect(zhihuClientStyles).toContain('.zhihu-panel .zhihu-link, .zhihu-panel .zhihu-result-title')
    expect(zhihuClientStyles).toContain('.dsh-ui .zhihu-link, .dsh-ui .zhihu-result-title { background: transparent; }')
  })

  it('owns the result-card surface so host list/card paint cannot win contrast', () => {
    expect(zhihuClientStyles).toMatch(
      /\.zhihu-result-item, \.dsh-ui \.zhihu-result-item \{[^}]*background: var\(--surface, #fdfcf6\)/,
    )
    expect(zhihuClientStyles).toContain('.zhihu-result-item:hover, .dsh-ui .zhihu-result-item:hover { background: var(--surface-warm, #e8e6dc); }')
  })

  it('snaps result-item and usage-card surfaces without a background-color transition', () => {
    const rule = (selector: string) => {
      const match = zhihuClientStyles.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`))
      expect(match?.[0], selector).toBeTruthy()
      return match![0]
    }
    const item = rule('.zhihu-result-item, .dsh-ui .zhihu-result-item')
    const usage = rule('.zhihu-usage-card, .dsh-ui .zhihu-usage-card')
    expect(item).toContain('background: var(--surface, #fdfcf6)')
    expect(item).not.toMatch(/transition\s*:[^;]*background-color/)
    expect(usage).toContain('background: var(--bg, #f3f1e8)')
    expect(usage).not.toMatch(/transition\s*:[^;]*background-color/)
    expect(zhihuClientStyles).toContain('.zhihu-result-item:hover, .dsh-ui .zhihu-result-item:hover { background: var(--surface-warm, #e8e6dc); }')
    expect(zhihuClientStyles).toContain('.zhihu-usage-card:hover, .dsh-ui .zhihu-usage-card:hover { background: var(--surface-warm, #e8e6dc); }')
  })
})
