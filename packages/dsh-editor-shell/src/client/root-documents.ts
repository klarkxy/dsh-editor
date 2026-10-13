import { collectWorkspaceFiles } from './root-workspaces.tsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionFace, WorkspaceId } from '../dsh-compat.ts'
import { WORKBENCH_RPC_CHANNEL, type ProjectOverview, type SnapshotResponse } from 'dsh-editor-workbench/contracts'
import { PROGRESS_RECORD_DEBOUNCE_MS, createDebouncedInvoker, progressRecordChars } from '../progress-record.ts'
import { errorMessage, partialApplyDetails, safeRpcCall, snapshotTimeLabel, type RevealRequest, type ShellContext } from './shared.ts'
import type { EditorCoreHandle } from 'dsh-manuscript/client/editor-core'
import { saveOpenEditor, type EditorSaveBlockReason } from '../wrap-up-view.ts'
import { createNavSaveGate } from '../model/nav-save-gate.ts'
import { toRevealRequest, type SearchHit } from '../model/search-panel.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import type { Dispatch, SetStateAction } from 'react'

/* 自动保存被拦住时的驻留原因提示：组字/冲突/保存失败/保存期间新输入/身份变化。 */
const SAVE_STAY_NOTE: Record<EditorSaveBlockReason, MessageKey> = {
  composing: 'note.staySaveComposing',
  conflict: 'note.staySaveConflict',
  save: 'note.staySaveFailed',
  typing: 'note.staySaveTyping',
  identity: 'note.staySaveIdentity',
}

// Saving, navigation and saved-document observations use the retained file session.
export function useRootDocuments({ ctx, fileSession, path, setPath, setWorkbenchNote,
  setTreeRevision, setContentRevision, pinnedPath, openWorkspaceId }: {
  ctx: ShellContext
  fileSession?: SessionFace
  path: string
  setPath: Dispatch<SetStateAction<string>>
  setWorkbenchNote: Dispatch<SetStateAction<string>>
  setTreeRevision: Dispatch<SetStateAction<number>>
  setContentRevision: Dispatch<SetStateAction<number>>
  pinnedPath: string | null
  openWorkspaceId?: WorkspaceId
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<SnapshotResponse[] | null>(null)
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<SnapshotResponse | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  /* editorDirty 的 ref 镜像：需要稳定身份的回调（memo 列的 props）读它而不是闭包值，
     翻转不再连带重渲染所有列；新鲜度与闭包一致（渲染期同步，事件总在渲染后触发）。 */
  const editorDirtyRef = useRef(editorDirty)
  editorDirtyRef.current = editorDirty
  const editorHandleRef = useRef<EditorCoreHandle | null>(null)
  /* 返回首页/切换作品/新建/打开/树内导航前，先通过当前编辑器句柄保存：保存成功才继续。
     不依赖滞后的 dirty 布尔状态——句柄里存在与当前选择一致的有效文档就走保存
     （干净缓冲区内部直接放行，不落盘）；组字/冲突/失败/保存期间新输入/身份变化都留在原处。
     保存进行中到来的请求排队等同一个在飞保存，结束后只放行最后一个，
     不再发第二次保存（nav-save-gate）。 */
  const navSaveGate = useRef(createNavSaveGate()).current
  const latestDocRef = useRef({ path: '', fileSessionId: '' })
  latestDocRef.current = { path, fileSessionId: fileSession?.sessionId ?? '' }
  const saveEditorBeforeAction = async (): Promise<boolean> => {
    const handle = editorHandleRef.current
    const doc = handle?.getDocument()
    const latest = latestDocRef.current
    /* 空白稿纸/未选中文件等无有效当前文档：无可保存，放行。 */
    if (!handle || !doc || doc.sessionId !== latest.fileSessionId || doc.path !== latest.path) return true
    return navSaveGate(async () => {
      const result = await saveOpenEditor(handle, { sessionId: doc.sessionId, path: doc.path })
      if (!result.ok) {
        setWorkbenchNote(t(SAVE_STAY_NOTE[result.reason]))
        return false
      }
      /* await 之后复核：句柄文档身份与 root 当前文档/会话都不能变；保存期间发生的切换优先，
         旧请求不得替新作品/新章节导航。 */
      const after = handle.getDocument()
      const now = latestDocRef.current
      return Boolean(after && after.sessionId === doc.sessionId && after.path === doc.path
        && now.fileSessionId === doc.sessionId && now.path === doc.path)
    })
  }
  /* 编辑器 dirty 状态经 React 回传有滞后；是否真有未保存内容直接读句柄实时缓冲区。 */
  const editorHasUnsavedText = () => {
    const handle = editorHandleRef.current
    if (!handle) return false
    const doc = handle.getDocument()
    return Boolean(doc && handle.getText() !== doc.text)
  }
  const [reveal, setReveal] = useState<RevealRequest | null>(null)
  const progressRecord = useRef(createDebouncedInvoker(PROGRESS_RECORD_DEBOUNCE_MS)).current
  const fileSessionRef = useRef(fileSession)
  fileSessionRef.current = fileSession
  useEffect(() => () => progressRecord.cancel(), [progressRecord])

  useEffect(() => {
    setEditorDirty(false)
    setHistoryOpen(false); setSnapshots(null); setRollbackTarget(null); setReveal(null)
    progressRecord.cancel()
  }, [openWorkspaceId])
  useEffect(() => {
    if (!historyOpen || !fileSession) { setSnapshots(null); return }
    let live = true
    void (async () => {
      const result = await safeRpcCall<SnapshotResponse[]>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.list', { sessionId: fileSession.sessionId }))
      if (!live) return
      setSnapshots(result.ok && Array.isArray(result.value) ? result.value : [])
      if (!result.ok) setWorkbenchNote(errorMessage(result))
    })()
    return () => { live = false }
  }, [historyOpen, fileSession?.sessionId, snapshotRevision])
  /* 统一导航入口：树/搜索/钉住/命令面板/章节导航都先走保存 gate，成功再跳转；失败留原处。
     导航发起时记下当前文档身份，保存期间被更新的导航优先，避免旧请求覆盖新选择。 */
  /* 保存 gate 与 dirty 判定的内部帮手都直读 ref（editorHandleRef/latestDocRef/navSaveBusyRef），
     因此 openDocument 只以 path 为依赖：身份稳定，供 memo 列与命令面板复用。 */
  const openDocument = useCallback((nextPath: string, hit?: SearchHit) => {
    if (nextPath === path && !hit) return
    if (editorHasUnsavedText()) {
      const fromPath = path
      const fromSessionId = latestDocRef.current.fileSessionId
      void (async () => {
        if (!(await saveEditorBeforeAction())) return
        if (latestDocRef.current.path !== fromPath || latestDocRef.current.fileSessionId !== fromSessionId) return
        setWorkbenchNote('')
        setPath(nextPath)
        setReveal(hit ? toRevealRequest(hit) : null)
      })()
      return
    }
    setWorkbenchNote('')
    setPath(nextPath)
    setReveal(hit ? toRevealRequest(hit) : null)
  }, [path])
  const recordSavedProgress = async () => {
    const session = fileSessionRef.current
    if (!session) return
    const refreshed = await safeRpcCall<ProjectOverview>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.overview', { sessionId: session.sessionId }))
    if (!refreshed.ok) return
    const chars = progressRecordChars(refreshed.value)
    if (chars === null) return
    await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'progress.record', {
      sessionId: session.sessionId,
      totalChars: chars,
    }))
  }
  const commitSnapshot = async () => {
    if (!fileSession || snapshotBusy) return
    setSnapshotBusy(true)
    const label = snapshotTimeLabel(Date.now())
    const result = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.create', { sessionId: fileSession.sessionId, label }))
    setSnapshotBusy(false)
    if (!result.ok) { setWorkbenchNote(errorMessage(result)); return }
    setWorkbenchNote(t('note.committed', { label }))
    setSnapshotRevision((value) => value + 1)
  }
  const requestRollback = (snapshot: SnapshotResponse) => {
    if (snapshotBusy) return
    if (editorDirtyRef.current) { setWorkbenchNote(t('note.saveBeforeRollback')); return }
    setRollbackTarget(snapshot)
  }
  const confirmRollback = async () => {
    const target = rollbackTarget
    if (!fileSession || !target || snapshotBusy) return
    setSnapshotBusy(true)
    const result = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.rollback', { sessionId: fileSession.sessionId, snapshotId: target.snapshotId }))
    setSnapshotBusy(false)
    if (!result.ok) {
      /* 部分回滚：不声称零写入，展示安全快照并刷新各视图到真实的中间状态。 */
      const partial = partialApplyDetails(result)
      if (partial) {
        setRollbackTarget(null)
        const wrote = partial.appliedPaths.length ? t('note.rollbackPartialPaths', { count: partial.appliedPaths.length }) : ''
        const snapshot = partial.safetySnapshotId ? t('note.rollbackPartialSnapshot', { id: partial.safetySnapshotId }) : ''
        const backup = partial.recoveryPath ? t('note.rollbackPartialBackup', { path: partial.recoveryPath }) : ''
        setWorkbenchNote(t('note.rollbackPartial', { wrote, snapshot, backup }))
        setSnapshotRevision((value) => value + 1)
        setTreeRevision((value) => value + 1)
        setContentRevision((value) => value + 1)
        return
      }
      setWorkbenchNote(errorMessage(result))
      return
    }
    setRollbackTarget(null)
    setWorkbenchNote(t('note.rolledBack', { label: target.label ?? target.createdAt }))
    setSnapshotRevision((value) => value + 1)
    setTreeRevision((value) => value + 1)
    setContentRevision((value) => value + 1)
    try {
      const remaining = await collectWorkspaceFiles(ctx, fileSession.sessionId)
      if (path && !remaining.includes(path)) setPath('')
    } catch { /* 目录树刷新会带出最新状态 */ }
  }
  const onEditorHandle = useCallback((handle: EditorCoreHandle | null) => { editorHandleRef.current = handle }, [])
  const onEditorSaved = useCallback(() => {
    if (path === pinnedPath) setContentRevision((value) => value + 1)
    progressRecord.schedule(() => { void recordSavedProgress() })
  }, [path, pinnedPath])

  return {
    editorDirty, setEditorDirty, editorDirtyRef, editorHandleRef, latestDocRef,
    saveEditorBeforeAction, openDocument, onEditorHandle, onEditorSaved, reveal,
    historyOpen, setHistoryOpen, snapshots, snapshotBusy,
    rollbackTarget, setRollbackTarget, commitSnapshot, requestRollback, confirmRollback,
  }
}
