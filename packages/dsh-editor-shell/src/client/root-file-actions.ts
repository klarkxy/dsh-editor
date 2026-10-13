import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { SessionFace, WorkspaceId } from '../dsh-compat.ts'
import { WORKBENCH_RPC_CHANNEL } from 'dsh-editor-workbench/contracts'
import { defaultCreateDirectory } from '../project-files.ts'
import { errorMessage, canMoveTreeEntry, treeMoveTargetDir, safeRpcCall, type WorkspaceOpenState, type ShellContext } from './shared.ts'
import { type FileMenuKind } from '../project-files.ts'
import { requestMergeChapter, requestSplitChapter, shouldOpenAfterChapterApply, type ChapterOpsRequest } from '../model/chapter-ops.ts'
import { type SearchHit } from '../model/search-panel.ts'
import { t } from '../i18n/index.ts'
import type { Dispatch, SetStateAction } from 'react'

type TreeCreateRequest = { kind: 'file' | 'folder'; directory: string }
type FileMenuState = { kind: FileMenuKind; path: string; x: number; y: number } | null
type ClipboardEntry = { op: 'copy' | 'cut'; path: string; kind: FileMenuKind } | null

// Tree commands and their dialogs own clipboard and focus-return lifetimes together.
export function useRootFileActions({ ctx, fileSession, workspaceOpen, path, setPath, editorDirty, editorDirtyRef,
  chapterFiles, openDocument, setWorkbenchNote, setTreeRevision, setContentRevision,
  setTreeExpansionPath, saveEditorBeforeAction, openWorkspaceId }: {
  ctx: ShellContext
  fileSession?: SessionFace
  workspaceOpen: WorkspaceOpenState
  path: string
  setPath: Dispatch<SetStateAction<string>>
  editorDirty: boolean
  editorDirtyRef: MutableRefObject<boolean>
  chapterFiles: string[]
  openDocument(path: string, hit?: SearchHit): void
  setWorkbenchNote: Dispatch<SetStateAction<string>>
  setTreeRevision: Dispatch<SetStateAction<number>>
  setContentRevision: Dispatch<SetStateAction<number>>
  setTreeExpansionPath: Dispatch<SetStateAction<string>>
  saveEditorBeforeAction(): Promise<boolean>
  openWorkspaceId?: WorkspaceId
}) {
  const [createNote, setCreateNote] = useState('')
  const [treeCreateRequest, setTreeCreateRequest] = useState<TreeCreateRequest | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [fileMenu, setFileMenu] = useState<FileMenuState>(null)
  const [chapterOps, setChapterOps] = useState<ChapterOpsRequest | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardEntry>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; kind: FileMenuKind } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ path: string; kind: FileMenuKind } | null>(null)

  const [managePath, setManagePath] = useState<string | null>(null)
  const [manageBusy, setManageBusy] = useState(false)
  const [manageNote, setManageNote] = useState('')
  const fileManageReturnFocus = useRef<HTMLElement | null>(null)
  const menuYieldsToDialog = useRef(false)

  useEffect(() => {
    setFileMenu(null); setChapterOps(null); setManagePath(null); setManageNote('')
    setClipboard(null); setDeleteTarget(null); setRenameTarget(null)
  }, [openWorkspaceId])
  const openImagePreview = useCallback(async (resourcePath: string) => {
    if (!fileSession || workspaceOpen.kind !== 'ready') return
    try {
      const sidebar = (ctx as unknown as { sidebarRight: { openResource(address: string): unknown } }).sidebarRight
      await sidebar.openResource(fileAddressFor(fileSession.sessionId, workspaceOpen.path, resourcePath))
      setWorkbenchNote('')
    } catch (error) { setWorkbenchNote(error instanceof Error ? error.message : String(error)) }
  }, [fileSession, workspaceOpen, ctx])
  const openFileMenu = useCallback((kind: FileMenuKind, selectedPath: string, position: { x: number; y: number }, trigger?: HTMLElement | null) => {
    if (editorDirtyRef.current) { setWorkbenchNote(t('error.saveFirst')); return }
    setWorkbenchNote('')
    menuYieldsToDialog.current = false
    fileManageReturnFocus.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setFileMenu({ kind, path: selectedPath, x: position.x, y: position.y })
  }, [])
  const yieldMenuToDialog = () => {
    menuYieldsToDialog.current = true
    setFileMenu(null)
  }
  const restoreTreeTriggerIfMenuDismissed = () => {
    if (menuYieldsToDialog.current) return
    const target = fileManageReturnFocus.current
    if (target?.isConnected) target.focus()
  }
  const closeFileMenu = () => setFileMenu(null)
  const beginChapterSplit = (target: string, source: 'tree' | 'cursor') => {
    if (source === 'tree') yieldMenuToDialog()
    else {
      fileManageReturnFocus.current = null
      setFileMenu(null)
    }
    const next = requestSplitChapter({ path: target, source, editorDirty, activePath: path })
    if (!next.ok) { setWorkbenchNote(next.reason === 'unsaved' ? t('error.saveFirst') : t('chapterOps.splitTxtDisabled')); return }
    setChapterOps(next.request)
  }
  const beginChapterMerge = (chapterPath: string, direction: 'previous' | 'next') => {
    yieldMenuToDialog()
    const next = requestMergeChapter({ chapterPath, direction, files: chapterFiles, editorDirty, activePath: path })
    if (!next.ok) {
      setWorkbenchNote(next.reason === 'unsaved' ? t('error.saveFirst') : t('chapterOps.mergeMdOnly'))
      return
    }
    setChapterOps(next.request)
  }
  const applyChapterOps = (appliedPath: string) => {
    setTreeRevision((value) => value + 1)
    if (appliedPath.startsWith('正文/')) setTreeExpansionPath(appliedPath)
    if (!chapterOps || !shouldOpenAfterChapterApply(chapterOps, appliedPath)) {
      if (appliedPath === path) setContentRevision((value) => value + 1)
      return
    }
    openDocument(appliedPath)
    setContentRevision((value) => value + 1)
  }
  /* 把绝对路径转为父目录(用于"在文件行右键 → 粘贴"的目录来源)。根目录统一用 '.'(Host 同时接受 '' 与 '.')。 */
  const parentOf = (target: string): string => {
    const index = target.lastIndexOf('/')
    return index < 0 ? '.' : target.slice(0, index)
  }
  const openRenameDialog = (selectedPath: string) => {
    if (editorDirty) { setWorkbenchNote(t('error.saveFirst')); return }
    yieldMenuToDialog()
    setManagePath(selectedPath)
    setManageNote('')
  }
  const closeRenameDialog = () => {
    if (manageBusy) return
    setManagePath(null)
    setManageNote('')
  }
  const renameManaged = async (name: string) => {
    if (!fileSession || !managePath || manageBusy) return
    setManageBusy(true); setManageNote('')
    const read = await safeRpcCall<{ version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: fileSession.sessionId, path: managePath }))
    setManageBusy(false)
    if (!read.ok) { setManageNote(errorMessage(read)); return }
    const renamed = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'file.rename', {
      sessionId: fileSession.sessionId,
      path: managePath,
      newName: name,
      expectedVersion: read.value.version,
    }))
    if (!renamed.ok) { setManageNote(errorMessage(renamed)); return }
    if (path === managePath) setPath(renamed.value.path)
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.renamed', { path: renamed.value.path }))
    setManagePath(null)
  }
  /* 目录行重命名:走 workbench entry.rename,不需要读 version；失败时把 note 放进
     fileManageReturnFocus 触发的输入框状态。 */
  const submitRenameEntry = async (name: string) => {
    if (!fileSession || !renameTarget) return
    const target = renameTarget
    setManageBusy(true); setManageNote('')
    const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'entry.rename', {
      sessionId: fileSession.sessionId,
      path: target.path,
      name,
    }))
    setManageBusy(false)
    if (!result.ok) { setManageNote(errorMessage(result)); return }
    const renamed = result.value.path
    if (path === target.path) setPath(renamed)
    else if (target.kind === 'directory' && path.startsWith(`${target.path}/`)) {
      /* 改名的是当前文稿的父目录：同步改写当前子路径。 */
      setPath(`${renamed}${path.slice(target.path.length)}`)
    }
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.renamed', { path: renamed }))
    setRenameTarget(null)
  }
  const closeRenameEntryDialog = () => {
    if (manageBusy) return
    setRenameTarget(null)
    setManageNote('')
  }
  const requestDeleteEntry = (kind: FileMenuKind, targetPath: string) => {
    if (editorDirty) { setWorkbenchNote(t('error.saveFirst')); return }
    yieldMenuToDialog()
    setManageNote('')
    setDeleteTarget({ kind, path: targetPath })
  }
  const closeDeleteConfirm = () => {
    if (manageBusy) return
    setDeleteTarget(null)
    setManageNote('')
  }
  const confirmDeleteEntry = async () => {
    const target = deleteTarget
    if (!fileSession || !target || manageBusy) return
    setManageBusy(true)
    setManageNote('')
    const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'entry.delete', {
      sessionId: fileSession.sessionId,
      path: target.path,
    }))
    setManageBusy(false)
    /* 失败原因内联在确认框里，不再只写进遮罩后面的侧栏通知。 */
    if (!result.ok) { setManageNote(errorMessage(result)); return }
    setDeleteTarget(null)
    if (target.kind === 'file' && path === target.path) setPath('')
    else if (target.kind === 'directory' && path.startsWith(`${target.path}/`)) {
      /* 删除的是当前文稿的父目录：当前子路径一并清空。 */
      setPath('')
    }
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.deleted', { path: target.path }))
  }
  const setClipboardFromMenu = (op: 'copy' | 'cut', kind: FileMenuKind, targetPath: string) => {
    /* cut 当前文稿或其父目录等于要搬走缓冲区：编辑器有未保存内容时先阻止，防 buffer 丢失。 */
    if (op === 'cut' && editorDirty && (targetPath === path || (kind === 'directory' && path.startsWith(`${targetPath}/`)))) {
      setWorkbenchNote(t('note.saveBeforeCut'))
      setFileMenu(null)
      return
    }
    setClipboard({ op, kind, path: targetPath })
    setWorkbenchNote(op === 'copy' ? t('note.copied', { path: targetPath }) : t('note.cut', { path: targetPath }))
    setFileMenu(null)
  }
  const pasteFromMenu = async () => {
    if (!fileSession || !fileMenu || !clipboard) return
    if (fileMenu.kind === 'directory') {
      /* 粘贴到树根时统一传 '.'（Host 同时接受 '' 与 '.'）。 */
      const targetDir = fileMenu.path === '' ? '.' : fileMenu.path
      await runClipboardPaste(targetDir)
      return
    }
    /* 文件行粘贴:放进该文件所在目录。 */
    await runClipboardPaste(parentOf(fileMenu.path))
  }
  const moveTreeEntry = useCallback(async (entry: { kind: FileMenuKind; path: string }, targetDir: string) => {
    if (!fileSession) return
    const dest = treeMoveTargetDir(targetDir)
    if (!canMoveTreeEntry(entry.path, dest)) return
    if (editorDirty && (entry.path === path || (entry.kind === 'directory' && path.startsWith(`${entry.path}/`)))) {
      setWorkbenchNote(t('note.saveBeforeCut'))
      return
    }
    const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'entry.move', {
      sessionId: fileSession.sessionId,
      path: entry.path,
      targetDir: dest,
    }))
    if (!result.ok) { setWorkbenchNote(errorMessage(result)); return }
    if (entry.kind === 'file' && path === entry.path) setPath(result.value.path)
    else if (entry.kind === 'directory' && path.startsWith(`${entry.path}/`)) {
      setPath(`${result.value.path}${path.slice(entry.path.length)}`)
    }
    if (clipboard?.path === entry.path) setClipboard(null)
    setTreeExpansionPath(result.value.path)
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(t('note.movedTo', { path: result.value.path }))
  }, [fileSession, editorDirty, path, clipboard, ctx])
  const runClipboardPaste = async (targetDir: string) => {
    if (!fileSession || !clipboard) return
    const sessionId = fileSession.sessionId
    const entry = clipboard
    setFileMenu(null)
    if (entry.op === 'copy') {
      const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'entry.copy', {
        sessionId,
        path: entry.path,
        targetDir,
      }))
      if (!result.ok) { setWorkbenchNote(errorMessage(result)); return }
      setTreeRevision((value) => value + 1)
      setWorkbenchNote(t('note.copiedTo', { path: result.value.path }))
      return
    }
    await moveTreeEntry(entry, targetDir)
  }
  const openTreeCreate = (kind: 'file' | 'folder', directory: string) => {
    if (!fileSession) return
    void (async () => {
      /* 与导航同一套保存 gate：有未保存内容先保存；空白稿纸/无选中文件直接放行。 */
      if (!(await saveEditorBeforeAction())) return
      if (fileMenu) yieldMenuToDialog()
      else fileManageReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : fileManageReturnFocus.current
      setCreateNote('')
      setTreeCreateRequest({ kind, directory })
    })()
  }
  const closeTreeCreate = () => {
    if (createBusy) return
    setTreeCreateRequest(null)
    setCreateNote('')
  }
  const submitTreeCreate = async (name: string) => {
    if (!fileSession || !treeCreateRequest) return
    const request = treeCreateRequest
    setCreateBusy(true)
    setCreateNote('')
    if (request.kind === 'folder') {
      const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'directory.create', {
        sessionId: fileSession.sessionId,
        path: request.directory ? `${request.directory}/${name}` : name,
      }))
      setCreateBusy(false)
      if (!result.ok) { setCreateNote(errorMessage(result)); return }
      setTreeCreateRequest(null)
      setTreeRevision((old) => old + 1)
      setWorkbenchNote(t('note.created', { path: result.value.path }))
      return
    }
    const fileName = /\.[a-z0-9]{1,8}$/i.test(name) ? name : `${name}.md`
    const target = request.directory ? `${request.directory}/${fileName}` : fileName
    const result = await safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'file.create', {
      sessionId: fileSession.sessionId,
      path: target,
      text: '',
    }))
    setCreateBusy(false)
    if (!result.ok) { setCreateNote(errorMessage(result)); return }
    setTreeCreateRequest(null)
    openDocument(target)
    setTreeRevision((old) => old + 1)
  }
  /* 树内新建文件/文件夹：openTreeCreate 读取 fileSession/fileMenu，二者列入依赖。 */
  const onTreeCreateFile = useCallback((directory: string) => openTreeCreate('file', directory), [fileSession, fileMenu])
  const onTreeCreateFolder = useCallback((directory: string) => openTreeCreate('folder', directory), [fileSession, fileMenu])
  /* 编辑器空态"新建"与句柄回传、保存回调：身份稳定，editorDirty 翻转不连带重渲染编辑列。 */
  const onEditorCreate = useCallback(() => openTreeCreate('file', defaultCreateDirectory({
    treeDirectory: fileMenu?.kind === 'directory' ? fileMenu.path : undefined,
    activePath: path,
  })), [fileSession, fileMenu, path])

  return {
    createNote, treeCreateRequest, createBusy, fileMenu, setFileMenu, chapterOps, setChapterOps,
    clipboard, deleteTarget, renameTarget, setRenameTarget, managePath, manageBusy, manageNote, setManageNote,
    fileManageReturnFocus, openImagePreview, openFileMenu, yieldMenuToDialog, restoreTreeTriggerIfMenuDismissed,
    closeFileMenu, beginChapterSplit, beginChapterMerge, applyChapterOps, parentOf,
    openRenameDialog, closeRenameDialog, renameManaged, submitRenameEntry, closeRenameEntryDialog,
    requestDeleteEntry, closeDeleteConfirm, confirmDeleteEntry, setClipboardFromMenu, pasteFromMenu,
    moveTreeEntry, openTreeCreate, closeTreeCreate, submitTreeCreate, onTreeCreateFile, onTreeCreateFolder, onEditorCreate,
  }
}
