import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  displayTreeFileName,
  fileIconKind,
  isPreviewableResourcePath,
  type FileMenuKind,
} from '../../project-files.ts'
import {
  canMoveTreeEntry,
  errorMessage,
  safeRpcCall,
  treeDropDirectory,
  treeMoveTargetDir,
  treeRowPadding,
  treeRevealDirectories,
  type ShellContext,
  type TreeEntry,
} from '../../client/shared.ts'
import { visibleManuscriptEntries } from '../../client/sidebar-chrome.ts'
import { t } from '../../i18n/index.ts'
import { Notice } from '../../ui/index.ts'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  PlusIcon,
} from '../../ui/icons.tsx'

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
  return visibleManuscriptEntries(entries)
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
  return (
    <div
      className="panel-skeleton tree-skeleton"
      role="status"
      aria-label={t('sidebar.treeLoading')}>
      {['62%', '84%', '48%'].map((width, index) => <i key={index} style={{ width }} />)}
    </div>
  );
}

function TreeFileIcon(props: { path: string }) {
  switch (fileIconKind(props.path)) {
    case 'image': return <ImageIcon size="sm" />
    case 'pdf':
    case 'office': return <FileTextIcon size="sm" />
    default: return <FileIcon size="sm" />
  }
}


const TREE_DRAG_TYPE = 'application/x-dsh-tree'

type TreeDragEntry = { kind: FileMenuKind; path: string }

function parseTreeDrag(raw: string | undefined): TreeDragEntry | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TreeDragEntry>
    if ((parsed.kind === 'file' || parsed.kind === 'directory') && typeof parsed.path === 'string' && parsed.path) {
      return { kind: parsed.kind, path: parsed.path }
    }
  } catch {
    return null
  }
  return null
}

type RowProps = {
  path: string
  level: number
  loaded: Record<string, TreeEntry[]>
  active: string
  openPaths: Set<string>
  highlightPath?: string
  menuTargetPath?: string
  tabbablePath: string
  onRowFocus(path: string): void
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }, trigger?: HTMLElement | null): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
  onMove(source: TreeDragEntry, targetDir: string): void
  loadSubtree: LoadSubtree
  toggleDirectory(path: string): void
  dropHover: string | null
  onTreeDragStart(entry: TreeDragEntry, event: ReactDragEvent<HTMLElement>): void
  onTreeDragOver(targetDir: string, hoverPath: string, event: ReactDragEvent<HTMLElement>): void
  onTreeDrop(targetDir: string, event: ReactDragEvent<HTMLElement>): void
  onTreeDragEnd(): void
}

function TreeRows(props: RowProps): ReactNode {
  const { path, level, loaded, active, openPaths, highlightPath, menuTargetPath, tabbablePath, onRowFocus, onOpen, onPreviewImage, onFileMenu, onCreateFile, onCreateFolder, loadSubtree, toggleDirectory, dropHover, onTreeDragStart, onTreeDragOver, onTreeDrop, onTreeDragEnd } = props
  /* loaded 在写入时已按 visibleTreeEntries 排序并过滤,这里直接渲染。 */
  const visible = loaded[path] ?? []
  return (
    <Fragment>
      {visible.map((item) => {
        const child = path ? `${path}/${item.name}` : item.name
        if (item.type === 'directory') {
          const isOpen = openPaths.has(child)
          return (
            <div key={child} className="tree-directory-wrap">
              <div
                className="tree-directory-row"
                style={{ paddingLeft: treeRowPadding(level) }}
                data-menu-target={menuTargetPath === child ? 'true' : undefined}>
                <button
                  className="tree-row"
                  type="button"
                  role="treeitem"
                  aria-level={level + 1}
                  tabIndex={child === tabbablePath ? 0 : -1}
                  data-tree-path={child}
                  data-tree-depth={level}
                  aria-expanded={isOpen}
                  aria-current={highlightPath === child ? 'page' : undefined}
                  draggable={true}
                  data-drop={dropHover === child ? 'true' : undefined}
                  onFocus={() => onRowFocus(child)}
                  onClick={() => toggleDirectory(child)}
                  onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => onTreeDragStart({ kind: 'directory', path: child }, event)}
                  onDragOver={(event: ReactDragEvent<HTMLButtonElement>) => onTreeDragOver(child, child, event)}
                  onDrop={(event: ReactDragEvent<HTMLButtonElement>) => onTreeDrop(child, event)}
                  onDragEnd={onTreeDragEnd}
                  onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    event.preventDefault()
                    onFileMenu('directory', child, { x: event.clientX, y: event.clientY }, event.currentTarget)
                  }}
                  onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
                    if (!isTreeMenuKey(event)) return
                    event.preventDefault()
                    onFileMenu('directory', child, treeMenuPosition(event.currentTarget), event.currentTarget)
                  }}>
                  <span className="tree-marker" aria-hidden="true">
                    {isOpen ? <ChevronDownIcon size="sm" /> : <ChevronRightIcon size="sm" />}
                  </span>
                  <span className="tree-icon" aria-hidden="true"><FolderIcon size="sm" /></span>
                  <span className="tree-name" title={item.name}>
                    {item.name}
                  </span>
                </button>
                <span className="tree-row-actions">
                  <button
                    className="tree-directory-add"
                    type="button"
                    title={t('sidebar.newFileIn', { name: item.name })}
                    aria-label={t('sidebar.newFileIn', { name: item.name })}
                    onClick={() => onCreateFile(child)}>
                    <PlusIcon size="sm" />
                  </button>
                  <button
                    className="tree-directory-add"
                    type="button"
                    title={t('sidebar.newFolderIn', { name: item.name })}
                    aria-label={t('sidebar.newFolderIn', { name: item.name })}
                    onClick={() => onCreateFolder(child)}>
                    <FolderIcon size="sm" />
                  </button>
                </span>
              </div>
              {isOpen ? <div role="group" className="tree-children">
                <TreeRows {...props} path={child} level={level + 1} />
              </div> : null}
            </div>
          );
        }
        return (
          <div key={child} className="tree-file-row" style={{ paddingLeft: treeRowPadding(level) }}>
            <button
              className="tree-row tree-main"
              type="button"
              role="treeitem"
              aria-level={level + 1}
              tabIndex={child === tabbablePath ? 0 : -1}
              data-tree-path={child}
              aria-current={active === child || highlightPath === child ? 'page' : undefined}
              data-menu-target={menuTargetPath === child ? 'true' : undefined}
              data-tree-depth={level}
              draggable={true}
              data-drop={dropHover === child ? 'true' : undefined}
              onFocus={() => onRowFocus(child)}
              onClick={() => (isPreviewableResourcePath(child) ? onPreviewImage(child) : onOpen(child))}
              onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => onTreeDragStart({ kind: 'file', path: child }, event)}
              onDragOver={(event: ReactDragEvent<HTMLButtonElement>) => onTreeDragOver(treeDropDirectory('file', child), child, event)}
              onDrop={(event: ReactDragEvent<HTMLButtonElement>) => onTreeDrop(treeDropDirectory('file', child), event)}
              onDragEnd={onTreeDragEnd}
              onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
                event.preventDefault()
                onFileMenu('file', child, { x: event.clientX, y: event.clientY }, event.currentTarget)
              }}
              onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
                if (!isTreeMenuKey(event)) return
                event.preventDefault()
                onFileMenu('file', child, treeMenuPosition(event.currentTarget), event.currentTarget)
              }}>
              <span className="tree-marker" aria-hidden="true" />
              <span className="tree-icon" aria-hidden="true"><TreeFileIcon path={child} /></span>
              <span className="tree-name" title={item.name}>
                {displayTreeFileName(item.name)}
              </span>
            </button>
          </div>
        );
      })}
    </Fragment>
  );
}

export function Tree(props: {
  ctx: ShellContext
  sessionId: string
  active: string
  expandPath: string
  revision: number
  highlightPath?: string
  /* 右键菜单打开期间，目标行加 line-strong 内描边，与当前文档区分（spec §3）。 */
  menuTargetPath?: string
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }, trigger?: HTMLElement | null): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
  onMove(source: TreeDragEntry, targetDir: string): void
}) {
  const { ctx, sessionId, active, expandPath, revision, highlightPath, menuTargetPath, onOpen, onPreviewImage, onFileMenu, onCreateFile, onCreateFolder, onMove } = props
  const [dragSource, setDragSource] = useState<TreeDragEntry | null>(null)
  const [dropHover, setDropHover] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Record<string, TreeEntry[]>>({})
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set())
  const [note, setNote] = useState('')
  /* roving tabindex 的锚点:最近聚焦过的行(行 onFocus 同步进来),空串表示尚未聚焦,
     停靠行推导时回退到活动文件。 */
  const [focusedPath, setFocusedPath] = useState('')
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
    setFocusedPath('')
    const expansion = treeRevealDirectories(expandPath, active)
    setOpenPaths(new Set(expansion))
    void loadSubtree('')
    for (const directory of expansion) void loadSubtree(directory)
    return () => { loadGeneration.current += 1 }
  }, [sessionId, revision])

  /* expandPath / 当前打开的文件只要求"保证这些祖先目录展开且已加载"：并入 openPaths，
     并仅为尚未加载的目录补发 tree.list，不重载整棵树。 */
  useEffect(() => {
    const expansion = treeRevealDirectories(expandPath, active)
    if (!expansion.length) return
    setOpenPaths((old) => {
      const next = new Set(old)
      for (const directory of expansion) next.add(directory)
      return next.size === old.size ? old : next
    })
    for (const directory of expansion) {
      if (loadedRef.current[directory] === undefined) void loadSubtree(directory)
    }
  }, [expandPath, active])

  const toggleDirectory = (path: string) => {
    setOpenPaths((old) => {
      const next = new Set(old)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (!openPaths.has(path)) void loadSubtree(path)
  }

  const onTreeDragStart = (entry: TreeDragEntry, event: ReactDragEvent<HTMLElement>) => {
    event.dataTransfer.setData(TREE_DRAG_TYPE, JSON.stringify(entry))
    event.dataTransfer.setData('text/plain', entry.path)
    event.dataTransfer.effectAllowed = 'move'
    setDragSource(entry)
    setDropHover(null)
  }
  const onTreeDragOver = (targetDir: string, hoverPath: string, event: ReactDragEvent<HTMLElement>) => {
    if (!dragSource) return
    if (!canMoveTreeEntry(dragSource.path, treeMoveTargetDir(targetDir))) {
      event.dataTransfer.dropEffect = 'none'
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropHover((current) => current === hoverPath ? current : hoverPath)
  }
  const onTreeDrop = (targetDir: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault()
    const source = dragSource ?? parseTreeDrag(event.dataTransfer.getData(TREE_DRAG_TYPE))
    setDragSource(null)
    setDropHover(null)
    if (!source || !canMoveTreeEntry(source.path, treeMoveTargetDir(targetDir))) return
    onMove(source, targetDir)
  }
  const onTreeDragEnd = () => {
    setDragSource(null)
    setDropHover(null)
  }

  /* 键盘导航（WAI-ARIA treeview roving tabindex）：方向键/Home/End 在可见行间移动
     DOM 焦点，行 onFocus 把 focusedPath 同步成新的停靠行，因此 Tab 始终以聚焦行为
     锚点离开/回到树内；行内原有的 ContextMenu/Shift+F10 不受影响。 */
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

  /* 唯一 tab 停靠行（roving tabindex）：默认跟随最近聚焦的行；聚焦行已不在可见行
     里（整树刷新、目录折叠、文件被删）时回退：活动文件 → 高亮行 → 第一可见行。 */
  const rootEntries = loaded['']
  const rowPaths = visibleTreePaths(loaded, openPaths, '')
  const fallbackTabbablePath = rowPaths.includes(active) ? active : highlightPath && rowPaths.includes(highlightPath) ? highlightPath : rowPaths[0] ?? ''
  const tabbablePath = rowPaths.includes(focusedPath) ? focusedPath : fallbackTabbablePath

  return (
    <nav
      className="tree"
      role="tree"
      aria-label={t('sidebar.manuscriptTree')}
      ref={treeNavRef}
      data-drop={dropHover === '' ? 'true' : undefined}
      onKeyDown={onTreeKeyDown}
      onDragOver={(event: ReactDragEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return
        onTreeDragOver('', '', event)
      }}
      onDrop={(event: ReactDragEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return
        onTreeDrop('', event)
      }}
      onDragLeave={(event: ReactDragEvent<HTMLElement>) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        setDropHover(null)
      }}
      onContextMenu={(event: ReactMouseEvent<HTMLElement>) => {
        // 仅在空白区(非已有行)右键时弹出根目录菜单;行内已自行阻止冒泡。
        if (event.target === event.currentTarget) {
          event.preventDefault()
          onFileMenu('directory', '', { x: event.clientX, y: event.clientY }, event.currentTarget)
        }
      }}>
      {rootEntries === undefined
        ? (note ? null : treeSkeleton())
        : rootEntries.length === 0
          ? <p className="tree-empty">
              {t('sidebar.treeEmpty')}
            </p>
          : <TreeRows
              path=""
              level={0}
              loaded={loaded}
              active={active}
              openPaths={openPaths}
              highlightPath={highlightPath}
              menuTargetPath={menuTargetPath}
              tabbablePath={tabbablePath}
              onRowFocus={setFocusedPath}
              onOpen={onOpen}
              onPreviewImage={onPreviewImage}
              onFileMenu={onFileMenu}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onMove={onMove}
              loadSubtree={loadSubtree}
              toggleDirectory={toggleDirectory}
              dropHover={dropHover}
              onTreeDragStart={onTreeDragStart}
              onTreeDragOver={onTreeDragOver}
              onTreeDrop={onTreeDrop}
              onTreeDragEnd={onTreeDragEnd} />}
      {note ? <Notice tone="danger" className="tree-notice">{note}</Notice> : null}
    </nav>
  );
}
