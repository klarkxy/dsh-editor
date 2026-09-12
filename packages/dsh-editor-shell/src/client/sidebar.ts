import { createElement as e, Fragment, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { ChapterStatus } from 'dsh-editor-workbench/contracts'
import { chapterStatusGlyph, chapterStatusLabel, isChapterDocumentPath } from '../chapter-status-view.ts'
import { canPinPath } from '../pinned-pane-view.ts'
import { errorMessage, isImagePath, orderTreeEntries, safeRpcCall, treeRowPadding, treeExpansionPaths, type ShellContext, type TreeEntry } from './shared.ts'
import { isAuxiliaryAuthorFile } from '../auxiliary-files.ts'
import { t } from '../i18n/index.ts'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './ui/index.ts'

type LoadSubtree = (path: string) => Promise<TreeEntry[] | null> | null | void

function treeMenuPosition(target: HTMLElement): { x: number; y: number } {
  const box = target.getBoundingClientRect()
  return { x: box.left + 12, y: box.bottom }
}

function isTreeMenuKey(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}

export type FileMenuKind = 'file' | 'directory'

type RowProps = {
  ctx: ShellContext
  sessionId: string
  path: string
  level: number
  loaded: Record<string, TreeEntry[]>
  active: string
  revision: number
  openPaths: Set<string>
  chapterStatuses: Record<string, ChapterStatus>
  highlightPath?: string
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }, trigger?: HTMLElement | null): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
  loadSubtree: LoadSubtree
  toggleDirectory(path: string): void
}

function TreeRows(props: RowProps): ReactNode {
  const { path, level, loaded, active, openPaths, chapterStatuses, highlightPath, onOpen, onPreviewImage, onFileMenu, onCreateFile, onCreateFolder, loadSubtree, toggleDirectory } = props
  const entries = orderTreeEntries(loaded[path] ?? [])
  // 树只渲染磁盘上真实存在的条目:预设分组已移除,目录(包括 正文/大纲/人物卡/世界书)
  // 在实际创建后自然出现。隐藏 . 开头的系统项。
  const visible = entries.filter((item) => {
    if (item.name.startsWith('.')) return false
    return !isAuxiliaryAuthorFile(item.name)
  })
  return e(Fragment, null, ...visible.map((item) => {
    const child = path ? `${path}/${item.name}` : item.name
    if (item.type === 'directory') {
      const isOpen = openPaths.has(child)
      return e('div', { key: child, className: 'tree-directory-wrap' },
        e('div', { className: 'tree-directory-row' },
          e('button', {
            className: 'tree-row',
            type: 'button',
            style: { paddingLeft: treeRowPadding(level) },
            'data-tree-depth': level,
            'aria-expanded': isOpen,
            onClick: () => toggleDirectory(child),
            onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => {
              event.preventDefault()
              onFileMenu('directory', child, { x: event.clientX, y: event.clientY }, event.currentTarget)
            },
            onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
              if (!isTreeMenuKey(event)) return
              event.preventDefault()
              onFileMenu('directory', child, treeMenuPosition(event.currentTarget), event.currentTarget)
            },
          },
          e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, isOpen ? '⌄' : '›'),
          e('span', null, item.name),
          ),
          e('span', { className: 'tree-row-actions' },
            e('button', {
              className: 'tree-directory-add',
              type: 'button',
              title: t('sidebar.newFileIn', { name: item.name }),
              'aria-label': t('sidebar.newFileIn', { name: item.name }),
              onClick: () => onCreateFile(child),
            }, '＋'),
            e('button', {
              className: 'tree-directory-add',
              type: 'button',
              title: t('sidebar.newFolderIn', { name: item.name }),
              'aria-label': t('sidebar.newFolderIn', { name: item.name }),
              onClick: () => onCreateFolder(child),
            }, '▣'),
          ),
        ),
        isOpen ? e(TreeRows, { ...props, path: child, level: level + 1 }) : null,
      )
    }
    const chapterStatus = isChapterDocumentPath(child) ? chapterStatuses[child] : undefined
    return e('div', { key: child, className: 'tree-file-row' },
      e('button', {
        className: 'tree-row tree-main',
        type: 'button',
        'aria-current': active === child || highlightPath === child ? 'page' : undefined,
        style: { paddingLeft: treeRowPadding(level) },
        'data-tree-depth': level,
        onClick: () => (isImagePath(child) ? onPreviewImage(child) : onOpen(child)),
        onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          onFileMenu('file', child, { x: event.clientX, y: event.clientY }, event.currentTarget)
        },
        onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
          if (!isTreeMenuKey(event)) return
          event.preventDefault()
          onFileMenu('file', child, treeMenuPosition(event.currentTarget), event.currentTarget)
        },
      },
      e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, '·'),
      e('span', null, item.name),
      chapterStatus ? e('span', {
        className: `chapter-status ${chapterStatus}`,
        title: chapterStatusLabel(chapterStatus),
        'aria-label': chapterStatusLabel(chapterStatus),
      }, chapterStatusGlyph(chapterStatus)) : null,
      ),
    )
  }))
}

export function Tree(props: {
  ctx: ShellContext
  sessionId: string
  active: string
  expandPath: string
  revision: number
  chapterStatuses: Record<string, ChapterStatus>
  highlightPath?: string
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }, trigger?: HTMLElement | null): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
}) {
  const { ctx, sessionId, active, expandPath, revision, chapterStatuses, highlightPath, onOpen, onPreviewImage, onFileMenu, onCreateFile, onCreateFolder } = props
  const [loaded, setLoaded] = useState<Record<string, TreeEntry[]>>({})
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set())
  const [note, setNote] = useState('')
  /* 加载代际：session/revision/expandPath 重置（含 effect 清理、卸载）时递增。
     早于当前代际的 tree.list 响应一律丢弃——否则合章/归档前的慢响应会在刷新
     完成后落地，把已归档的章节行写回目录树。成功与错误路径都受守护。 */
  const loadGeneration = useRef(0)

  const loadSubtree: LoadSubtree = async (path) => {
    const generation = loadGeneration.current
    const result = await safeRpcCall<{ entries?: TreeEntry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: path || '.',
    }))
    if (generation !== loadGeneration.current) return null
    if (!result.ok) { setNote(errorMessage(result)); return null }
    const entries = result.value.entries ?? []
    setLoaded((old) => ({ ...old, [path]: entries }))
    return entries
  }

  useEffect(() => {
    loadGeneration.current += 1
    setLoaded({})
    const expansion = treeExpansionPaths(expandPath)
    setOpenPaths(new Set(expansion))
    void loadSubtree('')
    for (const directory of expansion) void loadSubtree(directory)
    return () => { loadGeneration.current += 1 }
  }, [sessionId, revision, expandPath])

  const toggleDirectory = (path: string) => {
    setOpenPaths((old) => {
      const next = new Set(old)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (!openPaths.has(path)) void loadSubtree(path)
  }

  return e('nav', {
    className: 'tree',
    'aria-label': t('sidebar.manuscriptTree'),
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      // 仅在空白区(非已有行)右键时弹出根目录菜单;行内已自行阻止冒泡。
      if (event.target === event.currentTarget) {
        event.preventDefault()
        onFileMenu('directory', '', { x: event.clientX, y: event.clientY }, event.currentTarget)
      }
    },
  },
    e(TreeRows, {
      ctx,
      sessionId,
      path: '',
      level: 0,
      loaded,
      active,
      revision,
      openPaths,
      chapterStatuses,
      highlightPath,
      onOpen,
      onPreviewImage,
      onFileMenu,
      onCreateFile,
      onCreateFolder,
      loadSubtree,
      toggleDirectory,
    }),
    e('div', { hidden: !note, className: 'warning pad' }, note),
  )
}

export function FileContextMenu(props: {
  kind: FileMenuKind
  path: string
  x: number
  y: number
  canPaste: boolean
  onCreateFile(): void
  onCreateFolder(): void
  onCopy(): void
  onCut(): void
  onPaste(): void
  onRename(): void
  onArchive(): void
  onDelete(): void
  onClose(): void
  canArchive: boolean
  onSplit(): void
  onMergePrevious(): void
  onMergeNext(): void
  canSplit: boolean
  canMergePrevious: boolean
  canMergeNext: boolean
  splitDisabledTitle: string
  mergePreviousDisabledTitle: string
  mergeNextDisabledTitle: string
  onPin(): void
  onUnpin(): void
  isPinned: boolean
  onDismissFocus?(): void
}) {
  const left = Math.max(8, Math.min(props.x, globalThis.innerWidth - 220))
  const top = Math.max(8, Math.min(props.y, globalThis.innerHeight - 400))
  return e('div', {
    style: { position: 'fixed', left, top, width: 0, height: 0 },
    onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault(),
  },
    e(Menu, { open: true, onOpenChange: (open: boolean) => { if (!open) { props.onClose(); props.onDismissFocus?.() } } },
      e(MenuTrigger, { className: 'sr-only', tabIndex: -1 }, t('sidebar.fileActions')),
      e(MenuContent, {
        className: 'file-context-menu',
        align: 'start',
        side: 'bottom',
        sideOffset: 0,
        'aria-label': t('sidebar.fileActions'),
        onCloseAutoFocus: (event: Event) => {
          event.preventDefault()
          props.onDismissFocus?.()
        },
      },
        e(MenuItem, { role: 'menuitem', onSelect: () => props.onCreateFile() }, t('sidebar.newFile')),
        e(MenuItem, { role: 'menuitem', onSelect: () => props.onCreateFolder() }, t('sidebar.newFolder')),
        e(MenuSeparator, { className: 'file-context-menu-separator', 'aria-hidden': 'true' }),
        e(MenuItem, { role: 'menuitem', onSelect: () => props.onCopy() }, t('common.copy')),
        e(MenuItem, { role: 'menuitem', onSelect: () => props.onCut() }, t('common.cut')),
        e(MenuItem, { role: 'menuitem', disabled: !props.canPaste, onSelect: () => props.onPaste() }, t('common.paste')),
        e(MenuSeparator, { className: 'file-context-menu-separator', 'aria-hidden': 'true' }),
        e(MenuItem, { role: 'menuitem', onSelect: () => props.onRename() }, t('common.rename')),
        props.kind === 'file' && isChapterDocumentPath(props.path) ? e(MenuSeparator, { className: 'file-context-menu-separator', 'aria-hidden': 'true' }) : null,
        props.kind === 'file' && isChapterDocumentPath(props.path) ? e(MenuItem, {
          role: 'menuitem',
          disabled: !props.canSplit,
          title: props.canSplit ? undefined : props.splitDisabledTitle,
          onSelect: () => props.onSplit(),
        }, t('chapterOps.split')) : null,
        props.kind === 'file' && isChapterDocumentPath(props.path) ? e(MenuItem, {
          role: 'menuitem',
          disabled: !props.canMergePrevious,
          title: props.canMergePrevious ? undefined : props.mergePreviousDisabledTitle,
          onSelect: () => props.onMergePrevious(),
        }, t('chapterOps.mergePrevious')) : null,
        props.kind === 'file' && isChapterDocumentPath(props.path) ? e(MenuItem, {
          role: 'menuitem',
          disabled: !props.canMergeNext,
          title: props.canMergeNext ? undefined : props.mergeNextDisabledTitle,
          onSelect: () => props.onMergeNext(),
        }, t('chapterOps.mergeNext')) : null,
        props.kind === 'file' && canPinPath(props.path) && !props.isPinned ? e(MenuItem, {
          role: 'menuitem',
          onSelect: () => props.onPin(),
        }, t('pin.beside')) : null,
        props.kind === 'file' && props.isPinned ? e(MenuItem, {
          role: 'menuitem',
          onSelect: () => props.onUnpin(),
        }, t('pin.unpin')) : null,
        e(MenuItem, {
          role: 'menuitem',
          disabled: !props.canArchive,
          title: props.canArchive ? t('sidebar.archiveTitle') : t('sidebar.archiveDisabled'),
          onSelect: () => props.onArchive(),
        }, t('common.archive')),
        e(MenuItem, { role: 'menuitem', 'data-danger': 'true', onSelect: () => props.onDelete() }, t('common.delete')),
      ),
    ),
  )
}
