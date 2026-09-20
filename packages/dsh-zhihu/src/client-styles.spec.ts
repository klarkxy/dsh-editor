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
      /\.zhihu-result-item \{[^}]*background: var\(--color-panel-solid\)/,
    )
    expect(zhihuClientStyles).toContain('.zhihu-result-item:hover { background: var(--gray-3); }')
    expect(zhihuClientStyles).toContain('.zhihu-panel a.zhihu-result-title')
  })

  it('snaps result-item and usage-card surfaces without a background-color transition', () => {
    const rule = (selector: string) => {
      const match = zhihuClientStyles.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`))
      expect(match?.[0], selector).toBeTruthy()
      return match![0]
    }
    const item = rule('.zhihu-result-item')
    const usage = rule('.zhihu-usage-card')
    expect(item).toContain('background: var(--color-panel-solid)')
    expect(item).not.toMatch(/transition\s*:[^;]*background-color/)
    expect(usage).toContain('background: var(--color-panel-solid)')
    expect(usage).not.toMatch(/transition\s*:[^;]*background-color/)
    expect(zhihuClientStyles).toContain('.zhihu-result-item:hover { background: var(--gray-3); }')
    expect(zhihuClientStyles).toContain('.zhihu-usage-card:hover { background: var(--gray-a3); }')
  })
})

describe('zhihu standalone dock placement', () => {
  it('keeps host --dsh-ext-* overrides and numeric length fallbacks for a bare overlay', () => {
    expect(zhihuClientStyles).toContain('position: var(--dsh-ext-dock-position, absolute);')
    expect(zhihuClientStyles).toContain('right: var(--dsh-ext-dock-right, var(--space-4, 16px));')
    expect(zhihuClientStyles).toContain('bottom: var(--dsh-ext-dock-bottom, calc(var(--space-4, 16px) + 44px));')
    expect(zhihuClientStyles).toContain('top: var(--dsh-ext-panel-top, auto);')
    expect(zhihuClientStyles).toContain('bottom: var(--dsh-ext-panel-bottom, calc(100% + 6px));')
    expect(zhihuClientStyles).not.toMatch(/right:\s*var\(--dsh-ext-dock-right,\s*var\(--space-4\)\)\s*;/)
    expect(zhihuClientStyles).not.toMatch(/bottom:\s*var\(--dsh-ext-dock-bottom,\s*calc\(var\(--space-4\) \+ 44px\)\)/)
  })
})

describe('zhihu standalone overlay tokens', () => {
  it('paints local Radix tokens only when the overlay is not under .radix-themes', () => {
    expect(zhihuClientStyles).toContain('.zhihu-dock:not(.radix-themes *)')
    expect(zhihuClientStyles).toContain('.zhihu-panel:not(.radix-themes *)')
    expect(zhihuClientStyles).not.toMatch(/:has\(\s*\.radix-themes/)
    expect(zhihuClientStyles).not.toMatch(/@media\s*\(\s*prefers-color-scheme/)
    expect(zhihuClientStyles).toContain('--color-panel-solid: #ffffff')
    expect(zhihuClientStyles).toContain('--color-panel-solid: #191919')
    expect(zhihuClientStyles).toContain('--default-font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif')
    expect(zhihuClientStyles).toContain('--space-4: 16px')
    expect(zhihuClientStyles).toContain('--font-size-2: 14px')
  })
})
