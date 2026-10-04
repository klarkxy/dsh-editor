import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { manuscriptHostAppearance, radixThemesStyles, rewriteRadixThemesCss } from './themes.tsx'

const require = createRequire(import.meta.url)
const publishedCss = readFileSync(require.resolve('@radix-ui/themes/styles.css'), 'utf8')

describe('manuscript radix themes css', () => {
  it('scopes :root token blocks to .radix-themes without dropping component rules', () => {
    const result = radixThemesStyles || rewriteRadixThemesCss(publishedCss)
    const lines = result.split(/\r?\n/)
    expect(lines.some((line) => line.startsWith(':root,') || line.startsWith(':root {'))).toBe(false)
    expect(result).toContain('.rt-BaseButton')
    expect(result).toContain('.rt-TextFieldRoot')
  })

  it('rewrites only the standalone :root token selectors', () => {
    const rewritten = rewriteRadixThemesCss([
      ':root, .light, .light-theme { --gray-1: #fcfcfc; }',
      ':root { --gray-contrast: white; }',
      '.rt-BaseButton { display: inline-flex; }',
      ":root:where(:has(.radix-themes[data-is-root-theme='true']:where(.light, .light-theme))) { color-scheme: light; }",
    ].join('\n'))
    const lines = rewritten.split('\n')
    expect(lines.some((line) => line.startsWith(':root,') || line.startsWith(':root {'))).toBe(false)
    expect(rewritten).toContain('.rt-BaseButton')
    expect(rewritten).toContain(':root:where(:has(.radix-themes[data-is-root-theme=')
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
