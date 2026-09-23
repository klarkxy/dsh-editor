/*
 * DSH Editor 命令面板:Cmd/Ctrl+K 触发的浮层。Radix Dialog 负责焦点陷阱/aria
 * (cmdk 自带 Dialog 用的是同一个底层库,但我们要把 token 和现有对话框/首页卡
 * 风格对齐,所以分开组合,自己控制 Portal/Overlay/Content 的 className),
 * cmdk 负责输入过滤 + 命令项渲染。
 *
 * 设计要点:
 *   - Portal 挂到当前实例的 .radix-themes.shell-theme：主题 token 不在
 *     :root 上，容器未就绪时不挂载，避免掉到 document.body 后底板透明、
 *     命令条目叠在稿纸上。
 *   - 不与 root.ts 现有的工作区快捷键冲突:Cmd/Ctrl+K 是新增的,没有占用
 *     workspaceShortcut 的 Ctrl+,/B/J/\\/L 分支;全文搜索走
 *     Ctrl+Shift+F,由 root.ts 打开侧栏搜索面板;作品概览走注册表命令 Ctrl+Shift+O;
 *     校对走注册表命令 Ctrl+Shift+L；人物卡/世界书走注册表命令 Ctrl+Shift+C/W。
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
  Description as RadixDialogDescription,
} from '@radix-ui/react-dialog'
import { Button, Flex, Kbd } from '@radix-ui/themes'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ThemeValue } from './theme.tsx'
import { t, useLocale } from '../i18n/index.ts'
import { runtimePaletteShortcutHint } from '../palette-shortcut.ts'
import { DOCUMENT_ARCHIVE_UI } from './archive.tsx'
import {
  ArchiveIcon,
  ExportIcon,
  HistoryIcon,
  FileIcon,
  FocusIcon,
  FolderIcon,
  PinIcon,
  PlusIcon,
  RegistryCommandIcon,
  SearchIcon,
  SettingsIcon,
  ThemeInkIcon,
} from './icons.tsx'

/* 主题变量只挂在 .radix-themes 上（:root 已被 rewrite 掉，有 Theme 时
   seats fallback 也不生效）。命令面板必须 Portal 进 Theme 根，否则底板 /
   遮罩的 var(--color-panel-solid) / var(--gray-a6) 全是空的，条目会直接
   叠在稿纸上。 */
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

function useThemePortalContainer() {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<HTMLElement | undefined>()
  useLayoutEffect(() => {
    setContainer(resolveThemePortalFromAnchor(anchorRef.current) ?? resolveThemePortalContainer(document))
  }, [])
  return {
    container,
    anchor: <span ref={anchorRef} hidden data-palette-theme-anchor="" />,
  }
}

/* 视觉隐藏(.shell .sr-only 在 Portal 内容上不生效,这里内联自带)。 */
const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
}

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

export type RegistryCommandItem = {
  id: string
  group: 'workspace' | 'writing' | 'view'
  label: string
  hint?: string
  keywords?: string[]
  disabled?: boolean
  run(): void
}

export function appendRegistryCommands(groups: CommandGroup[], extras: readonly RegistryCommandItem[]): CommandGroup[] {
  if (!extras.length) return groups
  return groups.map((group) => {
    const added = extras
      .filter((item) => item.group === group.id)
      .map((item) => ({
        id: item.id,
        label: item.label,
        hint: item.hint,
        keywords: item.keywords,
        icon: <RegistryCommandIcon />,
        disabled: item.disabled,
        run: () => item.run(),
      }))
    return added.length ? { ...group, items: [...group.items, ...added] } : group
  });
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
  onOpenSearch(): void
  registryCommands?: readonly RegistryCommandItem[]
  onExport(): void
  onOpenArchives(): void
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
  useLocale()
  const { container: portalContainer, anchor: themeAnchor } = useThemePortalContainer()
  /* 全局 Cmd/Ctrl+K 监听:不管 palette 当前开没开,都能切换。
     用 useEffect 在打开/关闭时挂同一个 listener,这样 palette 不会因为
     onOpenChange 路径在 hotkey 阶段还是直接阶段而漏掉 ESC 关闭。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.repeat) return
      if (!props.open && document.querySelector('[aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (mod && !event.shiftKey && !event.altKey && key === 'k') {
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

  const themeNext: ThemeValue = props.theme === 'light' ? 'dark' : 'light'
  const workspaceGroup: CommandGroup = {
    id: 'workspace',
    heading: t('command.workspace'),
    items: [
      {
        id: 'cmd.open-workspace',
        label: t('command.openWork'),
        hint: t('command.openWorkHint'),
        keywords: ['folder', 'open', 'open workspace', 'open project'],
        icon: <FolderIcon />,
        run: () => props.onOpenWorkspace(),
      },
      {
        id: 'cmd.new-project',
        label: t('command.newWork'),
        hint: t('command.newWorkHint'),
        keywords: ['new', 'create', 'new project'],
        icon: <PlusIcon />,
        run: () => props.onNewProject(),
      },
    ],
  }

  const writingGroup: CommandGroup = {
    id: 'writing',
    heading: t('command.writing'),
    items: [
      {
        id: 'cmd.search',
        label: t('command.search'),
        hint: t('command.searchHint'),
        keywords: ['search', 'find', t('command.find'), t('common.search')],
        icon: <SearchIcon />,
        disabled: !props.hasWorkspace,
        run: () => props.onOpenSearch(),
      },
      {
        id: 'cmd.toggle-typewriter',
        label: props.typewriter ? t('command.typewriterOff') : t('command.typewriterOn'),
        hint: t('command.typewriterHint'),
        keywords: ['typewriter', t('command.kw.typewriter'), t('command.kw.scroll')],
        icon: <FocusIcon />,
        disabled: !props.hasWorkspace || !props.onToggleTypewriter,
        run: () => props.onToggleTypewriter?.(),
      },
      {
        id: 'cmd.toggle-focus-paragraph',
        label: props.focusParagraph ? t('command.focusParaOff') : t('command.focusParaOn'),
        hint: t('command.focusParaHint'),
        keywords: ['focus', t('command.kw.focus'), t('command.paragraph'), 'paragraph'],
        icon: <FocusIcon />,
        disabled: !props.hasWorkspace || !props.onToggleFocusParagraph,
        run: () => props.onToggleFocusParagraph?.(),
      },
      {
        id: 'cmd.export',
        label: t('command.export'),
        hint: t('command.exportHint'),
        keywords: ['export', t('command.exportShort'), 'markdown', 'txt'],
        icon: <ExportIcon />,
        disabled: !props.hasWorkspace,
        run: () => props.onExport(),
      },
      ...(DOCUMENT_ARCHIVE_UI ? [{
        id: 'cmd.archives',
        label: t('command.archived'),
        hint: t('command.archivedHint'),
        keywords: ['archive', t('common.archive'), t('common.restore')],
        icon: <ArchiveIcon />,
        disabled: !props.hasWorkspace,
        run: () => props.onOpenArchives(),
      }] : []),
      {
        id: 'cmd.history',
        label: t('command.history'),
        hint: t('command.historyHint'),
        keywords: ['history', 'git', 'commit', t('common.history'), t('workspace.rollback')],
        icon: <HistoryIcon />,
        disabled: !props.hasWorkspace,
        run: () => props.onOpenHistory(),
      },
      {
        id: 'cmd.split-at-cursor',
        label: t('chapterOps.splitAtCursor'),
        hint: t('chapterOps.splitAtCursorHint'),
        keywords: ['split', 'chapter', 'cursor'],
        icon: <FileIcon />,
        disabled: !props.canSplitAtCursor,
        run: () => props.onSplitAtCursor(),
      },
    ],
  }

  const viewGroup: CommandGroup = {
    id: 'view',
    heading: t('command.view'),
    items: [
      {
        id: 'cmd.toggle-theme',
        label: themeNext === 'dark' ? t('command.themeDark') : t('command.themeLight'),
        hint: props.theme === 'light' ? t('command.themeNowLight') : t('command.themeNowDark'),
        keywords: ['theme', t('command.theme'), t('command.switch'), 'dark', 'light'],
        icon: <ThemeInkIcon />,
        run: () => props.onThemeChange(themeNext),
      },
      {
        id: 'cmd.toggle-focus',
        label: props.focusMode ? t('command.exitFocus') : t('command.enterFocus'),
        hint: t('command.focusHint'),
        keywords: ['focus', t('workspace.focus'), 'toggle', 'zen'],
        icon: <FocusIcon />,
        disabled: !props.hasWorkspace,
        run: () => props.onToggleFocus(),
      },
      {
        id: 'cmd.pin-current',
        label: t('pin.current'),
        hint: t('pin.currentHint'),
        keywords: ['pin', 'beside', 'split'],
        icon: <PinIcon />,
        disabled: !props.canPinCurrent,
        run: () => props.onPinCurrent(),
      },
      {
        id: 'cmd.unpin',
        label: t('pin.unpin'),
        hint: t('pin.unpinHint'),
        keywords: ['unpin', 'pin'],
        icon: <PinIcon />,
        disabled: !props.pinnedPath,
        run: () => props.onUnpin(),
      },
      {
        id: 'cmd.open-settings',
        label: t('command.openSettings'),
        hint: t('command.openSettingsHint'),
        keywords: ['settings', 'preferences', t('command.kw.settings'), t('command.preferences')],
        icon: <SettingsIcon />,
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
        heading: t('command.jumpFile'),
        items: props.files.map((filePath) => {
          const { directory, name } = splitPath(filePath)
          return {
            id: `file.${filePath}`,
            label: name,
            hint: directory || t('command.rootDir'),
            keywords: [directory, filePath],
            icon: <FileIcon />,
            disabled: props.activePath === filePath,
            run: () => props.onOpenDocument(filePath),
          };
        }),
      }
    : null

  const groups: CommandGroup[] = appendRegistryCommands(
    fileGroup
      ? [workspaceGroup, writingGroup, viewGroup, fileGroup]
      : [workspaceGroup, writingGroup, viewGroup],
    props.registryCommands ?? [],
  )

  /* 关闭时彻底卸载,避免列表里残留旧文件路径。每次重新打开时 reset 到 ''。 */
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (props.open) setSearch('')
  }, [props.open])

  return (
    <>
      {themeAnchor}
      <RadixDialogRoot open={props.open} onOpenChange={props.onOpenChange}>
      {portalContainer ? <RadixDialogPortal container={portalContainer}>
        <RadixDialogOverlay className="palette-overlay" />
        <RadixDialogContent
          className="palette-content"
          aria-label={t('command.searchCommands')}
          onOpenAutoFocus={(event: Event) => {
            /* cmdk 的 Input 已经会自己 focus,我们只需要阻止 Radix 把焦点
               抢到它觉得合适的容器上,让 input 在挂载的同一帧拿到光标。 */
            event.preventDefault()
            const input = globalThis.document.querySelector<HTMLInputElement>('.palette-content input')
            globalThis.requestAnimationFrame(() => input?.focus())
          }}
        >
          {/* Radix Dialog 要求 Title/Description;标题由 aria-label 承担,这里补
              一条视觉隐藏的描述(复用现有本地化串),消除 a11y 警告。 */}
          <RadixDialogDescription style={visuallyHidden}>{t('command.searchTitle')}</RadixDialogDescription>
          <Command className="palette-command" label={t('command.searchCommands')} loop shouldFilter>
            <Flex className="palette-search" align="center" gap="3">
              <span className="palette-search-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m20 20-3.6-3.6" />
                </svg>
              </span>
              <Command.Input
                className="palette-input"
                placeholder={t('command.searchPlaceholder')}
                value={search}
                onValueChange={setSearch}
                autoComplete="off"
                spellCheck={false}
              />
              <Kbd className="palette-kbd" aria-hidden="true">ESC</Kbd>
            </Flex>
            <Command.List className="palette-list">
              <Command.Empty className="palette-empty">{t('command.empty')}</Command.Empty>
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
            <Flex className="palette-footer" align="center" gap="3" aria-hidden="true">
              <span><Kbd className="palette-kbd">↑</Kbd><Kbd className="palette-kbd">↓</Kbd></span>
              <span><Kbd className="palette-kbd">↵</Kbd></span>
              <span><Kbd className="palette-kbd">ESC</Kbd></span>
            </Flex>
          </Command>
        </RadixDialogContent>
      </RadixDialogPortal> : null}
      </RadixDialogRoot>
    </>
  )
}

/* 顶栏触发按钮:放大镜 + 当前系统的快捷键提示。可访问名称仍是「搜索与命令」。 */
export function CommandPaletteTrigger({ onClick }: { onClick(): void }) {
  useLocale()
  const shortcut = runtimePaletteShortcutHint()
  return (
    <Button
      type="button"
      variant="soft"
      color="gray"
      size="2"
      className="palette-trigger"
      onClick={onClick}
      aria-label={t('command.searchCommands')}
      title={t('command.searchTitle')}
    >
      <span className="palette-trigger-icon" aria-hidden="true">
        <SearchIcon size={14} />
      </span>
      <Kbd className="palette-trigger-kbd">{shortcut}</Kbd>
    </Button>
  )
}
