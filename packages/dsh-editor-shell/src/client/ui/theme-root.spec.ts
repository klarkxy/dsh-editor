import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { ACCENT_TO_RADIX, SHELL_GRAY_COLOR, radixThemesStyles, rewriteRadixThemesCss } from './theme-root.tsx'

const require = createRequire(import.meta.url)
const publishedCss = readFileSync(require.resolve('@radix-ui/themes/styles.css'), 'utf8')

describe('radix themes css rewrite', () => {
  it('scopes :root token blocks to .radix-themes without dropping component rules', () => {
    const result = radixThemesStyles || rewriteRadixThemesCss(publishedCss)
    const lines = result.split(/\r?\n/)
    expect(lines.some((line) => line.startsWith(':root,') || line.startsWith(':root {'))).toBe(false)
    expect(result).toContain('.rt-BaseButton')
    expect(result).toContain(":root:where(:has(.radix-themes[data-is-root-theme='true']")
  })

  it('rewrites only the standalone :root token selectors', () => {
    const rewritten = rewriteRadixThemesCss([
      ':root, .light, .light-theme { --gray-1: #fcfcfc; }',
      ':root { --gray-contrast: white; }',
      ".rt-BaseButton { display: inline-flex; }",
      ":root:where(:has(.radix-themes[data-is-root-theme='true']:where(.light, .light-theme))) { color-scheme: light; }",
    ].join('\n'))
    const lines = rewritten.split('\n')
    expect(lines.some((line) => line.startsWith(':root,') || line.startsWith(':root {'))).toBe(false)
    expect(rewritten).toContain('.rt-BaseButton')
    expect(rewritten).toContain(':root:where(:has(.radix-themes[data-is-root-theme=')
  })

  it('anchors neutrals on gray for the official web design adapter', () => {
    expect(SHELL_GRAY_COLOR).toBe('gray')
  })

  it('maps stored accents onto Radix accent colors', () => {
    expect(ACCENT_TO_RADIX).toEqual({
      indigo: 'indigo',
      blue: 'blue',
      teal: 'teal',
      green: 'green',
      amber: 'amber',
      crimson: 'crimson',
      violet: 'violet',
    })
  })
})
