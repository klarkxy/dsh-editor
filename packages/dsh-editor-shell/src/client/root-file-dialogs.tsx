import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { SessionFace } from '../dsh-compat.ts'
import type { EditorCoreHandle } from 'dsh-manuscript/client/editor-core'
import { defaultCreateDirectory } from '../project-files.ts'
import { t } from '../i18n/index.ts'
import type { ShellContext } from './shared.ts'
import { ConfirmDialog, TextPromptDialog } from './dialogs.tsx'
import { FileContextMenu } from './sidebar.tsx'
import { ChapterOpsLayer, chapterMenuModel, snapshotFromHandle } from './chapter-ops.tsx'
import type { useRootFileActions } from './root-file-actions.ts'

type FileActions = ReturnType<typeof useRootFileActions>

export function RootTreeCreateDialog({ actions }: { actions: FileActions }) {
  const { treeCreateRequest, createBusy, fileManageReturnFocus, closeTreeCreate, submitTreeCreate } = actions
  return <TextPromptDialog
    open={Boolean(treeCreateRequest)}
    id="tree-create"
    title={treeCreateRequest?.kind === 'folder' ? t('workspace.newFolder') : t('workspace.newFile')}
    label={treeCreateRequest?.kind === 'folder' ? t('workspace.folderName') : t('workspace.fileName')}
    initialValue=""
    confirmLabel={t('common.create')}
    busy={createBusy}
    returnFocusRef={fileManageReturnFocus}
    onCancel={closeTreeCreate}
    onConfirm={(name: string) => void submitTreeCreate(name)} />
}

export function RootFileDialogs({ actions, ctx, fileSession, files, editorHandleRef,
  path, chapterFiles, pinnedPath, setPinnedPath, exportDocuments }: {
  actions: FileActions
  ctx: ShellContext
  fileSession: SessionFace
  files: string[]
  editorHandleRef: MutableRefObject<EditorCoreHandle | null>
  path: string
  chapterFiles: string[]
  pinnedPath: string | null
  setPinnedPath: Dispatch<SetStateAction<string | null>>
  exportDocuments(directory?: string): Promise<void>
}) {
  const {
    fileMenu, setFileMenu, chapterOps, setChapterOps, clipboard, deleteTarget, renameTarget,
    setRenameTarget, managePath, manageBusy, manageNote, setManageNote, fileManageReturnFocus,
    restoreTreeTriggerIfMenuDismissed, closeFileMenu, beginChapterSplit, beginChapterMerge,
    applyChapterOps, parentOf, openTreeCreate, setClipboardFromMenu, pasteFromMenu, openRenameDialog,
    yieldMenuToDialog, requestDeleteEntry, closeRenameDialog, renameManaged, closeRenameEntryDialog,
    submitRenameEntry, closeDeleteConfirm, confirmDeleteEntry,
  } = actions
  const fileMenuChapterModel = fileMenu ? chapterMenuModel(fileMenu.path, chapterFiles) : null
  return <>
  {fileMenu ? <FileContextMenu
    kind={fileMenu.kind}
    path={fileMenu.path}
    x={fileMenu.x}
    y={fileMenu.y}
    canPaste={Boolean(clipboard)}
    onClose={closeFileMenu}
    onDismissFocus={restoreTreeTriggerIfMenuDismissed}
    onCreateFile={() => openTreeCreate('file', defaultCreateDirectory({
      treeDirectory: fileMenu.kind === 'directory' ? fileMenu.path : parentOf(fileMenu.path),
      activePath: path,
    }))}
    onCreateFolder={() => openTreeCreate('folder', defaultCreateDirectory({
      treeDirectory: fileMenu.kind === 'directory' ? fileMenu.path : parentOf(fileMenu.path),
      activePath: path,
    }))}
    onExportDirectory={() => { void exportDocuments(fileMenu.kind === 'directory' ? fileMenu.path : undefined) }}
    onCopy={() => setClipboardFromMenu('copy', fileMenu.kind, fileMenu.path)}
    onCut={() => setClipboardFromMenu('cut', fileMenu.kind, fileMenu.path)}
    onPaste={() => void pasteFromMenu()}
    onRename={() => {
      /* 文件行保留原有 file.rename 流程（需要 expectedVersion）；
         目录行走 workbench entry.rename（不需要 version）。 */
      if (fileMenu.kind === 'file') openRenameDialog(fileMenu.path)
      else {
        yieldMenuToDialog()
        setRenameTarget({ kind: 'directory', path: fileMenu.path })
        setManageNote('')
      }
    }}
    onDelete={() => requestDeleteEntry(fileMenu.kind, fileMenu.path)}
    onSplit={() => beginChapterSplit(fileMenu.path, 'tree')}
    onMergePrevious={() => beginChapterMerge(fileMenu.path, 'previous')}
    onMergeNext={() => beginChapterMerge(fileMenu.path, 'next')}
    canSplit={fileMenuChapterModel?.canSplit ?? false}
    canMergePrevious={fileMenuChapterModel?.canMergePrevious ?? false}
    canMergeNext={fileMenuChapterModel?.canMergeNext ?? false}
    splitDisabledTitle={fileMenuChapterModel?.splitDisabledTitle ?? ''}
    mergePreviousDisabledTitle={fileMenuChapterModel?.mergePreviousDisabledTitle ?? ''}
    mergeNextDisabledTitle={fileMenuChapterModel?.mergeNextDisabledTitle ?? ''}
    onPin={() => { setPinnedPath(fileMenu.path); setFileMenu(null) }}
    onUnpin={() => { setPinnedPath(null); setFileMenu(null) }}
    isPinned={pinnedPath === fileMenu.path} /> : null}
  {fileSession ? <ChapterOpsLayer
    ctx={ctx}
    sessionId={fileSession.sessionId}
    files={files}
    request={chapterOps}
    getEditorSnapshot={() => snapshotFromHandle(editorHandleRef.current)}
    onClose={() => setChapterOps(null)}
    onApplied={applyChapterOps}
    returnFocusRef={fileManageReturnFocus} /> : null}
  <TextPromptDialog
    open={Boolean(managePath)}
    id="rename-file"
    title={t('workspace.renameFile')}
    label={t('workspace.newName')}
    initialValue={managePath?.split('/').at(-1) ?? ''}
    confirmLabel={t('workspace.saveNewName')}
    returnFocusRef={fileManageReturnFocus}
    onCancel={closeRenameDialog}
    onConfirm={renameManaged} />
  <TextPromptDialog
    open={Boolean(renameTarget)}
    id="rename-entry"
    title={renameTarget?.kind === 'directory' ? t('workspace.renameFolder') : t('common.rename')}
    label={t('workspace.newName')}
    initialValue={renameTarget?.path.split('/').at(-1) ?? ''}
    confirmLabel={t('workspace.saveNewName')}
    note={manageNote}
    busy={manageBusy}
    returnFocusRef={fileManageReturnFocus}
    onCancel={closeRenameEntryDialog}
    onConfirm={submitRenameEntry} />
  <ConfirmDialog
    open={Boolean(deleteTarget)}
    id="delete-entry"
    title={deleteTarget?.kind === 'directory' ? t('workspace.deleteFolderTitle') : t('workspace.deleteFileTitle')}
    message={t('workspace.deleteBody', { path: deleteTarget?.path ?? '' })}
    confirmLabel={t('common.delete')}
    note={manageNote}
    busy={manageBusy}
    returnFocusRef={fileManageReturnFocus}
    onCancel={closeDeleteConfirm}
    onConfirm={() => void confirmDeleteEntry()} />
  </>
}
