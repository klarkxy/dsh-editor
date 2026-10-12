import { Theme, type ThemeProps } from '@radix-ui/themes'
import radixThemesCss from '@radix-ui/themes/styles.css'
import { useLayoutEffect, type ReactNode } from 'react'
import type { ThemeValue } from '../../model/theme.ts'
import { rewriteRadixThemesCss } from '../../model/theme-root.ts'
import { mountDesignScope } from '../../design-system/scope.ts'
import { DesignSystemGallery } from '../../design-system/gallery.tsx'
import { UiRoot } from '../../ui/root.tsx'

export const radixThemesStyles = rewriteRadixThemesCss(radixThemesCss)

export const SHELL_GRAY_COLOR: ThemeProps['grayColor'] = 'gray'

/*
 * 迁移期 Radix Themes 的 accentColor 固定 indigo（design-system-spec §1）。
 * 样式统一由 registerShellRoot 的 injectShellStyles 注入 head。
 */
export function ShellTheme(props: {
  appearance: ThemeValue
  children?: ReactNode
}) {
  // Scope includes body portals, but disappears when this shell unmounts.
  // It never keys/remounts the editor or changes the host's theme preference.
  useLayoutEffect(() => mountDesignScope(document.documentElement), [])
  return (
    <Theme
      className="shell-theme"
      appearance={props.appearance}
      accentColor="indigo"
      grayColor={SHELL_GRAY_COLOR}
      radius="medium"
      scaling="100%"
      panelBackground="solid"
    >
      {/* §3：迁移期 UiRoot 放在旧的 ShellTheme 内部。 */}
      <UiRoot theme={props.appearance === 'dark' ? 'dark' : 'light'}>
        {props.children}
        {/* gallery 在 UiRoot 内：其 Dialog/IconButton 依赖 portal 容器与 TooltipProvider。 */}
        <DesignSystemGallery />
      </UiRoot>
    </Theme>
  )
}
