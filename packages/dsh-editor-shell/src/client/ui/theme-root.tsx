import { useLayoutEffect, type ReactNode } from 'react'
import type { ThemeValue } from '../../model/theme.ts'
import { mountDesignScope } from '../../design-system/scope.ts'
import { DesignSystemGallery } from '../../design-system/gallery.tsx'
import { UiRoot } from '../../ui/root.tsx'

/*
 * ShellTheme 输出主题作用域根：`.radix-themes`（样式表的主题作用域类，
 * tokens.ts 的 SCOPE 以此与 [data-dsh-theme] 为根；名字沿用自迁移前的
 * Radix Themes 根，与依赖无关）+ light/dark。样式统一由
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
    <div className={`shell-theme radix-themes ${props.appearance === 'dark' ? 'dark' : 'light'}`}>
      <UiRoot theme={props.appearance === 'dark' ? 'dark' : 'light'}>
        {props.children}
        {/* gallery 在 UiRoot 内：其 Dialog/IconButton 依赖 portal 容器与 TooltipProvider。 */}
        <DesignSystemGallery />
      </UiRoot>
    </div>
  )
}
