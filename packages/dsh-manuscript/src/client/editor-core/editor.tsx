import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'
import { openFindPanel, openReplacePanel, revealEditorRange } from './search.ts'
import { selectParagraphInView } from './paragraph-selection.ts'
import { EditorChrome } from './editor-chrome.tsx'
import { useEditorCommands } from './editor-commands.ts'
import { usePaperView, type PaperViewCallbacks } from './editor-view.ts'
import { createDraftSyncTimer } from './draft-sync.ts'
import { defaultFimPayload, defaultPatchPayload, extractText } from './completion-payload.ts'
import type {
  EditorCoreDraft, EditorCoreDraftBackup, EditorCoreHandle, EditorCorePaperProjection,
  EditorCoreProps, EditorCoreRpc, EditorCoreStatus,
} from './editor-contracts.ts'
import {
  isEditorTargetCurrent,
  paperSelectionText,
  type EditorContextMenuEvent,
  type EditorTargetSnapshot,
} from './editor-clipboard.ts'

type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } }
import {
  addCompletionCandidate,
  applyGhost,
  applySelectionPatch,
  canApplyGhost,
  isDirty,
  isSelectionCurrent,
  saveState,
  selectionTicket,
  projectedPaperUnchanged,
  shouldRetainDraftAfterSave,
  type EditorDocument,
  type SaveState,
  type SelectionTicket,
  type StoredDraft,
} from './editor-state.ts'
import { automaticCompletionReady, type CompletionPreference } from './completion-preference.ts'

// Re-exports keep the public surface of editor-core in a single barrel.
export {
  addCompletionCandidate,
  applyGhost,
  applySelectionPatch,
  canApplyGhost,
  documentKey,
  hasUnsavedChanges,
  isDirty,
  isSelectionCurrent,
  isStaleWriteError,
  parseStoredDraft,
  saveState,
  selectionTicket,
  shouldApplyRead,
  shouldRetainDraftAfterSave,
  projectedPaperUnchanged,
  draftStorageKey,
  type DocumentTarget,
  type EditorDocument,
  type EditorStatus,
  type SaveState,
  type SelectionTicket,
  type StoredDraft,
} from './editor-state.ts'

export {
  automaticCompletionReady,
  COMPLETION_PREFERENCE_KEY,
  readCompletionPreference,
  type CompletionPreference,
} from './completion-preference.ts'

export type {
  EditorCoreRpc, EditorCoreHandle, EditorCoreDraftBackup, EditorCoreDraft,
  EditorCorePaperProjection, EditorCoreTypography, EditorCoreProps, EditorCoreStatus,
  EditorCoreSlot, FimPayloadInput, PatchPayloadInput,
} from './editor-contracts.ts'
export { defaultFimPayload, defaultPatchPayload } from './completion-payload.ts'
export { createDraftSyncTimer, type DraftSyncTimer } from './draft-sync.ts'

const SESSION_DRAFT_KEY = (cwd: string, path: string) =>
  `dsh-editor:draft:${encodeURIComponent(`${cwd}\u0000${path}`)}`

/* 键入时权威文本同步进 textRef；驱动字数统计/投影/头部 UI 的 React `text` state
   由尾部去抖收敛，一次击键连发只全量穿透 React 一次，而不是每键一次。 */
const TEXT_STATE_FLUSH_DELAY_MS = 150

const IDENTITY_PROJECTION: EditorCorePaperProjection = {
  project: (_path, text) => ({ text, offset: 0 }),
  replace: (_path, _text, paperText) => paperText,
}

const NO_DRAFT: EditorCoreDraft = { kind: 'none' }
const EMPTY_SLOT_CLASSES: NonNullable<EditorCoreProps['slotClassName']> = {}
const EMPTY_SLOT_STYLES: NonNullable<EditorCoreProps['slotStyle']> = {}

function isStaleMessage(message: string): boolean {
  return /changed on disk|\bSTALE\b|version|版本/i.test(message);
}

export function EditorCore(props: EditorCoreProps): ReactNode {
  const {
    sessionId,
    path,
    rpc: incomingRpc,
    draft: incomingDraft = NO_DRAFT,
    onDirtyChange,
    onSaved,
    onError,
    onNotice,
    onStatusChange,
    onHandle,
    testIdPrefix = 'paper',
    paperClassName = 'paper-stage',
    paperStyle,
    slotClassName = EMPTY_SLOT_CLASSES,
    slotStyle = EMPTY_SLOT_STYLES,
    completionPreference = 'manual',
    automaticCompletionEligible,
    completionEnabled = true,
    authorPreferences,
    chapterContext,
    fimDelayMs = 1500,
    maxGhostCandidates = 3,
    showGhostTip = false,
    buildFimPayload = defaultFimPayload,
    buildPatchPayload = defaultPatchPayload,
    extractFimText = extractText,
    extractPatchText = extractText,
    enablePatch = false,
    showProposalDiff = true,
    enableRewriteSelection = false,
    onRewriteSelection,
    paperProjection = IDENTITY_PROJECTION,
    typewriter = false,
    typography,
    focusParagraph = false,
    autoSaveDelayMs = 800,
    externalRevision = 0,
    onReloadDisk,
    onSaveConflictCopy,
    enableBeforeUnload = false,
    headerExtras,
    footerExtras,
    compactControls = false,
    onEditorContextMenu,
  } = props

  // Transport wrappers and callbacks may be recreated by the host on an ordinary
  // render. Their references do not identify a different manuscript or draft.
  const rpcRef = useRef(incomingRpc)
  rpcRef.current = incomingRpc
  const rpc = useMemo<EditorCoreRpc>(() => ({ call: (...args) => rpcRef.current.call(...args) }), [])
  const draftRef = useRef(incomingDraft)
  draftRef.current = incomingDraft
  const draftKind = incomingDraft.kind
  const draftCwd = incomingDraft.kind === 'session' ? incomingDraft.cwd : ''
  const draftDelay = incomingDraft.kind === 'none' ? undefined : incomingDraft.syncDelayMs
  const draft = useMemo<EditorCoreDraft>(() => {
    if (draftKind === 'session') return { kind: 'session', cwd: draftCwd }
    if (draftKind === 'none') return NO_DRAFT
    return { kind: 'host', call: (endpoint, payload) => {
      const current = draftRef.current
      if (current.kind !== 'host') throw new Error('Host draft adapter is no longer active')
      return current.call(endpoint, payload)
    } }
  }, [draftKind, draftCwd])
  const cwd = props.cwd ?? draftCwd

  const [doc, setDoc] = useState<EditorDocument | null>(null)
  const [text, setTextState] = useState('')
  const [ghostCandidates, setGhostCandidates] = useState<string[]>([])
  const [ghostIndex, setGhostIndex] = useState(0)
  const [ghostAt, setGhostAt] = useState(0)
  const [loadingFim, setLoadingFim] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [note, setNote] = useState('')
  const [revision, setRevision] = useState(0)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [proposal, setProposal] = useState<{ ticket: SelectionTicket; text: string } | null>(null)
  const proposalRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!proposal) return
    const reduce = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    proposalRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [proposal])
  const [patching, setPatching] = useState(false)
  const [userEditRevision, setUserEditRevision] = useState(0)
  const [error, setError] = useState('')
  const [hasSelection, setHasSelection] = useState(false)
  // Other windows' unsaved drafts for this document (host draft.list, self
  // excluded by the caller). Adopting one is always an explicit click.
  const [backups, setBackups] = useState<EditorCoreDraftBackup[]>([])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Cursor position (paper coordinates) to apply after the next external
  // doc sync; set by acceptGhost / acceptPatch before they call setText.
  const pendingCursorRef = useRef<number | null>(null)
  const fimAbort = useRef<AbortController | null>(null)
  const patchAbort = useRef<AbortController | null>(null)
  const saving = useRef(false)
  const lastAutomaticCompletion = useRef(0)
  /* 恢复出来的草稿真正基于的磁盘版本（get 恢复或采纳备份时设置）。
     冲突期间同步 put 必须沿用这个 base，否则重启后冲突会凭空消失、
     autosave 可能拿旧备份覆盖新正文。保存/放弃/重新载入时清空。 */
  const draftBaseRef = useRef<{ text: string; version: string } | null>(null)
  /* 去抖挂起期间存活的 timer；显式 setText / 保存 / 失焦 / 切章 / 卸载都会立即收敛或取消。 */
  const textFlushTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const draftSync = useRef(createDraftSyncTimer()).current
  const cancelPendingDraftSync = useCallback(() => draftSync.cancelPending(), [draftSync])
  /* 脏标记上次上报值，仅在实际变化时回调 onDirtyChange。 */
  const lastDirtyReportedRef = useRef<boolean | null>(null)

  const docRef = useRef<EditorDocument | null>(null)
  const textRef = useRef('')
  const revisionRef = useRef(0)
  const documentGenerationRef = useRef(0)
  const loadedGenerationRef = useRef(-1)
  const ghostSourceRef = useRef<{ generation: number; revision: number } | null>(null)
  const loadIdentityRef = useRef({ sessionId, path, cwd, externalRevision, draftKind, draftCwd })
  const previousLoad = loadIdentityRef.current
  if (previousLoad.sessionId !== sessionId || previousLoad.path !== path || previousLoad.cwd !== cwd
    || previousLoad.externalRevision !== externalRevision || previousLoad.draftKind !== draftKind || previousLoad.draftCwd !== draftCwd) {
    loadIdentityRef.current = { sessionId, path, cwd, externalRevision, draftKind, draftCwd }
    documentGenerationRef.current += 1
    loadedGenerationRef.current = -1
  }
  const renderGeneration = documentGenerationRef.current
  const ghostCandidatesRef = useRef<string[]>([])
  const ghostAtRef = useRef(0)
  const conflictRef = useRef(false)
  const completionEnabledRef = useRef(completionEnabled)
  const enablePatchRef = useRef(enablePatch)
  docRef.current = doc
  revisionRef.current = revision
  ghostCandidatesRef.current = ghostCandidates
  ghostAtRef.current = ghostAt
  conflictRef.current = conflict
  completionEnabledRef.current = completionEnabled
  enablePatchRef.current = enablePatch

  const isDocumentReady = useCallback(() => {
    const current = docRef.current
    const expected = loadIdentityRef.current
    return Boolean(viewRef.current && current && current.sessionId === expected.sessionId && current.path === expected.path
      && loadedGenerationRef.current === documentGenerationRef.current)
  }, [])
  const isGenerating = useCallback(() => Boolean(
    (fimAbort.current && !fimAbort.current.signal.aborted) || (patchAbort.current && !patchAbort.current.signal.aborted),
  ), [])
  const documentReady = Boolean(doc && doc.sessionId === sessionId && doc.path === path
    && loadedGenerationRef.current === documentGenerationRef.current)
  const setStatus = useCallback((status: EditorCoreStatus) => onStatusChange?.(status), [onStatusChange])

  const noticeCallbacksRef = useRef({ onNotice, onError })
  noticeCallbacksRef.current = { onNotice, onError }
  const report = useCallback((next: string) => { setNote(next); noticeCallbacksRef.current.onNotice?.(next) }, [])
  const reportError = useCallback((next: string) => { setError(next); noticeCallbacksRef.current.onError?.(next) }, [])
  const clearGhost = useCallback(() => { ghostSourceRef.current = null; setGhostCandidates([]); setGhostIndex(0) }, [])

  const projected = useMemo(() => paperProjection.project(path, text), [paperProjection, path, text])
  const paperOffset = projected.offset
  // paperOffset for the currently rendered text; read by the update listener.
  const paperOffsetRef = useRef(0)
  paperOffsetRef.current = paperOffset

  const paperText = projected.text
  const wordCount = useMemo(() => paperText.replace(/\s/g, '').length, [paperText])
  const state: SaveState = documentReady ? saveState(doc, textRef.current, conflict) : error ? 'error' : path ? 'loading' : 'empty'
  const ghost = ghostCandidates[ghostIndex] ?? ''

  useEffect(() => { setStatus(state) }, [state, setStatus])

  useEffect(() => {
    /* 键入只同步 bump revision（text state 去抖），脏标记按最新 textRef 计算，
       且仅在布尔值实际变化时上报，避免每次击键都穿透到宿主 setState。 */
    const dirty = Boolean(doc && isDirty(doc, textRef.current)) || conflict
    if (lastDirtyReportedRef.current === dirty) return
    lastDirtyReportedRef.current = dirty
    onDirtyChange?.(dirty)
  }, [doc, revision, conflict, onDirtyChange])

  /* 缓冲区唯一写入入口。deferState 仅供稿纸键入路径使用：textRef / revision 仍同步更新
     （保存、脏标记、建议失效、冲突检测立刻准确），而驱动字数统计与投影的 React
     text state 交给 scheduleTextFlush 做尾部去抖，避免每次击键全量穿透 React。 */
  const setText = useCallback((next: string, deferState = false) => {
    if (textFlushTimer.current != null) { globalThis.clearTimeout(textFlushTimer.current); textFlushTimer.current = null }
    if (loadingFim || patching) report('文稿已变化，已停止此前的建议。')
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setLoadingFim(false)
    setPatching(false)
    textRef.current = next
    revisionRef.current += 1
    if (!deferState) setTextState(next)
    setRevision(revisionRef.current)
    clearGhost()
    setProposal(null)
  }, [loadingFim, patching, report, clearGhost])

  const scheduleTextFlush = useCallback(() => {
    if (textFlushTimer.current != null) globalThis.clearTimeout(textFlushTimer.current)
    textFlushTimer.current = globalThis.setTimeout(() => {
      textFlushTimer.current = null
      setTextState(textRef.current)
    }, TEXT_STATE_FLUSH_DELAY_MS)
  }, [])

  /* 保存 / 失焦时立即收敛去抖，保证读取 React state 的 UI（字数、状态标签）不落旧值。 */
  const flushText = useCallback(() => {
    if (textFlushTimer.current != null) { globalThis.clearTimeout(textFlushTimer.current); textFlushTimer.current = null }
    setTextState(textRef.current)
  }, [])

  useEffect(() => {
    cancelPendingDraftSync()
    if (textFlushTimer.current != null) { globalThis.clearTimeout(textFlushTimer.current); textFlushTimer.current = null }
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setLoadingFim(false)
    setPatching(false)
    setProposal(null)
    clearGhost()
    setConflict(false)
    setSelection({ start: 0, end: 0 })
    setUserEditRevision(0)
    lastAutomaticCompletion.current = 0
    setError('')
    setBackups([])
    draftBaseRef.current = null
    documentGenerationRef.current += 1
    const loadGeneration = documentGenerationRef.current
    loadedGenerationRef.current = -1
    docRef.current = null
    setDoc(null)
    if (!path) { setDoc(null); textRef.current = ''; setTextState(''); setNote(''); return }
    let live = true
    void (async () => {
      const readResult = await rpc.call('/manuscript', 'file.read', { sessionId, path }).catch((error: unknown) => ({
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      })) as RpcResult<{ text: string; version: string }>
      if (!live) return
      if (!readResult.ok) {
        setDoc(null)
        reportError(readResult.error.message)
        return
      }
      const disk: EditorDocument = { sessionId, path, text: readResult.value.text, version: readResult.value.version }
      let restoredText: string | null = null
      let conflictOnLoad = false
      if (draft.kind === 'host') {
        /* 只取本窗口(ownerId)自己的草稿；其他窗口的备份经 draft.list 展示，不自动恢复。 */
        try {
          const draftResult = await draft.call('draft.get', { sessionId, path }) as RpcResult<{ draft: { text: string; baseText?: string; baseVersion: string } | null }>
          if (live && draftResult.ok && draftResult.value.draft) {
            const own = draftResult.value.draft
            restoredText = own.text
            conflictOnLoad = own.baseVersion !== disk.version
            /* 保留草稿真正的 base：冲突期间要随 put 原样回传。 */
            draftBaseRef.current = { text: typeof own.baseText === 'string' ? own.baseText : disk.text, version: own.baseVersion }
          }
        } catch { /* 草稿读取失败不阻塞磁盘正文 */ }
        try {
          const listResult = await draft.call('draft.list', { sessionId, path }) as RpcResult<{ drafts?: EditorCoreDraftBackup[] }>
          if (live && listResult.ok) setBackups(Array.isArray(listResult.value.drafts) ? listResult.value.drafts : [])
        } catch { /* 备份列表只是恢复入口,失败不影响正文载入 */ }
      } else if (draft.kind === 'session' && typeof globalThis.sessionStorage !== 'undefined') {
        try {
          const raw = globalThis.sessionStorage.getItem(SESSION_DRAFT_KEY(cwd, path))
          if (raw) {
            const parsed = JSON.parse(raw) as Partial<StoredDraft>
            // Older editor-core writes omitted cwd. The storage key already
            // scopes that record to this workspace; explicit mismatches stay rejected.
            if ((parsed.cwd === cwd || parsed.cwd === undefined) && parsed.path === path && typeof parsed.text === 'string' && typeof parsed.version === 'string') {
              restoredText = parsed.text
              conflictOnLoad = parsed.version !== disk.version
              draftBaseRef.current = { text: disk.text, version: parsed.version }
            }
          }
        } catch { /* corrupted draft is best effort */ }
      }
      if (!live) return
      loadedGenerationRef.current = loadGeneration
      docRef.current = disk
      textRef.current = restoredText ?? disk.text
      revisionRef.current += 1
      setDoc(disk)
      setRevision(revisionRef.current)
      if (restoredText !== null) {
        setTextState(restoredText)
        setConflict(conflictOnLoad)
        report(conflictOnLoad ? '磁盘版本已变化；草稿已保留，请另存或手动合并。' : '已恢复未保存的草稿。')
      } else {
        setTextState(disk.text)
        setConflict(false)
        setNote('')
      }
    })()
    return () => {
      live = false
      loadedGenerationRef.current = -1
      documentGenerationRef.current += 1
      cancelPendingDraftSync()
      fimAbort.current?.abort()
      patchAbort.current?.abort()
    }
  }, [path, sessionId, cwd, externalRevision, rpc, draft, report, reportError, clearGhost, cancelPendingDraftSync])

  useEffect(() => {
    if (draft.kind === 'none' || !doc || !isDocumentReady()) return
    const delay = draftDelay ?? 250
    draftSync.schedule(delay, () => {
      if (!isDocumentReady() || docRef.current?.path !== doc.path) return
      if (draft.kind === 'host') {
        const current = textRef.current
        const endpoint = current === doc.text ? 'draft.delete' : 'draft.put'
        /* 冲突期间沿用恢复时的 baseText/baseVersion；base 与 disk 一致时退化为当前 doc。 */
        const base = draftBaseRef.current
        const payload = endpoint === 'draft.delete'
          ? { sessionId: doc.sessionId, path: doc.path }
          : {
            sessionId: doc.sessionId,
            path: doc.path,
            text: current,
            baseText: base ? base.text : doc.text,
            baseVersion: base ? base.version : doc.version,
          }
        if (endpoint === 'draft.delete') draftBaseRef.current = null
        void draft.call(endpoint, payload).then((raw: unknown) => {
          const result = raw as RpcResult
          if (!result.ok) report(`草稿同步失败：${result.error.message}`)
        }).catch(() => { report('草稿同步失败：连接中断，内容仍保留在本地。') })
      } else if (draft.kind === 'session' && typeof globalThis.sessionStorage !== 'undefined') {
        try {
          const key = SESSION_DRAFT_KEY(cwd, doc.path)
          const current = textRef.current
          if (current === doc.text) globalThis.sessionStorage.removeItem(key)
          else globalThis.sessionStorage.setItem(key, JSON.stringify({ ...doc, cwd, text: current, version: draftBaseRef.current?.version ?? doc.version }))
        } catch { /* best effort */ }
      }
    })
    return cancelPendingDraftSync
  }, [draft, draftDelay, doc, revision, cwd, report, draftSync, cancelPendingDraftSync])

  const save = useCallback(async (): Promise<boolean> => {
    /* conflict 必须先经 放弃/重新载入/另存副本 解决，Ctrl+S 不得绕过。 */
    const savingDoc = docRef.current
    if (!savingDoc || !isDocumentReady() || saving.current) return false
    if (conflictRef.current) { report('草稿与磁盘版本冲突，请先另存冲突副本或放弃草稿。'); return false }
    cancelPendingDraftSync()
    /* 保存以 textRef 为准已包含最新键入；这里同步收敛去抖，让读 React state 的 UI 一致。 */
    flushText()
    const startGeneration = documentGenerationRef.current
    saving.current = true
    report('正在保存…')
    /* 统一的目标守卫：捕获的 generation/session/path 任一变化都视为已切换。
       每个 await 之后、任何状态/提示/回调之前先过它，迟到回执对新文档零 UI 影响。 */
    const stillSavingTarget = () => documentGenerationRef.current === startGeneration
      && docRef.current?.sessionId === savingDoc.sessionId
      && docRef.current?.path === savingDoc.path
    try {
      /* 以调用瞬间的最新缓冲区为准：保存前同步 setText（章纲/章末小结写入）不得被旧渲染快照覆盖。 */
      const savingText = textRef.current
      const savingRevision = revisionRef.current
      const result = await rpc.call('/manuscript', 'file.write', {
        sessionId: savingDoc.sessionId,
        path: savingDoc.path,
        text: savingText,
        version: savingDoc.version,
      }) as RpcResult<{ version?: string }>
      if (!stillSavingTarget()) return false
      if (!result.ok) {
        const stale = isStaleMessage(result.error.message)
        setConflict(stale)
        reportError(stale ? '磁盘文件已变化；本地草稿未丢失。' : result.error.message)
        return false
      }
      const saved: EditorDocument = { ...savingDoc, text: savingText, version: result.value.version ?? savingDoc.version }
      // Imperative callers must observe the committed version before React renders.
      docRef.current = saved
      setDoc(saved)
      /* 草稿 base 已随落盘更新；保留的更新键入将以新磁盘版本为 base 重新 put。 */
      draftBaseRef.current = null
      /* 保存飞行期间又键入了更新内容：那份更新的草稿不能删，留给下一轮同步。 */
      const retainDraft = shouldRetainDraftAfterSave(savingText, textRef.current, savingRevision, revisionRef.current)
      if (!retainDraft) {
        if (draft.kind === 'host') {
          const deleted = await draft.call('draft.delete', { sessionId: savingDoc.sessionId, path: savingDoc.path }) as RpcResult
          if (!stillSavingTarget()) return false
          if (!deleted.ok) {
            report(`文件已保存，但草稿清理失败：${deleted.error.message}`)
            return false
          }
        } else if (draft.kind === 'session' && typeof globalThis.sessionStorage !== 'undefined') {
          try {
            globalThis.sessionStorage.removeItem(SESSION_DRAFT_KEY(cwd, savingDoc.path))
          } catch { /* best effort */ }
        }
      }
      setConflict(false)
      /* 标题栏已有持久的保存状态显示，普通保存成功不再重复瞬时提示；
         保留草稿的情况标题栏表达不了，仍给出说明。 */
      report(retainDraft ? '已保存；继续键入的内容仍保留为草稿。' : '')
      onSaved?.()
      return true
    } catch (cause) {
      if (!stillSavingTarget()) return false
      reportError(cause instanceof Error ? `保存未能完成：${cause.message}` : '保存未能完成，请重试。')
      return false
    } finally {
      saving.current = false
    }
  }, [rpc, draft, cwd, report, reportError, onSaved, flushText, cancelPendingDraftSync])

  useEffect(() => {
    if (!doc || !isDocumentReady() || textRef.current === doc.text || conflict) return
    const timer = globalThis.setTimeout(() => { void save() }, autoSaveDelayMs)
    return () => globalThis.clearTimeout(timer)
  }, [doc, revision, conflict, autoSaveDelayMs, save])

  const discard = useCallback(() => {
    if (!doc || !isDocumentReady() || docRef.current !== doc) return
    cancelPendingDraftSync()
    if (draft.kind === 'host') {
      void draft.call('draft.delete', { sessionId: doc.sessionId, path: doc.path })
    } else if (draft.kind === 'session' && typeof globalThis.sessionStorage !== 'undefined') {
      try {
        globalThis.sessionStorage.removeItem(SESSION_DRAFT_KEY(cwd, doc.path))
      } catch { /* best effort */ }
    }
    textRef.current = doc.text
    revisionRef.current += 1
    setTextState(doc.text)
    setRevision(revisionRef.current)
    setConflict(false)
    draftBaseRef.current = null
    setHasSelection(false)
    setProposal(null)
    clearGhost()
    setError('')
    report('已放弃本地修改。')
  }, [doc, draft, cwd, clearGhost, report, cancelPendingDraftSync])

  /* 显式点击某条其他窗口的备份：把其 text 放进当前 buffer，按 baseVersion 决定
     是否标冲突；既有同步 effect 会通过 put 存成本窗口自己的副本，原备份保留。 */
  const adoptBackup = useCallback((backup: EditorCoreDraftBackup) => {
    const current = docRef.current
    if (!current) return
    if (isDirty(current, textRef.current) || conflict) {
      report('当前有未保存内容，请先保存或放弃修改，再采纳备份。')
      return
    }
    setText(backup.text)
    setConflict(backup.baseVersion !== current.version)
    /* 备份真正的 base：冲突时随 put 回传，重启后冲突依旧成立。 */
    draftBaseRef.current = { text: backup.baseText, version: backup.baseVersion }
    report(backup.baseVersion !== current.version
      ? '备份内容已放入草稿；其磁盘版本已变化，请确认后再保存。原备份仍保留。'
      : '备份内容已放入草稿；原备份仍保留，不会自动清理。')
  }, [conflict, setText, report])

  useEffect(() => {
    if (!enableBeforeUnload) return
    if (!doc || (!isDirty(doc, textRef.current) && !conflict)) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    globalThis.addEventListener('beforeunload', warn)
    return () => globalThis.removeEventListener('beforeunload', warn)
  }, [enableBeforeUnload, doc, revision, conflict])

  const stopCompletion = useCallback(() => {
    fimAbort.current?.abort()
    setLoadingFim(false)
    report('已停止补全。')
  }, [report])

  const complete = useCallback(async (append = false) => {
    if (!doc || !isDocumentReady() || docRef.current !== doc || isGenerating() || viewRef.current?.composing) return
    if (!completionEnabled) { report('写作补全未启用。'); return }
    if (conflict) { report('草稿与磁盘版本冲突，请先另存冲突副本或放弃草稿。'); return }
    const main = viewRef.current!.state.selection.main
    if (!append && !main.empty) { report('请先把光标放到要补全的位置。'); return }
    lastAutomaticCompletion.current = Math.max(lastAutomaticCompletion.current, userEditRevision)
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setProposal(null)
    const requestDoc = doc
    const requestRevision = revisionRef.current
    const requestGeneration = documentGenerationRef.current
    const requestText = textRef.current
    const candidates = ghostCandidatesRef.current
    const ghostAnchor = ghostAtRef.current
    const pos = append && candidates.length > 0 ? ghostAnchor : main.from + paperOffsetRef.current
    const controller = new AbortController()
    fimAbort.current = controller
    setLoadingFim(true)
    report('正在生成补全…')
    const result = await rpc.call('/manuscript', 'fim.complete', buildFimPayload({
      sessionId: doc.sessionId,
      path: doc.path,
      prefix: requestText.slice(0, pos),
      suffix: requestText.slice(pos),
      authorPreferences,
      chapterContext,
    }), controller.signal).catch((error: unknown) => ({
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    })) as RpcResult<{ text?: string }>
    if (fimAbort.current === controller) {
      fimAbort.current = null
      setLoadingFim(false)
    }
    if (controller.signal.aborted) return
    if (!isDocumentReady() || documentGenerationRef.current !== requestGeneration || docRef.current?.sessionId !== requestDoc.sessionId || docRef.current.path !== requestDoc.path || revisionRef.current !== requestRevision) return
    if (!result.ok) { reportError(result.error.message); return }
    const suggestion = extractFimText(result.value)
    if (!suggestion.trim()) { report('模型未返回可用补全。'); return }
    const next = append
      ? addCompletionCandidate(candidates, suggestion, maxGhostCandidates)
      : { candidates: [suggestion], index: 0, added: true }
    ghostSourceRef.current = { generation: requestGeneration, revision: requestRevision }
    setGhostCandidates(next.candidates)
    setGhostIndex(next.index)
    setGhostAt(pos)
    report(next.added
      ? `补全候选 ${next.index + 1}/${next.candidates.length} 已就绪。`
      : '新候选与已有建议相同，已保留原建议。')
  }, [doc, revision, text, selection.start, selection.end, rpc, buildFimPayload, authorPreferences, chapterContext, maxGhostCandidates, userEditRevision, extractFimText, report, reportError, completionEnabled, conflict])

  useEffect(() => {
    const view = viewRef.current
    if (!doc || !view || !isDocumentReady() || !completionEnabled) return
    const cursor = selection.start
    const isManuscript = automaticCompletionEligible ?? /^正文\/.+\.(?:md|txt)$/i.test(doc.path)
    const ready = (at: number) => automaticCompletionReady({
      preference: completionPreference,
      manuscript: isManuscript,
      userEditRevision,
      requestedRevision: lastAutomaticCompletion.current,
      focused: view.hasFocus,
      collapsedSelection: selection.start === selection.end,
      prefix: textRef.current.slice(0, at),
      busy: loadingFim || patching,
      blocked: conflict || Boolean(ghost) || Boolean(proposal),
    })
    if (!ready(cursor)) return
    const timer = globalThis.setTimeout(() => {
      // Never fire an automatic completion in the middle of IME composition.
      if (view.composing) return
      const currentCursor = view.state.selection.main.from + paperOffset
      if (!ready(currentCursor)) return
      lastAutomaticCompletion.current = userEditRevision
      void complete()
    }, fimDelayMs)
    return () => globalThis.clearTimeout(timer)
  }, [completionEnabled, completionPreference, automaticCompletionEligible, conflict, doc?.path, doc?.sessionId, ghost, loadingFim, patching, proposal, selection.end, selection.start, text, userEditRevision, fimDelayMs, paperOffset, complete])

  const { liveTarget, captureTarget, readCommandState, replaceSelection, restoreTarget } = useEditorCommands({
    viewRef, docRef, textRef, revisionRef, documentGenerationRef, paperOffsetRef,
    paperProjection, selection, isDocumentReady, isGenerating,
    conflictRef, completionEnabledRef, enablePatchRef,
  })

  /* 章纲/章末小结等隐藏文件头的统一写入通道：只许改稿纸之外的内容，复用与正文完全相同的
   * 保存机制（setText → 最新缓冲区 → file.write 回执）。目标快照复用既有 captureTarget /
   * isTargetCurrent（会话/路径/代次/修订）；飞行中的保存与冲突态一律安全拒绝，绝不覆盖更新的文本。 */
  const saveMetadataText = useCallback(async (next: string, target: EditorTargetSnapshot): Promise<boolean> => {
    const current = docRef.current
    if (!current || !isDocumentReady() || saving.current) return false
    if (conflictRef.current) { report('草稿与磁盘版本冲突，请先另存冲突副本或放弃草稿。'); return false }
    const live = liveTarget()
    if (!live || !isEditorTargetCurrent(target, live)) {
      report('章节内容已变化，请关闭本窗口后重新打开再写入。')
      return false
    }
    /* 只允许改动隐藏的文件头：可见稿纸文本必须逐字不变，否则说明调用方改到了正文，拒绝。 */
    if (!projectedPaperUnchanged(paperProjection, current.path, next, textRef.current)) {
      report('只能写入章节文件头，正文改动请直接在稿纸上进行。')
      return false
    }
    setText(next)
    return save()
  }, [liveTarget, paperProjection, setText, save, report])

  const requestPatch = useCallback(async (instruction?: string, target?: EditorTargetSnapshot) => {
    if (!doc || !isDocumentReady() || docRef.current !== doc || isGenerating() || viewRef.current?.composing) return
    if (!completionEnabled) { report('写作补全未启用。'); return }
    if (!enablePatch) return
    if (conflict) { report('草稿与磁盘版本冲突，请先另存冲突副本或放弃草稿。'); return }
    const live = liveTarget()
    if (!live) return
    if (target && !isEditorTargetCurrent(target, live)) {
      report('所选内容已变化，过期的改写已取消。')
      return
    }
    const main = viewRef.current!.state.selection.main
    const range = target ?? { start: main.from + paperOffsetRef.current, end: main.to + paperOffsetRef.current }
    const requestText = textRef.current
    const requestGeneration = documentGenerationRef.current
    const ticket = selectionTicket(doc, requestText, revisionRef.current, range.start, range.end)
    if (!ticket) { report('请先选择需要改写的文字。'); return }
    fimAbort.current?.abort()
    clearGhost()
    patchAbort.current?.abort()
    const controller = new AbortController()
    patchAbort.current = controller
    setPatching(true)
    report('正在生成选段修改…')
    const result = await rpc.call('/manuscript', 'patch.complete', buildPatchPayload({
      sessionId: ticket.sessionId,
      path: ticket.path,
      selectedText: ticket.selectedText,
      before: requestText.slice(Math.max(0, ticket.start - 4000), ticket.start),
      after: requestText.slice(ticket.end, ticket.end + 4000),
      authorPreferences,
      chapterContext,
      instruction,
    }), controller.signal).catch((error: unknown) => ({
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    })) as RpcResult<{ text?: string }>
    if (patchAbort.current === controller) {
      patchAbort.current = null
      setPatching(false)
    }
    if (controller.signal.aborted || !isDocumentReady() || documentGenerationRef.current !== requestGeneration || !isSelectionCurrent(ticket, docRef.current, textRef.current, revisionRef.current)) return
    if (!result.ok) { reportError(result.error.message); return }
    const replacement = extractPatchText(result.value).trim()
    if (!replacement) { report('模型未返回可用改写。'); return }
    setProposal({ ticket, text: replacement })
    report('修改建议已就绪。')
  }, [doc, text, revision, selection, rpc, buildPatchPayload, authorPreferences, chapterContext, extractPatchText, report, reportError, clearGhost, completionEnabled, enablePatch, conflict, liveTarget])

  // Imperative handle via callback ref.
  useEffect(() => {
    if (!onHandle) return
    const handle: EditorCoreHandle = {
      save,
      saveMetadataText,
      discard,
      cancelPendingDraftSync,
      isDirty: () => isDirty(docRef.current, textRef.current),
      getText: () => textRef.current,
      getDocument: () => docRef.current,
      getSelection: () => {
        const view = viewRef.current
        if (!view) return { start: 0, end: 0 }
        const main = view.state.selection.main
        return { start: main.from + paperOffsetRef.current, end: main.to + paperOffsetRef.current }
      },
      setGhost: (candidates, index, at) => {
        if (!isDocumentReady()) return
        ghostSourceRef.current = { generation: documentGenerationRef.current, revision: revisionRef.current }
        setGhostCandidates(candidates); setGhostIndex(index); setGhostAt(at)
      },
      clearGhost: () => { clearGhost(); setGhostAt(0) },
      setProposal: (next) => setProposal(next),
      revealRange: (start, end) => {
        const view = viewRef.current
        if (!view) return
        revealEditorRange(view, paperOffsetRef.current, start, end)
      },
      requestRewrite: (instruction, target) => { void requestPatch(instruction, target) },
      focus: () => { viewRef.current?.focus() },
      getFocusTarget: () => viewRef.current?.contentDOM ?? null,
      isComposing: () => Boolean(viewRef.current?.composing),
      getCommandState: () => readCommandState(),
      captureTarget,
      isTargetCurrent: (target) => {
        const live = liveTarget()
        return Boolean(live && isEditorTargetCurrent(target, live))
      },
      restoreTarget,
      undo: () => {
        const view = viewRef.current
        return view && isDocumentReady() ? undo(view) : false
      },
      redo: () => {
        const view = viewRef.current
        return view && isDocumentReady() ? redo(view) : false
      },
      selectAll: () => {
        const view = viewRef.current
        if (!view || !isDocumentReady()) return false
        view.dispatch({
          selection: EditorSelection.range(0, view.state.doc.length),
          scrollIntoView: true,
        })
        view.focus()
        return true
      },
      selectParagraph: (target) => {
        const view = viewRef.current
        if (!view || !isDocumentReady() || view.composing) return false
        if (target && !restoreTarget(target)) return false
        return selectParagraphInView(view)
      },
      replaceSelection,
      getVisibleSelectionText: () => {
        const view = viewRef.current
        const current = docRef.current
        if (!view || !current) return ''
        const main = view.state.selection.main
        const offset = paperOffsetRef.current
        return paperSelectionText({
          text: textRef.current,
          paperOffset: offset,
          start: main.from + offset,
          end: main.to + offset,
        })
      },
      getVisiblePaperText: () => {
        const current = docRef.current
        if (!current) return ''
        return paperProjection.project(current.path, textRef.current).text
      },
      getPaperOffset: () => paperOffsetRef.current,
      openFind: () => {
        const view = viewRef.current
        return view && isDocumentReady() ? openFindPanel(view) : false
      },
      openReplace: () => {
        const view = viewRef.current
        return view && isDocumentReady() ? openReplacePanel(view) : false
      },
      requestCompletion: () => { void complete(false) },
    }
    onHandle(handle)
    return () => onHandle(null)
  }, [onHandle, save, saveMetadataText, discard, cancelPendingDraftSync, clearGhost, requestPatch, captureTarget, liveTarget, restoreTarget, replaceSelection, readCommandState, complete])

  const acceptGhost = useCallback(() => {
    const source = ghostSourceRef.current
    if (!isDocumentReady() || !source || source.generation !== documentGenerationRef.current || source.revision !== revisionRef.current || !canApplyGhost(state, ghost)) return
    const cursor = ghostAt + ghost.length
    pendingCursorRef.current = Math.max(0, cursor - paperOffset)
    setText(applyGhost(textRef.current, ghostAt, ghost))
    clearGhost()
    report('补全已加入草稿。')
    globalThis.setTimeout(() => { viewRef.current?.focus() }, 0)
  }, [state, ghost, ghostAt, text, paperOffset, setText, clearGhost, report])

  const acceptPatch = useCallback(() => {
    if (!isDocumentReady() || !proposal || !isSelectionCurrent(proposal.ticket, docRef.current, textRef.current, revisionRef.current)) {
      setProposal(null)
      report('所选内容已变化，过期的建议已丢弃。')
      return
    }
    const cursor = proposal.ticket.start + proposal.text.length
    pendingCursorRef.current = Math.max(0, cursor - paperOffset)
    setText(applySelectionPatch(textRef.current, proposal.ticket, proposal.text))
    setProposal(null)
    report('修改已加入草稿。')
    globalThis.setTimeout(() => { viewRef.current?.focus() }, 0)
  }, [proposal, doc, text, revision, paperOffset, setText, report])

  // Escape: cancel the in-flight suggestion/proposal. Returns whether the
  // keypress was consumed so the CM keymap can fall through when idle.
  const cancelSuggestions = useCallback((): boolean => {
    if (!(loadingFim || patching || ghost || proposal)) return false
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setLoadingFim(false)
    setPatching(false)
    clearGhost()
    setProposal(null)
    report('已放弃当前建议。')
    return true
  }, [loadingFim, patching, ghost, proposal, clearGhost, report])

  /* ── CodeMirror view lifecycle ───────────────────────────────────── */

  // Stable dispatch table for CM keymaps / listeners; always points at the
  // latest render's closures.
  const callbacksRef = useRef<PaperViewCallbacks>({
    setTextFromPaper: (_paper: string) => {},
    flushText: () => {},
    onSelection: (_start: number, _end: number) => {},
    acceptGhost: () => {},
    acceptPatch: () => {},
    complete: () => {},
    cancelSuggestions: (): boolean => false,
    save: () => {},
    hasGhost: (): boolean => false,
    hasProposal: (): boolean => false,
    hasCompletionActivity: (): boolean => false,
    onContextMenu: (_event: EditorContextMenuEvent) => {},
    hasContextMenu: (): boolean => false,
    canEdit: (): boolean => false,
  })
  callbacksRef.current = {
    setTextFromPaper: (paper: string) => {
      setText(paperProjection.replace(path, textRef.current, paper), true)
      setUserEditRevision((old) => old + 1)
      scheduleTextFlush()
    },
    flushText,
    onSelection: (start: number, end: number) => {
      setSelection({ start, end })
      setHasSelection(start !== end)
    },
    acceptGhost,
    acceptPatch,
    complete: () => { void complete() },
    cancelSuggestions,
    save: () => { void save() },
    hasGhost: () => ghostCandidatesRef.current.length > 0,
    hasProposal: () => proposal !== null,
    hasCompletionActivity: () => loadingFim || patching || ghostCandidatesRef.current.length > 0 || proposal !== null,
    onContextMenu: (event) => { onEditorContextMenu?.(event) },
    hasContextMenu: () => Boolean(onEditorContextMenu),
    canEdit: isDocumentReady,
  }

  usePaperView({
    containerRef, viewRef, callbacksRef, paperOffsetRef, textFlushTimer,
    typewriter, focusParagraph, documentReady, isDocumentReady,
    path, paperProjection, textRef, documentGenerationRef, pendingCursorRef,
    paperText, renderGeneration, ghost, ghostAt, paperOffset, testIdPrefix, slotClassName,
  })

  if (!path) return null
  return <EditorChrome
    path={path}
    paperClassName={paperClassName}
    paperStyle={paperStyle}
    slotClassName={slotClassName}
    slotStyle={slotStyle}
    compactControls={compactControls}
    enableRewriteSelection={enableRewriteSelection}
    completionEnabled={completionEnabled}
    onRewriteSelection={onRewriteSelection}
    testIdPrefix={testIdPrefix}
    headerExtras={headerExtras}
    footerExtras={footerExtras}
    showGhostTip={showGhostTip}
    enablePatch={enablePatch}
    showProposalDiff={showProposalDiff}
    onReloadDisk={onReloadDisk}
    onSaveConflictCopy={onSaveConflictCopy}
    typography={typography}
    maxGhostCandidates={maxGhostCandidates}
    doc={doc}
    textRef={textRef}
    selection={selection}
    hasSelection={hasSelection}
    wordCount={wordCount}
    state={state}
    loadingFim={loadingFim}
    patching={patching}
    conflict={conflict}
    error={error}
    note={note}
    ghost={ghost}
    ghostCandidates={ghostCandidates}
    ghostIndex={ghostIndex}
    proposal={proposal}
    backups={backups}
    proposalRef={proposalRef}
    containerRef={containerRef}
    viewRef={viewRef}
    save={save}
    discard={discard}
    stopCompletion={stopCompletion}
    complete={complete}
    requestPatch={requestPatch}
    acceptGhost={acceptGhost}
    acceptPatch={acceptPatch}
    clearGhost={clearGhost}
    report={report}
    adoptBackup={adoptBackup}
    setGhostIndex={setGhostIndex}
    setProposal={setProposal}
    stopPatch={() => {
      patchAbort.current?.abort()
      setPatching(false)
      report('已停止改写。')
    }}
  />
}
