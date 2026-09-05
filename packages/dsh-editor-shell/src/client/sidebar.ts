import { createElement as e, Fragment, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { errorMessage, isImagePath, orderTreeEntries, safeRpcCall, treeRowPadding, treeExpansionPaths, type ShellContext, type TreeEntry } from './shared.ts'

type LoadSubtree = (path: string) => Promise<TreeEntry[] | null> | null | void

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
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
  loadSubtree: LoadSubtree
  toggleDirectory(path: string): void
}

function TreeRows(props: RowProps): ReactNode {
  const { path, level, loaded, active, openPaths, onOpen, onPreviewImage, onFileMenu, onCreateFile, onCreateFolder, loadSubtree, toggleDirectory } = props
  const entries = orderTreeEntries(loaded[path] ?? [])
  // 树只渲染磁盘上真实存在的条目:预设分组已移除,目录(包括 正文/大纲/人物卡/世界书)
  // 在实际创建后自然出现。隐藏 . 开头的系统项。
  const visible = entries.filter((item) => !item.name.startsWith('.'))
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
              onFileMenu('directory', child, { x: event.clientX, y: event.clientY })
            },
          },
          e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, isOpen ? '⌄' : '›'),
          e('span', null, item.name),
          ),
          e('span', { className: 'tree-row-actions' },
            e('button', {
              className: 'tree-directory-add',
              type: 'button',
              title: `在 ${item.name} 中新建文件`,
              'aria-label': `在 ${item.name} 中新建文件`,
              onClick: () => onCreateFile(child),
            }, '＋'),
            e('button', {
              className: 'tree-directory-add',
              type: 'button',
              title: `在 ${item.name} 中新建文件夹`,
              'aria-label': `在 ${item.name} 中新建文件夹`,
              onClick: () => onCreateFolder(child),
            }, '▣'),
          ),
        ),
        isOpen ? e(TreeRows, { ...props, path: child, level: level + 1 }) : null,
      )
    }
    return e('div', { key: child, className: 'tree-file-row' },
      e('button', {
        className: 'tree-row tree-main',
        type: 'button',
        'aria-current': active === child ? 'page' : undefined,
        style: { paddingLeft: treeRowPadding(level) },
        'data-tree-depth': level,
        onClick: () => (isImagePath(child) ? onPreviewImage(child) : onOpen(child)),
        onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          onFileMenu('file', child, { x: event.clientX, y: event.clientY })
        },
      },
      e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, '·'),
      e('span', null, item.name),
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
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
}) {
  const { ctx, sessionId, active, expandPath, revision, onOpen, onPreviewImage, onFileMenu, onCreateFile, onCreateFolder } = props
  const [loaded, setLoaded] = useState<Record<string, TreeEntry[]>>({})
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set())
  const [note, setNote] = useState('')

  const loadSubtree: LoadSubtree = async (path) => {
    const result = await safeRpcCall<{ entries?: TreeEntry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: path || '.',
    }))
    if (!result.ok) { setNote(errorMessage(result)); return null }
    const entries = result.value.entries ?? []
    setLoaded((old) => ({ ...old, [path]: entries }))
    return entries
  }

  useEffect(() => {
    setLoaded({})
    const expansion = treeExpansionPaths(expandPath)
    setOpenPaths(new Set(expansion))
    void loadSubtree('')
    for (const directory of expansion) void loadSubtree(directory)
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
    'aria-label': '稿件目录',
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      // 仅在空白区(非已有行)右键时弹出根目录菜单;行内已自行阻止冒泡。
      if (event.target === event.currentTarget) {
        event.preventDefault()
        onFileMenu('directory', '', { x: event.clientX, y: event.clientY })
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
  onDelete(): void
  onClose(): void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const first = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    globalThis.setTimeout(() => first.current?.focus(), 0)
    const onPointer = (event: globalThis.MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) props.onClose()
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose()
    }
    globalThis.addEventListener('mousedown', onPointer)
    globalThis.addEventListener('keydown', onKey)
    return () => {
      globalThis.removeEventListener('mousedown', onPointer)
      globalThis.removeEventListener('keydown', onKey)
    }
  }, [props.path, props.x, props.y])
  const left = Math.max(8, Math.min(props.x, globalThis.innerWidth - 188))
  const top = Math.max(8, Math.min(props.y, globalThis.innerHeight - 220))
  return e('div', {
    ref: panel,
    className: 'file-context-menu',
    role: 'menu',
    'aria-label': '文档操作',
    style: { left, top },
    onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault(),
  },
    e('button', { ref: first, type: 'button', role: 'menuitem', onClick: props.onCreateFile }, '新建文件'),
    e('button', { type: 'button', role: 'menuitem', onClick: props.onCreateFolder }, '新建文件夹'),
    e('hr', { className: 'file-context-menu-separator', 'aria-hidden': 'true' }),
    e('button', { type: 'button', role: 'menuitem', onClick: props.onCopy }, '复制'),
    e('button', { type: 'button', role: 'menuitem', onClick: props.onCut }, '剪切'),
    e('button', {
      type: 'button',
      role: 'menuitem',
      disabled: !props.canPaste,
      onClick: props.onPaste,
    }, '粘贴'),
    e('hr', { className: 'file-context-menu-separator', 'aria-hidden': 'true' }),
    e('button', { type: 'button', role: 'menuitem', onClick: props.onRename }, '重命名'),
    e('button', { type: 'button', role: 'menuitem', 'data-danger': 'true', onClick: props.onDelete }, '删除'),
  )
}
