import { createElement as e, Fragment, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { DocumentKind } from '../project-files.ts'
import { errorMessage, isManagedGroupName, orderTreeEntries, safeRpcCall, treeRowPadding, treeExpansionPaths, type ShellContext, type TreeEntry } from './shared.ts'

const STATIC_GROUPS: { directory: string; label: string; kind: Exclude<DocumentKind, 'chapter'> }[] = [
  { directory: '大纲', label: '大纲', kind: 'outline' },
  { directory: '人物卡', label: '人物卡', kind: 'character' },
  { directory: '世界书', label: '世界书', kind: 'world' },
]

type LoadSubtree = (path: string) => Promise<TreeEntry[] | null> | null | void

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
  onFileMenu(path: string, position: { x: number; y: number }): void
  onCreateChapter(directory: string): void
  loadSubtree: LoadSubtree
  toggleDirectory(path: string): void
}

function TreeRows(props: RowProps): ReactNode {
  const { path, level, loaded, active, openPaths, onOpen, onFileMenu, onCreateChapter, loadSubtree, toggleDirectory } = props
  const entries = orderTreeEntries(path, loaded[path] ?? [])
  // At the workspace root, the four managed directories (大纲/人物卡/世界书/正文)
  // are already rendered by the static groups and the manuscript header; hide
  // them here to avoid a duplicate listing. Nested children are unaffected.
  const visible = entries.filter((item) => !item.name.startsWith('.') && (path !== '' || !isManagedGroupName(item.name)))
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
          },
          e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, isOpen ? '⌄' : '›'),
          e('span', null, item.name),
          ),
          child.startsWith('正文/') ? e('button', {
            className: 'tree-directory-add',
            type: 'button',
            title: `在 ${item.name} 中新建章节`,
            'aria-label': `在 ${item.name} 中新建章节`,
            onClick: () => onCreateChapter(child),
          }, '＋') : null,
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
        onClick: () => onOpen(child),
        onContextMenu: /\.(md|txt)$/i.test(child) ? (event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          onFileMenu(child, { x: event.clientX, y: event.clientY })
        } : undefined,
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
  onFileMenu(path: string, position: { x: number; y: number }): void
  onCreateChapter(directory: string): void
  onCreateInGroup(kind: Exclude<DocumentKind, 'chapter'>): void
  onCreateGroup(): void
}) {
  const { ctx, sessionId, active, expandPath, revision, onOpen, onFileMenu, onCreateChapter, onCreateInGroup, onCreateGroup } = props
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

  const toggleStatic = (directory: string) => {
    if (openPaths.has(directory)) {
      setOpenPaths((old) => { const next = new Set(old); next.delete(directory); return next })
    } else {
      setOpenPaths((old) => new Set(old).add(directory))
      void loadSubtree(directory)
    }
  }

  return e('nav', { className: 'tree', 'aria-label': '稿件目录' },
    e('div', { className: 'tree-static-groups' },
      e('div', { className: 'tree-directory-row tree-static-row' },
        e('button', {
          className: 'tree-row tree-group',
          type: 'button',
          'aria-label': '新建卷/部',
          onClick: () => onCreateGroup(),
        },
        e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, '＋'),
        e('span', null, '新建卷/部'),
        ),
      ),
      STATIC_GROUPS.map((group) => e('div', { key: group.directory, className: 'tree-static-group' },
        e('div', { className: 'tree-directory-row' },
          e('button', {
            className: 'tree-row',
            type: 'button',
            'aria-expanded': openPaths.has(group.directory),
            onClick: () => toggleStatic(group.directory),
          },
          e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, openPaths.has(group.directory) ? '⌄' : '›'),
          e('span', null, group.label),
          ),
          e('button', {
            className: 'tree-directory-add',
            type: 'button',
            title: `在 ${group.label} 中新建文件`,
            'aria-label': `在 ${group.label} 中新建文件`,
            onClick: () => onCreateInGroup(group.kind),
          }, '＋'),
        ),
        openPaths.has(group.directory) ? e(TreeRows, {
          ctx,
          sessionId,
          path: group.directory,
          level: 1,
          loaded,
          active,
          revision,
          openPaths,
          onOpen,
          onFileMenu,
          onCreateChapter,
          loadSubtree,
          toggleDirectory,
        }) : null,
      )),
    ),
    e('div', { className: 'tree-manuscript-header' },
      e('button', {
        className: 'tree-row tree-manuscript-row',
        type: 'button',
        'aria-expanded': openPaths.has('正文'),
        onClick: () => toggleStatic('正文'),
      },
      e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, openPaths.has('正文') ? '⌄' : '›'),
      e('span', null, '正文'),
      ),
      e('button', { className: 'tree-directory-add', type: 'button', onClick: () => onCreateChapter('正文'), 'aria-label': '新建章节' }, '＋'),
    ),
    openPaths.has('正文') ? e(TreeRows, {
      ctx,
      sessionId,
      path: '正文',
      level: 1,
      loaded,
      active,
      revision,
      openPaths,
      onOpen,
      onFileMenu,
      onCreateChapter,
      loadSubtree,
      toggleDirectory,
    }) : null,
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
      onFileMenu,
      onCreateChapter,
      loadSubtree,
      toggleDirectory,
    }),
    e('div', { hidden: !note, className: 'warning pad' }, note),
  )
}

export function FileContextMenu(props: {
  path: string
  x: number
  y: number
  onClose(): void
  onRename(): void
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
  const top = Math.max(8, Math.min(props.y, globalThis.innerHeight - 148))
  return e('div', {
    ref: panel,
    className: 'file-context-menu',
    role: 'menu',
    'aria-label': '文档操作',
    style: { left, top },
    onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault(),
  },
    e('button', { ref: first, type: 'button', role: 'menuitem', onClick: props.onRename }, '重命名'),
  )
}
