import { describe, expect, it } from 'vitest'
import { manuscriptHostAppearance, manuscriptStandaloneStyles } from './themes.tsx'

describe('manuscript standalone theme tokens', () => {
  it('scopes the palettes to the manuscript theme wrapper, never :root', () => {
    expect(manuscriptStandaloneStyles).toContain('.radix-themes[data-dsh-manuscript-theme]')
    expect(manuscriptStandaloneStyles).toContain('.radix-themes[data-dsh-manuscript-theme].dark')
    expect(manuscriptStandaloneStyles).not.toMatch(/(^|\n):root/)
    expect(manuscriptStandaloneStyles).toContain('--gray-12: #0f1115')
    expect(manuscriptStandaloneStyles).toContain('--gray-12: #f9fafb')
  })

  it('bridges 原稿 tokens for standalone consumers', () => {
    expect(manuscriptStandaloneStyles).toContain('--dsh-ui-text: var(--dsw-alias-label-primary, var(--gray-12))')
    expect(manuscriptStandaloneStyles).toContain('--dsh-ui-accent:')
    expect(manuscriptStandaloneStyles).toContain('--dsh-ui-warning-soft:')
  })
})

function host(theme: string | null, bodyDark: boolean) {
  return {
    documentElement: { getAttribute: (name: string) => name === 'data-theme' ? theme : null },
    body: { hasAttribute: (name: string) => bodyDark && name === 'data-ds-dark-theme' },
  }
}

describe('manuscript host appearance', () => {
  it('treats an official body dark marker as dark when html has no data-theme', () => {
    expect(manuscriptHostAppearance(host(null, true))).toBe('dark')
    expect(manuscriptHostAppearance(host(null, false))).toBe('light')
    expect(manuscriptHostAppearance(host('light', true))).toBe('dark')
  })

  it('follows light, dark, and light again while the host markers change', () => {
    expect(manuscriptHostAppearance(host(null, false))).toBe('light')
    expect(manuscriptHostAppearance(host(null, true))).toBe('dark')
    expect(manuscriptHostAppearance(host('dark', false))).toBe('dark')
    expect(manuscriptHostAppearance(host('light', false))).toBe('light')
  })
})
