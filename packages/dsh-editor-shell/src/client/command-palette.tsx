/*
 * DSH Editor 命令面板:Cmd/Ctrl+K 触发的浮层。Radix Dialog 负责焦点陷阱/aria
 * (cmdk 自带 Dialog 用的是同一个底层库,但我们要把 token 和现有对话框/首页卡
 * 风格对齐,所以分开组合,自己控制 Portal/Overlay/Content 的 className),
 * cmdk 负责输入过滤 + 命令项渲染。
 *
 * 设计要点:
 *   - 不与 root.ts 现有的工作区快捷键冲突:Cmd/Ctrl+K 是新增的,没有占用
 *     workspaceShortcut 任何分支(后者只处理 Ctrl+,/B/J/\\/L/Alt+[/])。
 *   - 关闭时不残留热键:本组件挂自己的 keydown 监听(只接受 K 切换 / Esc 关
 *     闭),卸载时移除;同时在 root.ts 的全局热键里也加入 Cmd+K 触发入口,
 *     让命令面板从外部唤起与自身切换走同一条路径。
 *   - 文件快速跳转的来源是 root.ts 现有 files 状态(已经按章节顺序排好),无
 *     需重复发 RPC;选中后调用同一个 openDocument 闭包,与点击树行等价。
 *   - 状态灰显:没有打开工作台时只显示作品级命令,置灰依赖根状态的命令;关
 *     注模式按钮复用 root.ts 现有的 setFocusMode 切换。
 *   - 整个文件用 .tsx + JSX 写,是项目里第一个 TSX 文件——tsconfig 已开
 *     jsx: react-jsx,新组件沿用此风格。
 */
import { Command } from 'cmdk'
import {
  Root as RadixDialogRoot,
  Portal as RadixDialogPortal,
  Overlay as RadixDialogOverlay,
  Content as RadixDialogContent,
} from '@radix-ui/react-dialog'
import { createElement as e, useEffect, useState, type ReactNode } from 'react'
import type { ThemeValue } from './theme.ts'

/* 命令面板接收的最小动作集。根组件传进来的就是这些闭包,palette 自己只
   做"显示哪一条 → 选了就调哪个"的分发,不知道选择作品/新建/切主题背后的
   状态机,这样和现有 root.ts 复用 action 的方式保持一致。 */
type CommandAction = {
  id: string
  label: string
  hint?: string
  keywords?: string[]
  icon: ReactNode
  run(): void
  disabled?: boolean
}

type CommandGroup = {
  id: string
  heading: string
  items: CommandAction[]
}

export type CommandPaletteProps = {
  open: boolean
  onOpenChange(next: boolean): void
  /* 主题与切换(theme.ts 已经提供 useTheme,palette 不直接 import,避免把
     内部 hook 暴露给 props 之外的调用方;根组件把 setTheme 当作回调传进来
     即可)。 */
  theme: ThemeValue
  onThemeChange(next: ThemeValue): void
  /* 动作闭包。palette 只关心"按下时调一下",不关心是不是同步。 */
  onOpenWorkspace(): void
  onNewProject(): void
  onOpenSettings(): void
  onToggleFocus(): void
  onOpenDocument(path: string): void
  /* 当前状态:决定命令的置灰 / 显隐。files 来自 root.ts 的 useState,已经
     是排好序的 markdown/txt 路径。activePath 用于高亮当前打开的文档。 */
  hasWorkspace: boolean
  focusMode: boolean
  files: readonly string[]
  activePath: string
}

/* 命令面板左侧的线性几何图标(和首页 FolderIcon/NewDocIcon 同款 1.6px
   stroke + currentColor),保证视觉系统只有一套原子。 */
function OpenIcon() {
  return e('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', 'aria-hidden': 'true' },
    e('path', { d: 'M3.5 7.5a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.6 1.6a2 2 0 0 0 1.4.6h4.4a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' }),
    e('path', { d: 'M3.5 9.5h17' }),
  )
}
function PlusIcon() {
  return e('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' },
    e('path', { d: 'M12 5v14M5 12h14' }),
  )
}
function ThemeIcon() {
  return e('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', 'aria-hidden': 'true' },
    e('path', { d: 'M5 14a7 7 0 0 1 12-4.9 6 6 0 0 1-1 11.4 7 7 0 0 1-11-6.5z' }),
    e('path', { d: 'M9 19l-1 2.5M12.5 19.5l.5 2M16 18.7l1.2 1.8' }),
  )
}
function FocusIcon() {
  return e('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', 'aria-hidden': 'true' },
    e('path', { d: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4' }),
  )
}
function SettingsIcon() {
  return e('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', 'aria-hidden': 'true' },
    e('circle', { cx: '12', cy: '12', r: '3' }),
    e('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }),
  )
}
function FileIcon() {
  return e('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', 'aria-hidden': 'true' },
    e('path', { d: 'M7 3.5h6.5l4 4v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z' }),
    e('path', { d: 'M13.5 3.5v4h4' }),
  )
}

/* 把路径转成"目录 / 文件名"两段,便于在命令项里分两行显示。
   正文/第一卷/003.md → (大纲, 总纲.md)? 实际是 (第一卷, 003.md)。
   用在文件快速跳转分组时,把目录名当 hint。 */
function splitPath(path: string): { directory: string; name: string } {
  const parts = path.split('/')
  const name = parts.pop() ?? path
  const directory = parts.join('/')
  return { directory, name }
}

export function CommandPalette(props: CommandPaletteProps) {
  /* 全局 Cmd/Ctrl+K 监听:不管 palette 当前开没开,都能切换。
     用 useEffect 在打开/关闭时挂同一个 listener,这样 palette 不会因为
     onOpenChange 路径在 hotkey 阶段还是直接阶段而漏掉 ESC 关闭。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (mod && key === 'k') {
        event.preventDefault()
        props.onOpenChange(!props.open)
        return
      }
      if (event.key === 'Escape' && props.open) {
        /* 留给 Radix Dialog 自行处理关闭——本监听只起幂等保险作用,
           不能 preventDefault,否则 Radix 的 unmount 动画路径会断。 */
        props.onOpenChange(false)
      }
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [props.open, props.onOpenChange])

  const themeNext: ThemeValue = props.theme === 'paper' ? 'ink' : 'paper'
  const workspaceGroup: CommandGroup = {
    id: 'workspace',
    heading: '作品',
    items: [
      {
        id: 'cmd.open-workspace',
        label: '打开作品',
        hint: '选择本地已有的作品目录',
        keywords: ['folder', 'open', 'open workspace', 'open project'],
        icon: e(OpenIcon, null),
        run: () => props.onOpenWorkspace(),
      },
      {
        id: 'cmd.new-project',
        label: '新建作品',
        hint: '在「文档/dsh-editor」下从空白稿纸开始',
        keywords: ['new', 'create', 'new project'],
        icon: e(PlusIcon, null),
        run: () => props.onNewProject(),
      },
    ],
  }

  const viewGroup: CommandGroup = {
    id: 'view',
    heading: '视图',
    items: [
      {
        id: 'cmd.toggle-theme',
        label: themeNext === 'ink' ? '切换到墨主题' : '切换到纸主题',
        hint: props.theme === 'paper' ? '当前：纸' : '当前：墨',
        keywords: ['theme', '主题', '切换', 'paper', 'ink', 'dark', 'light'],
        icon: e(ThemeIcon, null),
        run: () => props.onThemeChange(themeNext),
      },
      {
        id: 'cmd.toggle-focus',
        label: props.focusMode ? '退出专注模式' : '进入专注模式',
        hint: '隐藏侧栏与搭档,只保留稿纸',
        keywords: ['focus', '专注', 'toggle', 'zen'],
        icon: e(FocusIcon, null),
        disabled: !props.hasWorkspace,
        run: () => props.onToggleFocus(),
      },
      {
        id: 'cmd.open-settings',
        label: '打开设置',
        hint: '通过 DSH 宿主打开设置面板',
        keywords: ['settings', 'preferences', '设置', '偏好'],
        icon: e(SettingsIcon, null),
        run: () => props.onOpenSettings(),
      },
    ],
  }

  /* 文件快速跳转:只列 .md/.txt,排除隐藏/系统目录;活跃文档用 current 标
     记,scoring 时 cmdk 会自动把它留在更靠前的位置(因为标题前缀一样)。
     没有打开工作台时整个分组直接不渲染,避免出现"打开空列表"。 */
  const fileGroup: CommandGroup | null = props.hasWorkspace
    ? {
        id: 'files',
        heading: '跳转到文档',
        items: props.files.map((filePath) => {
          const { directory, name } = splitPath(filePath)
          return {
            id: `file.${filePath}`,
            label: name,
            hint: directory || '根目录',
            keywords: [directory, filePath],
            icon: e(FileIcon, null),
            disabled: props.activePath === filePath,
            run: () => props.onOpenDocument(filePath),
          }
        }),
      }
    : null

  const groups: CommandGroup[] = fileGroup
    ? [workspaceGroup, viewGroup, fileGroup]
    : [workspaceGroup, viewGroup]

  /* 关闭时彻底卸载,避免列表里残留旧文件路径。每次重新打开时 reset 到 ''。 */
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (props.open) setSearch('')
  }, [props.open])

  return (
    <RadixDialogRoot open={props.open} onOpenChange={props.onOpenChange}>
      <RadixDialogPortal>
        <RadixDialogOverlay className="palette-overlay" />
        <RadixDialogContent
          className="palette-content"
          aria-label="搜索与命令"
          onOpenAutoFocus={(event: Event) => {
            /* cmdk 的 Input 已经会自己 focus,我们只需要阻止 Radix 把焦点
               抢到它觉得合适的容器上,让 input 在挂载的同一帧拿到光标。 */
            event.preventDefault()
            const input = globalThis.document.querySelector<HTMLInputElement>('.palette-content input')
            globalThis.requestAnimationFrame(() => input?.focus())
          }}
        >
          <Command className="palette-command" label="搜索与命令" loop shouldFilter>
            <div className="palette-search">
              <span className="palette-search-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m20 20-3.6-3.6" />
                </svg>
              </span>
              <Command.Input
                className="palette-input"
                placeholder="搜索与命令…"
                value={search}
                onValueChange={setSearch}
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="palette-kbd" aria-hidden="true">ESC</kbd>
            </div>
            <Command.List className="palette-list">
              <Command.Empty className="palette-empty">没有匹配的命令</Command.Empty>
              {groups.map((group) => (
                <Command.Group key={group.id} heading={group.heading} className="palette-group">
                  {group.items.map((action) => (
                    <Command.Item
                      key={action.id}
                      value={action.label}
                      keywords={action.keywords}
                      disabled={action.disabled}
                      onSelect={() => {
                        if (action.disabled) return
                        action.run()
                        props.onOpenChange(false)
                      }}
                      className="palette-item"
                    >
                      <span className="palette-item-icon" aria-hidden="true">{action.icon}</span>
                      <span className="palette-item-text">
                        <span className="palette-item-label">{action.label}</span>
                        {action.hint ? <span className="palette-item-hint">{action.hint}</span> : null}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="palette-footer" aria-hidden="true">
              <span><kbd className="palette-kbd">↑</kbd><kbd className="palette-kbd">↓</kbd> 选择</span>
              <span><kbd className="palette-kbd">↵</kbd> 执行</span>
              <span><kbd className="palette-kbd">⌘K</kbd> 关闭</span>
            </div>
          </Command>
        </RadixDialogContent>
      </RadixDialogPortal>
    </RadixDialogRoot>
  )
}

/* 顶栏触发按钮:放在 chrome 右上角的"设置"按钮左侧,显示"搜索与命令 +
   ⌘K"小键名;class 名 palette-trigger 来自任务要求,样式写在 styles.ts。 */
export function CommandPaletteTrigger({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      className="palette-trigger"
      onClick={onClick}
      aria-label="搜索与命令"
      title="搜索与命令 (⌘K / Ctrl+K)"
    >
      <span className="palette-trigger-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-3.6-3.6" />
        </svg>
      </span>
      <span className="palette-trigger-label">搜索与命令</span>
      <kbd className="palette-trigger-kbd" aria-hidden="true">⌘K</kbd>
    </button>
  )
}
