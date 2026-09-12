import {
  createElement as e,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { SessionFace } from '../dsh-compat.ts'
import {
  EditorCore,
  editorCommandState,
  type EditorCommandState,
  type EditorContextMenuEvent,
  type EditorCoreHandle,
  type EditorCorePaperProjection,
  type EditorCoreStatus,
  type EditorTargetSnapshot,
  type CompletionPreference,
} from 'dsh-manuscript/client/editor-core'
import { DraftSyncQueue } from '../drafts.ts'
import { PaperStage } from './components.ts'
import { ConfirmDialog } from './dialogs.ts'
import {
  errorMessage,
  isStaleFailure,
  isWorldbookPath,
  replaceWorldbookPaperText,
  safeRpcCall,
  worldbookPaperProjection,
  type RevealRequest,
  type RpcResult,
  type ShellContext,
} from './shared.ts'
import { isChapterMetaPath, ChapterMetaSettings } from './chapter-meta-settings.ts'
import { canRewritePath, CUSTOM_INSTRUCTION_MAX, normalizeCustomInstruction } from '../rewrite-presets-view.ts'
import {
  chapterContextFor,
  previousChapterPath,
  previousChapterState,
  type PreviousChapterState,
} from '../chapter-meta-view.ts'
import { t } from '../i18n/index.ts'
import { Button, Dialog, Input } from './ui/index.ts'
import {
  clipboardResultMessage,
  copyEditorSelection,
  cutEditorSelection,
  editorClipboardBridge,
  pasteEditorSelection,
} from './editor-clipboard.ts'
import {
  EditorContextMenu,
  EditorOverflowMenu,
  type EditorMenuAction,
  type EditorMenuModel,
} from './editor-menu.tsx'

const PAPER_PROJECTION: EditorCorePaperProjection = {
  project: worldbookPaperProjection,
  replace: replaceWorldbookPaperText,
}

/** Opens the existing dsh-proofread dialog with captured visible paper text. */
const PROOFREAD_TEXT_EVENT = 'dsh-proofread:open-text'

export type ProofreadOpenDetail = {
  text: string
  sourceLabel?: string
  onLocate?(start: number, end: number): boolean
}

function requestProofreadText(detail: ProofreadOpenDetail): boolean {
  const event = new CustomEvent(PROOFREAD_TEXT_EVENT, { detail, cancelable: true })
  globalThis.dispatchEvent(event)
  return event.defaultPrevented
}

export function locateProofreadOffsets(input: {
  handle: EditorCoreHandle
  snapshot: EditorTargetSnapshot
  sentText: string
  originStart: number
  start: number
  end: number
}): boolean {
  if (!input.handle.isTargetCurrent(input.snapshot)) return false
  const selected = input.snapshot.start < input.snapshot.end
  // isTargetCurrent already validates the captured span against the live document.
  // A prior locate may move the cursor without changing that source span.
  const liveText = selected ? input.snapshot.selectedText : input.handle.getVisiblePaperText()
  if (liveText !== input.sentText) return false
  if (input.start < 0 || input.end < input.start || input.end > input.sentText.length) return false
  input.handle.revealRange(input.originStart + input.start, input.originStart + input.end)
  return true
}

const HIDE_NOTICE: CSSProperties = { display: 'none' }

/* 草稿归属窗口的 ownerId：sessionStorage 每个窗口（标签页）独立且重启后可恢复，
   只用于草稿 RPC，绝不写 localStorage（否则多窗口会互相认领/删除备份）。
   sessionStorage 不可用时退化为本次页面加载内的稳定随机值。 */
const DRAFT_OWNER_KEY = 'dsh-editor:draft-owner'
let fallbackDraftOwner = ''

function randomDraftOwner(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined
  return cryptoApi?.randomUUID?.() ?? `owner-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function draftOwnerId(): string {
  try {
    const store = globalThis.sessionStorage
    if (store) {
      const existing = store.getItem(DRAFT_OWNER_KEY)
      if (existing) return existing
      const generated = randomDraftOwner()
      store.setItem(DRAFT_OWNER_KEY, generated)
      return generated
    }
  } catch { /* sessionStorage 被禁用时走页面级 fallback */ }
  if (!fallbackDraftOwner) fallbackDraftOwner = randomDraftOwner()
  return fallbackDraftOwner
}

export function Editor(props: {
  ctx: ShellContext
  session: SessionFace
  path: string
  files: string[]
  onOpen(path: string): void
  create(): void
  externalRevision: number
  onDirtyChange(dirty: boolean): void
  completionPreference: CompletionPreference
  /* 可选补全能力开关：false 时停止 FIM 与选段改写 RPC(含快捷键);缺省 true 保持兼容。 */
  completionEnabled?: boolean
  authorPreferences: string
  authorMemory: string
  typewriter?: boolean
  focusParagraph?: boolean
  typography?: {
    fontSize?: number
    lineHeight?: number
    fontFamily?: 'serif' | 'sans' | 'mono' | string
    paragraphSpacing?: number
    maxWidth?: number
  }
  onSaved(): void
  reveal: RevealRequest | null
  onHandle?(handle: EditorCoreHandle | null): void
}) {
  const {
    ctx,
    session,
    path,
    files,
    onOpen,
    create,
    externalRevision: incomingRevision,
    onDirtyChange,
    completionPreference,
    completionEnabled = true,
    authorPreferences,
    typewriter = false,
    focusParagraph = false,
    typography,
    reveal,
    onHandle: onHandleOut,
  } = props

  const [note, setNote] = useState('')
  const [status, setStatus] = useState<EditorCoreStatus>('empty')
  const [reloadConfirm, setReloadConfirm] = useState(false)
  // Local copy of externalRevision so the reload-conflict flow can force a
  // re-read after clearing the host draft. Bumping this triggers EditorCore's
  // own file.read / draft.get cycle.
  const [revisionTick, setRevisionTick] = useState(0)
  const externalRevision = incomingRevision + revisionTick
  const handleRef = useRef<EditorCoreHandle | null>(null)
  const pendingMenuAction = useRef<(() => void) | null>(null)
  const editorFocusTarget = useRef<HTMLElement | null>(null)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [menuState, setMenuState] = useState<EditorCommandState>(() => editorCommandState({
    loaded: false, conflict: false, busy: false, completionEnabled: false, enablePatch: false,
    hasVisibleSelection: false, collapsed: true, dirty: false, canUndo: false, canRedo: false, paperLength: 0,
  }))
  const [menuTarget, setMenuTarget] = useState<EditorTargetSnapshot | null>(null)
  const [chapterMetaOpen, setChapterMetaOpen] = useState(false)
  const [customRewriteOpen, setCustomRewriteOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const [customTarget, setCustomTarget] = useState<EditorTargetSnapshot | null>(null)

  // Serialize draft RPCs so a delayed put cannot land after save's delete.
  // Every call carries this window's ownerId; the queue tracks per-file
  // revisions so deletes always echo the revision Host last handed out.
  const ownerId = useMemo(draftOwnerId, [])
  const draftQueue = useRef<DraftSyncQueue | null>(null)
  if (!draftQueue.current) {
    draftQueue.current = new DraftSyncQueue((endpoint, payload) =>
      ctx.connection.rpc.call('/manuscript', endpoint, { ...payload, ownerId }),
    )
  }

  const draft = useMemo(
    () => ({
      kind: 'host' as const,
      call: (endpoint: 'draft.get' | 'draft.put' | 'draft.delete' | 'draft.list', payload: Record<string, unknown>) => {
        const queue = draftQueue.current!
        if (endpoint === 'draft.delete') return queue.delete(payload)
        if (endpoint === 'draft.list') {
          /* 其他窗口（含早期无 owner 的 legacy 备份）的恢复列表：排除本窗口自己的草稿。 */
          return queue.run(endpoint, payload).then((raw) => {
            const result = raw as RpcResult<{ drafts?: Array<{ ownerId?: string }> }>
            if (!result.ok || !Array.isArray(result.value?.drafts)) return raw
            return { ...result, value: { ...result.value, drafts: result.value.drafts.filter((entry) => (entry.ownerId ?? '') !== ownerId) } }
          })
        }
        return queue.run(endpoint, payload)
      },
      syncDelayMs: 250,
    }),
    [ownerId],
  )

  const onNotice = useCallback((message: string) => { setNote(message) }, [])
  const onError = useCallback((message: string) => { setNote(message) }, [])
  const onHandle = useCallback((handle: EditorCoreHandle | null) => {
    handleRef.current = handle
    if (handle) {
      setBufferText(handle.getText() ?? '')
      editorFocusTarget.current = handle.getFocusTarget()
    }
    onHandleOut?.(handle)
  }, [onHandleOut])

  const snapshotMenu = useCallback(() => {
    const handle = handleRef.current
    if (!handle || handle.isComposing()) return false
    setMenuState(handle.getCommandState())
    setMenuTarget(handle.captureTarget())
    return true
  }, [])

  const closeMenus = useCallback(() => {
    setOverflowOpen(false)
    setContextMenu(null)
  }, [])

  const focusEditorIfNeeded = useCallback((event?: Event) => {
    event?.preventDefault()
    const action = pendingMenuAction.current
    pendingMenuAction.current = null
    globalThis.setTimeout(() => {
      if (action) action()
      else handleRef.current?.focus()
    }, 0)
  }, [])

  const runMenuAction = useCallback((action: EditorMenuAction) => {
    const handle = handleRef.current
    if (!handle) return
    const live = handle.getCommandState()
    const target = menuTarget ?? handle.captureTarget()
    if (target && !handle.isTargetCurrent(target)) {
      closeMenus()
      setNote(t('editor.clipboardExpired'))
      return
    }
    const canRewriteTarget = live.loaded && live.completionEnabled && live.enablePatch && !live.conflict && !live.busy
      && Boolean(target && target.start < target.end)
    const canCompleteTarget = live.loaded && live.completionEnabled && !live.conflict && !live.busy
      && Boolean(target && target.start === target.end)
    const afterMenu = (run: () => void) => {
      pendingMenuAction.current = () => {
        if (target && handleRef.current?.isTargetCurrent(target)) run()
      }
    }

    if (action === 'undo') { if (live.canUndo) handle.undo(); return }
    if (action === 'redo') { if (live.canRedo) handle.redo(); return }
    if (action === 'selectAll') { if (live.canSelectAll) handle.selectAll(); return }
    if (action === 'save') { if (live.canSave) void handle.save(); return }
    if (action === 'find') { if (live.canFind) afterMenu(() => handleRef.current?.openFind()); return }
    if (action === 'replace') { if (live.canReplace) afterMenu(() => handleRef.current?.openReplace()); return }
    if (action === 'complete') { if (canCompleteTarget && target && handle.restoreTarget(target)) handle.requestCompletion(); return }
    if (action === 'rewrite') {
      if (!canRewriteTarget) return
      afterMenu(() => {
        setCustomTarget(target)
        setCustomText('')
        setCustomRewriteOpen(true)
      })
      return
    }
    if (action === 'proofread') {
      afterMenu(() => {
        const liveHandle = handleRef.current
        if (!liveHandle || (target && !liveHandle.isTargetCurrent(target))) {
          setNote(t('editor.clipboardExpired'))
          return
        }
        const selected = liveHandle.getVisibleSelectionText()
        const paper = liveHandle.getVisiblePaperText()
        const text = selected || paper
        if (!text.trim()) {
          setNote(t('editor.proofreadEmpty'))
          return
        }
        const snapshot = liveHandle.captureTarget()
        if (!snapshot) {
          setNote(t('editor.clipboardExpired'))
          return
        }
        const usingSelection = selected.length > 0
        const originStart = usingSelection ? snapshot.start : liveHandle.getPaperOffset()
        const sourceLabel = usingSelection ? t('editor.proofreadSelection') : t('editor.proofreadChapter')
        const opened = requestProofreadText({
          text,
          sourceLabel,
          onLocate: (start, end) => {
            const current = handleRef.current
            if (!current) return false
            const ok = locateProofreadOffsets({ handle: current, snapshot, sentText: text, originStart, start, end })
            if (!ok) setNote(t('editor.proofreadLocateFailed'))
            return ok
          },
        })
        if (!opened) setNote(t('editor.proofreadUnavailable'))
      })
      return
    }
    if (action === 'chapterMeta') { if (live.loaded && !live.conflict && isChapterMetaPath(path)) afterMenu(() => setChapterMetaOpen(true)); return }

    const bridge = editorClipboardBridge()
    if (!bridge) {
      setNote(t('editor.clipboardUnavailable'))
      return
    }
    if (action === 'copy') {
      void copyEditorSelection({ handle, state: live, target, writeText: (text) => bridge.writeText(text) }).then((result) => {
        const message = clipboardResultMessage(result)
        if (message) setNote(message)
      })
      return
    }
    if (action === 'cut') {
      void cutEditorSelection({ handle, state: live, target, writeText: (text) => bridge.writeText(text) }).then((result) => {
        const message = clipboardResultMessage(result)
        if (message) setNote(message)
      })
      return
    }
    if (action === 'paste') {
      void pasteEditorSelection({ handle, state: live, target, readText: () => bridge.readText() }).then((result) => {
        const message = clipboardResultMessage(result)
        if (message) setNote(message)
      })
    }
  }, [menuTarget, path, closeMenus])

  const onEditorContextMenu = useCallback((event: EditorContextMenuEvent) => {
    if (!snapshotMenu()) return
    setOverflowOpen(false)
    setContextMenu({ x: event.x, y: event.y })
  }, [snapshotMenu])

  const menuModel: EditorMenuModel = {
    state: menuState,
    canChapterMeta: isChapterMetaPath(path) && menuState.loaded && !menuState.conflict,
    canRewritePath: canRewritePath(path) && completionEnabled,
  }

  const runCustomRewrite = () => {
    const instruction = normalizeCustomInstruction(customText)
    if (!instruction) return
    const handle = handleRef.current
    const target = customTarget
    setCustomRewriteOpen(false)
    if (!handle || !target || !handle.isTargetCurrent(target)) {
      setNote(t('editor.rewriteLocked'))
      return
    }
    handle.restoreTarget(target)
    handle.requestRewrite(instruction, target)
  }
  const [bufferText, setBufferText] = useState('')

  const onStatusChange = useCallback((next: EditorCoreStatus) => {
    setStatus(next)
    if (next === 'saved' || next === 'draft' || next === 'conflict' || next === 'empty') {
      setBufferText(handleRef.current?.getText() ?? '')
    }
  }, [])

  const reloadDisk = useCallback(async () => {
    setReloadConfirm(false)
    const deleted = await draftQueue.current!.delete({ sessionId: session.sessionId, path }) as RpcResult
    if (!deleted.ok && !isStaleFailure(deleted)) {
      setNote(t('editor.draftCleanupFailed', { error: errorMessage(deleted) }))
      return
    }
    setRevisionTick((tick) => tick + 1)
    setNote(t('editor.reloadedDisk'))
  }, [session.sessionId, path])

  const saveConflictCopy = useCallback(async () => {
    const currentText = handleRef.current?.getText() ?? ''
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    /* 冲突副本沿用原扩展名（.md/.txt），避免 TXT 文稿被改名成 Markdown。 */
    const extension = /\.(md|txt)$/i.exec(path)
    const copy = extension
      ? t('editor.conflictName', { stem: path.slice(0, extension.index), stamp, ext: extension[0] })
      : t('editor.conflictNameFallback', { path, stamp })
    const created = await ctx.connection.rpc.call('/manuscript', 'file.create', {
      sessionId: session.sessionId,
      path: copy,
      text: currentText,
    }) as RpcResult
    if (!created.ok) { setNote(errorMessage(created)); return }
    setNote(t('editor.draftSavedAs', { path: copy }))
    const deleted = await draftQueue.current!.delete({ sessionId: session.sessionId, path }) as RpcResult
    if (!deleted.ok && !isStaleFailure(deleted)) {
      setNote(t('editor.draftCleanupFailed', { error: errorMessage(deleted) }))
      return
    }
    setRevisionTick((tick) => tick + 1)
  }, [ctx.connection.rpc, session.sessionId, path])

  // Clear stale notes when navigating to a new document.
  useEffect(() => {
    setNote('')
    setReloadConfirm(false)
    setBufferText('')
    setOverflowOpen(false)
    setContextMenu(null)
    setChapterMetaOpen(false)
    setCustomRewriteOpen(false)
    setCustomTarget(null)
  }, [path, session.sessionId, externalRevision])

  const applyFrontmatterBuffer = useCallback(async (next: string) => {
    const doc = handleRef.current?.getDocument()
    if (!doc) {
      setNote(isWorldbookPath(path) ? t('editor.worldbookNotLoaded') : t('chapterMeta.notLoaded'))
      return
    }
    const put = await draftQueue.current!.run('draft.put', {
      sessionId: session.sessionId,
      path,
      text: next,
      baseText: doc.text,
      baseVersion: doc.version,
    }) as RpcResult
    if (!put.ok) { setNote(errorMessage(put)); return }
    setBufferText(next)
    setRevisionTick((tick) => tick + 1)
  }, [session.sessionId, path])

  const currentText = bufferText || handleRef.current?.getText() || ''

  // 上一章的章末状态表：只在正文章节读取一次，随文件树 / 外部修订刷新；读取失败时静默不带。
  const previousPath = useMemo(
    () => (isChapterMetaPath(path) ? previousChapterPath(path, files) : undefined),
    [path, files],
  )
  const [previousState, setPreviousState] = useState<PreviousChapterState | undefined>(undefined)
  useEffect(() => {
    if (!previousPath) { setPreviousState(undefined); return }
    let cancelled = false
    void (async () => {
      const read = await safeRpcCall<{ text: string; version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', {
        sessionId: session.sessionId,
        path: previousPath,
      }))
      if (cancelled) return
      setPreviousState(read.ok && typeof read.value?.text === 'string' ? previousChapterState(previousPath, read.value.text) : undefined)
    })()
    return () => { cancelled = true }
  }, [ctx.connection.rpc, session.sessionId, previousPath, incomingRevision, revisionTick])

  const chapterContext = useMemo(
    () => isChapterMetaPath(path) ? chapterContextFor(currentText, previousState) : undefined,
    [path, currentText, previousState],
  )

  useEffect(() => {
    if (!path || !reveal || reveal.path !== path) return
    const apply = () => {
      const handle = handleRef.current
      const current = handle?.getText()
      const doc = handle?.getDocument()
      if (!handle || !current || !doc || doc.path !== reveal.path) return false
      if (reveal.version !== doc.version) {
        setNote(t('editor.searchStale'))
        return true
      }
      handle.revealRange(reveal.start, reveal.end)
      return true
    }
    if (apply()) return
    const timer = globalThis.setTimeout(() => { apply() }, 80)
    return () => globalThis.clearTimeout(timer)
  }, [path, reveal?.nonce, reveal?.path, reveal?.version, externalRevision])

  if (!path) {
    const hasChapter = files.some((item) => /^正文\/.+\.(md|txt)$/i.test(item))
    return e(PaperStage, { label: t('editor.emptyChapter') },
      e('p', { className: 'home-hint' }, t('editor.emptyHint')),
      e('div', { className: 'home-actions' },
        e('button', { className: 'primary-action', type: 'button', onClick: create }, hasChapter ? t('editor.newChapter') : t('editor.writeFirstChapter')),
      ),
    )
  }

  const navigationBlocked = status === 'draft' || status === 'conflict'

  return e(Fragment, null,
    e(EditorCore, {
      sessionId: session.sessionId,
      path,
      rpc: ctx.connection.rpc,
      draft,
      externalRevision,
      onDirtyChange,
      onSaved: props.onSaved,
      onNotice,
      onError,
      onStatusChange,
      onHandle,
      testIdPrefix: 'paper',
      paperClassName: 'editor',
      slotClassName: {
        header: 'editor-header',
        textarea: 'paper-input',
        proposal: 'proposal',
      },
      slotStyle: { notice: HIDE_NOTICE },
      completionPreference,
      completionEnabled,
      authorPreferences,
      typewriter,
      focusParagraph,
      typography,
      compactControls: true,
      onEditorContextMenu,
      headerExtras: e(EditorOverflowMenu, {
        open: overflowOpen,
        onOpenChange: (open: boolean) => {
          if (open && !snapshotMenu()) return
          setOverflowOpen(open)
          if (open) setContextMenu(null)
        },
        model: menuModel,
        onAction: runMenuAction,
        onCloseAutoFocus: focusEditorIfNeeded,
      }),
      maxGhostCandidates: 3,
      enablePatch: true,
      enableBeforeUnload: true,
      paperProjection: PAPER_PROJECTION,
      chapterContext,
      siblings: files,
      onOpenSibling: onOpen,
      siblingsBlocked: navigationBlocked,
      onReloadDisk: () => setReloadConfirm(true),
      onSaveConflictCopy: saveConflictCopy,
      footerExtras: note ? e('div', {
        className: 'editor-notice',
        'data-testid': 'paper-notice',
        role: status === 'conflict' || status === 'error' ? 'alert' : 'status',
        style: { padding: '4px 8px', fontSize: 12, opacity: 0.75 },
      }, note) : null,
    }),
    contextMenu ? e(EditorContextMenu, {
      x: contextMenu.x,
      y: contextMenu.y,
      model: menuModel,
      onAction: (action: EditorMenuAction) => {
        runMenuAction(action)
        closeMenus()
      },
      onClose: closeMenus,
      onCloseAutoFocus: focusEditorIfNeeded,
    }) : null,
    isChapterMetaPath(path) ? e(ChapterMetaSettings, {
      key: `${path}:${externalRevision}:${currentText ? 'ready' : 'empty'}`,
      path,
      text: currentText,
      open: chapterMetaOpen,
      returnFocusRef: editorFocusTarget,
      onOpenChange: setChapterMetaOpen,
      onChange: (next: string) => { void applyFrontmatterBuffer(next) },
      onNote: setNote,
    }) : null,
    e(Dialog, {
      open: customRewriteOpen,
      onOpenChange: setCustomRewriteOpen,
      title: t('editor.rewriteCustomTitle'),
      className: 'file-dialog editor-action-dialog',
      returnFocusRef: editorFocusTarget,
    },
      e('header', null, e('h2', null, t('editor.rewriteCustomTitle'))),
      e(Input, {
        value: customText,
        maxLength: CUSTOM_INSTRUCTION_MAX,
        placeholder: t('rewrite.customPlaceholder'),
        'aria-label': t('rewrite.customPlaceholder'),
        autoFocus: true,
        onChange: setCustomText,
        onKeyDown: (event) => {
          if (event.key === 'Enter') { event.preventDefault(); runCustomRewrite() }
          if (event.key === 'Escape') { event.preventDefault(); setCustomRewriteOpen(false) }
        },
      }),
      e('footer', null,
        e(Button, { onClick: () => setCustomRewriteOpen(false) }, t('common.cancel')),
        e(Button, { variant: 'primary', disabled: !normalizeCustomInstruction(customText), onClick: runCustomRewrite }, t('rewrite.customRun')),
      ),
    ),
    e(ConfirmDialog, {
      open: Boolean(reloadConfirm),
      id: 'reload-disk-confirm',
      title: t('editor.discardDraftTitle'),
      message: t('editor.discardDraftBody'),
      confirmLabel: t('editor.discardReload'),
      onCancel: () => setReloadConfirm(false),
      onConfirm: () => { void reloadDisk() },
    }),
  )
}
