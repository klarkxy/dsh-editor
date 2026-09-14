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

/* 排序与隐藏规则在写入 loaded 时一次性完成,树渲染不再每层递归 sort/filter。
   只保留磁盘上真实存在的条目;隐藏 . 开头的系统项与辅助作者文件。 */
function visibleTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return orderTreeEntries(entries).filter((item) => {
    if (item.name.startsWith('.')) return false
    return !isAuxiliaryAuthorFile(item.name)
  })
}

/* 可见行的扁平路径序列(与 DOM 顺序一致),用于推导唯一的 tab 停靠行。 */
function visibleTreePaths(loaded: Record<string, TreeEntry[]>, openPaths: Set<string>, path: string): string[] {
  const rows: string[] = []
  for (const item of loaded[path] ?? []) {
    const child = path ? `${path}/${item.name}` : item.name
    rows.push(child)
    if (item.type === 'directory' && openPaths.has(child)) rows.push(...visibleTreePaths(loaded, openPaths, child))
  }
  return rows
}

/* 首屏 tree.list 仍在途时的骨架行;条为装饰,状态文本交给 aria-label。 */
function treeSkeleton(): ReactNode {
  return e('div', { className: 'panel-skeleton tree-skeleton', role: 'status', 'aria-label': t('sidebar.treeLoading') },
    ['62%', '84%', '48%'].map((width, index) => e('i', { key: index, style: { width } })))
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
  tabbablePath: string
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }, trigger?: HTMLElement | null): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
  loadSubtree: LoadSubtree
  toggleDirectory(path: string): void
}

function TreeRows(props: RowProps): ReactNode {
  const { path, level, loaded, active, openPaths, chapterStatuses, highlightPath, tabbablePath, onOpen, onPreviewImage, onFileMenu, onCreateFile, onCreateFolder, loadSubtree, toggleDirectory } = props
  /* loaded 在写入时已按 visibleTreeEntries 排序并过滤,这里直接渲染。 */
  const visible = loaded[path] ?? []
  return e(Fragment, null, ...visible.map((item) => {
    const child = path ? `${path}/${item.name}` : item.name
    if (item.type === 'directory') {
      const isOpen = openPaths.has(child)
      return e('div', { key: child, className: 'tree-directory-wrap' },
        e('div', { className: 'tree-directory-row' },
          e('button', {
            className: 'tree-row',
            type: 'button',
            role: 'treeitem',
            'aria-level': level + 1,
            tabIndex: child === tabbablePath ? 0 : -1,
            'data-tree-path': child,
            style: { paddingLeft: treeRowPadding(level) },
            'data-tree-depth': level,
            'aria-expanded': isOpen,
            'aria-current': highlightPath === child ? 'page' : undefined,
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
        role: 'treeitem',
        'aria-level': level + 1,
        tabIndex: child === tabbablePath ? 0 : -1,
        'data-tree-path': child,
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
        role: 'img',
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
  /* 加载代际：session/revision 重置（含 effect 清理、卸载）时递增。
     早于当前代际的 tree.list 响应一律丢弃——否则合章/归档前的慢响应会在刷新
     完成后落地，把已归档的章节行写回目录树。成功与错误路径都受守护。
     expandPath 不参与代际：它只合并进展开状态并补齐未加载的祖先目录。 */
  const loadGeneration = useRef(0)
  /* loaded 的 ref 镜像：effect 内判断"某目录是否已加载"时读取（不触发渲染）。 */
  const loadedRef = useRef<Record<string, TreeEntry[]>>({})
  /* 去重在途请求：reload 与 expandPath 合并可能在同一拍重复请求同一目录。 */
  const loadingPaths = useRef<Set<string>>(new Set())
  const treeNavRef = useRef<HTMLElement | null>(null)

  const loadSubtree: LoadSubtree = async (path) => {
    if (loadingPaths.current.has(path)) return null
    loadingPaths.current.add(path)
    try {
      const generation = loadGeneration.current
      const result = await safeRpcCall<{ entries?: TreeEntry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
        sessionId,
        path: path || '.',
      }))
      if (generation !== loadGeneration.current) return null
      if (!result.ok) { setNote(errorMessage(result)); return null }
      const entries = visibleTreeEntries(result.value.entries ?? [])
      loadedRef.current = { ...loadedRef.current, [path]: entries }
      setLoaded((old) => ({ ...old, [path]: entries }))
      return entries
    } finally {
      loadingPaths.current.delete(path)
    }
  }

  /* session/revision 变化才是真正的整树刷新；expandPath 变化不得清空已加载目录。 */
  useEffect(() => {
    loadGeneration.current += 1
    loadedRef.current = {}
    setLoaded({})
    const expansion = treeExpansionPaths(expandPath)
    setOpenPaths(new Set(expansion))
    void loadSubtree('')
    for (const directory of expansion) void loadSubtree(directory)
    return () => { loadGeneration.current += 1 }
  }, [sessionId, revision])

  /* expandPath 只要求"保证这些祖先目录展开且已加载"：并入 openPaths，
     并仅为尚未加载的目录补发 tree.list，不重载整棵树。 */
  useEffect(() => {
    const expansion = treeExpansionPaths(expandPath)
    if (!expansion.length) return
    setOpenPaths((old) => {
      const next = new Set(old)
      for (const directory of expansion) next.add(directory)
      return next.size === old.size ? old : next
    })
    for (const directory of expansion) {
      if (loadedRef.current[directory] === undefined) void loadSubtree(directory)
    }
  }, [expandPath])

  const toggleDirectory = (path: string) => {
    setOpenPaths((old) => {
      const next = new Set(old)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (!openPaths.has(path)) void loadSubtree(path)
  }

  /* 键盘导航（WAI-ARIA treeview）：全树只有 tabbablePath 一行可 Tab 到达，
     方向键在可见行间移动焦点；行内原有的 ContextMenu/Shift+F10 不受影响。 */
  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const row = target.closest<HTMLElement>('button.tree-row')
    const nav = treeNavRef.current
    if (!row || !nav || !nav.contains(row)) return
    const rows = Array.from(nav.querySelectorAll<HTMLElement>('button.tree-row'))
    const index = rows.indexOf(row)
    if (index < 0) return
    const depthOf = (element: HTMLElement) => Number(element.dataset.treeDepth ?? 0)
    const focusAt = (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, nextIndex))
      rows[clamped]?.focus()
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(index + 1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(index - 1); return }
    if (event.key === 'Home') { event.preventDefault(); focusAt(0); return }
    if (event.key === 'End') { event.preventDefault(); focusAt(rows.length - 1); return }
    if (event.key === 'ArrowRight') {
      // 折叠目录：展开（加载沿用 toggleDirectory）；已展开：落到第一个子行。
      if (row.getAttribute('aria-expanded') === 'false') {
        event.preventDefault()
        toggleDirectory(row.dataset.treePath ?? '')
        return
      }
      const next = rows[index + 1]
      if (next && depthOf(next) > depthOf(row)) { event.preventDefault(); next.focus() }
      return
    }
    if (event.key === 'ArrowLeft') {
      // 展开目录：折叠；文件/已折叠目录：焦点回到父行。
      if (row.getAttribute('aria-expanded') === 'true') {
        event.preventDefault()
        toggleDirectory(row.dataset.treePath ?? '')
        return
      }
      for (let walk = index - 1; walk >= 0; walk -= 1) {
        if (depthOf(rows[walk]) < depthOf(row)) { event.preventDefault(); rows[walk].focus(); return }
      }
    }
  }

  /* 唯一 tab 停靠行：当前文件优先，其次高亮行，最后回退第一可见行；
     数据变化（如活动文件被删除）后随渲染重新推导，停靠自然回退。 */
  const rootEntries = loaded['']
  const rowPaths = visibleTreePaths(loaded, openPaths, '')
  const tabbablePath = rowPaths.includes(active) ? active : highlightPath && rowPaths.includes(highlightPath) ? highlightPath : rowPaths[0] ?? ''

  return e('nav', {
    className: 'tree',
    role: 'tree',
    'aria-label': t('sidebar.manuscriptTree'),
    ref: treeNavRef,
    onKeyDown: onTreeKeyDown,
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      // 仅在空白区(非已有行)右键时弹出根目录菜单;行内已自行阻止冒泡。
      if (event.target === event.currentTarget) {
        event.preventDefault()
        onFileMenu('directory', '', { x: event.clientX, y: event.clientY }, event.currentTarget)
      }
    },
  },
    rootEntries === undefined
      ? (note ? null : treeSkeleton())
      : rootEntries.length === 0
        ? e('p', { className: 'muted tree-empty' }, t('sidebar.treeEmpty'))
        : e(TreeRows, {
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
      tabbablePath,
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
