import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type { SessionFace } from '../dsh-compat.ts'
import {
  EditorCore,
  editorCommandState,
  REWRITE_PRESETS,
  type EditorCommandState,
  type EditorContextMenuEvent,
  type EditorCoreHandle,
  type EditorCorePaperProjection,
  type EditorCoreStatus,
  type EditorTargetSnapshot,
  type CompletionPreference,
} from 'dsh-manuscript/client/editor-core'
import { DraftSyncQueue } from '../drafts.ts'
import { PaperStage } from './components.tsx'
import { ConfirmDialog } from './dialogs.tsx'
import {
  errorMessage,
  isStaleFailure,
  replaceWorldbookPaperText,
  worldbookPaperProjection,
  type RevealRequest,
  type RpcResult,
  type ShellContext,
} from './shared.ts'
import { useTransientSuccessNote } from './transient-note.ts'
import { isAuthorFacingDocumentPath } from '../project-files.ts'
import { canPinPath } from '../pinned-pane-view.ts'
import { canRewritePath, CUSTOM_INSTRUCTION_MAX, normalizeCustomInstruction, presetLabelKey } from '../rewrite-presets-view.ts'
import { t } from '../i18n/index.ts'
import type { SearchHit } from '../model/search-panel.ts'
import { normalizeReferenceQuery } from './reference-lookup.ts'
import { ReferenceLookupDialog } from './reference-lookup-dialog.tsx'
import { Button as HostButton, isImeEvent } from './ui/index.ts'
import { Button, Input, Notice, Popover } from '../ui/index.ts'
import { Button as ThemesButton, Callout, Text } from '@radix-ui/themes'
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
} from './editor-menu.tsx'
import type { EditorMenuAction, EditorMenuModel } from '../model/editor-menu.ts'

const PAPER_PROJECTION: EditorCorePaperProjection = {
  project: worldbookPaperProjection,
  replace: replaceWorldbookPaperText,
}

const HIDE_NOTICE: CSSProperties = { display: 'none' }

import { draftOwnerId } from '../model/editor.ts'

export function Editor(props: {
  ctx: ShellContext
  session: SessionFace
  path: string
  files: string[]
  referenceFiles?: readonly string[]
  referenceRevision?: number
  onOpenReference?(path: string, hit?: SearchHit): void
  onPinReference?(path: string): void
  create(): void
  externalRevision: number
  onDirtyChange(dirty: boolean): void
  completionPreference: CompletionPreference
  completionDelayMs?: number
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
    firstLineIndent?: boolean
    centerSectionMarks?: boolean
  }
  onSaved(): void
  reveal: RevealRequest | null
  onHandle?(handle: EditorCoreHandle | null): void
  onStatusChange?(status: EditorCoreStatus): void
}) {
  const {
    ctx,
    session,
    path,
    files,
    create,
    externalRevision: incomingRevision,
    onDirtyChange,
    completionPreference,
    completionDelayMs,
    completionEnabled = true,
    authorPreferences,
    typewriter = false,
    focusParagraph = false,
    typography,
    reveal,
    onHandle: onHandleOut,
    onStatusChange: onStatusChangeOut,
  } = props

  const [note, setNote] = useState('')
  const expireNote = useCallback((expired: string) => {
    setNote((current) => current === expired ? '' : current)
  }, [])
  useTransientSuccessNote(note, expireNote)
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
  const [customRewriteOpen, setCustomRewriteOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const [customTarget, setCustomTarget] = useState<EditorTargetSnapshot | null>(null)
  /* 改写浮层锚点：选区下沿的视口矩形（CodeMirror coordsAtPos），
     打开时定格一次，滚动/排版变化不重新求值。 */
  const [rewriteAnchor, setRewriteAnchor] = useState<{
    getBoundingClientRect(): DOMRect
  } | null>(null)
  const rewriteInputRef = useRef<HTMLInputElement | null>(null)
  const [referenceQuery, setReferenceQuery] = useState<string | null>(null)

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
    if (action === 'selectParagraph') { if (live.canSelectAll) afterMenu(() => handleRef.current?.selectParagraph?.(target ?? undefined)); return }
    if (action === 'lookupReferences') {
      const query = normalizeReferenceQuery(target?.selectedText ?? '')
      if (query && props.onOpenReference && props.onPinReference) afterMenu(() => setReferenceQuery(query))
      return
    }
    if (action === 'save') { if (live.canSave) void handle.save(); return }
    if (action === 'find') { if (live.canFind) afterMenu(() => handleRef.current?.openFind()); return }
    if (action === 'replace') { if (live.canReplace) afterMenu(() => handleRef.current?.openReplace()); return }
    if (action === 'complete') { if (canCompleteTarget && target && handle.restoreTarget(target)) handle.requestCompletion(); return }
    if (action === 'rewrite') {
      if (!canRewriteTarget) return
      afterMenu(() => {
        /* 锚点取选区下沿：coordsAtPos(end) 返回该位置的插入符矩形，
           其 bottom 即选区末行下沿；取不到坐标时回退到选区上沿。 */
        const liveHandle = handleRef.current
        const rect = target
          ? liveHandle?.coordsAtPos(target.end) ?? liveHandle?.coordsAtPos(target.start)
          : null
        if (!rect) {
          setNote(t('editor.rewriteLocked'))
          return
        }
        /* coordsAtPos は {left,top,right,bottom}；Radix virtualRef の
           Measurable は DOMRect 形を要求するため全フィールドを補う。 */
        const domRect = {
          x: rect.left, y: rect.top,
          top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom,
          width: rect.right - rect.left, height: rect.bottom - rect.top,
          toJSON: () => rect,
        } as DOMRect
        setRewriteAnchor({ getBoundingClientRect: () => domRect })
        setCustomTarget(target)
        setCustomText('')
        setCustomRewriteOpen(true)
      })
      return
    }
    if (action === 'pin') {
      if (props.onPinReference && canPinPath(path)) props.onPinReference(path)
      return
    }
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
  }, [menuTarget, path, closeMenus, props.onOpenReference, props.onPinReference])

  const onEditorContextMenu = useCallback((event: EditorContextMenuEvent) => {
    if (!snapshotMenu()) return
    setOverflowOpen(false)
    setContextMenu({ x: event.x, y: event.y })
  }, [snapshotMenu])

  const menuModel: EditorMenuModel = {
    state: menuState,
    canRewritePath: canRewritePath(path) && completionEnabled,
    canSelectParagraph: menuState.canSelectAll && Boolean(handleRef.current?.selectParagraph),
    canLookupReferences: menuState.canCopy && Boolean(props.onOpenReference && props.onPinReference && normalizeReferenceQuery(menuTarget?.selectedText ?? '')),
    canPin: Boolean(props.onPinReference) && canPinPath(path),
  }

  const submitRewrite = (raw: string) => {
    const instruction = normalizeCustomInstruction(raw)
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
  const runCustomRewrite = () => submitRewrite(customText)

  const onStatusChange = useCallback((next: EditorCoreStatus) => {
    setStatus(next)
    onStatusChangeOut?.(next)
  }, [onStatusChangeOut])

  const reloadDisk = useCallback(async () => {
    setReloadConfirm(false)
    handleRef.current?.cancelPendingDraftSync()
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
    handleRef.current?.cancelPendingDraftSync()
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
    setOverflowOpen(false)
    setContextMenu(null)
    setCustomRewriteOpen(false)
    setCustomTarget(null)
    setRewriteAnchor(null)
    setReferenceQuery(null)
  }, [path, session.sessionId, externalRevision])

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

  /* 版心竖线定位（§4）：从 .cm-content 的实际内容盒（边框盒减两侧内边距）
     量出文字区左右缘，各向外让 24px 画线；跟随 paperWidth 与窗口尺寸。 */
  const editorStackRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = editorStackRef.current
    const paper = host?.querySelector<HTMLElement>('.paper-input')
    if (!host || !paper) return
    const shellRoot = host.closest<HTMLElement>('.shell')
    let content: HTMLElement | null = null
    let raf = 0
    const measure = () => {
      raf = 0
      if (!content) return
      const inputRect = paper.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      const styles = globalThis.getComputedStyle(content)
      const left = contentRect.left + (Number.parseFloat(styles.paddingLeft) || 0) - inputRect.left
      const right = contentRect.right - (Number.parseFloat(styles.paddingRight) || 0) - inputRect.left
      if (right <= left) return
      /* 窄窗下文字几乎贴到稿纸边缘时，两根线看起来像边框缺陷：内容盒到
         稿纸边缘的实测间隙不足 32px 就整对隐藏。 */
      paper.toggleAttribute('data-rules-hidden', left < 32 || inputRect.width - right < 32)
      /* 1px 线内缘距内容盒 24px。 */
      paper.style.setProperty('--paper-rule-left', `${Math.round(left - 25)}px`)
      paper.style.setProperty('--paper-rule-right', `${Math.round(right + 24)}px`)
      /* 「搭档」 launcher 等浮层要停在页脚上方：把页脚高度抬到 .shell 上。 */
      const footer = host.querySelector<HTMLElement>('.editor-tools')
      shellRoot?.style.setProperty('--paper-footer-h', `${Math.round(footer?.getBoundingClientRect().height ?? 0)}px`)
    }
    const schedule = () => { if (!raf) raf = globalThis.requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    const sync = () => {
      const next = host.querySelector<HTMLElement>('.cm-content')
      if (next !== content) {
        if (content) observer.unobserve(content)
        content = next
        if (content) observer.observe(content)
      }
      schedule()
    }
    const mutations = new MutationObserver(sync)
    mutations.observe(paper, { childList: true, subtree: true })
    observer.observe(paper)
    globalThis.addEventListener('resize', schedule)
    sync()
    return () => {
      mutations.disconnect()
      observer.disconnect()
      globalThis.removeEventListener('resize', schedule)
      shellRoot?.style.removeProperty('--paper-footer-h')
      if (raf) globalThis.cancelAnimationFrame(raf)
    }
  }, [path, session.sessionId])

  if (!path) {
    const hasDocument = files.some((item) => isAuthorFacingDocumentPath(item))
    return (
      <PaperStage label={t('editor.emptyChapter')}>
        {hasDocument ? null : <Text className="home-hint" size="2" color="gray">
          {t('editor.emptyHint')}
        </Text>}
        <div className="home-actions">
          <ThemesButton variant="solid" type="button" onClick={create}>
            {hasDocument ? t('editor.newChapter') : t('editor.writeFirstChapter')}
          </ThemesButton>
        </div>
      </PaperStage>
    );
  }

  return (
    <Fragment>
      {/* .editor-stack 接管原 .editor 的直接子级网格座位（grid-row: 2，见 styles.ts），
         内联布局样式与原稿纸根一致：flex 列 + 100% 高，子级 .editor-pane/.editor 尺寸行为不变。 */}
      <div
        ref={editorStackRef}
        className="editor-stack"
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="editor-pane">
          <EditorCore
            sessionId={session.sessionId}
            path={path}
            rpc={ctx.connection.rpc}
            draft={draft}
            externalRevision={externalRevision}
            onDirtyChange={onDirtyChange}
            onSaved={props.onSaved}
            onNotice={onNotice}
            onError={onError}
            onStatusChange={onStatusChange}
            onHandle={onHandle}
            testIdPrefix="paper"
            paperClassName="editor"
            slotClassName={{
              header: 'editor-header',
              textarea: 'paper-input',
              proposal: 'proposal',
              footer: 'editor-tools',
              ghostTip: 'editor-ghost-tip',
            }}
            slotStyle={{ notice: HIDE_NOTICE }}
            completionPreference={completionPreference}
            automaticCompletionEligible={isAuthorFacingDocumentPath(path)}
            fimDelayMs={completionDelayMs}
            completionEnabled={completionEnabled}
            authorPreferences={authorPreferences}
            typewriter={typewriter}
            focusParagraph={focusParagraph}
            typography={typography}
            compactControls={true}
            onEditorContextMenu={onEditorContextMenu}
            hostButton={HostButton}
            paperHeader={<div className="paper-page-header">
              <div className="paper-page-headline">
                {/* paper-path 是沿用至今的测试钩子；§4 修订后页眉不再显示标题
                    文字（正文一级标题即章节名），只留右侧「⋯」稿纸菜单。 */}
                <span className="sr-only" data-testid="paper-path">{path}</span>
                <span className="paper-page-menu">
                  <EditorOverflowMenu
                    open={overflowOpen}
                    onOpenChange={(open: boolean) => {
                      if (open && !snapshotMenu()) return
                      setOverflowOpen(open)
                      if (open) setContextMenu(null)
                    }}
                    model={menuModel}
                    onAction={runMenuAction}
                    onCloseAutoFocus={focusEditorIfNeeded} />
                </span>
              </div>
            </div>}
            conflictNotice={<div data-testid="paper-conflict-guard">
              <Notice
                tone="danger"
                title={t('editor.conflictNoticeTitle')}
                action={<Fragment>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="paper-reload-disk"
                    onClick={() => setReloadConfirm(true)}>
                    {t('editor.reloadDisk')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="paper-save-conflict-copy"
                    onClick={() => { void saveConflictCopy() }}>
                    {t('editor.saveConflictCopy')}
                  </Button>
                </Fragment>}>
                {t('editor.conflictNoticeBody')}
              </Notice>
            </div>}
            maxGhostCandidates={3}
            enablePatch={true}
            enableBeforeUnload={true}
            paperProjection={PAPER_PROJECTION}
            onReloadDisk={() => setReloadConfirm(true)}
            onSaveConflictCopy={saveConflictCopy}
            footerExtras={note ? <Callout.Root
              className="editor-notice"
              data-testid="paper-notice"
              role={status === 'conflict' || status === 'error' ? 'alert' : 'status'}
              color={status === 'conflict' || status === 'error' ? 'red' : 'gray'}
              size="1">
              <Callout.Text>
                {note}
              </Callout.Text>
            </Callout.Root> : null} />
        </div>
      </div>
      {referenceQuery && props.onOpenReference && props.onPinReference ? <ReferenceLookupDialog
        key={`${session.sessionId}:${path}:${referenceQuery}`}
        ctx={ctx}
        sessionId={session.sessionId}
        query={referenceQuery}
        files={props.referenceFiles ?? files}
        revision={props.referenceRevision ?? externalRevision}
        returnFocusRef={editorFocusTarget}
        onClose={() => setReferenceQuery(null)}
        onOpen={props.onOpenReference}
        onPin={props.onPinReference} /> : null}
      {contextMenu ? <EditorContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        model={menuModel}
        onAction={(action: EditorMenuAction) => {
          runMenuAction(action)
          closeMenus()
        }}
        onClose={closeMenus}
        onCloseAutoFocus={focusEditorIfNeeded} /> : null}
      {/* §4 选段改写：就近 Popover 替代模态窗；锚点是选区下沿的虚拟元素，
          空间不足时 Radix 自动翻到上方，不遮住选区。 */}
      {customRewriteOpen && rewriteAnchor ? <Popover
        open={customRewriteOpen}
        onOpenChange={(open) => { if (!open) setCustomRewriteOpen(false) }}
        anchor={rewriteAnchor}
        side="bottom"
        align="center"
        aria-label={t('editor.rewrite')}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          rewriteInputRef.current?.focus()
        }}
        onCloseAutoFocus={focusEditorIfNeeded}
        content={<div className="rewrite-popover" role="group" aria-label={t('editor.rewrite')}>
          <div className="rewrite-presets" role="group" aria-label={t('rewrite.barLabel')}>
            {REWRITE_PRESETS.map((preset) => <Button
              key={preset.id}
              variant="ghost"
              size="sm"
              onClick={() => submitRewrite(preset.instruction)}>
              {t(presetLabelKey(preset.id))}
            </Button>)}
          </div>
          <Input
            ref={rewriteInputRef}
            className="rewrite-instruction"
            value={customText}
            maxLength={CUSTOM_INSTRUCTION_MAX}
            placeholder={t('rewrite.customPlaceholder')}
            aria-label={t('rewrite.customPlaceholder')}
            onChange={(value) => setCustomText(value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Escape') { event.preventDefault(); setCustomRewriteOpen(false); return }
              if (event.key === 'Enter' && !isImeEvent({ isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
                event.preventDefault()
                runCustomRewrite()
              }
            }} />
          <div className="rewrite-popover-actions">
            <Button variant="ghost" size="sm" onClick={() => setCustomRewriteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!normalizeCustomInstruction(customText)}
              onClick={runCustomRewrite}>
              {t('rewrite.customRun')}
            </Button>
          </div>
        </div>} /> : null}
      <ConfirmDialog
        open={Boolean(reloadConfirm)}
        id="reload-disk-confirm"
        title={t('editor.discardDraftTitle')}
        message={t('editor.discardDraftBody')}
        confirmLabel={t('editor.discardReload')}
        onCancel={() => setReloadConfirm(false)}
        onConfirm={() => { void reloadDisk() }} />
    </Fragment>
  );
}
