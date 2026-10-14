import type { ThemeValue } from './theme.ts'

export function resolveThemePortalContainer(root: Pick<ParentNode, 'querySelector'>): HTMLElement | undefined {
  return root.querySelector<HTMLElement>('.radix-themes.shell-theme')
    ?? root.querySelector<HTMLElement>('.radix-themes')
    ?? undefined
}

export function resolveThemePortalFromAnchor(anchor: Element | null): HTMLElement | undefined {
  return anchor?.closest<HTMLElement>('.radix-themes.shell-theme')
    ?? anchor?.closest<HTMLElement>('.radix-themes')
    ?? undefined
}

export type RegistryCommandItem = {
  id: string
  group: 'workspace' | 'writing' | 'view'
  label: string
  hint?: string
  keywords?: string[]
  disabled?: boolean
  run(): void
}

/** 面板可下达的主题目标；'system' 表示跟随系统（写宿主的 ui-theme 偏好）。 */
export type PaletteThemeTarget = ThemeValue | 'system'

export type CommandPaletteProps = {
  open: boolean
  hotkeysEnabled?: boolean
  onOpenChange(next: boolean): void
  /* 主题与切换(theme.ts 已经提供 useTheme,palette 不直接 import,避免把
     内部 hook 暴露给 props 之外的调用方;根组件把 setTheme 当作回调传进来
     即可)。 */
  theme: ThemeValue
  /* 宿主的 ui-theme 偏好已是「跟随系统」时为真,用来隐藏「跟随系统」命令。 */
  systemTheme?: boolean
  onThemeChange(next: PaletteThemeTarget): void
  /* 动作闭包。palette 只关心"按下时调一下",不关心是不是同步。 */
  onOpenWorkspace(): void
  onNewProject(): void
  onCreateFile?(): void
  onOpenSettings(): void
  onOpenPlugins?(): void
  onToggleFocus(): void
  onOpenDocument(path: string): void
  onOpenSearch(): void
  registryCommands?: readonly RegistryCommandItem[]
  onExport(): void
  onOpenHistory(): void
  onSplitAtCursor(): void
  canSplitAtCursor: boolean
  onToggleTypewriter?(): void
  onToggleFocusParagraph?(): void
  typewriter?: boolean
  focusParagraph?: boolean
  onPinCurrent(): void
  canPinCurrent: boolean
  onUnpin(): void
  pinnedPath: string | null
  /* 当前状态:决定命令的置灰 / 显隐。files 来自 root.ts 的 useState,已经
     是排好序的 markdown/txt 路径。activePath 用于高亮当前打开的文档。 */
  hasWorkspace: boolean
  focusMode: boolean
  files: readonly string[]
  activePath: string
}
