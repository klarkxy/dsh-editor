import { describe, expect, it } from 'vitest'
import { radixFallbackTokens, surfaceTokenAliases } from './tokens.ts'

describe('radix fallback type scale', () => {
  it('matches chrome caption floor and the full Radix size ladder', () => {
    expect(radixFallbackTokens).toContain('--font-size-1: 13px')
    expect(radixFallbackTokens).toContain('--font-size-2: 14px')
    expect(radixFallbackTokens).toContain('--font-size-3: 16px')
    expect(radixFallbackTokens).toContain('--font-size-4: 18px')
    expect(radixFallbackTokens).toContain('--font-size-5: 20px')
    expect(radixFallbackTokens).toContain('--font-size-6: 24px')
    expect(radixFallbackTokens).toContain('--font-size-7: 28px')
    expect(radixFallbackTokens).toContain('--font-size-8: 35px')
    expect(radixFallbackTokens).toContain('--font-size-9: 60px')
    expect(radixFallbackTokens).not.toContain('--font-size-1: 12px')
  })
})

describe('radix fallback contract', () => {
  it('keeps the no-radix gate, both dark triggers, and the spacing ladder', () => {
    expect(radixFallbackTokens).toContain(':root:not(:has(.radix-themes))')
    expect(radixFallbackTokens).toContain(':root[data-theme="dark"]:not(:has(.radix-themes))')
    expect(radixFallbackTokens).toContain('body[data-ds-dark-theme]:not(:has(.radix-themes))')
    expect(radixFallbackTokens).not.toMatch(/@media\s*\(\s*prefers-color-scheme/)
    expect(radixFallbackTokens).toContain('--space-1: 4px')
    expect(radixFallbackTokens).toContain('--space-2: 8px')
    expect(radixFallbackTokens).toContain('--space-3: 12px')
    expect(radixFallbackTokens).toContain('--space-4: 16px')
    expect(radixFallbackTokens).toContain('--space-5: 24px')
    expect(radixFallbackTokens).toContain('--radius-1: 4px')
    expect(radixFallbackTokens).toContain('--radius-2: 8px')
    expect(radixFallbackTokens).toContain('--radius-3: 12px')
    expect(radixFallbackTokens).toContain('--radius-4: 16px')
    expect(radixFallbackTokens).toContain('--radius-5: 20px')
    expect(radixFallbackTokens).toContain('--radius-6: 28px')
  })

  it('provides official neutrals for light main surfaces and dark layers', () => {
    expect(radixFallbackTokens).toContain('--gray-12: #0f1115')
    expect(radixFallbackTokens).toContain('--gray-11: #61666b')
    expect(radixFallbackTokens).toContain('--gray-2: #f9fafb')
    expect(radixFallbackTokens).toContain('--color-background: #ffffff')
    expect(radixFallbackTokens).toContain('--color-background: #151517')
    expect(radixFallbackTokens).toContain('--gray-2: #1b1b1c')
    expect(radixFallbackTokens).toContain('--color-surface: #232324')
    expect(radixFallbackTokens).toContain('--color-panel-solid: #2c2c2e')
    expect(radixFallbackTokens).toContain('--gray-12: #f9fafb')
    expect(radixFallbackTokens).toContain('--gray-11: #adb2b8')
    expect(radixFallbackTokens).toContain('--accent-9: #4176e6')
    expect(radixFallbackTokens).toContain('--accent-9: #7aaaff')
  })
})

describe('surface token aliases', () => {
  it('prefers existing dsh-ui names, then official aliases, then Radix vars', () => {
    expect(surfaceTokenAliases).toContain('--s-text: var(--dsh-ui-text, var(--dsw-alias-label-primary, var(--gray-12)))')
    expect(surfaceTokenAliases).toContain('--s-selected: var(--dsh-ui-selected, var(--dsw-specific-sidebar-nav-item-active, var(--gray-a4)))')
    expect(surfaceTokenAliases).toContain('--s-accent: var(--dsh-ui-accent, var(--dsw-alias-link, var(--accent-9)))')
    expect(surfaceTokenAliases).toContain('--s-radius-md: var(--dsh-ui-radius-md, var(--dsw-radius-md, var(--radius-3)))')
    expect(surfaceTokenAliases).toContain('--s-radius-panel: var(--dsh-ui-radius-2xl, var(--dsw-radius-panel, var(--radius-6, 28px)))')
    expect(surfaceTokenAliases).toContain('--s-elevate: var(--dsh-ui-shadow-lg, var(--dsw-elevation-panel, var(--shadow-4)))')
    expect(surfaceTokenAliases).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(surfaceTokenAliases).not.toMatch(/data-theme|data-ds-dark-theme/)
  })
})
