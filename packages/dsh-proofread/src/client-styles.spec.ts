import { describe, expect, it } from 'vitest'
import { proofreadClientStyles } from './client-styles.ts'

const HOST_DARK = 'html:not([data-theme]) body[data-ds-dark-theme]'
const ROOT_DARK = ':root[data-theme="dark"]'
const ROOTS = [
  '.dsh-proofread-dock',
  '.dsh-proofread-toggle',
  '.dsh-proofread-panel',
] as const

describe('proofread standalone theme selectors', () => {
  it('reads ordinary DSH dark and keeps the desktop dark contract', () => {
    for (const root of ROOTS) {
      expect(proofreadClientStyles).toContain(`${HOST_DARK} ${root}`)
      expect(proofreadClientStyles).toContain(`${ROOT_DARK} ${root}`)
    }
    expect(proofreadClientStyles).not.toMatch(/@media\s*\(\s*prefers-color-scheme/)
  })
})

describe('proofread standalone dock placement', () => {
  it('keeps host --dsh-ext-* overrides and numeric length fallbacks for a bare overlay', () => {
    expect(proofreadClientStyles).toContain('position: var(--dsh-ext-dock-position, absolute);')
    expect(proofreadClientStyles).toContain('right: var(--dsh-ext-dock-right, var(--space-4, 16px));')
    expect(proofreadClientStyles).toContain('bottom: var(--dsh-ext-dock-bottom, var(--space-4, 16px));')
    expect(proofreadClientStyles).toContain('top: var(--dsh-ext-panel-top, auto);')
    expect(proofreadClientStyles).toContain('bottom: var(--dsh-ext-panel-bottom, calc(100% + 6px));')
    expect(proofreadClientStyles).not.toMatch(/right:\s*var\(--dsh-ext-dock-right,\s*var\(--space-4\)\)\s*;/)
    expect(proofreadClientStyles).not.toMatch(/bottom:\s*var\(--dsh-ext-dock-bottom,\s*var\(--space-4\)\)\s*;/)
  })
})

describe('proofread standalone overlay tokens', () => {
  it('paints local Radix tokens only when the overlay is not under .radix-themes', () => {
    expect(proofreadClientStyles).toContain('.dsh-proofread-dock:not(.radix-themes *)')
    expect(proofreadClientStyles).toContain('.dsh-proofread-panel:not(.radix-themes *)')
    expect(proofreadClientStyles).not.toMatch(/:has\(\s*\.radix-themes/)
    expect(proofreadClientStyles).not.toMatch(/@media\s*\(\s*prefers-color-scheme/)
    expect(proofreadClientStyles).toContain('--color-panel-solid: #ffffff')
    expect(proofreadClientStyles).toContain('--color-panel-solid: #191919')
    expect(proofreadClientStyles).toContain('--default-font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif')
    expect(proofreadClientStyles).toContain('--space-4: 16px')
    expect(proofreadClientStyles).toContain('--font-size-2: 14px')
  })
})
