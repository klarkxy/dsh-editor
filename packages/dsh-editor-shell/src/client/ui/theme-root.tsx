import radixThemesCss from '@radix-ui/themes/styles.css'
import { useLayoutEffect, type ReactNode } from 'react'
import type { ThemeValue } from '../../model/theme.ts'
import { rewriteRadixThemesCss } from '../../model/theme-root.ts'
import { mountDesignScope } from '../../design-system/scope.ts'
import { DesignSystemGallery } from '../../design-system/gallery.tsx'
import { UiRoot } from '../../ui/root.tsx'

export const radixThemesStyles = rewriteRadixThemesCss(radixThemesCss)

export const SHELL_GRAY_COLOR = 'gray'

/*
 * 迁移期 ShellTheme：旧 Radix <Theme> 渲染出的 DOM（.radix-themes + data-*）
 * 由这里的普通 div 原样输出——注入表里的 accent/gray 变量与 .rt-
 * 选择器仍以它为作用域，直到 Phase 6a 的变量退役与 legacy 层折叠完成。
 * accentColor 固定 indigo（design-system-spec §1）；样式统一由
 * registerShellRoot 的 injectShellStyles 注入 head。
 */
export function ShellTheme(props: {
  appearance: ThemeValue
  children?: ReactNode
}) {
  // Scope includes body portals, but disappears when this shell unmounts.
  // It never keys/remounts the editor or changes the host's theme preference.
  useLayoutEffect(() => mountDesignScope(document.documentElement), [])
  return (
    <div
      className={`shell-theme radix-themes ${props.appearance === 'dark' ? 'dark' : 'light'}`}
      data-is-root-theme="true"
      data-accent-color="indigo"
      data-gray-color={SHELL_GRAY_COLOR}
      data-has-background="true"
      data-panel-background="solid"
      data-radius="medium"
      data-scaling="100%"
    >
      <UiRoot theme={props.appearance === 'dark' ? 'dark' : 'light'}>
        {props.children}
        {/* gallery 在 UiRoot 内：其 Dialog/IconButton 依赖 portal 容器与 TooltipProvider。 */}
        <DesignSystemGallery />
      </UiRoot>
    </div>
  )
}
