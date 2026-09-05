import { createElement as e, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { externalSync, ghostField, livePreview, paperHighlight, paperMarkdown, paperTheme, setGhostEffect } from './codemirror.ts'

// EditorCore only needs to issue RPCs; hosts that also register handlers can
// pass the full RpcBag and the structural type will still match.
export type EditorCoreRpc = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
}

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

export type EditorCoreHandle = {
  save(): Promise<boolean>
  discard(): void
  isDirty(): boolean
  getText(): string
  getDocument(): EditorDocument | null
  getSelection(): { start: number; end: number }
  setGhost(candidates: string[], index: number, at: number): void
  clearGhost(): void
  setProposal(proposal: { ticket: SelectionTicket; text: string } | null): void
}

export type EditorCoreDraftBackup = {
  path: string
  text: string
  baseText: string
  baseVersion: string
  ownerId?: string
  revision?: string
  updatedAt?: string
}

export type EditorCoreDraft =
  | {
      kind: 'host'
      call: (endpoint: 'draft.get' | 'draft.put' | 'draft.delete' | 'draft.list', payload: Record<string, unknown>) => Promise<unknown>
      syncDelayMs?: number
    }
  | {
      kind: 'session'
      cwd: string
      syncDelayMs?: number
    }
  | { kind: 'none' }

export type EditorCorePaperProjection = {
  project(path: string, text: string): { text: string; offset: number }
  replace(path: string, text: string, paperText: string): string
}

export type EditorCoreProps = {
  sessionId: string
  cwd?: string
  path: string

  rpc: EditorCoreRpc
  draft?: EditorCoreDraft

  onDirtyChange?(dirty: boolean): void
  onSaved?(): void
  onError?(message: string): void
  onNotice?(message: string): void
  onStatusChange?(status: EditorCoreStatus): void

  // Caller receives a handle once mounted; the handle exposes imperative
  // save / discard so the host can coordinate switch-while-dirty flows
  // (manuscript's "保存后切换" / "放弃修改并切换" pattern). A `null`
  // argument is delivered on unmount so the host can release its cache.
  onHandle?(handle: EditorCoreHandle | null): void

  testIdPrefix?: string
  paperClassName?: string
  paperStyle?: CSSProperties
  slotClassName?: Partial<Record<EditorCoreSlot, string>>
  slotStyle?: Partial<Record<EditorCoreSlot, CSSProperties>>

  completionPreference?: CompletionPreference
  authorPreferences?: string
  fimDelayMs?: number
  maxGhostCandidates?: number
  showGhostTip?: boolean
  buildFimPayload?(input: { sessionId: string; path: string; prefix: string; suffix: string; authorPreferences?: string }): Record<string, unknown>
  buildPatchPayload?(input: { sessionId: string; path: string; selectedText: string; before: string; after: string; authorPreferences?: string }): Record<string, unknown>
  extractFimText?(value: unknown): string
  extractPatchText?(value: unknown): string

  enablePatch?: boolean
  showProposalDiff?: boolean

  enableRewriteSelection?: boolean
  onRewriteSelection?(selection: string, path: string): void | Promise<void>

  paperProjection?: EditorCorePaperProjection

  autoSaveDelayMs?: number
  externalRevision?: number

  // Optional chapter navigation. The shell passes the file list; the
  // manuscript client passes siblings for the same directory. Prev/next
  // are hidden when the current path is not in the list.
  siblings?: readonly string[]
  onOpenSibling?(path: string): void
  siblingsBlocked?: boolean

  // Shell-specific conflict recovery actions. When provided, the matching
  // button is rendered alongside EditorCore's built-in discard. The host
  // owns the actual flow (e.g. confirm dialog, copy-as-conflict).
  onReloadDisk?(): void
  onSaveConflictCopy?(): void

  // Install a beforeunload warning while the buffer is dirty. The shell
  // wants the browser prompt; the manuscript overlay adds its own.
  enableBeforeUnload?: boolean

  // Custom header/footer nodes for hosts that need to inject extra UI
  // (e.g. a row of chapter shortcuts in the shell's footer). Rendered
  // after the built-in controls.
  headerExtras?: ReactNode
  footerExtras?: ReactNode
}

export type EditorCoreStatus = 'empty' | 'loading' | 'saved' | 'draft' | 'conflict' | 'error'

export type EditorCoreSlot =
  | 'outer'
  | 'header'
  | 'chapterNav'
  | 'tools'
  | 'textarea'
  | 'mirror'
  | 'ghost'
  | 'ghostCard'
  | 'ghostTip'
  | 'proposal'
  | 'conflict'
  | 'notice'
  | 'footer'

const SESSION_DRAFT_KEY = (cwd: string, path: string) =>
  `dsh-editor:draft:${encodeURIComponent(`${cwd}\u0000${path}`)}`

const IDENTITY_PROJECTION: EditorCorePaperProjection = {
  project: (_path, text) => ({ text, offset: 0 }),
  replace: (_path, _text, paperText) => paperText,
}

function extractText(value: unknown): string {
  if (value && typeof value === 'object' && 'text' in value) {
    const raw = (value as { text: unknown }).text
    return typeof raw === 'string' ? raw : ''
  }
  return ''
}

function defaultFimPayload(input: { sessionId: string; path: string; prefix: string; suffix: string; authorPreferences?: string }): Record<string, unknown> {
  return input.authorPreferences
    ? { sessionId: input.sessionId, path: input.path, prefix: input.prefix, suffix: input.suffix, authorPreferences: input.authorPreferences }
    : { sessionId: input.sessionId, path: input.path, prefix: input.prefix, suffix: input.suffix }
}

function defaultPatchPayload(input: { sessionId: string; path: string; selectedText: string; before: string; after: string; authorPreferences?: string }): Record<string, unknown> {
  return input.authorPreferences
    ? { sessionId: input.sessionId, path: input.path, selectedText: input.selectedText, before: input.before, after: input.after, authorPreferences: input.authorPreferences }
    : { sessionId: input.sessionId, path: input.path, selectedText: input.selectedText, before: input.before, after: input.after }
}

function describeStatus(state: SaveState, conflict: boolean): string {
  if (state === 'empty') return ''
  if (state === 'loading') return '读取中'
  if (state === 'saved') return '已保存'
  if (state === 'draft') return '草稿未保存'
  if (state === 'conflict') return conflict ? '版本冲突' : '需处理'
  return '读取失败'
}

function isStaleMessage(message: string): boolean {
  return /changed on disk|\bSTALE\b|version|版本/i.test(message)
}

/** 备份按钮的小标签：序号 + 可读的更新时间（没有 updatedAt 时只有序号）。 */
function draftBackupLabel(backup: EditorCoreDraftBackup, index: number): string {
  const stamp = backup.updatedAt ? backup.updatedAt.replace('T', ' ').slice(5, 16) : ''
  return stamp ? `备份 ${index + 1} · ${stamp}` : `备份 ${index + 1}`
}

export function EditorCore(props: EditorCoreProps): ReactNode {
  const {
    sessionId,
    path,
    rpc,
    draft = { kind: 'none' },
    onDirtyChange,
    onSaved,
    onError,
    onNotice,
    onStatusChange,
    onHandle,
    testIdPrefix = 'paper',
    paperClassName = 'paper-stage',
    paperStyle,
    slotClassName = {},
    slotStyle = {},
    completionPreference = 'manual',
    authorPreferences,
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
    autoSaveDelayMs = 800,
    externalRevision = 0,
    siblings,
    onOpenSibling,
    siblingsBlocked = false,
    onReloadDisk,
    onSaveConflictCopy,
    enableBeforeUnload = false,
    headerExtras,
    footerExtras,
  } = props

  const cwd = props.cwd ?? (draft.kind === 'session' ? draft.cwd : '')

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

  const docRef = useRef<EditorDocument | null>(null)
  const textRef = useRef('')
  const revisionRef = useRef(0)
  const ghostCandidatesRef = useRef<string[]>([])
  const ghostAtRef = useRef(0)
  docRef.current = doc
  textRef.current = text
  revisionRef.current = revision
  ghostCandidatesRef.current = ghostCandidates
  ghostAtRef.current = ghostAt

  const setStatus: (status: EditorCoreStatus) => void = (status) => onStatusChange?.(status)

  const report = useCallback((next: string) => { setNote(next); onNotice?.(next) }, [onNotice])
  const reportError = useCallback((next: string) => { setError(next); onError?.(next) }, [onError])
  const clearGhost = useCallback(() => { setGhostCandidates([]); setGhostIndex(0) }, [])

  const paperOffset = paperProjection.project(path, text).offset
  const paperText = paperProjection.project(path, text).text
  const state: SaveState = saveState(doc, text, conflict)
  const ghost = ghostCandidates[ghostIndex] ?? ''

  useEffect(() => { setStatus(state) }, [state, setStatus])

  useEffect(() => {
    onDirtyChange?.(Boolean(doc && isDirty(doc, text)) || conflict)
  }, [doc, text, conflict, onDirtyChange])

  const setText = useCallback((next: string) => {
    if (loadingFim || patching) report('正文已变化，已停止此前的建议。')
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setLoadingFim(false)
    setPatching(false)
    setTextState(next)
    setRevision((old) => old + 1)
    clearGhost()
    setProposal(null)
  }, [loadingFim, patching, report, clearGhost])

  useEffect(() => {
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
    if (!path) { setDoc(null); setTextState(''); setNote(''); return }
    let live = true
    void (async () => {
      const readResult = await rpc.call('/manuscript', 'file.read', { sessionId, path }) as RpcResult<{ text: string; version: string }>
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
            if (parsed.cwd === cwd && parsed.path === path && typeof parsed.text === 'string' && typeof parsed.version === 'string') {
              restoredText = parsed.text
              conflictOnLoad = parsed.version !== disk.version
            }
          }
        } catch { /* corrupted draft is best effort */ }
      }
      if (!live) return
      setDoc(disk)
      setRevision((old) => old + 1)
      if (restoredText !== null) {
        setTextState(restoredText)
        setConflict(conflictOnLoad)
        report(conflictOnLoad ? '磁盘版本已变化；本地草稿已保留，请另存或手动合并。' : '已恢复未保存的草稿')
      } else {
        setTextState(disk.text)
        setConflict(false)
        setNote('')
      }
    })()
    return () => { live = false; fimAbort.current?.abort(); patchAbort.current?.abort() }
  }, [path, sessionId, cwd, externalRevision, rpc, draft, report, reportError, clearGhost])

  useEffect(() => {
    if (draft.kind === 'none' || !doc) return
    const delay = draft.syncDelayMs ?? 250
    const timer = globalThis.setTimeout(() => {
      if (draft.kind === 'host') {
        const endpoint = text === doc.text ? 'draft.delete' : 'draft.put'
        /* 冲突期间沿用恢复时的 baseText/baseVersion；base 与 disk 一致时退化为当前 doc。 */
        const base = draftBaseRef.current
        const payload = endpoint === 'draft.delete'
          ? { sessionId: doc.sessionId, path: doc.path }
          : {
            sessionId: doc.sessionId,
            path: doc.path,
            text,
            baseText: base ? base.text : doc.text,
            baseVersion: base ? base.version : doc.version,
          }
        if (endpoint === 'draft.delete') draftBaseRef.current = null
        void draft.call(endpoint, payload).then((raw: unknown) => {
          const result = raw as RpcResult
          if (!result.ok) report(`草稿同步失败：${result.error.message}`)
        }).catch(() => { report('草稿同步失败：连接中断，内容仍保留在本地缓冲区。') })
      } else if (draft.kind === 'session' && typeof globalThis.sessionStorage !== 'undefined') {
        try {
          const key = SESSION_DRAFT_KEY(cwd, doc.path)
          if (text === doc.text) globalThis.sessionStorage.removeItem(key)
          else globalThis.sessionStorage.setItem(key, JSON.stringify({ ...doc, text }))
        } catch { /* best effort */ }
      }
    }, delay)
    return () => globalThis.clearTimeout(timer)
  }, [draft, doc, text, cwd, report])

  const save = useCallback(async (): Promise<boolean> => {
    /* conflict 必须先经 放弃/重新载入/另存副本 解决，Ctrl+S 不得绕过。 */
    if (!doc || saving.current) return false
    if (conflict) { report('当前草稿与磁盘版本冲突，请先另存冲突副本或放弃草稿。'); return false }
    const savingDoc = doc
    const savingText = text
    const savingRevision = revisionRef.current
    saving.current = true
    report('正在保存…')
    /* finally 恢复 saving.current：运输层抛错不得让编辑器永远无法再保存。 */
    try {
      const result = await rpc.call('/manuscript', 'file.write', {
        sessionId: savingDoc.sessionId,
        path: savingDoc.path,
        text: savingText,
        version: savingDoc.version,
      }) as RpcResult<{ version?: string }>
      if (!result.ok) {
        const stale = isStaleMessage(result.error.message)
        setConflict(stale)
        reportError(stale ? '磁盘文件已变化；本地草稿未丢失。' : result.error.message)
        return false
      }
      const saved: EditorDocument = { ...savingDoc, text: savingText, version: result.value.version ?? savingDoc.version }
      setDoc(saved)
      /* 草稿 base 已随落盘更新；保留的更新键入将以新磁盘版本为 base 重新 put。 */
      draftBaseRef.current = null
      /* 保存飞行期间又键入了更新内容：那份更新的草稿不能删，留给下一轮同步。 */
      const retainDraft = shouldRetainDraftAfterSave(savingText, textRef.current, savingRevision, revisionRef.current)
      if (!retainDraft) {
        if (draft.kind === 'host') {
          const deleted = await draft.call('draft.delete', { sessionId: savingDoc.sessionId, path: savingDoc.path }) as RpcResult
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
      report(retainDraft ? '已保存；继续键入的内容仍保留为草稿。' : '已保存')
      onSaved?.()
      return true
    } catch (cause) {
      reportError(cause instanceof Error ? `保存未能完成：${cause.message}` : '保存未能完成，请重试。')
      return false
    } finally {
      saving.current = false
    }
  }, [doc, text, conflict, rpc, draft, cwd, report, reportError, onSaved])

  useEffect(() => {
    if (!doc || text === doc.text || conflict) return
    const timer = globalThis.setTimeout(() => { void save() }, autoSaveDelayMs)
    return () => globalThis.clearTimeout(timer)
  }, [doc, text, conflict, autoSaveDelayMs, save])

  const discard = useCallback(() => {
    if (!doc) return
    if (draft.kind === 'host') {
      void draft.call('draft.delete', { sessionId: doc.sessionId, path: doc.path })
    } else if (draft.kind === 'session' && typeof globalThis.sessionStorage !== 'undefined') {
      try {
        globalThis.sessionStorage.removeItem(SESSION_DRAFT_KEY(cwd, doc.path))
      } catch { /* best effort */ }
    }
    setTextState(doc.text)
    setRevision((old) => old + 1)
    setConflict(false)
    draftBaseRef.current = null
    setHasSelection(false)
    setProposal(null)
    clearGhost()
    setError('')
    report('已放弃本地修改。')
  }, [doc, draft, cwd, clearGhost, report])

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
      ? '已把备份内容放入当前草稿；备份基于的磁盘版本已变化，请确认后再保存。原备份仍保留给其他窗口。'
      : '已把备份内容放入当前草稿；原备份仍保留给其他窗口，不会自动清理。')
  }, [conflict, setText, report])

  const siblingIndex = siblings ? siblings.indexOf(path) : -1
  const showSiblings = !!siblings && !!onOpenSibling && siblingIndex >= 0

  useEffect(() => {
    if (!enableBeforeUnload) return
    if (!doc || (!isDirty(doc, text) && !conflict)) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    globalThis.addEventListener('beforeunload', warn)
    return () => globalThis.removeEventListener('beforeunload', warn)
  }, [enableBeforeUnload, doc, text, conflict])

  // Imperative handle via callback ref.
  useEffect(() => {
    if (!onHandle) return
    const handle: EditorCoreHandle = {
      save,
      discard,
      isDirty: () => isDirty(docRef.current, textRef.current),
      getText: () => textRef.current,
      getDocument: () => docRef.current,
      getSelection: () => {
        const view = viewRef.current
        if (!view) return { start: 0, end: 0 }
        const main = view.state.selection.main
        return { start: main.from + paperOffsetRef.current, end: main.to + paperOffsetRef.current }
      },
      setGhost: (candidates, index, at) => { setGhostCandidates(candidates); setGhostIndex(index); setGhostAt(at) },
      clearGhost: () => { clearGhost(); setGhostAt(0) },
      setProposal: (next) => setProposal(next),
    }
    onHandle(handle)
    return () => onHandle(null)
  }, [onHandle, save, discard, clearGhost])

  const complete = useCallback(async (append = false) => {
    if (!doc) return
    lastAutomaticCompletion.current = Math.max(lastAutomaticCompletion.current, userEditRevision)
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setProposal(null)
    const requestDoc = doc
    const requestRevision = revision
    const candidates = ghostCandidatesRef.current
    const ghostAnchor = ghostAtRef.current
    const pos = append && candidates.length > 0 ? ghostAnchor : selection.start
    const controller = new AbortController()
    fimAbort.current = controller
    setLoadingFim(true)
    report('正在生成补全…')
    const result = await rpc.call('/manuscript', 'fim.complete', buildFimPayload({
      sessionId: doc.sessionId,
      path: doc.path,
      prefix: text.slice(0, pos),
      suffix: text.slice(pos),
      authorPreferences,
    }), controller.signal) as RpcResult<{ text?: string }>
    if (fimAbort.current === controller) {
      fimAbort.current = null
      setLoadingFim(false)
    }
    if (controller.signal.aborted) return
    if (docRef.current?.sessionId !== requestDoc.sessionId || docRef.current.path !== requestDoc.path || revisionRef.current !== requestRevision) return
    if (!result.ok) { reportError(result.error.message); return }
    const suggestion = extractFimText(result.value)
    if (!suggestion.trim()) { report('模型未返回可用补全。'); return }
    const next = append
      ? addCompletionCandidate(candidates, suggestion, maxGhostCandidates)
      : { candidates: [suggestion], index: 0, added: true }
    setGhostCandidates(next.candidates)
    setGhostIndex(next.index)
    setGhostAt(pos)
    report(next.added
      ? `补全候选 ${next.index + 1}/${next.candidates.length} 已就绪。`
      : '新候选与已有建议相同，已保留原建议。')
  }, [doc, revision, text, selection.start, rpc, buildFimPayload, authorPreferences, maxGhostCandidates, userEditRevision, extractFimText, report, reportError])

  useEffect(() => {
    const view = viewRef.current
    if (!doc || !view) return
    const cursor = selection.start
    const isManuscript = /^正文\/.+\.(?:md|txt)$/i.test(doc.path)
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
  }, [completionPreference, conflict, doc?.path, doc?.sessionId, ghost, loadingFim, patching, proposal, selection.end, selection.start, text, userEditRevision, fimDelayMs, paperOffset, complete])

  const requestPatch = useCallback(async () => {
    if (!doc) return
    const ticket = selectionTicket(doc, text, revision, selection.start, selection.end)
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
      before: text.slice(Math.max(0, ticket.start - 4000), ticket.start),
      after: text.slice(ticket.end, ticket.end + 4000),
      authorPreferences,
    }), controller.signal) as RpcResult<{ text?: string }>
    if (patchAbort.current === controller) {
      patchAbort.current = null
      setPatching(false)
    }
    if (controller.signal.aborted || !isSelectionCurrent(ticket, docRef.current, textRef.current, revisionRef.current)) return
    if (!result.ok) { reportError(result.error.message); return }
    const replacement = extractPatchText(result.value).trim()
    if (!replacement) { report('模型未返回可用改写。'); return }
    setProposal({ ticket, text: replacement })
    report('修改建议已就绪。')
  }, [doc, text, revision, selection, rpc, buildPatchPayload, authorPreferences, extractPatchText, report, reportError, clearGhost])

  const acceptGhost = useCallback(() => {
    if (!canApplyGhost(state, ghost)) return
    const cursor = ghostAt + ghost.length
    pendingCursorRef.current = Math.max(0, cursor - paperOffset)
    setText(applyGhost(text, ghostAt, ghost))
    clearGhost()
    report('补全已加入草稿。')
    globalThis.setTimeout(() => { viewRef.current?.focus() }, 0)
  }, [state, ghost, ghostAt, text, paperOffset, setText, clearGhost, report])

  const acceptPatch = useCallback(() => {
    if (!proposal || !isSelectionCurrent(proposal.ticket, doc, text, revision)) {
      setProposal(null)
      report('所选内容已变化，过期的建议已丢弃。')
      return
    }
    const cursor = proposal.ticket.start + proposal.text.length
    pendingCursorRef.current = Math.max(0, cursor - paperOffset)
    setText(applySelectionPatch(text, proposal.ticket, proposal.text))
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

  // paperOffset for the currently rendered text; read by the update listener.
  const paperOffsetRef = useRef(0)
  paperOffsetRef.current = paperOffset

  // Stable dispatch table for CM keymaps / listeners; always points at the
  // latest render's closures.
  const callbacksRef = useRef({
    setTextFromPaper: (_paper: string) => {},
    onSelection: (_start: number, _end: number) => {},
    acceptGhost: () => {},
    acceptPatch: () => {},
    cancelSuggestions: (): boolean => false,
    save: () => {},
    hasGhost: (): boolean => false,
    hasProposal: (): boolean => false,
  })
  callbacksRef.current = {
    setTextFromPaper: (paper: string) => {
      setText(paperProjection.replace(path, textRef.current, paper))
      setUserEditRevision((old) => old + 1)
    },
    onSelection: (start: number, end: number) => {
      setSelection({ start, end })
      setHasSelection(start !== end)
    },
    acceptGhost,
    acceptPatch,
    cancelSuggestions,
    save: () => { void save() },
    hasGhost: () => ghostCandidatesRef.current.length > 0,
    hasProposal: () => proposal !== null,
  }

  // Mount the EditorView once; content flows in through the sync effect.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const cb = callbacksRef
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: '',
        extensions: [
          history(),
          paperMarkdown,
          paperHighlight,
          paperTheme,
          livePreview,
          ghostField,
          EditorView.lineWrapping,
          placeholder('从这里开始写作，或按 ⌘K 唤起命令'),
          Prec.high(keymap.of([
            {
              key: 'Tab',
              run: (v) => {
                // Let IME composition consume Tab before ghost acceptance.
                if (v.composing || !cb.current.hasGhost()) return false
                cb.current.acceptGhost()
                return true
              },
            },
            { key: 'Escape', run: () => cb.current.cancelSuggestions() },
            { key: 'Mod-s', run: () => { cb.current.save(); return true } },
            {
              key: 'Mod-Enter',
              run: () => {
                if (!cb.current.hasProposal()) return false
                cb.current.acceptPatch()
                return true
              },
            },
          ])),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            const external = update.transactions.some((tr) => tr.annotation(externalSync))
            if (update.docChanged && !external) {
              cb.current.setTextFromPaper(update.state.doc.toString())
            }
            if (update.docChanged || update.selectionSet) {
              const main = update.state.selection.main
              const offset = paperOffsetRef.current
              cb.current.onSelection(main.from + offset, main.to + offset)
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    // Test handle for e2e scripts: read/write the document via evaluate.
    ;(container as unknown as { __cmView: EditorView }).__cmView = view
    return () => {
      view.destroy()
      viewRef.current = null
      delete (container as unknown as { __cmView?: EditorView }).__cmView
    }
  }, [])

  // React text → CM doc. Skips the echo from user edits (doc already equals
  // paperText) and annotates genuine external replacements so the listener
  // does not feed them back into setText.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === paperText) return
    const pending = pendingCursorRef.current
    pendingCursorRef.current = null
    const anchor = pending == null ? undefined : Math.max(0, Math.min(paperText.length, pending))
    view.dispatch({
      changes: { from: 0, to: current.length, insert: paperText },
      selection: anchor == null ? undefined : { anchor },
      annotations: externalSync.of(true),
    })
  }, [paperText])

  // React ghost state → CM ghost widget (paper coordinates).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const at = Math.max(0, Math.min(view.state.doc.length, ghostAt - paperOffset))
    view.dispatch({
      effects: setGhostEffect.of(
        ghost
          ? { at, text: ghost, testId: `${testIdPrefix}-ghost`, className: slotClassName.ghost }
          : null,
      ),
    })
  }, [ghost, ghostAt, paperOffset, testIdPrefix, slotClassName])

  const wordCount = paperText.replace(/\s/g, '').length
  if (!path) return null

  const cls = (slot: EditorCoreSlot) => slotClassName[slot]
  const sty = (slot: EditorCoreSlot) => slotStyle[slot]
  const showFooter = loadingFim || patching || ghost || proposal || conflict || note

  return e('section', {
    className: [paperClassName, cls('outer')].filter(Boolean).join(' '),
    'aria-label': '正文编辑区',
    style: { display: 'flex', flexDirection: 'column', height: '100%', ...paperStyle, ...sty('outer') },
  },
    e('header', {
      className: cls('header'),
      style: { padding: '4px 8px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', ...sty('header') },
    },
      e('span', {
        'data-testid': `${testIdPrefix}-path`,
        style: { opacity: 0.7, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
      }, doc?.path || path),
      showSiblings ? e('nav', {
        className: ['chapter-navigation', cls('chapterNav')].filter(Boolean).join(' '),
        'aria-label': '章节导航',
        style: { display: 'inline-flex', gap: 4, alignItems: 'center' },
      },
        e('button', {
          type: 'button',
          'data-testid': `${testIdPrefix}-prev`,
          disabled: siblingsBlocked || siblingIndex <= 0,
          title: siblingsBlocked ? '请先保存' : '上一章',
          onClick: () => { if (siblingIndex > 0 && siblings) onOpenSibling(siblings[siblingIndex - 1]!) },
        }, '‹'),
        e('span', { style: { fontSize: 11, opacity: 0.6 } }, `${siblingIndex + 1} / ${siblings!.length}`),
        e('button', {
          type: 'button',
          'data-testid': `${testIdPrefix}-next`,
          disabled: siblingsBlocked || siblingIndex >= siblings!.length - 1,
          title: siblingsBlocked ? '请先保存' : '下一章',
          onClick: () => { if (siblingIndex < siblings!.length - 1 && siblings) onOpenSibling(siblings[siblingIndex + 1]!) },
        }, '›'),
      ) : null,
      enableRewriteSelection ? e('button', {
        type: 'button',
        'data-testid': `${testIdPrefix}-rewrite`,
        disabled: !hasSelection,
        onClick: () => {
          const sel = text.slice(selection.start, selection.end)
          if (!sel) return
          void Promise.resolve(onRewriteSelection?.(sel, doc?.path || path))
        },
      }, '改这段') : null,
      e('button', {
        type: 'button',
        'data-testid': `${testIdPrefix}-fim`,
        onClick: () => { void complete(false) },
      }, loadingFim ? '停止补全' : ghost ? '重新补全' : '补全'),
      e('span', { 'data-testid': `${testIdPrefix}-wordcount`, style: { opacity: 0.55 } }, `${wordCount} 字`),
      e('span', { 'data-testid': `${testIdPrefix}-save-state`, style: { opacity: 0.55 } }, describeStatus(state, conflict)),
      headerExtras,
    ),
    e('div', {
      className: cls('textarea'),
      style: { position: 'relative', flex: 1, minHeight: 0, ...sty('textarea') },
    },
      // CodeMirror mounts here. The container keeps the legacy testid and
      // fills the wrapper; the EditorView lives on `__cmView` for e2e.
      e('div', {
        ref: containerRef,
        'data-testid': `${testIdPrefix}-editor`,
        'aria-label': '正文编辑器',
        style: { position: 'absolute', inset: 0 },
      }),
    ),
    showGhostTip && ghost ? e('div', {
      className: cls('ghostTip'),
      style: { padding: '4px 8px', fontSize: 12, opacity: 0.55, ...sty('ghostTip') },
    }, '补全 · Tab 采纳 · Esc 关掉') : null,
    proposal ? e('div', {
      className: cls('proposal'),
      'aria-label': '选段修改建议',
      style: { padding: 12, border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))', borderRadius: 6, ...sty('proposal') },
    },
      e('strong', null, '选段修改建议'),
      showProposalDiff ? e('div', { style: { display: 'grid', gap: 7 } },
        e('section', null, e('small', null, '原文'), e('p', null, proposal.ticket.selectedText)),
        e('section', null, e('small', null, '修改后'), e('p', null, proposal.text)),
      ) : e('p', null, proposal.text),
      e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        e('button', { type: 'button', onClick: acceptPatch }, '应用修改'),
        e('button', { type: 'button', onClick: () => { setProposal(null); report('已放弃修改建议。'); viewRef.current?.focus() } }, '放弃'),
      ),
    ) : null,
    conflict ? e('div', {
      'data-testid': `${testIdPrefix}-conflict-guard`,
      className: cls('conflict'),
      style: { padding: '6px 8px', borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))', fontSize: 12, ...sty('conflict') },
    },
      e('span', null, '当前草稿与磁盘版本不一致，已保留本地内容。'),
    ) : null,
    note ? e('div', {
      'data-testid': `${testIdPrefix}-notice`,
      className: cls('notice'),
      role: conflict ? 'alert' : 'status',
      style: { padding: '4px 8px', fontSize: 12, opacity: 0.7, ...sty('notice') },
    }, note) : null,
    error ? e('div', {
      className: cls('notice'),
      style: { padding: 8, color: '#8a3a30', fontSize: 12, ...sty('notice') },
    }, error) : null,
    /* 恢复备份入口独立于 notice 槽：shell 会把 slotStyle.notice 设为 display:none
       只隐藏普通提示，这里的按钮必须始终可见可点。 */
    backups.length > 0 && doc ? e('div', {
      'data-testid': `${testIdPrefix}-draft-backups`,
      role: 'status',
      style: { padding: '4px 8px', fontSize: 12, opacity: 0.8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
    },
      e('span', null, `发现 ${backups.length} 份其他窗口留下的未保存备份（采纳后原备份仍保留）：`),
      backups.map((backup, index) => e('button', {
        key: `${backup.ownerId ?? 'legacy'}-${backup.revision ?? index}`,
        type: 'button',
        disabled: isDirty(doc, text) || conflict,
        title: isDirty(doc, text) || conflict ? '当前有未保存内容，请先保存或放弃修改，避免丢稿' : '把这份备份放入当前草稿',
        onClick: () => adoptBackup(backup),
      }, draftBackupLabel(backup, index))),
    ) : null,
    showFooter ? e('footer', {
      className: cls('footer'),
      style: { padding: '6px 8px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', ...sty('footer') },
    },
      e('button', { type: 'button', disabled: !doc || text === doc.text || conflict, onClick: () => void save() }, '保存'),
      loadingFim ? e('button', { type: 'button', onClick: () => { fimAbort.current?.abort(); setLoadingFim(false); report('已停止补全。') } }, '停止补全') : null,
      enablePatch ? e('button', {
        type: 'button',
        disabled: !doc || conflict || loadingFim || (!patching && selection.start === selection.end),
        onClick: () => {
          if (!patching) { void requestPatch(); return }
          patchAbort.current?.abort()
          setPatching(false)
          report('已停止改写。')
        },
      }, patching ? '停止改写' : '修改选段') : null,
      ghost ? e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        e('strong', null, '补全建议'),
        e('small', null, `候选 ${ghostIndex + 1} / ${ghostCandidates.length}`),
        e('button', { type: 'button', onClick: acceptGhost }, '接受补全'),
        ghostCandidates.length < maxGhostCandidates ? e('button', { type: 'button', disabled: loadingFim, onClick: () => void complete(true) }, '再来一个') : e('span', { style: { opacity: 0.55 } }, `已满 ${maxGhostCandidates} 条`),
        e('button', { type: 'button', onClick: () => { clearGhost(); report('已放弃补全。'); viewRef.current?.focus() } }, '放弃'),
        ghostCandidates.length > 1 ? e('nav', { 'aria-label': '切换补全候选', style: { display: 'flex', gap: 4 } },
          e('button', { type: 'button', disabled: ghostIndex <= 0, onClick: () => setGhostIndex((old) => Math.max(0, old - 1)) }, '上一条'),
          e('button', { type: 'button', disabled: ghostIndex >= ghostCandidates.length - 1, onClick: () => setGhostIndex((old) => Math.min(ghostCandidates.length - 1, old + 1)) }, '下一条'),
        ) : null,
      ) : null,
      conflict ? e('button', { type: 'button', onClick: discard }, '放弃草稿并重新读取') : null,
      conflict && onReloadDisk ? e('button', { type: 'button', 'data-testid': `${testIdPrefix}-reload-disk`, onClick: onReloadDisk }, '重新载入磁盘版本') : null,
      conflict && onSaveConflictCopy ? e('button', { type: 'button', 'data-testid': `${testIdPrefix}-save-conflict-copy`, onClick: onSaveConflictCopy }, '另存冲突副本') : null,
      footerExtras,
    ) : null,
  )
}
