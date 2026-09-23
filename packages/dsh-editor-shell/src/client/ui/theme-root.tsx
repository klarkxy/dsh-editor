import { Theme, type ThemeProps } from '@radix-ui/themes'
import radixThemesCss from '@radix-ui/themes/styles.css'
import type { ReactNode } from 'react'
import type { AccentValue, ThemeValue } from '../theme.tsx'

export function rewriteRadixThemesCss(css: string): string {
  const rewritten = css
    .replaceAll(':root, .light, .light-theme {', '.radix-themes, .light, .light-theme {')
    .replaceAll(':root {', '.radix-themes {')
  if ((css.includes(':root') && rewritten === css) || /:root\s*[{,]/.test(rewritten)) {
    console.error('[theme-root] Radix Themes CSS rewrite matched no `:root` selector; theme variables will not apply. The upstream styles.css format has likely changed.')
  }
  return rewritten
}

export const radixThemesStyles = rewriteRadixThemesCss(radixThemesCss)

export const ACCENT_TO_RADIX: Record<AccentValue, ThemeProps['accentColor']> = {
  indigo: 'indigo',
  blue: 'blue',
  teal: 'teal',
  green: 'green',
  amber: 'amber',
  crimson: 'crimson',
  violet: 'violet',
}

export const SHELL_GRAY_COLOR: ThemeProps['grayColor'] = 'sand'

export function ShellTheme(props: {
  appearance: ThemeValue
  accent: AccentValue
  children?: ReactNode
}) {
  return (
    <Theme
      className="shell-theme"
      appearance={props.appearance}
      accentColor={ACCENT_TO_RADIX[props.accent]}
      grayColor={SHELL_GRAY_COLOR}
      radius="large"
      scaling="100%"
      panelBackground="solid"
    >
      {props.children}
    </Theme>
  )
}
