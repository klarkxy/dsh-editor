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
import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import {
  EditorCore,
  type EditorCoreHandle,
  type EditorCorePaperProjection,
  type EditorCoreStatus,
  type CompletionPreference,
} from 'dsh-manuscript/client/editor-core'
import { DraftSyncQueue } from '../drafts.ts'
import { PaperStage } from './components.ts'
import { ConfirmDialog } from './dialogs.ts'
import {
  errorMessage,
  isStaleFailure,
  replaceWorldbookPaperText,
  worldbookPaperProjection,
  type RevealRequest,
  type RpcResult,
  type ShellContext,
} from './shared.ts'
import { isWorldbookPath, WorldbookSettings } from './worldbook-settings.ts'
import { t } from '../i18n/index.ts'

const PAPER_PROJECTION: EditorCorePaperProjection = {
  project: worldbookPaperProjection,
  replace: replaceWorldbookPaperText,
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
  onToggleTypewriter?(): void
  onToggleFocusParagraph?(): void
  onSaved(): void
  reveal: RevealRequest | null
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
    authorPreferences,
    typewriter = false,
    focusParagraph = false,
    typography,
    onToggleTypewriter,
    onToggleFocusParagraph,
    reveal,
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
  const onHandle = useCallback((handle: EditorCoreHandle | null) => { handleRef.current = handle }, [])
  const [worldbookText, setWorldbookText] = useState('')

  const onStatusChange = useCallback((next: EditorCoreStatus) => {
    setStatus(next)
    if (next === 'saved' || next === 'draft' || next === 'conflict') {
      setWorldbookText(handleRef.current?.getText() ?? '')
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
    setWorldbookText('')
  }, [path, session.sessionId])

  const applyWorldbookBuffer = useCallback(async (next: string) => {
    const doc = handleRef.current?.getDocument()
    if (!doc) { setNote(t('editor.worldbookNotLoaded')); return }
    const put = await draftQueue.current!.run('draft.put', {
      sessionId: session.sessionId,
      path,
      text: next,
      baseText: doc.text,
      baseVersion: doc.version,
    }) as RpcResult
    if (!put.ok) { setNote(errorMessage(put)); return }
    setWorldbookText(next)
    setRevisionTick((tick) => tick + 1)
  }, [session.sessionId, path])

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
    return e(PaperStage, { label: t('editor.emptyChapter') },
      e('p', { className: 'home-hint' }, t('editor.emptyHint')),
      e('div', { className: 'home-actions' },
        e('button', { className: 'primary-action', type: 'button', onClick: create }, t('editor.newFile')),
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
      },
      slotStyle: { notice: HIDE_NOTICE },
      completionPreference,
      authorPreferences,
      typewriter,
      focusParagraph,
      typography,
      headerExtras: onToggleTypewriter || onToggleFocusParagraph
        ? e('div', { className: 'paper-experience-toggles' },
          onToggleTypewriter ? e('button', {
            type: 'button',
            title: t('editor.typewriterTitle'),
            'aria-label': t('editor.typewriterTitle'),
            'aria-pressed': typewriter,
            onClick: onToggleTypewriter,
          }, t('editor.typewriter')) : null,
          onToggleFocusParagraph ? e('button', {
            type: 'button',
            title: t('editor.focusTitle'),
            'aria-label': t('editor.focusTitle'),
            'aria-pressed': focusParagraph,
            onClick: onToggleFocusParagraph,
          }, t('editor.focus')) : null,
        )
        : null,
      maxGhostCandidates: 3,
      enablePatch: true,
      enableBeforeUnload: true,
      paperProjection: PAPER_PROJECTION,
      siblings: files,
      onOpenSibling: onOpen,
      siblingsBlocked: navigationBlocked,
      onReloadDisk: () => setReloadConfirm(true),
      onSaveConflictCopy: saveConflictCopy,
      footerExtras: isWorldbookPath(path) ? e(WorldbookSettings, {
        key: `${path}:${externalRevision}`,
        path,
        text: worldbookText || handleRef.current?.getText() || '',
        onChange: (next: string) => { void applyWorldbookBuffer(next) },
        onNote: setNote,
      }) : null,
    }),
    note ? e('div', {
      className: 'editor-notice',
      role: status === 'conflict' || status === 'error' ? 'alert' : 'status',
      style: { padding: '4px 8px', fontSize: 12, opacity: 0.75 },
    }, note) : null,
    reloadConfirm ? e(ConfirmDialog, {
      id: 'reload-disk-confirm',
      title: t('editor.discardDraftTitle'),
      message: t('editor.discardDraftBody'),
      confirmLabel: t('editor.discardReload'),
      onCancel: () => setReloadConfirm(false),
      onConfirm: () => { void reloadDisk() },
    }) : null,
  )
}
