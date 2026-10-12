import { Theme, type ThemeProps } from '@radix-ui/themes'
import { useLayoutEffect, type ReactNode } from 'react'
import type { AccentValue, ThemeValue } from '../../model/theme.ts'
import { ACCENT_TO_RADIX, radixThemesStyles, SHELL_GRAY_COLOR } from '../../model/theme-root.ts'
import { designSystemStyles } from '../../design-system/styles.ts'
import { DESIGN_SYSTEM_ID } from '../../design-system/tokens.ts'
import { mountDesignScope } from '../../design-system/scope.ts'
import { DesignSystemGallery } from '../../design-system/gallery.tsx'


export function ShellTheme(props: {
  appearance: ThemeValue
  accent: AccentValue
  children?: ReactNode
}) {
  // Scope includes body portals, but disappears when this shell unmounts.
  // It never keys/remounts the editor or changes the host's theme preference.
  useLayoutEffect(() => mountDesignScope(document.documentElement), [])
  return (
    <Theme
      className="shell-theme"
      appearance={props.appearance}
      accentColor={ACCENT_TO_RADIX[props.accent]}
      grayColor={SHELL_GRAY_COLOR}
      radius="medium"
      scaling="100%"
      panelBackground="solid"
    >
      <style data-dsh-design-styles={DESIGN_SYSTEM_ID}>{designSystemStyles}</style>
      {props.children}
      <DesignSystemGallery />
    </Theme>
  )
}
