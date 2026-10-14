import { useLayoutEffect, type ReactNode } from 'react'
import type { ThemeValue } from '../../model/theme.ts'
import { mountDesignScope } from '../../design-system/scope.ts'
import { DesignSystemGallery } from '../../design-system/gallery.tsx'
import { UiRoot } from '../../ui/root.tsx'

export const SHELL_GRAY_COLOR = 'gray'

/*
 * ShellTheme 输出旧 Radix <Theme> 的 DOM（.radix-themes + data-*）作为
 * 主题作用域：tokens.ts 的 TOKEN_SCOPE 与 legacy 层里尚未折叠的
 * `.radix-themes` 选择器仍以它为根，直到 6a-3 的层折叠完成。
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
