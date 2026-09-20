import { describe, expect, it } from 'vitest'
import { zhihuClientStyles } from './client-styles.ts'

const HOST_DARK = 'html:not([data-theme]) body[data-ds-dark-theme]'
const ROOT_DARK = ':root[data-theme="dark"]'
const ROOTS = [
  '.zhihu-dock',
  '.zhihu-toggle',
  '.zhihu-panel',
] as const

describe('zhihu standalone theme selectors', () => {
  it('reads ordinary DSH dark and keeps the desktop dark contract', () => {
    for (const root of ROOTS) {
      expect(zhihuClientStyles).toContain(`${HOST_DARK} ${root}`)
      expect(zhihuClientStyles).toContain(`${ROOT_DARK} ${root}`)
    }
    expect(zhihuClientStyles).not.toMatch(/@media\s*\(\s*prefers-color-scheme/)
  })

  it('stacks settings and knowledge copy so capability notes have a gap', () => {
    expect(zhihuClientStyles).toMatch(/\.zhihu-settings, \.zhihu-knowledge \{[^}]*display: flex/)
    expect(zhihuClientStyles).toContain('.zhihu-intro {')
    expect(zhihuClientStyles).toContain('.zhihu-field > .zhihu-intro { margin-bottom: var(--space-2); }')
  })

  it('resets host link background on self-contained result titles', () => {
    expect(zhihuClientStyles).toContain('.zhihu-panel .zhihu-link, .zhihu-panel .zhihu-result-title { background: transparent; }')
  })

  it('owns the result-card surface so host list/card paint cannot win contrast', () => {
    expect(zhihuClientStyles).toMatch(
      /\.zhihu-result-item \{[^}]*background: var\(--color-surface\)/,
    )
    expect(zhihuClientStyles).toContain('.zhihu-result-item:hover { background: var(--gray-a3); }')
  })

  it('snaps result-item and usage-card surfaces without a background-color transition', () => {
    const rule = (selector: string) => {
      const match = zhihuClientStyles.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`))
      expect(match?.[0], selector).toBeTruthy()
      return match![0]
    }
    const item = rule('.zhihu-result-item')
    const usage = rule('.zhihu-usage-card')
    expect(item).toContain('background: var(--color-surface)')
    expect(item).not.toMatch(/transition\s*:[^;]*background-color/)
    expect(usage).toContain('background: var(--color-panel-solid)')
    expect(usage).not.toMatch(/transition\s*:[^;]*background-color/)
    expect(zhihuClientStyles).toContain('.zhihu-result-item:hover { background: var(--gray-a3); }')
    expect(zhihuClientStyles).toContain('.zhihu-usage-card:hover { background: var(--gray-a3); }')
  })
})
