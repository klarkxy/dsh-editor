import type { Context } from '@deepseek-ai/cordis'
import type {
  ClientContext,
  ConversationSnapshot,
  PendingInteraction,
  SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConnectionHandle,
  RpcError,
  SessionId,
  SessionModels,
  WorkspaceId,
} from '@deepseek-ai/dsh-client-connection/client'
import {
  createElement as e,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  answerApproval,
  answerQuestions,
  chatRows,
  loadOlder,
  partialText,
  readModels,
  selectModel,
  sendProjectContext,
  stop,
  visibleRunningCalls,
  type QuestionAnswerItem,
} from './adapter.ts'
import { formatWorldbookTriggerLines, parseWorldbookTriggerLines, worldbookEditorMetadata, writeWorldbookFrontmatter, type ProjectContextReceiptBundle } from './project-context.ts'
import type { EditorDraft } from './drafts.ts'
import { DraftSyncQueue } from './drafts.ts'
import {
  applyGhost,
  applySelectionPatch,
  canApplyGhost,
  isDirty,
  isSelectionCurrent,
  saveState,
  selectionTicket,
  type EditorDocument,
  type SelectionTicket,
} from './editor-state.ts'
import { registerRoot } from './root-registration.ts'
import { ModelSetup } from './model-setup.ts'
import { buildNovelIndexPrompt } from './novel-index.ts'
import { buildExport, type ChapterExport, type ExportFormat } from './export.ts'
import { archiveStateText, documentName, visibleArchives, type ArchiveView } from './file-lifecycle.ts'
import { documentTemplate, manuscriptGroupPath, nextChapterPath, nextDocumentPath, sortChapterPaths, type DocumentKind } from './project-files.ts'
import { WORKBENCH_RPC_CHANNEL } from './workbench-rpc.ts'
import type { ProposalMarker } from './proposal-tool.ts'
import { idleImportFlow, importReview, recoverImport, importSummary, type ImportFlow, type ImportProbeView } from './import-flow.ts'
import { ConversationRenameQueue, conversationRows, nextAutomaticConversationTitle, shouldConfirmConversationSwitch } from './conversation-lifecycle.ts'
import { automaticCompletionReady, COMPLETION_PREFERENCE_KEY, readCompletionPreference, type CompletionPreference } from './completion-preference.ts'
import {
  blocksWorkspaceOpen,
  idleSnapshotFlow,
  recoverSnapshot,
  restoreSummary,
  snapshotReview,
  snapshotSummary,
  type RestoreView,
  type SnapshotFlow,
  type SnapshotView,
} from './snapshot-flow.ts'

export const name = 'dsh-editor-shell-client'
export const inject = ['slots', 'sessions', 'workspaces', 'connection'] as const

type Entry = { name: string; type: 'file' | 'directory' | 'other' }
type SearchHit = { path: string; line: number; column: number; start: number; end: number; excerpt: string; version: string }
type SearchResponse = { results: SearchHit[]; scannedFiles: number; scannedBytes: number; skipped: number; truncated: boolean }
type ArchiveListResponse = { items: ArchiveView[]; invalid: number }
type RevealRequest = SearchHit & { nonce: number }
type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: RpcError | { code?: string; message?: string } }
type ShellContext = ClientContext & { connection: ConnectionHandle }

const SIDEBAR_DEFAULT = 248
const SIDEBAR_MIN = 196
const SIDEBAR_MAX = 420
const ASSISTANT_DEFAULT = 384
const conversationRenameQueue = new ConversationRenameQueue()
const ASSISTANT_MIN = 300
const ASSISTANT_MAX = 560

export async function safeRpcCall<T>(request: () => Promise<unknown>): Promise<RpcResult<T>> {
  try {
    return await request() as RpcResult<T>
  } catch (error) {
    return {
      ok: false,
      error: { code: 'internal', message: error instanceof Error ? error.message : 'request failed' },
    }
  }
}

type RequestTicket = Readonly<{ scope: string; sequence: number }>

/** Keeps late async responses from crossing session/revision boundaries. */
export class LatestRequestGate {
  private scope = ''
  private sequence = 0

  setScope(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope
    this.sequence += 1
  }

  begin(scope: string): RequestTicket {
    this.setScope(scope)
    this.sequence += 1
    return { scope, sequence: this.sequence }
  }

  isCurrent(ticket: RequestTicket): boolean {
    return ticket.scope === this.scope && ticket.sequence === this.sequence
  }
}

export type ResizablePanelSide = 'left' | 'right'
export type WorkspaceShortcutAction = 'settings' | 'toggle-sidebar' | 'toggle-assistant' | 'toggle-focus' | 'focus-assistant' | 'previous-chapter' | 'next-chapter'

type ShortcutInput = {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function workspaceShortcut(input: ShortcutInput): WorkspaceShortcutAction | null {
  const mod = input.ctrlKey || input.metaKey
  const key = input.key.toLowerCase()
  if (mod && !input.altKey && !input.shiftKey) {
    if (key === ',') return 'settings'
    if (key === 'b') return 'toggle-sidebar'
    if (key === 'j') return 'toggle-assistant'
    if (key === '\\') return 'toggle-focus'
    if (key === 'l') return 'focus-assistant'
  }
  if (!mod && input.altKey && !input.shiftKey) {
    if (input.code === 'BracketLeft' || key === '[') return 'previous-chapter'
    if (input.code === 'BracketRight' || key === ']') return 'next-chapter'
  }
  return null
}

export function shouldSubmitComposer(input: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return input.key === 'Enter' && !input.shiftKey && !input.isComposing
}

export function canSubmitComposer(input: { draft: string; connected: boolean; removed: boolean; outgoingState?: 'sending' | 'accepted' | 'failed' }): boolean {
  return Boolean(input.draft.trim()) && input.connected && !input.removed && (!input.outgoingState || input.outgoingState === 'failed')
}

const WORKSPACE_SHORTCUTS = [
  ['Ctrl+S', '保存当前文档'],
  ['Ctrl+,', '打开接口设置'],
  ['Ctrl+B', '显示或隐藏文件栏'],
  ['Ctrl+J', '显示或隐藏写作搭档'],
  ['Ctrl+\\', '进入或退出专注写作'],
  ['Ctrl+L', '打开并聚焦写作搭档'],
  ['Alt+[ / Alt+]', '上一章 / 下一章'],
  ['Tab / Esc', '接受 / 放弃补全建议'],
  ['Ctrl+Enter', '应用选段修改建议'],
  ['Enter / Shift+Enter', '发送消息 / 消息内换行'],
] as const

export function clampPanelWidth(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function resizedPanelWidth(side: ResizablePanelSide, start: number, pointerDelta: number, minimum: number, maximum: number): number {
  return clampPanelWidth(start + (side === 'left' ? pointerDelta : -pointerDelta), minimum, maximum)
}

function storedPanelWidth(key: string, fallback: number, minimum: number, maximum: number): number {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (raw === null || raw === undefined) return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? clampPanelWidth(value, minimum, maximum) : fallback
  } catch {
    return fallback
  }
}

function storedPanelOpen(key: string, fallback: boolean): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw === null || raw === undefined ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

function PanelResizer(props: {
  side: ResizablePanelSide
  value: number
  minimum: number
  maximum: number
  defaultValue: number
  label: string
  onChange(value: number): void
}) {
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null)
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    props.onChange(resizedPanelWidth(props.side, active.startValue, event.clientX - active.startX, props.minimum, props.maximum))
  }
  return e('div', {
    className: `panel-resizer ${props.side}`,
    role: 'separator',
    tabIndex: 0,
    'aria-label': props.label,
    'aria-orientation': 'vertical',
    'aria-valuemin': props.minimum,
    'aria-valuemax': props.maximum,
    'aria-valuenow': props.value,
    title: `${props.label}（可拖动或使用方向键）`,
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: props.value }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: move,
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (drag.current?.pointerId === event.pointerId) drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onLostPointerCapture: () => { drag.current = null },
    onDoubleClick: () => props.onChange(props.defaultValue),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Home') { event.preventDefault(); props.onChange(props.defaultValue); return }
      if (event.key === 'End') { event.preventDefault(); props.onChange(props.maximum); return }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      props.onChange(resizedPanelWidth(props.side, props.value, event.key === 'ArrowRight' ? 12 : -12, props.minimum, props.maximum))
    },
  }, e('span', { 'aria-hidden': 'true' }))
}

function ShortcutDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLElement | null>(null)
  const close = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { close.current?.focus() }, [])
  return e('div', { className: 'shortcut-overlay', onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const controls = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex="0"]')]
    if (!controls.length) return
    const first = controls[0]!
    const last = controls[controls.length - 1]!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  } },
    e('section', { ref: dialog, className: 'shortcut-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'shortcut-dialog-title' },
      e('header', null,
        e('div', null, e('small', null, 'WORKBENCH'), e('h2', { id: 'shortcut-dialog-title' }, '键盘快捷键')),
        e('button', { ref: close, className: 'icon-button', type: 'button', onClick: onClose, 'aria-label': '关闭快捷键' }, '×'),
      ),
      e('p', null, '也可以按 Ctrl+K，再按 Ctrl+S 打开本页。'),
      e('dl', null, WORKSPACE_SHORTCUTS.map(([keys, label]) => e('div', { key: keys }, e('dt', null, keys), e('dd', null, label)))),
    ),
  )
}

function useObservable<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void }): T {
  return useSyncExternalStore(source.subscribe.bind(source), source.getSnapshot.bind(source), source.getSnapshot.bind(source))
}

function currentSession(ctx: ShellContext): SessionFace | undefined {
  const id = ctx.sessions.list.getSnapshot().current
  return id ? ctx.sessions.binding(id)?.session : undefined
}

function rpcFailureText(result: RpcResult): string {
  if (result.ok) return ''
  return `${result.error.code ?? ''} ${result.error.message ?? ''}`
}

export function errorMessage(result: RpcResult): string {
  if (result.ok) return ''
  const blob = rpcFailureText(result)
  if (/stale|changed|version|版本/i.test(blob)) return '磁盘文件已经变化。'
  if (/directory-exists|already exists/i.test(blob)) return '同名文件或目录已经存在。'
  if (/workspace-invalid-path|invalid path/i.test(blob)) return '名称或路径不符合规则。'
  if (/read-only|permission|denied/i.test(blob)) return '当前文件无法写入，请检查目录权限。'
  if (/directory-unreadable|unreadable/i.test(blob)) return '没有读取到作品目录，请重试。'
  if (/not-found|missing/i.test(blob)) return '没有找到所需的文件。'
  return '操作没有完成，请重试。'
}

export function isStaleFailure(result: RpcResult): boolean {
  return !result.ok && /stale|changed|version|版本/i.test(`${rpcFailureText(result)} ${errorMessage(result)}`)
}

function Tree(props: {
  ctx: ShellContext
  sessionId: string
  active: string
  revision: number
  onOpen(path: string): void
  onManage(path: string): void
  onCreateChapter(directory: string): void
}) {
  const { ctx, sessionId, active, revision, onOpen, onManage, onCreateChapter } = props
  const [open, setOpen] = useState<Record<string, Entry[]>>({})
  const [note, setNote] = useState('')

  const load = async (path: string) => {
    const result = await safeRpcCall<{ entries?: Entry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: path || '.',
    }))
    if (!result.ok) { setNote(errorMessage(result)); return }
    setOpen((old) => ({ ...old, [path]: result.value.entries ?? [] }))
    setNote('')
  }

  useEffect(() => {
    setOpen({})
    void load('')
  }, [sessionId, revision])

  const rows = (path: string, level: number): ReactNode[] => (open[path] ?? [])
    .filter((item) => !item.name.startsWith('.'))
    .map((item) => {
      const child = path ? `${path}/${item.name}` : item.name
      if (item.type === 'directory') {
        return e('div', { key: child },
          e('div', { className: 'tree-directory-row' },
            e('button', {
              className: 'tree-row', type: 'button', style: { paddingLeft: 14 + level * 14 },
              'aria-expanded': child in open,
              onClick: () => child in open
                ? setOpen((old) => { const next = { ...old }; delete next[child]; return next })
                : void load(child),
            }, `${child in open ? '⌄' : '›'} ${item.name}`),
            child.startsWith('正文/') ? e('button', {
              className: 'tree-directory-add',
              type: 'button',
              title: `在 ${item.name} 中新建章节`,
              'aria-label': `在 ${item.name} 中新建章节`,
              onClick: () => onCreateChapter(child),
            }, '＋') : null,
          ),
          child in open ? rows(child, level + 1) : null,
        )
      }
      return e('div', { key: child, className: 'tree-file-row' },
        e('button', {
          className: 'tree-row tree-main',
          type: 'button',
          'aria-current': active === child ? 'page' : undefined,
          style: { paddingLeft: 28 + level * 14 },
          onClick: () => onOpen(child),
        }, item.name),
        /\.(md|txt)$/i.test(child) ? e('button', {
          className: 'tree-manage',
          type: 'button',
          title: `管理 ${item.name}`,
          'aria-label': `管理 ${item.name}`,
          onClick: () => onManage(child),
        }, '···') : null,
      )
    })

  return e('nav', { className: 'tree', 'aria-label': '稿件目录' }, rows('', 0), note ? e('p', { className: 'warning pad' }, note) : null)
}

function SearchPanel(props: {
  ctx: ShellContext
  sessionId: string
  revision: number
  navigationBlocked: boolean
  onOpen(hit: SearchHit): void
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'project' | 'manuscript'>('project')
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.revision}`
  requestGate.setScope(requestScope)

  useEffect(() => { setQuery(''); setResult(null); setNote(''); setBusy(false) }, [props.sessionId, props.revision])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = query.trim()
    if (!value) { setNote('请输入要查找的文字。'); return }
    const ticket = requestGate.begin(requestScope)
    setBusy(true); setNote('')
    const searched = await safeRpcCall<SearchResponse>(() => props.ctx.connection.rpc.call('/manuscript', 'search.text', {
      sessionId: props.sessionId,
      query: value,
      scope,
    }))
    if (!requestGate.isCurrent(ticket)) return
    setBusy(false)
    if (!searched.ok) { setResult(null); setNote(errorMessage(searched)); return }
    setResult(searched.value)
    setNote(searched.value.results.length ? '' : '没有找到匹配内容。')
  }

  return e('section', { className: 'search-panel', 'aria-label': '全文搜索' },
    e('form', { role: 'search', onSubmit: (event: FormEvent) => void submit(event) },
      e('input', {
        value: query,
        maxLength: 120,
        placeholder: '查找人物、地点或句子',
        'aria-label': '搜索作品文字',
        onChange: (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
      }),
      e('button', { type: 'submit', disabled: busy || !query.trim(), 'aria-label': '开始搜索' }, busy ? '…' : '查'),
      e('select', {
        value: scope,
        'aria-label': '搜索范围',
        onChange: (event: ChangeEvent<HTMLSelectElement>) => setScope(event.target.value === 'manuscript' ? 'manuscript' : 'project'),
      }, e('option', { value: 'project' }, '整部作品'), e('option', { value: 'manuscript' }, '仅正文')),
    ),
    result ? e('div', { className: 'search-summary', role: 'status' },
      `${result.results.length} 处 · 已查 ${result.scannedFiles} 份文件`,
      result.truncated ? e('strong', null, '结果已达安全上限') : null,
      result.skipped ? e('span', null, `跳过 ${result.skipped} 项`) : null,
    ) : null,
    props.navigationBlocked && result?.results.length ? e('p', { className: 'warning', role: 'alert' }, '请先保存当前文档，再跳转搜索结果。') : null,
    note ? e('p', { className: 'muted', role: 'status' }, note) : null,
    result?.results.length ? e('ol', { className: 'search-results' }, result.results.map((hit, index) => e('li', { key: `${hit.path}:${hit.start}:${index}` },
      e('button', { type: 'button', disabled: props.navigationBlocked, onClick: () => props.onOpen(hit) },
        e('strong', null, hit.path),
        e('span', null, `第 ${hit.line} 行 · ${hit.excerpt}`),
      ),
    ))) : null,
  )
}

type CreateRequest = { kind: DocumentKind | 'group'; directory: string }

function ConfirmDialog(props: {
  id: string
  title: string
  message: string
  confirmLabel: string
  onCancel(): void
  onConfirm(): void
}) {
  const dialog = useRef<HTMLDivElement | null>(null)
  const cancel = useRef<HTMLButtonElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    globalThis.setTimeout(() => cancel.current?.focus(), 0)
    return () => { const target = returnFocus.current; globalThis.setTimeout(() => { if (target?.isConnected) target.focus() }, 0) }
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); props.onCancel(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const buttons = [...dialog.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const first = buttons[0]; const last = buttons.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return e('div', { className: 'file-dialog-overlay' },
    e('div', { ref: dialog, className: 'file-dialog confirm-dialog', role: 'alertdialog', 'aria-modal': true, 'aria-labelledby': `${props.id}-title`, 'aria-describedby': `${props.id}-message`, onKeyDown },
      e('header', null, e('h2', { id: `${props.id}-title` }, props.title)),
      e('p', { id: `${props.id}-message` }, props.message),
      e('footer', null,
        e('button', { ref: cancel, type: 'button', onClick: props.onCancel }, '取消'),
        e('button', { className: 'danger-action', type: 'button', onClick: props.onConfirm }, props.confirmLabel),
      ),
    ),
  )
}

function TextPromptDialog(props: {
  id: string
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  onCancel(): void
  onConfirm(value: string): void
}) {
  const [value, setValue] = useState(props.initialValue)
  const dialog = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    globalThis.setTimeout(() => { input.current?.focus(); input.current?.select() }, 0)
    return () => { const target = returnFocus.current; globalThis.setTimeout(() => { if (target?.isConnected) target.focus() }, 0) }
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); props.onCancel(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const controls = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
    const first = controls[0]; const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return e('div', { className: 'file-dialog-overlay' },
    e('div', { ref: dialog, className: 'file-dialog prompt-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': `${props.id}-title`, onKeyDown },
      e('header', null,
        e('h2', { id: `${props.id}-title` }, props.title),
        e('button', { className: 'icon-button', type: 'button', 'aria-label': '关闭', onClick: props.onCancel }, '×'),
      ),
      e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (value.trim()) props.onConfirm(value.trim()) } },
        e('label', null, props.label, e('input', { ref: input, value, maxLength: 80, onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value) })),
        e('footer', null,
          e('button', { type: 'button', onClick: props.onCancel }, '取消'),
          e('button', { className: 'primary-action', type: 'submit', disabled: !value.trim() }, props.confirmLabel),
        ),
      ),
    ),
  )
}

function CreateDocumentDialog(props: {
  request: CreateRequest
  busy: boolean
  note: string
  onClose(): void
  onCreate(title: string): void
}) {
  const { request } = props
  const [title, setTitle] = useState('')
  const dialog = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const label = request.kind === 'group'
    ? '卷或部名称'
    : request.kind === 'chapter'
      ? '章节标题'
      : request.kind === 'outline'
        ? '大纲名称'
        : request.kind === 'character'
          ? '人物名称'
          : '设定名称'
  const heading = request.kind === 'group' ? '新建卷/部' : request.kind === 'chapter' ? '新建章节' : `新建${label.replace('名称', '')}`
  useEffect(() => { setTitle(''); globalThis.setTimeout(() => input.current?.focus(), 0) }, [request.kind, request.directory])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) { event.preventDefault(); props.onClose(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
    if (!focusable.length) return
    const first = focusable[0]!
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return e('div', { className: 'file-dialog-overlay' },
    e('div', { ref: dialog, className: 'file-dialog create-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'create-dialog-title', onKeyDown },
      e('header', null,
        e('div', null,
          e('h2', { id: 'create-dialog-title' }, heading),
          e('small', null, request.kind === 'group' ? '建立真实目录；现有章节不会移动。' : `保存到 ${request.directory}`),
        ),
        e('button', { className: 'icon-button', type: 'button', disabled: props.busy, 'aria-label': '关闭', onClick: props.onClose }, '×'),
      ),
      e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (title.trim()) props.onCreate(title.trim()) } },
        e('label', null, label,
          e('input', {
            ref: input,
            value: title,
            maxLength: 80,
            placeholder: request.kind === 'group' ? '例如：第一卷' : request.kind === 'chapter' ? '例如：第一章 风起' : '',
            onChange: (event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value),
          }),
        ),
        props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
        e('footer', null,
          e('button', { type: 'button', disabled: props.busy, onClick: props.onClose }, '取消'),
          e('button', { className: 'primary-action', type: 'submit', disabled: props.busy || !title.trim() }, props.busy ? '创建中…' : '创建'),
        ),
      ),
    ),
  )
}

function FileManageDialog(props: {
  path: string
  busy: boolean
  note: string
  moveDirectories: string[] | null
  onClose(): void
  onRename(name: string): void
  onMove(directory: string): void
  onArchive(): void
}) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'move' | 'archive'>('menu')
  const [name, setName] = useState(() => documentName(props.path))
  const [targetDirectory, setTargetDirectory] = useState('')
  const dialog = useRef<HTMLDivElement | null>(null)
  const first = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { setMode('menu'); setName(documentName(props.path)); globalThis.setTimeout(() => first.current?.focus(), 0) }, [props.path])
  useEffect(() => {
    setTargetDirectory((current) => props.moveDirectories?.includes(current) ? current : (props.moveDirectories?.[0] ?? ''))
  }, [props.moveDirectories])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) { event.preventDefault(); props.onClose(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
    if (!focusable.length) return
    const firstItem = focusable[0]!
    const lastItem = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus() }
    else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus() }
  }

  return e('div', { className: 'file-dialog-overlay' },
    e('div', {
      ref: dialog,
      className: 'file-dialog',
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'file-dialog-title',
      onKeyDown,
    },
    e('header', null,
      e('div', null,
        e('small', null, '文档管理'),
        e('h2', { id: 'file-dialog-title' }, documentName(props.path)),
        e('code', null, props.path),
      ),
      e('button', { ref: first, className: 'icon-button', type: 'button', disabled: props.busy, onClick: props.onClose, 'aria-label': '关闭' }, '×'),
    ),
    mode === 'menu' ? e('div', { className: 'file-dialog-actions' },
      props.path.startsWith('正文/') ? e('button', { type: 'button', disabled: props.busy || !props.moveDirectories?.length, onClick: () => setMode('move') },
        e('strong', null, '移动到卷/部'),
        e('span', null, props.moveDirectories === null ? '正在读取可用位置…' : props.moveDirectories.length ? '保留文件名，把章节整理到其他正文目录。' : '没有其他可用位置；可以先新建卷/部。')) : null,
      e('button', { type: 'button', disabled: props.busy, onClick: () => setMode('rename') },
        e('strong', null, '重命名'), e('span', null, '保留文件类型，只修改当前文档名称。')),
      e('button', { type: 'button', disabled: props.busy, onClick: () => setMode('archive') },
        e('strong', null, '归档'), e('span', null, '从文件树移出，以后可以恢复，不会永久删除。')),
    ) : null,
    mode === 'rename' ? e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); props.onRename(name) } },
      e('label', null, e('span', null, '新名称'), e('input', { value: name, maxLength: 120, autoFocus: true, onChange: (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value) })),
      e('p', null, '文件夹和 .md/.txt 类型保持不变。'),
      e('footer', null,
        e('button', { type: 'button', disabled: props.busy, onClick: () => setMode('menu') }, '返回'),
        e('button', { className: 'primary-action', type: 'submit', disabled: props.busy || !name.trim() }, props.busy ? '处理中…' : '保存新名称'),
      ),
    ) : null,
    mode === 'move' ? e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (targetDirectory) props.onMove(targetDirectory) } },
      e('label', null, e('span', null, '目标卷/部'), e('select', {
        value: targetDirectory,
        autoFocus: true,
        'aria-label': '目标卷或部',
        onChange: (event: ChangeEvent<HTMLSelectElement>) => setTargetDirectory(event.target.value),
      }, props.moveDirectories?.map((directory) => e('option', { key: directory, value: directory }, directory === '正文' ? '正文（根目录）' : directory.slice('正文/'.length))))),
      targetDirectory ? e('p', null, `移动后：${targetDirectory}/${props.path.split('/').at(-1)}`) : null,
      e('p', null, '不会覆盖同名文件；移动前会再次核对当前磁盘版本。'),
      e('footer', null,
        e('button', { type: 'button', disabled: props.busy, onClick: () => setMode('menu') }, '返回'),
        e('button', { className: 'primary-action', type: 'submit', disabled: props.busy || !targetDirectory }, props.busy ? '移动中…' : '确认移动'),
      ),
    ) : null,
    mode === 'archive' ? e('div', { className: 'archive-confirm' },
      e('p', null, '归档后，文档会从当前文件树消失，但内容会保留在本地作品中。'),
      e('strong', null, '这不是永久删除。'),
      e('footer', null,
        e('button', { type: 'button', disabled: props.busy, onClick: () => setMode('menu') }, '返回'),
        e('button', { className: 'danger-action', type: 'button', disabled: props.busy, onClick: props.onArchive }, props.busy ? '归档中…' : '确认归档'),
      ),
    ) : null,
    props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
    ),
  )
}

type ManagedWorkspace = { workspaceId: WorkspaceId; title: string; path: string; removable: boolean }

function WorkspaceManageDialog(props: {
  workspace: ManagedWorkspace
  busy: boolean
  note: string
  onClose(): void
  onRename(title: string): void
  onRemove(): void
}) {
  const [title, setTitle] = useState(props.workspace.title)
  const [removing, setRemoving] = useState(false)
  const dialog = useRef<HTMLDivElement | null>(null)
  const close = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { close.current?.focus() }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) { event.preventDefault(); props.onClose(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const controls = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
    if (!controls.length) return
    const first = controls[0]!
    const last = controls.at(-1)!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return e('div', { className: 'file-dialog-overlay' },
    e('div', { ref: dialog, className: 'file-dialog workspace-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'workspace-dialog-title', onKeyDown },
      e('header', null,
        e('div', null,
          e('small', null, '作品管理'),
          e('h2', { id: 'workspace-dialog-title' }, props.workspace.title),
          e('code', null, props.workspace.path),
        ),
        e('button', { ref: close, className: 'icon-button', type: 'button', disabled: props.busy, onClick: props.onClose, 'aria-label': '关闭作品管理' }, '×'),
      ),
      removing ? e('div', { className: 'archive-confirm' },
        e('p', null, '这里只移除首页的作品入口。作品文件夹、正文、会话和日志都不会删除。'),
        e('strong', null, '以后仍可用“打开作品”重新加入。'),
        e('footer', null,
          e('button', { type: 'button', disabled: props.busy, onClick: () => setRemoving(false) }, '返回'),
          e('button', { className: 'danger-action', type: 'button', disabled: props.busy, onClick: props.onRemove }, props.busy ? '移除中…' : '确认从最近移除'),
        ),
      ) : e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); props.onRename(title) } },
        e('label', null, e('span', null, '作品显示名'), e('input', { value: title, maxLength: 120, autoFocus: true, onChange: (event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value) })),
        e('p', null, '只修改应用内显示名，不移动或重命名作品文件夹。'),
        e('footer', null,
          props.workspace.removable ? e('button', { className: 'danger-link', type: 'button', disabled: props.busy, onClick: () => setRemoving(true) }, '从最近移除') : null,
          e('button', { type: 'button', disabled: props.busy, onClick: props.onClose }, '取消'),
          e('button', { className: 'primary-action', type: 'submit', disabled: props.busy || !title.trim() || title.trim() === props.workspace.title }, props.busy ? '保存中…' : '保存显示名'),
        ),
      ),
      props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
    ),
  )
}

function Editor(props: {
  ctx: ShellContext
  session: SessionFace
  path: string
  files: string[]
  onOpen(path: string): void
  create(): void
  externalRevision: number
  onDirtyChange(dirty: boolean): void
  reveal: RevealRequest | null
  completionPreference: CompletionPreference
}) {
  const { ctx, session, path, files, onOpen, create, externalRevision, onDirtyChange, reveal, completionPreference } = props
  const [doc, setDoc] = useState<EditorDocument | null>(null)
  const [text, setTextState] = useState('')
  const [ghost, setGhost] = useState('')
  const [ghostAt, setGhostAt] = useState(0)
  const [loadingFim, setLoadingFim] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [note, setNote] = useState('')
  const [revision, setRevision] = useState(0)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [proposal, setProposal] = useState<{ ticket: SelectionTicket; text: string } | null>(null)
  const [patching, setPatching] = useState(false)
  const [reloadConfirm, setReloadConfirm] = useState(false)
  const [userEditRevision, setUserEditRevision] = useState(0)
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const fimAbort = useRef<AbortController | null>(null)
  const patchAbort = useRef<AbortController | null>(null)
  const draftQueue = useRef<DraftSyncQueue | null>(null)
  const saving = useRef(false)
  const lastAutomaticCompletion = useRef(0)
  if (!draftQueue.current) {
    draftQueue.current = new DraftSyncQueue((endpoint, payload) => ctx.connection.rpc.call('/manuscript', endpoint, payload))
  }
  const docRef = useRef<EditorDocument | null>(null)
  const textRef = useRef('')
  const revisionRef = useRef(0)
  docRef.current = doc
  textRef.current = text
  revisionRef.current = revision
  const state = saveState(doc, text, conflict)

  useEffect(() => {
    onDirtyChange(Boolean(doc && isDirty(doc, text)) || conflict)
    return () => onDirtyChange(false)
  }, [doc, text, conflict, onDirtyChange])

  const setText = (value: string) => {
    if (loadingFim || patching) setNote('正文已变化，已停止旧建议。')
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setLoadingFim(false)
    setPatching(false)
    setTextState(value)
    setRevision((old) => old + 1)
    setGhost('')
    setProposal(null)
  }

  useEffect(() => {
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setLoadingFim(false)
    setPatching(false)
    setProposal(null)
    setGhost('')
    setConflict(false)
    setReloadConfirm(false)
    setUserEditRevision(0)
    lastAutomaticCompletion.current = 0
    if (!path) { setDoc(null); setTextState(''); setNote(''); return }
    let live = true
    void Promise.all([
      safeRpcCall<{ text: string; version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: session.sessionId, path })),
      safeRpcCall<{ draft: EditorDraft | null }>(() => ctx.connection.rpc.call('/manuscript', 'draft.get', { sessionId: session.sessionId, path })),
    ]).then(([result, draftResult]) => {
      if (!live) return
      if (!result.ok) { setDoc(null); setNote(errorMessage(result)); return }
      const disk: EditorDocument = {
        sessionId: session.sessionId,
        path,
        text: result.value.text,
        version: result.value.version,
      }
      const draft = draftResult.ok ? draftResult.value.draft : null
      setDoc(disk)
      setRevision((old) => old + 1)
      if (draft) {
        setTextState(draft.text)
        const stale = draft.baseVersion !== disk.version
        setConflict(stale)
        setNote(stale ? '磁盘版本已变化；本地草稿已保留，请另存或手动合并。' : '已恢复未保存草稿')
      } else {
        setTextState(disk.text)
        setNote('')
      }
    })
    return () => { live = false; fimAbort.current?.abort(); patchAbort.current?.abort() }
  }, [path, session.sessionId, externalRevision])

  useEffect(() => {
    if (!doc || !reveal || reveal.path !== doc.path || !ta.current) return
    if (reveal.version !== doc.version) {
      setNote('搜索后文件已变化，已打开文档但未强制定位。')
      return
    }
    const start = Math.max(0, Math.min(text.length, reveal.start))
    const end = Math.max(start, Math.min(text.length, reveal.end))
    globalThis.setTimeout(() => {
      if (!ta.current) return
      ta.current.focus()
      ta.current.setSelectionRange(start, end)
      setSelection({ start, end })
    }, 0)
  }, [doc?.path, doc?.version, reveal?.nonce])

  useEffect(() => {
    if (!doc) return
    const timer = globalThis.setTimeout(() => {
      const endpoint = text === doc.text ? 'draft.delete' : 'draft.put'
      const payload = endpoint === 'draft.delete'
        ? { sessionId: doc.sessionId, path: doc.path }
        : { sessionId: doc.sessionId, path: doc.path, text, baseText: doc.text, baseVersion: doc.version }
      void draftQueue.current!.run(endpoint, payload).then((raw: unknown) => {
        const result = raw as RpcResult
        if (!result.ok) setNote(`草稿同步失败：${errorMessage(result)}`)
      })
    }, 250)
    return () => globalThis.clearTimeout(timer)
  }, [ctx.connection.rpc, doc, text])

  const save = async () => {
    if (!doc || saving.current) return
    const savingDoc = doc
    const savingText = text
    saving.current = true
    setNote('正在保存…')
    const result = await safeRpcCall<{ version?: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.write', {
      sessionId: savingDoc.sessionId,
      path: savingDoc.path,
      text: savingText,
      version: savingDoc.version,
    }))
    if (!result.ok) {
      const stale = isStaleFailure(result)
      setConflict(stale)
      setNote(stale ? '磁盘文件已变化；本地草稿未丢失。' : errorMessage(result))
      saving.current = false
      return
    }
    const saved = { ...savingDoc, text: savingText, version: result.value.version ?? savingDoc.version }
    setDoc(saved)
    const deleted = await draftQueue.current!.run('draft.delete', { sessionId: savingDoc.sessionId, path: savingDoc.path }) as RpcResult
    if (!deleted.ok) {
      setNote(`文件已保存，但草稿清理失败：${errorMessage(deleted)}`)
      saving.current = false
      return
    }
    setConflict(false)
    setNote('已保存')
    saving.current = false
  }

  useEffect(() => {
    if (!doc || text === doc.text || conflict) return
    const timer = globalThis.setTimeout(() => void save(), 800)
    return () => globalThis.clearTimeout(timer)
  }, [doc, text, conflict])

  useEffect(() => {
    if (!doc || text === doc.text) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    globalThis.addEventListener('beforeunload', warn)
    return () => globalThis.removeEventListener('beforeunload', warn)
  }, [doc, text])

  const reloadDisk = async () => {
    if (!doc) return
    setReloadConfirm(false)
    const result = await ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: doc.sessionId, path: doc.path }) as RpcResult<{ text: string; version: string }>
    if (!result.ok) { setNote(errorMessage(result)); return }
    const next = { ...doc, text: result.value.text, version: result.value.version }
    setDoc(next); setTextState(next.text); setConflict(false); setNote('已重新载入磁盘版本')
    await draftQueue.current!.run('draft.delete', { sessionId: doc.sessionId, path: doc.path })
    globalThis.setTimeout(() => ta.current?.focus(), 0)
  }

  const saveConflictCopy = async () => {
    if (!doc) return
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const copy = doc.path.replace(/\.md$/i, `.冲突-${stamp}.md`)
    const created = await ctx.connection.rpc.call('/manuscript', 'file.create', {
      sessionId: doc.sessionId, path: copy, text,
    }) as RpcResult
    if (!created.ok) { setNote(errorMessage(created)); return }
    setNote(`草稿已另存为 ${copy}`)
    const disk = await ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: doc.sessionId, path: doc.path }) as RpcResult<{ text: string; version: string }>
    if (!disk.ok) return
    setDoc({ ...doc, ...disk.value }); setTextState(disk.value.text); setConflict(false)
    await draftQueue.current!.run('draft.delete', { sessionId: doc.sessionId, path: doc.path })
  }

  const complete = async () => {
    if (!doc || !ta.current) return
    // A manual request also consumes the pending pause trigger for this edit.
    lastAutomaticCompletion.current = Math.max(lastAutomaticCompletion.current, userEditRevision)
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setProposal(null)
    const requestDoc = doc
    const requestRevision = revision
    const pos = ta.current.selectionStart
    const controller = new AbortController()
    fimAbort.current = controller
    setLoadingFim(true)
    setNote('正在生成补全…')
    const result = await safeRpcCall<{ text?: string }>(() => ctx.connection.rpc.call('/manuscript', 'fim.complete', {
      sessionId: doc.sessionId,
      path: doc.path,
      prefix: text.slice(0, pos),
      suffix: text.slice(pos),
    }, controller.signal))
    if (fimAbort.current === controller) {
      fimAbort.current = null
      setLoadingFim(false)
    }
    if (controller.signal.aborted) return
    if (docRef.current?.sessionId !== requestDoc.sessionId || docRef.current.path !== requestDoc.path || revisionRef.current !== requestRevision) return
    if (!result.ok) { setNote(errorMessage(result)); return }
    const suggestion = String(result.value.text ?? '')
    if (!suggestion.trim()) { setNote('模型没有返回可用补全。'); return }
    setGhost(suggestion)
    setGhostAt(pos)
    setNote('补全已就绪；确认后才会写入正文。')
  }

  useEffect(() => {
    if (!doc || !ta.current) return
    const cursor = ta.current.selectionStart
    if (!automaticCompletionReady({
      preference: completionPreference,
      manuscript: /^正文\/.+\.(?:md|txt)$/i.test(doc.path),
      userEditRevision,
      requestedRevision: lastAutomaticCompletion.current,
      focused: document.activeElement === ta.current,
      collapsedSelection: ta.current.selectionStart === ta.current.selectionEnd,
      prefix: text.slice(0, cursor),
      busy: loadingFim || patching,
      blocked: conflict || Boolean(ghost) || Boolean(proposal),
    })) return
    const timer = globalThis.setTimeout(() => {
      if (!ta.current) return
      const currentCursor = ta.current.selectionStart
      if (!automaticCompletionReady({
        preference: completionPreference,
        manuscript: /^正文\/.+\.(?:md|txt)$/i.test(doc.path),
        userEditRevision,
        requestedRevision: lastAutomaticCompletion.current,
        focused: document.activeElement === ta.current,
        collapsedSelection: ta.current.selectionStart === ta.current.selectionEnd,
        prefix: textRef.current.slice(0, currentCursor),
        busy: loadingFim || patching,
        blocked: conflict || Boolean(ghost) || Boolean(proposal),
      })) return
      lastAutomaticCompletion.current = userEditRevision
      void complete()
    }, 1_500)
    return () => globalThis.clearTimeout(timer)
  }, [completionPreference, conflict, doc?.path, doc?.sessionId, ghost, loadingFim, patching, proposal, selection.end, selection.start, text, userEditRevision])

  const requestPatch = async () => {
    if (!doc) return
    const ticket = selectionTicket(doc, text, revision, selection.start, selection.end)
    if (!ticket) { setNote('请先选择需要改写的文字。'); return }
    fimAbort.current?.abort()
    setGhost('')
    patchAbort.current?.abort()
    const controller = new AbortController()
    patchAbort.current = controller
    setPatching(true)
    setNote('正在生成选段修改…')
    const result = await safeRpcCall<{ text?: string }>(() => ctx.connection.rpc.call('/manuscript', 'patch.complete', {
      sessionId: ticket.sessionId,
      path: ticket.path,
      selectedText: ticket.selectedText,
      before: text.slice(Math.max(0, ticket.start - 4000), ticket.start),
      after: text.slice(ticket.end, ticket.end + 4000),
    }, controller.signal))
    if (patchAbort.current === controller) {
      patchAbort.current = null
      setPatching(false)
    }
    if (controller.signal.aborted || !isSelectionCurrent(ticket, docRef.current, textRef.current, revisionRef.current)) return
    if (!result.ok) { setNote(errorMessage(result)); return }
    const replacement = String(result.value.text ?? '').trim()
    if (!replacement) { setNote('模型没有返回可用改写。'); return }
    setProposal({ ticket, text: replacement })
    setNote('修改建议已就绪；确认后才会写入正文。')
  }

  const acceptGhost = () => {
    if (!canApplyGhost(state, ghost)) return
    const cursor = ghostAt + ghost.length
    setText(applyGhost(text, ghostAt, ghost))
    setSelection({ start: cursor, end: cursor })
    setGhost('')
    setNote('补全已加入草稿，正在自动保存。')
    globalThis.setTimeout(() => { ta.current?.focus(); ta.current?.setSelectionRange(cursor, cursor) }, 0)
  }

  const acceptPatch = () => {
    if (!proposal || !isSelectionCurrent(proposal.ticket, doc, text, revision)) {
      setProposal(null)
      setNote('选区已经变化，已丢弃过期建议。')
      return
    }
    const cursor = proposal.ticket.start + proposal.text.length
    setText(applySelectionPatch(text, proposal.ticket, proposal.text))
    setSelection({ start: cursor, end: cursor })
    setProposal(null)
    setNote('修改已加入草稿，正在自动保存。')
    globalThis.setTimeout(() => { ta.current?.focus(); ta.current?.setSelectionRange(cursor, cursor) }, 0)
  }

  if (!path) {
    return e('section', { className: 'empty-paper', 'aria-label': '空白章' },
      e('span', { className: 'empty-paper-mark', 'aria-hidden': 'true' }, '〆'),
      e('h1', null, '空白页'),
      e('button', { type: 'button', onClick: create }, '新建一章'),
    )
  }

  const index = files.indexOf(path)
  const navigationBlocked = state === 'draft' || state === 'conflict'
  const editableWorldbook = Boolean(doc && /^世界书\/.+\.md$/i.test(doc.path)
    && doc.path.toLowerCase() !== '世界书/设定总汇.md'.toLowerCase())
  return e('section', { className: 'editor', 'aria-label': '正文编辑区' },
    e('header', { className: 'editor-header' },
      e('span', null, doc?.path ?? path),
      e('nav', { className: 'chapter-navigation', 'aria-label': '章节导航' },
        e('button', { type: 'button', onClick: () => index > 0 && onOpen(files[index - 1]!), disabled: navigationBlocked || index <= 0, title: navigationBlocked ? '请先保存' : '上一章' }, '‹'),
        e('span', null, index >= 0 ? `${index + 1} / ${files.length}` : `— / ${files.length}`),
        e('button', { type: 'button', onClick: () => index >= 0 && index < files.length - 1 && onOpen(files[index + 1]!), disabled: navigationBlocked || index < 0 || index >= files.length - 1, title: navigationBlocked ? '请先保存' : '下一章' }, '›'),
      ),
      e('span', null, `${text.replace(/\s/g, '').length} 字 · ${state === 'draft' ? '草稿未保存' : state === 'conflict' ? '版本冲突' : state === 'saved' ? '已保存' : '读取中'}`),
    ),
    editableWorldbook && doc ? e(WorldbookSettings, {
      key: `${doc.path}:${doc.version}`,
      path: doc.path,
      text,
      onChange: setText,
      onNote: setNote,
    }) : null,
    e('textarea', {
      ref: ta,
      value: text,
      className: 'paper-input',
      'aria-label': '正文',
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
        setText(event.target.value)
        setUserEditRevision((old) => old + 1)
      },
      onSelect: (event: ChangeEvent<HTMLTextAreaElement>) => setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd }),
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && proposal) { event.preventDefault(); acceptPatch() }
        if (event.key === 'Tab' && ghost) { event.preventDefault(); acceptGhost() }
        if (event.key === 'Escape' && (loadingFim || patching || ghost || proposal)) {
          event.preventDefault()
          fimAbort.current?.abort()
          patchAbort.current?.abort()
          setLoadingFim(false)
          setPatching(false)
          setGhost('')
          setProposal(null)
          setNote('已放弃当前建议。')
        }
      },
    }),
    ghost ? e('section', { className: 'ghost ghost-suggestion', 'aria-label': '补全建议', 'aria-live': 'polite' },
      e('strong', null, '补全建议'),
      e('p', null, ghost),
      e('div', null,
        e('button', { type: 'button', onClick: acceptGhost }, '接受补全'),
        e('button', { type: 'button', onClick: () => { setGhost(''); setNote('已放弃补全。'); ta.current?.focus() } }, '放弃'),
      ),
    ) : null,
    proposal ? e('section', { className: 'proposal', 'aria-label': '选段修改建议', 'aria-live': 'polite' },
      e('strong', null, '选段修改建议'),
      e('div', { className: 'selection-diff' },
        e('section', null, e('small', null, '原文'), e('p', null, proposal.ticket.selectedText)),
        e('section', null, e('small', null, '修改后'), e('p', null, proposal.text)),
      ),
      e('div', { className: 'proposal-actions' },
        e('button', { type: 'button', onClick: acceptPatch }, '应用修改'),
        e('button', { type: 'button', onClick: () => { setProposal(null); setNote('已放弃修改建议。'); ta.current?.focus() } }, '放弃'),
      ),
    ) : null,
    e('footer', { className: 'editor-tools' },
      e('button', { type: 'button', onClick: () => void save(), disabled: !doc || !isDirty(doc, text) || conflict }, '保存'),
      e('button', {
        type: 'button',
        disabled: !doc || conflict || patching,
        onClick: () => {
          if (!loadingFim) { void complete(); return }
          fimAbort.current?.abort()
          setLoadingFim(false)
          setNote('已停止补全。')
        },
      }, loadingFim ? '停止补全' : '补全'),
      e('button', {
        type: 'button',
        disabled: !doc || conflict || loadingFim || (!patching && selection.start === selection.end),
        onClick: () => {
          if (!patching) { void requestPatch(); return }
          patchAbort.current?.abort()
          setPatching(false)
          setNote('已停止改写。')
        },
      }, patching ? '停止改写' : '修改选段'),
      conflict ? e('button', { type: 'button', onClick: () => setReloadConfirm(true) }, '重新载入磁盘版本') : null,
      conflict ? e('button', { type: 'button', onClick: () => void saveConflictCopy() }, '另存冲突副本') : null,
      note ? e('span', { role: conflict ? 'alert' : 'status' }, note) : null,
    ),
    reloadConfirm ? e(ConfirmDialog, {
      id: 'reload-disk-confirm',
      title: '放弃本地草稿？',
      message: '将重新载入磁盘版本；当前未保存内容不会被写入。',
      confirmLabel: '放弃并重新载入',
      onCancel: () => setReloadConfirm(false),
      onConfirm: () => void reloadDisk(),
    }) : null,
  )
}

function ModelIndicator({ ctx, session, onConfigure }: { ctx: ShellContext; session: SessionFace; onConfigure(): void }) {
  const [models, setModels] = useState<SessionModels | null>(null)
  const [note, setNote] = useState('')
  const refresh = async () => {
    const result = await readModels(ctx.connection, session.sessionId)
    if (!result.ok) { setNote('接口不可用'); return }
    setModels(result.value); setNote('')
  }
  useEffect(() => { setModels(null); void refresh() }, [session.sessionId])
  const current = models?.groups
    .flatMap((group) => group.models.map((model) => ({ provider: group.id, providerName: group.name, model })))
    .find((item) => item.provider === models.current.provider && item.model.id === models.current.model)
  if (!models || models.groups.length === 0) {
    return e('div', { className: 'compact-control model-empty' },
      e('span', null, note || (models ? '没有可用模型' : '读取中…')),
      e('button', { type: 'button', onClick: () => void refresh() }, '重试'),
      e('button', { type: 'button', onClick: onConfigure }, '设置接口'),
    )
  }
  return e('div', { className: 'compact-control' },
    e('span', { className: 'model-indicator', title: '本次对话使用的模型' }, current ? `${current.providerName} · ${current.model.name}` : models.current.model),
    e('button', { className: 'icon-button', type: 'button', onClick: onConfigure, 'aria-label': '设置接口', title: '接口设置' }, '⌁'),
  )
}

function NewConversationPicker(props: {
  ctx: ShellContext
  session: SessionFace
  workspaceId?: WorkspaceId
  canStart(): Promise<boolean>
  onOpen(sessionId: SessionId): void
  onClose(): void
  onConfigure(): void
}) {
  const { ctx, session, workspaceId, canStart, onOpen, onClose, onConfigure } = props
  const [models, setModels] = useState<SessionModels | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    void readModels(ctx.connection, session.sessionId).then((result) => {
      if (!live) return
      if (!result.ok) { setNote('模型不可用'); return }
      const options = result.value.groups.flatMap((group) => group.models.map((model) => `${group.id}\0${model.id}`))
      const currentValue = `${result.value.current.provider}\0${result.value.current.model}`
      setModels(result.value)
      setValue(options.includes(currentValue) ? currentValue : (options[0] ?? ''))
      setNote('')
    }).catch(() => { if (live) setNote('模型不可用') })
    return () => { live = false }
  }, [ctx.connection, session.sessionId])

  const start = async (event: FormEvent) => {
    event.preventDefault()
    const [provider, model] = value.split('\0')
    if (!workspaceId || !provider || !model) return
    setBusy(true); setNote('')
    if (!(await canStart())) { setBusy(false); return }
    try {
      const sessionId = await ctx.workspaces.connectWorkspace(workspaceId)
      const selected = await selectModel(ctx.connection, sessionId, provider, model)
      if (!selected.ok) throw new Error(selected.error.message)
      onOpen(sessionId)
      onClose()
    } catch {
      setNote('新对话未建立')
    } finally {
      setBusy(false)
    }
  }

  return e('form', { className: 'conversation-setup', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'new-conversation-title', onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => { if (event.key === 'Escape') onClose() }, onSubmit: (event: FormEvent) => void start(event) },
    e('header', null,
      e('strong', { id: 'new-conversation-title' }, '新对话'),
      e('button', { className: 'icon-button', type: 'button', onClick: onClose, 'aria-label': '关闭' }, '×'),
    ),
    models && value ? e('label', null,
      e('span', { className: 'sr-only' }, '选择模型'),
      e('select', { value, autoFocus: true, 'aria-label': '选择模型', onChange: (event: ChangeEvent<HTMLSelectElement>) => setValue(event.target.value) },
        models.groups.flatMap((group) => group.models.map((model) => e('option', {
          key: `${group.id}/${model.id}`,
          value: `${group.id}\0${model.id}`,
        }, `${group.name} · ${model.name}`))),
      ),
    ) : e('button', { type: 'button', disabled: !note, onClick: onConfigure }, note || '读取中'),
    note && models ? e('small', { className: 'warning', role: 'alert' }, note) : null,
    e('footer', null,
      e('button', { type: 'button', onClick: onClose, disabled: busy }, '取消'),
      e('button', { className: 'primary-action', type: 'submit', disabled: busy || !workspaceId || !value }, busy ? '创建中' : '开始'),
    ),
  )
}

function PendingCard({ item }: { item: PendingInteraction }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  if (item.kind === 'approval') {
    const decide = (outcome: 'allowed-once' | 'rejected') => {
      setBusy(true)
      void answerApproval(item, outcome).then((receipt) => {
        if (!receipt.accepted) setNote('这项操作状态已变化，请重新发起。')
      }).catch(() => setNote('提交没有完成，请重试。')).finally(() => setBusy(false))
    }
    return e('article', { className: 'pending-card', 'aria-label': '工具审批' },
      e('strong', null, '需要授权'),
      e('p', null, '允许 Agent 执行这一步？'),
      e('div', null,
        e('button', { type: 'button', disabled: busy, onClick: () => decide('allowed-once') }, '允许一次'),
        e('button', { type: 'button', disabled: busy, onClick: () => decide('rejected') }, '拒绝'),
      ),
      note ? e('small', { className: 'warning' }, note) : null,
    )
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const encoded: QuestionAnswerItem[] = item.payload.questions.map((question) => {
      const value = answers[question.id]?.trim() ?? ''
      const labels = question.options?.map((option) => option.label) ?? []
      return labels.includes(value)
        ? { id: question.id, selected: [value] }
        : { id: question.id, selected: [], ...(value ? { custom: value } : {}) }
    })
    if (encoded.some((answer) => answer.selected.length === 0 && !answer.custom)) { setNote('请回答全部问题。'); return }
    setBusy(true)
    void answerQuestions(item, encoded).then((receipt) => {
      if (!receipt.accepted) setNote('这些问题的状态已变化，请重新回答。')
    }).catch(() => setNote('提交没有完成，请重试。')).finally(() => setBusy(false))
  }
  return e('form', { className: 'pending-card', 'aria-label': '回答问题', onSubmit: submit },
    item.payload.questions.map((question) => e('fieldset', { key: question.id },
      e('legend', null, question.header ?? '写作助手需要你的回答'),
      e('p', null, question.question),
      question.detail ? e('small', null, question.detail) : null,
      e('input', {
        value: answers[question.id] ?? '',
        list: `question-${item.key}-${question.id}`,
        'aria-label': question.question,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setAnswers((old) => ({ ...old, [question.id]: event.target.value })),
      }),
      question.options ? e('datalist', { id: `question-${item.key}-${question.id}` }, question.options.map((option) => e('option', { key: option.label, value: option.label }, option.description))) : null,
    )),
    e('button', { type: 'submit', disabled: busy }, busy ? '提交中…' : '提交全部回答'),
    note ? e('small', { className: 'warning' }, note) : null,
  )
}

function ProposalCard(props: { ctx: ShellContext; sessionId: string; proposal: ProposalMarker; onApplied(path: string): void }) {
  const [prepared, setPrepared] = useState<{ version?: string; before?: string; after?: string; text?: string } | null>(null)
  const [state, setState] = useState<'checking' | 'ready' | 'applying' | 'applied' | 'ignored' | 'expired'>('checking')
  const [note, setNote] = useState('正在核对文件…')

  useEffect(() => {
    let live = true
    setState('checking'); setNote('正在核对文件…')
    void props.ctx.connection.rpc.call('/manuscript', 'proposal.prepare', {
      sessionId: props.sessionId,
      ...props.proposal,
    }).then((raw: unknown) => {
      if (!live) return
      const result = raw as RpcResult<{ version?: string; before?: string; after?: string; text?: string }>
      if (!result.ok) { setState('expired'); setNote('文件已经变化，这项建议需要重新生成。'); return }
      setPrepared(result.value); setState('ready'); setNote('可以安全应用')
    })
    return () => { live = false }
  }, [props.sessionId, props.proposal.path, props.proposal.summary, props.proposal.oldText, props.proposal.newText, props.proposal.text])

  const apply = async () => {
    if (!prepared) return
    setState('applying'); setNote('正在应用…')
    const result = await props.ctx.connection.rpc.call('/manuscript', 'proposal.apply', {
      sessionId: props.sessionId,
      ...props.proposal,
      expectedVersion: prepared.version ?? '',
    }) as RpcResult<{ path: string }>
    if (!result.ok) { setState('expired'); setNote('文件已经变化，未写入任何内容。请让写作助手重新生成建议。'); return }
    setState('applied'); setNote('已应用到作品')
    props.onApplied(result.value.path)
  }

  return e('article', { className: `proposal-card ${state}`, 'aria-label': '文件修改建议' },
    e('header', null, e('strong', null, props.proposal.summary), e('code', null, props.proposal.path)),
    props.proposal.kind === 'edit' ? e('div', { className: 'proposal-diff' },
      e('section', null, e('small', null, '原文'), e('pre', null, prepared?.before ?? props.proposal.oldText)),
      e('section', null, e('small', null, '修改后'), e('pre', null, prepared?.after ?? props.proposal.newText)),
    ) : e('section', null, e('small', null, '新文件内容'), e('pre', null, props.proposal.text)),
    e('footer', null,
      e('span', { role: state === 'expired' ? 'alert' : 'status' }, note),
      state === 'ready' ? e('button', { type: 'button', onClick: () => void apply() }, '应用') : null,
      state === 'ready' ? e('button', { type: 'button', onClick: () => { setState('ignored'); setNote('已忽略') } }, '忽略') : null,
    ),
  )
}

function ProjectContextReceiptView({ receipt }: { receipt: ProjectContextReceiptBundle }) {
  const fixed = receipt.sources.filter((item) => item.kind !== 'worldbook')
  const includedFixed = fixed.filter((item) => item.status === 'included' && item.includedChars > 0).length
  const worldbook = receipt.sources.filter((item) => item.kind === 'worldbook')
  const matchedByText = (value: string | undefined) => value === 'both' ? '请求与当前文稿' : value === 'saved-document' ? '当前文稿' : '本次请求'
  return e('details', { className: 'project-context-receipt' },
    e('summary', null, `项目上下文：固定 ${includedFixed}/${fixed.length}，触发世界书 ${worldbook.length}`),
    e('ul', null, receipt.sources.map((item) => e('li', { key: item.path },
      e('code', null, item.path),
      ` · ${item.status === 'included'
        ? item.includedChars > 0 ? `纳入 ${item.includedChars} 字符` : item.truncated ? '未纳入（已达总量上限）' : '空文件'
        : item.status === 'missing' ? '未找到' : '读取失败'}`,
      item.truncated ? '（已截断）' : '',
      item.kind === 'worldbook' ? ` · 优先级 ${item.priority ?? 0} · 匹配：${matchedByText(item.matchedBy)}${item.matchedTriggers?.length ? `（${item.matchedTriggers.join('、')}）` : ''}` : '',
      item.version ? ` · ${item.version}` : '',
    ))),
    receipt.scan ? e('p', { className: 'muted' }, `世界书扫描 ${receipt.scan.scanned} 份：未匹配 ${receipt.scan.unmatched}，已停用 ${receipt.scan.disabled}，格式无效 ${receipt.scan.invalid}，超过限制 ${receipt.scan.limits}，读取失败 ${receipt.scan.readErrors}`) : null,
  )
}

function WorldbookSettings(props: { path: string; text: string; onChange(text: string): void; onNote(note: string): void }) {
  const metadata = worldbookEditorMetadata(props.path, props.text)
  const [triggers, setTriggers] = useState(formatWorldbookTriggerLines(metadata.triggers))
  const [enabled, setEnabled] = useState(metadata.enabled)
  const [priority, setPriority] = useState(String(metadata.priority))
  const apply = () => {
    const values = parseWorldbookTriggerLines(triggers)
    const numericPriority = Number(priority)
    if (!metadata.valid) { props.onNote('世界书文件头格式无效；为避免丢失未知内容，请先在正文中手工修复。'); return }
    if (!values.length) { props.onNote('请至少填写一个世界书触发词。'); return }
    if (values.length > 16 || values.some((value) => value.length > 64 || /[\u0000-\u001f\u007f]/.test(value))) {
      props.onNote('世界书最多填写 16 个触发词，每个不超过 64 个字符。')
      return
    }
    if (!/^-?\d+$/.test(priority.trim()) || !Number.isSafeInteger(numericPriority) || numericPriority < -100 || numericPriority > 100) {
      props.onNote('世界书优先级必须是 -100 到 100 的整数。')
      return
    }
    try {
      props.onChange(writeWorldbookFrontmatter(props.text, { triggers: values, enabled, priority: numericPriority }))
      props.onNote('世界书触发设置已加入草稿，正在自动保存。')
    } catch {
      props.onNote('世界书文件头没有正确闭合，请先在正文中修复后再应用。')
    }
  }
  return e('section', { className: 'worldbook-settings', 'aria-label': '世界书触发设置' },
    e('div', null,
      e('strong', null, '触发设置'),
      e('small', null, '只决定何时把这篇设定带给搭档；规则正文仍写在下方。'),
      !metadata.valid ? e('span', { className: 'warning', role: 'alert' }, '现有文件头格式无效，当前不会触发。') : null,
    ),
    e('label', null, e('span', null, '触发词（一行一个）'), e('textarea', {
      value: triggers,
      disabled: !metadata.valid,
      rows: Math.min(3, Math.max(1, triggers.split(/\r?\n/).length)),
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setTriggers(event.target.value),
      placeholder: '每行填写一个触发词',
      'aria-label': '世界书触发词',
    })),
    e('label', { className: 'worldbook-enabled' }, e('input', {
      type: 'checkbox',
      checked: enabled,
      disabled: !metadata.valid,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setEnabled(event.target.checked),
    }), e('span', null, '启用')),
    e('label', null, e('span', null, '优先级'), e('input', {
      type: 'number', min: -100, max: 100, step: 1,
      value: priority,
      disabled: !metadata.valid,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setPriority(event.target.value),
      'aria-label': '世界书优先级',
    })),
    e('button', { type: 'button', onClick: apply, disabled: !metadata.valid }, '应用设置'),
  )
}

function ImportDialog(props: { flow: ImportFlow; onCancel(): void; onApply(): void; onContinue(): void; onCleanup(): void }) {
  const focus = useRef<HTMLButtonElement | null>(null)
  const dialog = useRef<HTMLElement | null>(null)
  useEffect(() => { if (focus.current) focus.current.focus(); else dialog.current?.focus() }, [props.flow.kind])
  if (props.flow.kind === 'idle') return null
  const working = props.flow.kind === 'working'
  const recover = props.flow.kind === 'recover'
  const cleanup = props.flow.kind === 'cleanup-confirm'
  const probe = props.flow.kind === 'review' || props.flow.kind === 'recover' ? props.flow.probe : undefined
  const cleaning = recover && probe?.message === 'cleaning'
  return e('div', { className: 'import-overlay', onKeyDown: (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !working) props.onCancel()
    if (event.key !== 'Tab' || working || !dialog.current) return
    const buttons = [...dialog.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    if (!buttons.length) return
    const first = buttons[0]; const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  } },
    e('section', { ref: dialog, className: 'import-dialog', role: 'dialog', tabIndex: -1, 'aria-modal': true, 'aria-labelledby': 'import-dialog-title' },
      e('h2', { id: 'import-dialog-title' }, working ? '正在导入作品' : cleanup ? '清理未完成导入？' : recover ? '发现未完成导入' : '确认导入作品'),
      working ? e('p', { role: 'status', 'aria-live': 'polite' }, props.flow.kind === 'working' ? props.flow.message : '')
        : cleanup ? e('p', null, '只会删除清单拥有且内容未变化的导入文件；不会删除目标文件夹或其他文件。')
          : recover ? e('div', null,
              e('p', null, cleaning ? '上次清理尚未完成。只能继续安全清理。' : `上次导入未完成（${importSummary(probe!)}）。重新选择原源目录后可以继续，或安全清理。`),
              probe?.message && !cleaning ? e('p', { className: 'warning', role: 'alert' }, probe.message) : null,
            )
            : e('div', null,
              e('p', null, `将导入 ${importSummary(probe!)}；源目录不会被修改。`),
              probe!.skipped.length ? e('p', null, `将跳过 ${probe!.skipped.length} 项。`) : null,
              e('ul', null, probe!.preview.map((item: string) => e('li', { key: item }, item))),
              probe!.skipped.length ? e('ul', { 'aria-label': '跳过项目示例' }, probe!.skipped.slice(0, 8).map((item) => e('li', { key: `${item.reason}:${item.path}` }, `${item.path} — ${item.reason}`))) : null,
            ),
      !working ? e('footer', null,
        e('button', { ref: focus, type: 'button', onClick: props.onCancel }, '取消'),
        recover && !cleaning ? e('button', { type: 'button', onClick: props.onContinue }, '继续导入') : null,
        recover ? e('button', { type: 'button', onClick: () => props.onCleanup() }, '清理未完成导入') : null,
        cleanup ? e('button', { type: 'button', onClick: props.onCleanup }, '确认清理') : null,
        props.flow.kind === 'review' ? e('button', { type: 'button', onClick: props.onApply }, '开始导入') : null,
      ) : null,
    ),
  )
}

function SnapshotDialog(props: {
  flow: SnapshotFlow
  dirty: boolean
  onCancel(): void
  onCreate(): void
  onSelect(snapshot: SnapshotView): void
  onApply(): void
  onContinue(): void
  onCleanup(): void
}) {
  const focus = useRef<HTMLButtonElement | null>(null)
  const dialog = useRef<HTMLElement | null>(null)
  useEffect(() => { if (focus.current) focus.current.focus(); else dialog.current?.focus() }, [props.flow.kind])
  if (props.flow.kind === 'idle') return null
  const working = props.flow.kind === 'working'
  const list = props.flow.kind === 'list' ? props.flow : undefined
  const review = props.flow.kind === 'review' ? props.flow : undefined
  const recover = props.flow.kind === 'recover' ? props.flow : undefined
  const cleanup = props.flow.kind === 'cleanup-confirm'
  return e('div', { className: 'import-overlay', onKeyDown: (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !working) props.onCancel()
    if (event.key !== 'Tab' || working || !dialog.current) return
    const buttons = [...dialog.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    if (!buttons.length) return
    const first = buttons[0]; const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  } },
    e('section', { ref: dialog, className: 'import-dialog snapshot-dialog', role: 'dialog', tabIndex: -1, 'aria-modal': true, 'aria-labelledby': 'snapshot-dialog-title' },
      e('h2', { id: 'snapshot-dialog-title' }, working ? '作品快照' : cleanup ? '清理未完成恢复？' : recover ? '发现未完成恢复' : review ? '确认恢复为新副本' : '作品快照'),
      working ? e('p', { role: 'status', 'aria-live': 'polite' }, props.flow.kind === 'working' ? props.flow.message : '') : null,
      list ? e('div', null,
        e('p', null, '快照只保存已经写入磁盘的 Markdown/TXT 作品文件；不包含未保存内容、对话、隐藏目录或构建文件。'),
        list.note ? e('p', { className: 'success', role: 'status' }, list.note) : null,
        props.dirty ? e('p', { className: 'warning', role: 'alert' }, '当前有未保存内容，请先保存再创建快照。') : null,
        list.snapshots.length
          ? e('ul', { className: 'snapshot-list', 'aria-label': '可恢复快照' }, list.snapshots.map((snapshot) => e('li', { key: snapshot.snapshotId },
              e('div', null,
                e('strong', null, snapshot.label || new Date(snapshot.createdAt).toLocaleString()),
                e('small', null, snapshotSummary(snapshot)),
              ),
              e('button', { type: 'button', onClick: () => props.onSelect(snapshot) }, '恢复为新副本'),
            )))
          : e('p', { className: 'muted' }, '还没有作品快照。'),
      ) : null,
      review ? e('div', null,
        e('p', null, '将在新的空文件夹中恢复，不覆盖或修改当前作品。'),
        review.snapshot ? e('p', null, `快照时间：${new Date(review.snapshot.createdAt).toLocaleString()}`) : null,
        e('p', null, restoreSummary(review.probe)),
        e('p', null, '当前未保存内容不会进入恢复副本。'),
        review.probe.preview.length ? e('ul', { 'aria-label': '恢复文件示例' }, review.probe.preview.map((item) => e('li', { key: item }, item))) : null,
        review.probe.excluded.length ? e('p', null, `快照创建时排除了 ${review.probe.excluded.length} 项。`) : null,
      ) : null,
      recover ? e('div', null,
        e('p', null, `上次恢复未完成（${restoreSummary(recover.probe)}）。目标不会作为完整作品打开。`),
        e('p', null, '可以重新选择创建快照的原作品继续，或安全清理已复制且内容未变化的文件。'),
        recover.probe.message ? e('p', { className: 'warning', role: 'alert' }, recover.probe.message) : null,
      ) : null,
      cleanup ? e('p', null, '只会删除恢复清单拥有且内容仍匹配的文件；检测到作者修改、链接或路径变化时会停止。') : null,
      !working ? e('footer', null,
        e('button', { ref: focus, type: 'button', onClick: props.onCancel }, '取消'),
        list ? e('button', { type: 'button', disabled: props.dirty, onClick: props.onCreate }, '创建快照') : null,
        review ? e('button', { type: 'button', onClick: props.onApply }, '确认恢复为新副本') : null,
        recover && recover.probe.message !== 'cleaning' ? e('button', { type: 'button', onClick: props.onContinue }, '选择原作品并继续') : null,
        recover ? e('button', { type: 'button', onClick: props.onCleanup }, '清理未完成恢复') : null,
        cleanup ? e('button', { type: 'button', onClick: props.onCleanup }, '确认安全清理') : null,
      ) : null,
    ),
  )
}

function Chat({ ctx, session, workspaceId, activePath, hidden, onClose, onConfigure, onApplied, onDraftDirtyChange }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; activePath?: string; hidden: boolean; onClose(): void; onConfigure(): void; onApplied(path: string): void; onDraftDirtyChange(dirty: boolean): void }) {
  const snapshot = useObservable<ConversationSnapshot>(session)
  const sessionList = useObservable(ctx.sessions.list)
  const workspaceList = useObservable(ctx.workspaces.list)
  const connected = useObservable(ctx.connection.hostDescription)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [outgoing, setOutgoing] = useState<{ text: string; state: 'sending' | 'accepted' | 'failed'; afterRows: number; projectContextReceipt?: ProjectContextReceiptBundle } | null>(null)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [renamingConversation, setRenamingConversation] = useState(false)
  const [draftConfirm, setDraftConfirm] = useState<{ resolve(value: boolean): void } | null>(null)
  const titleAttempted = useRef(new Set<string>())
  const partial = partialText(snapshot)
  const rows = chatRows(snapshot)
  const workspace = workspaceList.items.find((item) => item.workspaceId === workspaceId)
  const sessionIds = sessionList.ids.filter((id) => workspace?.sessionIds.includes(id))
  const conversations = conversationRows({
    workspaceSessionIds: sessionIds.length ? sessionIds : [session.sessionId],
    archivedIds: workspaceList.archivedSessionIds,
    reusableBlankIds: Object.values(sessionList.byId ?? {}).filter((item) => item.blank).map((item) => item.id),
    currentId: session.sessionId,
    titles: Object.fromEntries(Object.entries(sessionList.byId ?? {}).map(([id, value]) => [id, value.displayTitle])),
  })
  const queueConversationRename = (title: string, failureNote: string) => {
    void conversationRenameQueue.enqueue(session.sessionId, async () => {
      try {
        const result = await session.rename(title)
        if (!result.ok) setNote(failureNote)
      } catch {
        setNote(failureNote)
      }
    })
  }
  useEffect(() => {
    const currentTitle = sessionList.byId?.[session.sessionId]?.title?.trim()
    const title = nextAutomaticConversationTitle({
      durableTitle: currentTitle,
      assistantReplies: rows.filter((row) => row.role === 'assistant').map((row) => row.text),
      attempted: titleAttempted.current.has(session.sessionId),
    })
    if (!title) return
    titleAttempted.current.add(session.sessionId)
    queueConversationRename(title, '对话名称没有自动保存，可以手动重命名。')
  }, [rows, session.sessionId, sessionList.byId])
  useEffect(() => { onDraftDirtyChange(Boolean(draft.trim())) }, [draft, onDraftDirtyChange])
  useEffect(() => () => draftConfirm?.resolve(false), [draftConfirm])
  const canDiscardDraft = async (nextId: string): Promise<boolean> => {
    if (!shouldConfirmConversationSwitch(draft, nextId, session.sessionId)) return true
    return await new Promise<boolean>((resolve) => setDraftConfirm({ resolve }))
  }
  const resolveDraftConfirm = (value: boolean) => {
    draftConfirm?.resolve(value)
    setDraftConfirm(null)
  }
  const openConversation = (nextId: SessionId) => {
    setDraft(''); setNote(''); setOutgoing(null); onDraftDirtyChange(false); ctx.sessions.open(nextId)
  }
  const switchConversation = async (nextId: string) => {
    if (!(await canDiscardDraft(nextId))) return
    openConversation(nextId as SessionId)
  }
  const renameConversation = (title: string) => {
    setRenamingConversation(false)
    titleAttempted.current.add(session.sessionId)
    setNote('')
    queueConversationRename(title, '对话名称没有保存，请重试。')
  }
  const outgoingIsCanonical = Boolean(outgoing && rows.slice(outgoing.afterRows)
    .some((row) => row.role === 'user' && row.text.trim() === outgoing.text))
  const composerCanSubmit = canSubmitComposer({
    draft,
    connected: Boolean(connected),
    removed: snapshot.removed,
    outgoingState: outgoing?.state,
  })
  useEffect(() => {
    if (outgoingIsCanonical) setOutgoing(null)
  }, [outgoingIsCanonical])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!composerCanSubmit) return
    const value = draft.trim()
    setOutgoing({ text: value, state: 'sending', afterRows: rows.length })
    setDraft('')
    setNote('')
    let contextCompileFailed = false
    void sendProjectContext(session, value, async () => {
      const compiled = await safeRpcCall<{ serialized: string; receipt: ProjectContextReceiptBundle }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'context.compile', { sessionId: session.sessionId, userRequest: value, activePath }))
      if (!compiled.ok) { contextCompileFailed = true; throw new Error('context unavailable') }
      return { serialized: compiled.value.serialized, receipt: compiled.value.receipt }
    }).then((outcome) => {
      const result = outcome?.result
      if (outcome) setOutgoing((current) => current?.text === value ? { ...current, projectContextReceipt: outcome.receipt } : current)
      if (!result || !result.ok) {
        setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
        setNote('消息没有发送成功，请重试。')
        return
      }
      setOutgoing((current) => current?.text === value ? { ...current, state: 'accepted' } : current)
    }).catch(() => {
      setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
      if (contextCompileFailed) {
        setDraft((current) => current || value)
        setNote('项目资料暂时无法整理，消息未发送。内容已保留，请重试。')
      } else setNote('消息没有发送成功，请重试。')
    })
  }
  return e('aside', { className: 'chat', 'aria-label': '写作助手', hidden },
    e('header', { className: 'chat-header' },
      e('strong', null, connected ? '搭档' : '重连中'),
      e('label', { className: 'conversation-select' }, e('span', { className: 'sr-only' }, '切换对话'), e('select', { value: session.sessionId, 'aria-label': '切换对话', onChange: (event: ChangeEvent<HTMLSelectElement>) => void switchConversation(event.target.value) }, conversations.map((item) => e('option', { key: item.id, value: item.id }, item.title)))),
      e('div', { className: 'chat-controls' }, e(ModelIndicator, { ctx, session, onConfigure })),
      e('div', { className: 'chat-header-actions' },
        e('button', { className: 'icon-button', type: 'button', title: '新对话', 'aria-label': '新对话', onClick: () => setCreatingConversation(true) }, '＋'),
        e('button', { className: 'icon-button', type: 'button', title: '重命名对话', 'aria-label': '重命名对话', onClick: () => setRenamingConversation(true) }, '✎'),
        e('button', { className: 'icon-button', type: 'button', title: '收起搭档', 'aria-label': '收起搭档', onClick: onClose }, '×'),
      ),
    ),
    creatingConversation ? e(NewConversationPicker, {
      ctx,
      session,
      workspaceId,
      canStart: () => canDiscardDraft('__new-conversation__'),
      onOpen: openConversation,
      onClose: () => setCreatingConversation(false),
      onConfigure,
    }) : null,
    e('div', { className: 'chat-history' },
      snapshot.hasMore ? e('button', { type: 'button', onClick: () => void loadOlder(session), disabled: snapshot.loadingOlder }, snapshot.loadingOlder ? '加载中…' : '加载更早消息') : null,
      rows.map((row) => row.proposal
        ? e(ProposalCard, { key: row.id, ctx, sessionId: session.sessionId, proposal: row.proposal, onApplied })
        : e('article', { className: `chat-row ${row.role}`, key: row.id },
          e('p', null, row.text || '（无文字内容）'),
          row.detail ? e('small', null, row.detail) : null,
          row.projectContextReceipt ? e(ProjectContextReceiptView, { receipt: row.projectContextReceipt }) : null,
        )),
      outgoing && !outgoingIsCanonical ? e('article', { className: 'chat-row user', key: 'local-outgoing' },
        e('p', null, outgoing.text),
        outgoing.projectContextReceipt ? e(ProjectContextReceiptView, { receipt: outgoing.projectContextReceipt }) : null,
        e('small', { role: outgoing.state === 'failed' ? 'alert' : 'status' },
          outgoing.state === 'sending' ? '正在发送…' : outgoing.state === 'accepted' ? '已发送' : '发送失败',
        ),
      ) : null,
      outgoing?.state === 'accepted' && !outgoingIsCanonical
        ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, '正在回复…')
        : null,
      visibleRunningCalls(snapshot.runningCalls).map((call) => e('article', { className: 'chat-row tool', key: `running:${call.callId}` }, e('strong', null,
        call.name === 'glob' || call.name === 'grep' ? '正在查找作品资料…' : call.name === 'read' ? '正在阅读作品资料…' : call.name === 'novel_propose' ? '正在准备修改建议…' : '正在处理…'
      ))),
      snapshot.queue.map((item) => e('article', { className: 'chat-row notice', key: `queue:${item.id}` }, e('p', null, item.preview), e('small', null, item.placement === 'queued' ? '已排队' : '正在转向'))),
      partial ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, e('p', null, partial)) : snapshot.partial ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, '正在回复…') : null,
      snapshot.pending.map((item) => e(PendingCard, { key: item.key, item })),
      snapshot.openState === 'error' ? e('p', { className: 'warning' }, '连接暂时中断，正在恢复…') : null,
      snapshot.promptError ? e('p', { className: 'warning' }, '写作助手未能完成这次请求，请重试。') : null,
    ),
    e('form', { className: 'composer', onSubmit: submit },
      e('textarea', {
        value: draft,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
        onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (!shouldSubmitComposer({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        },
        placeholder: '问剧情、审一段、对质人物……',
        'aria-label': '输入消息',
      }),
      note ? e('small', { className: 'warning' }, note) : null,
      e('div', null,
        snapshot.running ? e('button', { type: 'button', onClick: () => void stop(session) }, '停止') : null,
        e('button', {
          type: 'submit',
          disabled: !composerCanSubmit,
        }, '发送'),
      ),
    ),
    renamingConversation ? e(TextPromptDialog, {
      id: 'rename-conversation',
      title: '重命名对话',
      label: '对话名称',
      initialValue: sessionList.byId?.[session.sessionId]?.title ?? '',
      confirmLabel: '保存名称',
      onCancel: () => setRenamingConversation(false),
      onConfirm: renameConversation,
    }) : null,
    draftConfirm ? e(ConfirmDialog, {
      id: 'discard-message-draft',
      title: '放弃未发送的消息？',
      message: '这段文字不会带到另一个对话，也不会自动保存。',
      confirmLabel: '放弃并继续',
      onCancel: () => resolveDraftConfirm(false),
      onConfirm: () => resolveDraftConfirm(true),
    }) : null,
  )
}

async function collectChapters(ctx: ShellContext, sessionId: string): Promise<ChapterExport[]> {
  const queue = ['正文']
  const files: string[] = []
  while (queue.length) {
    const directory = queue.shift()!
    const listed = await ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: directory }) as RpcResult<{ entries?: Entry[] }>
    if (!listed.ok) throw new Error(errorMessage(listed))
    for (const entry of listed.value.entries ?? []) {
      const child = `${directory}/${entry.name}`
      if (entry.type === 'directory') queue.push(child)
      else if (entry.type === 'file' && /\.md$/i.test(entry.name)) files.push(child)
    }
  }
  return await Promise.all(files.map(async (path) => {
    const read = await ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId, path }) as RpcResult<{ text: string }>
    if (!read.ok) throw new Error(errorMessage(read))
    return { path, text: read.value.text }
  }))
}

async function collectManuscriptDirectories(ctx: ShellContext, sessionId: string): Promise<string[]> {
  const queue = ['正文']
  const directories = ['正文']
  while (queue.length) {
    const directory = queue.shift()!
    const listed = await safeRpcCall<{ entries?: Entry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: directory }))
    if (!listed.ok) throw new Error(errorMessage(listed))
    for (const entry of listed.value.entries ?? []) {
      if (entry.type !== 'directory' || entry.name.startsWith('.')) continue
      const child = `${directory}/${entry.name}`
      directories.push(child)
      if (directories.length > 256 || child.split('/').length > 12) throw new Error('manuscript directories exceed the workbench limit')
      queue.push(child)
    }
  }
  return directories
}

async function collectWorkspaceFiles(ctx: ShellContext, sessionId: string): Promise<string[]> {
  const queue = ['']
  const files: string[] = []
  while (queue.length) {
    const directory = queue.shift()!
    const listed = await safeRpcCall<{ entries?: Entry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: directory || '.',
    }))
    if (!listed.ok) throw new Error(errorMessage(listed))
    for (const entry of listed.value.entries ?? []) {
      if (entry.name.startsWith('.')) continue
      const child = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.type === 'directory') queue.push(child)
      else if (entry.type === 'file') files.push(child)
    }
  }
  return files
}

export class FlowWorkspaceCleanupError extends Error {
  constructor(options?: ErrorOptions) {
    super('workspace projection failed and its registration could not be removed', options)
    this.name = 'FlowWorkspaceCleanupError'
  }
}

export async function createFlowWorkspace(ctx: ShellContext, workspacePath: string) {
  const created = await ctx.connection.api.workspace.create({ path: workspacePath })
  if (!created.result.ok) throw new Error(created.result.error.message)
  try {
    const workspace = await ctx.workspaces.create({ path: created.result.value.workspace.path })
    return { workspace, created: created.result.value.created }
  } catch (error) {
    if (created.result.value.created) {
      let cleanupFailed = false
      try {
        const cleanup = await ctx.connection.api.workspace.delete({ workspaceId: created.result.value.workspace.workspaceId })
        cleanupFailed = !cleanup.result.ok
      } catch {
        cleanupFailed = true
      }
      if (cleanupFailed) throw new FlowWorkspaceCleanupError({ cause: error })
    }
    throw error
  }
}

function downloadExport(filename: string, content: string, format: ExportFormat): void {
  const blob = new Blob([content], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  globalThis.setTimeout(() => URL.revokeObjectURL(href), 0)
}

function Root({ ctx }: { ctx: ShellContext }) {
  const sessions = useObservable(ctx.sessions.list)
  const workspaces = useObservable(ctx.workspaces.list)
  const session = currentSession(ctx)
  const [path, setPath] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [reveal, setReveal] = useState<RevealRequest | null>(null)
  const [workbenchNote, setWorkbenchNote] = useState('')
  const [treeRevision, setTreeRevision] = useState(0)
  const [contentRevision, setContentRevision] = useState(0)
  const [homeNote, setHomeNote] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const [manualWorkspaceMode, setManualWorkspaceMode] = useState<'existing' | 'new' | null>(null)
  const [manualWorkspacePath, setManualWorkspacePath] = useState('')
  const [view, setView] = useState<'workspace' | 'settings'>('workspace')
  const [sidebarOpen, setSidebarOpen] = useState(() => storedPanelOpen('dsh-editor.layout.sidebar-open', true))
  const [sidebarWidth, setSidebarWidth] = useState(() => storedPanelWidth('dsh-editor.layout.sidebar-width', SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX))
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantWidth, setAssistantWidth] = useState(() => storedPanelWidth('dsh-editor.layout.assistant-width', ASSISTANT_DEFAULT, ASSISTANT_MIN, ASSISTANT_MAX))
  const [completionPreference, setCompletionPreference] = useState(() => readCompletionPreference(globalThis.localStorage))
  const [assistantDraftDirty, setAssistantDraftDirty] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState<{ resolve(value: boolean): void } | null>(null)
  useEffect(() => () => leaveConfirm?.resolve(false), [leaveConfirm])
  const canLeaveAssistantDraft = async (): Promise<boolean> => {
    if (!assistantDraftDirty) return true
    return await new Promise<boolean>((resolve) => setLeaveConfirm({ resolve }))
  }
  const resolveLeaveConfirm = (value: boolean) => {
    leaveConfirm?.resolve(value)
    setLeaveConfirm(null)
  }
  const openSettings = async () => {
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    setView('settings')
  }
  const [focusMode, setFocusMode] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [chatFocusNonce, setChatFocusNonce] = useState(0)
  const [setupGate, setSetupGate] = useState<'checking' | 'required' | 'ready'>('checking')
  const [indexStatus, setIndexStatus] = useState<Record<string, 'initializing' | 'queued' | 'failed'>>({})
  const indexedWorkspaces = useRef(new Set<string>())
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState('')
  const [importFlow, setImportFlow] = useState<ImportFlow>(idleImportFlow)
  const [snapshotNote, setSnapshotNote] = useState('')
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [snapshotFlow, setSnapshotFlow] = useState<SnapshotFlow>(idleSnapshotFlow)
  const [editorDirty, setEditorDirty] = useState(false)
  const [managePath, setManagePath] = useState<string | null>(null)
  const [manageBusy, setManageBusy] = useState(false)
  const [manageNote, setManageNote] = useState('')
  const [manageDirectories, setManageDirectories] = useState<string[] | null>(null)
  const [workspaceManage, setWorkspaceManage] = useState<ManagedWorkspace | null>(null)
  const [workspaceManageBusy, setWorkspaceManageBusy] = useState(false)
  const [workspaceManageNote, setWorkspaceManageNote] = useState('')
  const [archives, setArchives] = useState<ArchiveView[]>([])
  const [archiveInvalid, setArchiveInvalid] = useState(0)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveNote, setArchiveNote] = useState('')
  const archiveRequestGate = useRef(new LatestRequestGate()).current
  const manageDirectoryGate = useRef(new LatestRequestGate()).current
  const importReturnFocus = useRef<HTMLElement | null>(null)
  const snapshotReturnFocus = useRef<HTMLElement | null>(null)
  const fileManageReturnFocus = useRef<HTMLElement | null>(null)
  const createReturnFocus = useRef<HTMLElement | null>(null)
  const workspaceManageReturnFocus = useRef<HTMLElement | null>(null)
  const shortcutReturnFocus = useRef<HTMLElement | null>(null)
  const shortcutChordAt = useRef(0)
  const temporaryFlowWorkspaces = useRef(new Set<string>())
  const temporarySourceWorkspaces = useRef(new Map<string, string>())
  const probedImportSessions = useRef(new Set<string>())
  const probedRestoreSessions = useRef(new Set<string>())
  const verifiedRestoreSessions = useRef(new Set<string>())
  const [, refreshRestoreGate] = useState(0)
  const current = sessions.current
  archiveRequestGate.setScope(current ?? '')
  const registerFlowWorkspace = async (workspacePath: string) => {
    const registration = await createFlowWorkspace(ctx, workspacePath)
    if (registration.created) temporaryFlowWorkspaces.current.add(registration.workspace.workspaceId)
    return registration
  }
  const bindTemporarySource = (sessionId: string, workspaceId: string, created: boolean) => {
    if (created) temporarySourceWorkspaces.current.set(sessionId, workspaceId)
  }
  const cleanupFlowWorkspace = async (workspaceId: string): Promise<boolean> => {
    if (!temporaryFlowWorkspaces.current.has(workspaceId)) return true
    try {
      await ctx.workspaces.delete(workspaceId as WorkspaceId)
      temporaryFlowWorkspaces.current.delete(workspaceId)
      return true
    } catch {
      return false
    }
  }
  const cleanupTemporarySource = async (sessionId: string): Promise<boolean> => {
    const workspaceId = temporarySourceWorkspaces.current.get(sessionId)
    if (!workspaceId) return true
    const cleaned = await cleanupFlowWorkspace(workspaceId)
    if (cleaned) temporarySourceWorkspaces.current.delete(sessionId)
    return cleaned
  }
  const preserveFlowWorkspace = (workspaceId: string) => {
    temporaryFlowWorkspaces.current.delete(workspaceId)
  }
  const openShortcuts = () => {
    shortcutReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setShortcutsOpen(true)
  }
  const closeShortcuts = () => {
    const target = shortcutReturnFocus.current
    setShortcutsOpen(false)
    if (target) globalThis.setTimeout(() => target.focus(), 0)
  }
  useEffect(() => { document.title = 'DSH Editor' }, [])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.sidebar-open', String(sidebarOpen)) } catch { /* View preferences remain optional. */ }
  }, [sidebarOpen])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.sidebar-width', String(sidebarWidth)) } catch { /* View preferences remain optional. */ }
  }, [sidebarWidth])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.assistant-width', String(assistantWidth)) } catch { /* View preferences remain optional. */ }
  }, [assistantWidth])
  useEffect(() => {
    try { globalThis.localStorage?.setItem(COMPLETION_PREFERENCE_KEY, completionPreference) } catch { /* Writing preferences remain optional. */ }
  }, [completionPreference])
  useEffect(() => {
    const hotkey = (event: globalThis.KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (shortcutsOpen) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeShortcuts() }
        return
      }
      if (document.querySelector('[aria-modal="true"]')) return
      if (mod && !event.altKey && !event.shiftKey && key === 'k') {
        event.preventDefault(); event.stopPropagation(); shortcutChordAt.current = Date.now(); return
      }
      if (mod && !event.altKey && !event.shiftKey && key === 's' && Date.now() - shortcutChordAt.current < 2_000) {
        event.preventDefault(); event.stopPropagation(); shortcutChordAt.current = 0; openShortcuts(); return
      }
      if (!['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) shortcutChordAt.current = 0
      const action = workspaceShortcut(event)
      if (!action || event.repeat) return
      if (action !== 'settings' && (!session || view !== 'workspace')) return
      event.preventDefault()
      if (action === 'settings') { void openSettings(); return }
      if (action === 'toggle-sidebar') {
        if (focusMode) { setFocusMode(false); setSidebarOpen(true) } else setSidebarOpen((value) => !value)
        return
      }
      if (action === 'toggle-assistant') {
        if (focusMode) { setFocusMode(false); setAssistantOpen(true) } else setAssistantOpen((value) => !value)
        return
      }
      if (action === 'toggle-focus') { setFocusMode((value) => !value); return }
      if (action === 'focus-assistant') {
        setFocusMode(false)
        setAssistantOpen(true)
        setChatFocusNonce((value) => value + 1)
        return
      }
      if (editorDirty) return
      const buttons = document.querySelectorAll<HTMLButtonElement>('[aria-label="章节导航"] button')
      const button = action === 'previous-chapter' ? buttons[0] : buttons[1]
      if (button && !button.disabled) button.click()
    }
    globalThis.addEventListener('keydown', hotkey, true)
    return () => globalThis.removeEventListener('keydown', hotkey, true)
  }, [assistantDraftDirty, editorDirty, focusMode, session?.sessionId, shortcutsOpen, view])
  useEffect(() => {
    if (!chatFocusNonce || !assistantOpen || focusMode) return
    globalThis.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus(), 0)
  }, [assistantOpen, chatFocusNonce, focusMode])
  useEffect(() => {
    setPath(''); setFiles([]); setReveal(null); setWorkbenchNote(''); setEditorDirty(false)
    setManagePath(null); setManageNote(''); setArchives([]); setArchiveInvalid(0); setArchiveNote('')
  }, [current])
  useEffect(() => {
    if (!session) { setFiles([]); return }
    let live = true
    void collectWorkspaceFiles(ctx, session.sessionId).then((paths) => {
      if (live) setFiles(sortChapterPaths(paths))
    }).catch(() => {
      if (live) { setFiles([]); setWorkbenchNote('没有读取到完整章节顺序。') }
    })
    return () => { live = false }
  }, [ctx.connection.rpc, session?.sessionId, treeRevision])
  const openDocument = (nextPath: string, hit?: SearchHit) => {
    if (editorDirty && (nextPath !== path || hit)) {
      setWorkbenchNote('请先保存当前文档。')
      return
    }
    setWorkbenchNote('')
    setPath(nextPath)
    setReveal(hit ? { ...hit, nonce: Date.now() } : null)
  }
  const loadArchives = async () => {
    if (!session) return
    const ticket = archiveRequestGate.begin(session.sessionId)
    setArchiveBusy(true); setArchiveNote('')
    const result = await safeRpcCall<ArchiveListResponse>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.list', { sessionId: session.sessionId }))
    if (!archiveRequestGate.isCurrent(ticket)) return
    setArchiveBusy(false)
    if (!result.ok) { setArchiveNote(errorMessage(result)); return }
    setArchives(result.value.items)
    setArchiveInvalid(result.value.invalid)
  }
  const openManage = (selectedPath: string) => {
    if (editorDirty) { setWorkbenchNote('请先保存当前文档。'); return }
    fileManageReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setManagePath(selectedPath); setManageNote('')
    if (!session || !selectedPath.startsWith('正文/')) { setManageDirectories([]); return }
    setManageDirectories(null)
    const ticket = manageDirectoryGate.begin(`${session.sessionId}\0${selectedPath}`)
    const currentDirectory = selectedPath.slice(0, selectedPath.lastIndexOf('/'))
    void collectManuscriptDirectories(ctx, session.sessionId).then((directories) => {
      if (!manageDirectoryGate.isCurrent(ticket)) return
      setManageDirectories(directories.filter((directory) => directory.normalize('NFC').toLocaleLowerCase() !== currentDirectory.normalize('NFC').toLocaleLowerCase()))
    }).catch(() => {
      if (!manageDirectoryGate.isCurrent(ticket)) return
      setManageDirectories([])
      setManageNote('没有读取到可用卷/部；重命名和归档仍可使用。')
    })
  }
  const closeManage = () => {
    if (manageBusy) return
    const target = fileManageReturnFocus.current
    manageDirectoryGate.setScope('')
    setManagePath(null); setManageNote(''); setManageDirectories(null)
    if (target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const openWorkspaceManage = (workspace: { workspaceId: WorkspaceId; title?: string; path: string }, removable: boolean) => {
    workspaceManageReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setWorkspaceManage({ workspaceId: workspace.workspaceId, title: workspace.title || workspace.path, path: workspace.path, removable })
    setWorkspaceManageNote('')
  }
  const closeWorkspaceManage = (force = false) => {
    if (workspaceManageBusy && !force) return
    const target = workspaceManageReturnFocus.current
    setWorkspaceManage(null)
    setWorkspaceManageNote('')
    if (target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const renameWorkspace = async (title: string) => {
    if (!workspaceManage || workspaceManageBusy) return
    setWorkspaceManageBusy(true); setWorkspaceManageNote('')
    try {
      await ctx.workspaces.rename(workspaceManage.workspaceId, title.trim())
      setWorkspaceManageBusy(false)
      closeWorkspaceManage(true)
      if (session) setExportNote('作品显示名已更新。')
      else setHomeNote('作品显示名已更新。')
    } catch {
      setWorkspaceManageBusy(false)
      setWorkspaceManageNote('作品名没有修改；请检查是否与其他作品重名。')
    }
  }
  const removeWorkspace = async () => {
    if (!workspaceManage?.removable || workspaceManageBusy) return
    setWorkspaceManageBusy(true); setWorkspaceManageNote('')
    try {
      await ctx.workspaces.delete(workspaceManage.workspaceId)
      setWorkspaceManageBusy(false)
      closeWorkspaceManage(true)
      setHomeNote('已从最近移除；磁盘中的作品没有删除。')
    } catch {
      setWorkspaceManageBusy(false)
      setWorkspaceManageNote('最近入口没有移除，请重试。')
    }
  }
  const observedVersion = async (selectedPath: string): Promise<string | undefined> => {
    if (!session) return undefined
    const read = await safeRpcCall<{ version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: session.sessionId, path: selectedPath }))
    if (!read.ok) { setManageNote(errorMessage(read)); return undefined }
    return read.value.version
  }
  const renameManaged = async (name: string) => {
    if (!session || !managePath || manageBusy) return
    setManageBusy(true); setManageNote('')
    const version = await observedVersion(managePath)
    if (!version) { setManageBusy(false); return }
    const renamed = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'file.rename', {
      sessionId: session.sessionId,
      path: managePath,
      newName: name,
      expectedVersion: version,
    }))
    setManageBusy(false)
    if (!renamed.ok) { setManageNote(errorMessage(renamed)); return }
    if (path === managePath) { setPath(renamed.value.path); setReveal(null) }
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(`已重命名为 ${renamed.value.path}`)
    manageDirectoryGate.setScope('')
    setManageDirectories(null)
    setManagePath(null)
  }
  const moveManaged = async (targetDirectory: string) => {
    if (!session || !managePath || manageBusy) return
    setManageBusy(true); setManageNote('')
    const version = await observedVersion(managePath)
    if (!version) { setManageBusy(false); return }
    const moved = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'file.moveManuscript', {
      sessionId: session.sessionId,
      path: managePath,
      targetDirectory,
      expectedVersion: version,
    }))
    setManageBusy(false)
    if (!moved.ok) { setManageNote(errorMessage(moved)); return }
    if (path === managePath) { setPath(moved.value.path); setReveal(null) }
    manageDirectoryGate.setScope('')
    setManageDirectories(null)
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(`已移动到 ${moved.value.path}`)
    setManagePath(null)
  }
  const archiveManaged = async () => {
    if (!session || !managePath || manageBusy) return
    setManageBusy(true); setManageNote('')
    const version = await observedVersion(managePath)
    if (!version) { setManageBusy(false); return }
    const archived = await safeRpcCall<ArchiveView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.apply', {
      sessionId: session.sessionId,
      path: managePath,
      expectedVersion: version,
    }))
    setManageBusy(false)
    if (!archived.ok) { setManageNote(errorMessage(archived)); return }
    if (archived.value.state !== 'archived') { setManageNote('归档未完成，请在已归档列表中检查。'); await loadArchives(); return }
    if (path === managePath) { setPath(''); setReveal(null) }
    manageDirectoryGate.setScope('')
    setManageDirectories(null)
    setManagePath(null)
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(`已归档 ${archived.value.path}`)
    await loadArchives()
  }
  const continueArchive = async (item: ArchiveView) => {
    if (!session || archiveBusy || editorDirty) { if (editorDirty) setArchiveNote('请先保存当前文档。'); return }
    setArchiveBusy(true); setArchiveNote('')
    const result = await safeRpcCall<ArchiveView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.apply', { sessionId: session.sessionId, archiveId: item.archiveId }))
    setArchiveBusy(false)
    if (!result.ok) { setArchiveNote(errorMessage(result)); return }
    setTreeRevision((value) => value + 1)
    await loadArchives()
  }
  const restoreArchived = async (item: ArchiveView) => {
    if (!session || archiveBusy || editorDirty) { if (editorDirty) setArchiveNote('请先保存当前文档。'); return }
    if (!item.version) { setArchiveNote('归档状态无法验证，未恢复。'); return }
    setArchiveBusy(true); setArchiveNote('')
    const result = await safeRpcCall<ArchiveView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.restore', {
      sessionId: session.sessionId,
      archiveId: item.archiveId,
      expectedVersion: item.version,
    }))
    setArchiveBusy(false)
    if (!result.ok) { setArchiveNote(errorMessage(result)); return }
    if (result.value.state !== 'restored') { setArchiveNote('原路径已有文件或归档已变化，未覆盖。'); await loadArchives(); return }
    setTreeRevision((value) => value + 1)
    openDocument(result.value.path)
    setWorkbenchNote(`已恢复 ${result.value.path}`)
    await loadArchives()
  }
  useEffect(() => {
    let live = true
    void ctx.connection.api.credentials.describe({ refs: ['DEEPSEEK_API_KEY', 'DSH_EDITOR_CUSTOM_API_KEY'] }).then((response) => {
      if (!live) return
      const credentials = response.result.ok ? response.result.value.credentials : undefined
      const configured = Boolean(credentials?.DEEPSEEK_API_KEY?.configured || credentials?.DSH_EDITOR_CUSTOM_API_KEY?.configured)
      setSetupGate(configured ? 'ready' : 'required')
      if (!configured) setView('settings')
    }).catch(() => {
      if (!live) return
      setSetupGate('required')
      setView('settings')
    })
    return () => { live = false }
  }, [ctx.connection])
  const openCreateDialog = (kind: DocumentKind | 'group', directory = '正文') => {
    if (!session) return
    if (editorDirty) { setCreateNote('请先保存当前文档。'); return }
    createReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCreateNote('')
    setCreateRequest({ kind, directory })
  }
  const closeCreateDialog = () => {
    if (createBusy) return
    const target = createReturnFocus.current
    setCreateRequest(null)
    setCreateNote('')
    globalThis.setTimeout(() => target?.focus(), 0)
  }
  const create = async (title: string) => {
    if (!session || !createRequest) return
    const request = createRequest
    setCreateBusy(true)
    setCreateNote('')
    if (request.kind === 'group') {
      const groupPath = manuscriptGroupPath(title)
      const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'structure.groupCreate', {
        sessionId: session.sessionId,
        path: groupPath,
      }))
      setCreateBusy(false)
      if (!result.ok) { setCreateNote(errorMessage(result)); return }
      setCreateRequest(null)
      setTreeRevision((old) => old + 1)
      setWorkbenchNote(`已创建 ${result.value.path}`)
      return
    }
    const kind: DocumentKind = request.kind
    let workspaceFiles: string[]
    try {
      workspaceFiles = await collectWorkspaceFiles(ctx, session.sessionId)
    } catch {
      setCreateBusy(false)
      setCreateNote('没有读取到完整目录，请重试。')
      return
    }
    const file = kind === 'chapter'
      ? nextChapterPath(workspaceFiles, request.directory)
      : nextDocumentPath(kind, title, workspaceFiles)
    const result = await safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'file.create', {
      sessionId: session.sessionId,
      path: file,
      text: documentTemplate(kind, title),
    }))
    setCreateBusy(false)
    if (!result.ok) { setCreateNote(errorMessage(result)); return }
    setCreateRequest(null)
    openDocument(file)
    setTreeRevision((old) => old + 1)
  }
  const exportNovel = async (format: ExportFormat) => {
    if (!session) return
    setExporting(true); setExportNote('正在整理正文…')
    try {
      const chapters = await collectChapters(ctx, session.sessionId)
      const title = currentWorkspace?.title || (current ? sessions.byId[current]?.displayTitle : undefined) || '未命名作品'
      const result = buildExport(chapters, title, format)
      downloadExport(result.filename, result.content, format)
      setExportNote(`已生成 ${result.filename}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setExportNote(/没有可导出|正文为空/.test(message) ? message : '导出没有完成，请重试。')
    } finally {
      setExporting(false)
    }
  }
  const currentCwd = current ? sessions.byId[current]?.cwd : undefined
  const currentWorkspace = workspaces.items.find((workspace) => workspace.path === currentCwd)
  useEffect(() => {
    if (!current || !currentWorkspace || probedImportSessions.current.has(current)) return
    probedImportSessions.current.add(current)
    let live = true
    void safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', { targetSessionId: current }))
      .then((recovery) => {
        if (!live) return
        if (!recovery.ok) {
          ctx.sessions.clear()
          setHomeNote('作品中的导入状态无法验证，已停止打开。')
          return
        }
        if (recovery.value.state !== 'recoverable') return
        importReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        ctx.sessions.clear()
        setImportFlow(recoverImport(current, currentWorkspace.workspaceId, recovery.value))
      })
    return () => { live = false }
  }, [ctx.connection.rpc, current, currentWorkspace?.workspaceId])
  useEffect(() => {
    if (!current || !currentWorkspace || probedRestoreSessions.current.has(current)) return
    probedRestoreSessions.current.add(current)
    let live = true
    void safeRpcCall<RestoreView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreProbe', { targetSessionId: current }))
      .then((recovery) => {
        if (!live) return
        if (!recovery.ok) {
          ctx.sessions.clear()
          setHomeNote('作品中的恢复状态无法验证，已停止打开。')
          return
        }
        if (!blocksWorkspaceOpen(recovery.value)) {
          verifiedRestoreSessions.current.add(current)
          refreshRestoreGate((value) => value + 1)
          return
        }
        snapshotReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        ctx.sessions.clear()
        setSnapshotFlow(recoverSnapshot(current, currentWorkspace.workspaceId, recovery.value))
        return
      })
    return () => { live = false }
  }, [ctx.connection.rpc, current, currentWorkspace?.workspaceId])
  const triggerExistingIndex = (workspaceId: WorkspaceId, sessionId: SessionId, force = false) => {
    if (!force && indexedWorkspaces.current.has(workspaceId)) return
    indexedWorkspaces.current.add(workspaceId)
    setIndexStatus((old) => ({ ...old, [workspaceId]: 'initializing' }))
    void Promise.resolve().then(async () => {
      const prepared = await ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.prepareIndex', { sessionId }) as RpcResult
      if (!prepared.ok) throw new Error(errorMessage(prepared))
      const indexedSession = ctx.sessions.binding(sessionId)?.session
      if (!indexedSession) throw new Error('session unavailable')
      const result = await indexedSession.prompt([{ type: 'text', text: buildNovelIndexPrompt() }], 'queue')
      if (!result.ok) throw new Error('prompt rejected')
      setIndexStatus((old) => ({ ...old, [workspaceId]: 'queued' }))
    }).catch(() => setIndexStatus((old) => ({ ...old, [workspaceId]: 'failed' })))
  }
  const connectAndInitialize = async (workspaceId: WorkspaceId, newProject: boolean) => {
    const sessionId = await ctx.workspaces.connectWorkspace(workspaceId)
    if (newProject) {
      const initialized = await ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.init', { sessionId, newProject: true }) as RpcResult
      if (!initialized.ok) throw new Error(errorMessage(initialized))
    }
    if (!newProject) {
      probedImportSessions.current.add(sessionId)
      const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', { targetSessionId: sessionId }))
      if (!recovery.ok) {
        setHomeNote('作品中的导入状态无法验证，已停止打开。')
        setExportNote('作品中的导入状态无法验证，未切换工作区。')
        return
      }
      if (recovery.ok && recovery.value.state === 'recoverable') {
        importReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setImportFlow(recoverImport(sessionId, workspaceId, recovery.value)); return
      }
      probedRestoreSessions.current.add(sessionId)
      const restore = await safeRpcCall<RestoreView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreProbe', { targetSessionId: sessionId }))
      if (!restore.ok) {
        setHomeNote('作品中的恢复状态无法验证，已停止打开。')
        setExportNote('作品中的恢复状态无法验证，未切换工作区。')
        return
      }
      if (blocksWorkspaceOpen(restore.value)) {
        snapshotReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setSnapshotFlow(recoverSnapshot(sessionId, workspaceId, restore.value))
        return
      }
      verifiedRestoreSessions.current.add(sessionId)
      triggerExistingIndex(workspaceId, sessionId)
    }
    ctx.sessions.open(sessionId)
  }
  const openWorkspacePath = async (path: string, newProject: boolean) => {
    const workspace = await ctx.workspaces.create({ path })
    await connectAndInitialize(workspace.workspaceId, newProject)
  }
  const pickWorkspace = async (newProject: boolean) => {
    setManualWorkspaceMode(newProject ? 'new' : 'existing')
    setHomeNote('也可以直接输入作品路径。')
    try {
      const path = await ctx.workspaces.pickDirectory()
      if (!path) {
        setHomeNote('没有选择目录，也可以在下方输入作品路径。')
        return
      }
      setOpeningWorkspace(true)
      try {
        await openWorkspacePath(path, newProject)
        setManualWorkspaceMode(null)
        setHomeNote('')
      } finally {
        setOpeningWorkspace(false)
      }
    } catch {
      setHomeNote('目录选择器暂时不可用，请在下方输入作品路径。')
    }
  }
  const submitWorkspacePath = async (event: FormEvent) => {
    event.preventDefault()
    const path = manualWorkspacePath.trim()
    if (!path) { setHomeNote('请输入作品文件夹路径。'); return }
    setOpeningWorkspace(true)
    setHomeNote('')
    try {
      await openWorkspacePath(path, manualWorkspaceMode === 'new')
      setManualWorkspaceMode(null)
      setManualWorkspacePath('')
    } catch {
      setHomeNote('工作区没有打开，请检查路径后重试。')
    } finally {
      setOpeningWorkspace(false)
    }
  }
  const closeImportFlow = (restoreFocus = true) => {
    const target = importReturnFocus.current
    importReturnFocus.current = null
    setImportFlow(idleImportFlow)
    if (restoreFocus && target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const selectImportSource = async (targetSessionId?: SessionId, targetWorkspaceId?: WorkspaceId) => {
    if (!targetSessionId) importReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const sourcePath = await ctx.workspaces.pickDirectory()
    if (!sourcePath) { closeImportFlow(); return }
    let sourceSessionId: SessionId | undefined
    let createdSourceWorkspaceId: WorkspaceId | undefined
    let createdTargetWorkspaceId: WorkspaceId | undefined
    try {
      const sourceRegistration = await registerFlowWorkspace(sourcePath)
      if (sourceRegistration.created) createdSourceWorkspaceId = sourceRegistration.workspace.workspaceId
      sourceSessionId = await ctx.workspaces.connectWorkspace(sourceRegistration.workspace.workspaceId)
      bindTemporarySource(sourceSessionId, sourceRegistration.workspace.workspaceId, sourceRegistration.created)
      let destinationSessionId = targetSessionId
      let destinationWorkspaceId = targetWorkspaceId
      if (!destinationSessionId || !destinationWorkspaceId) {
        const targetPath = await ctx.workspaces.pickDirectory()
        if (!targetPath) {
          const sourceCleaned = await cleanupTemporarySource(sourceSessionId)
          closeImportFlow()
          if (!sourceCleaned) setHomeNote('已取消导入，但临时来源入口未能自动移除。')
          return
        }
        const targetRegistration = await registerFlowWorkspace(targetPath)
        destinationWorkspaceId = targetRegistration.workspace.workspaceId
        if (targetRegistration.created) createdTargetWorkspaceId = destinationWorkspaceId
        destinationSessionId = await ctx.workspaces.connectWorkspace(destinationWorkspaceId)
      }
      setImportFlow({ kind: 'working', message: '正在检查可导入的文件…' })
      const probe = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', {
        sourceSessionId, targetSessionId: destinationSessionId,
      }))
      if (!probe.ok || probe.value.state !== 'ready') {
        const sourceCleaned = await cleanupTemporarySource(sourceSessionId)
        const targetCleaned = createdTargetWorkspaceId ? await cleanupFlowWorkspace(createdTargetWorkspaceId) : true
        closeImportFlow()
        const note = probe.ok ? probe.value.message ?? '目录不能导入。' : '导入检查没有完成。'
        setHomeNote(sourceCleaned && targetCleaned ? note : `${note} 临时工作区入口未能自动移除。`)
        return
      }
      setImportFlow(importReview(sourceSessionId, destinationSessionId as string, destinationWorkspaceId as string, probe.value))
    } catch (error) {
      const sourceCleaned = sourceSessionId
        ? await cleanupTemporarySource(sourceSessionId)
        : createdSourceWorkspaceId ? await cleanupFlowWorkspace(createdSourceWorkspaceId) : true
      const targetCleaned = createdTargetWorkspaceId ? await cleanupFlowWorkspace(createdTargetWorkspaceId) : true
      if (error instanceof FlowWorkspaceCleanupError || !sourceCleaned || !targetCleaned) {
        closeImportFlow()
        setHomeNote('导入没有开始；临时工作区入口未能自动移除。')
        return
      }
      throw error
    }
  }
  const applyImportFlow = async () => {
    if (importFlow.kind !== 'review') return
    const flow = importFlow
    setImportFlow({ kind: 'working', message: '正在复制作品文件…' })
    const applied = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importApply', {
      sourceSessionId: flow.sourceSessionId, targetSessionId: flow.targetSessionId, probeToken: flow.probe.token,
    }))
    if (!applied.ok) {
      const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', { targetSessionId: flow.targetSessionId }))
      const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
      if (recovery.ok && recovery.value.state === 'recoverable') {
        setImportFlow(recoverImport(flow.targetSessionId, flow.targetWorkspaceId, recovery.value))
        if (!sourceCleaned) setHomeNote('未完成导入仍可恢复，但临时来源入口未能自动移除。')
      } else {
        const targetCleaned = await cleanupFlowWorkspace(flow.targetWorkspaceId)
        closeImportFlow(false)
        setHomeNote(sourceCleaned && targetCleaned ? '导入没有完成，请重试。' : '导入没有完成；临时工作区入口未能自动移除。')
      }
      return
    }
    const initialized = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.init', { sessionId: flow.targetSessionId, newProject: false }))
    const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
    preserveFlowWorkspace(flow.targetWorkspaceId)
    if (!initialized.ok) {
      closeImportFlow(false)
      setHomeNote(sourceCleaned ? '导入已完成，但项目初始化没有完成。' : '导入已完成，但项目初始化和临时入口清理没有完成。')
      return
    }
    ctx.sessions.open(flow.targetSessionId as SessionId)
    triggerExistingIndex(flow.targetWorkspaceId as WorkspaceId, flow.targetSessionId as SessionId)
    closeImportFlow(false)
    if (!sourceCleaned) setHomeNote('作品已导入；临时来源入口未能自动移除。')
  }
  const cleanupImportFlow = async () => {
    if (importFlow.kind === 'recover') { setImportFlow({ kind: 'cleanup-confirm', targetSessionId: importFlow.targetSessionId, targetWorkspaceId: importFlow.targetWorkspaceId, receiptId: importFlow.probe.receiptId! }); return }
    if (importFlow.kind !== 'cleanup-confirm') return
    const flow = importFlow
    setImportFlow({ kind: 'working', message: '正在安全清理未完成导入…' })
    const cleaned = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importCleanup', { targetSessionId: flow.targetSessionId, receiptId: flow.receiptId }))
    if (cleaned.ok) {
      if (current === flow.targetSessionId) ctx.sessions.clear()
      const targetCleaned = await cleanupFlowWorkspace(flow.targetWorkspaceId)
      closeImportFlow()
      setHomeNote(targetCleaned ? '已清理未完成导入。' : '已清理未完成导入，但临时工作区入口未能自动移除。')
      return
    }
    const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', { targetSessionId: flow.targetSessionId }))
    if (recovery.ok && recovery.value.state === 'recoverable') {
      setImportFlow(recoverImport(flow.targetSessionId, flow.targetWorkspaceId, { ...recovery.value, message: recovery.value.message ?? '清理没有完成；文件未被自动删除。' }))
      return
    }
    if (current === flow.targetSessionId) ctx.sessions.clear()
    closeImportFlow()
    setHomeNote('清理没有完成；文件未被自动删除。')
  }
  const closeSnapshotFlow = (restoreFocus = true) => {
    const target = snapshotReturnFocus.current
    snapshotReturnFocus.current = null
    setSnapshotFlow(idleSnapshotFlow)
    if (restoreFocus && target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const loadSnapshotList = async (note?: string) => {
    if (!session) return
    setSnapshotBusy(true)
    setSnapshotFlow({ kind: 'working', message: '正在读取作品快照…' })
    const listed = await safeRpcCall<SnapshotView[]>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.list', { sessionId: session.sessionId }))
    setSnapshotBusy(false)
    if (!listed.ok) { closeSnapshotFlow(false); setSnapshotNote('快照列表没有读取完成，请重试。'); return }
    setSnapshotFlow({ kind: 'list', snapshots: listed.value, note })
  }
  const openSnapshotPanel = () => {
    snapshotReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void loadSnapshotList()
  }
  const createSnapshot = async () => {
    if (!session) return
    if (editorDirty) { setSnapshotNote('请先保存当前未保存内容，再创建快照。'); return }
    setSnapshotBusy(true)
    setSnapshotFlow({ kind: 'working', message: '正在创建整部作品文本快照…' })
    const result = await safeRpcCall<SnapshotView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.create', { sessionId: session.sessionId }))
    setSnapshotBusy(false)
    if (!result.ok) { closeSnapshotFlow(false); setSnapshotNote('快照没有创建，请重试。'); return }
    setSnapshotNote(`已创建快照：${snapshotSummary(result.value)}`)
    await loadSnapshotList('快照已创建。')
  }
  const restoreAsCopy = async (snapshot: SnapshotView) => {
    if (!session) return
    setSnapshotBusy(true)
    setSnapshotFlow({ kind: 'working', message: '请选择一个新的空文件夹作为恢复目标…' })
    const targetPath = await ctx.workspaces.pickDirectory()
    if (!targetPath) { setSnapshotBusy(false); await loadSnapshotList('已取消选择恢复目标。'); return }
    let createdTargetWorkspaceId: WorkspaceId | undefined
    try {
      const targetRegistration = await registerFlowWorkspace(targetPath)
      const target = targetRegistration.workspace
      if (targetRegistration.created) createdTargetWorkspaceId = target.workspaceId
      const targetSessionId = await ctx.workspaces.connectWorkspace(target.workspaceId)
      const probe = await safeRpcCall<RestoreView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreProbe', {
        sourceSessionId: session.sessionId,
        targetSessionId,
        snapshotId: snapshot.snapshotId,
      }))
      setSnapshotBusy(false)
      if (!probe.ok || probe.value.state !== 'ready' || !probe.value.token) {
        const targetCleaned = createdTargetWorkspaceId ? await cleanupFlowWorkspace(createdTargetWorkspaceId) : true
        closeSnapshotFlow(false)
        const note = probe.ok ? probe.value.message ?? '目标目录不能用于恢复。' : '恢复检查没有完成。'
        setSnapshotNote(targetCleaned ? note : `${note} 临时工作区入口未能自动移除。`)
        return
      }
      setSnapshotFlow(snapshotReview(session.sessionId, targetSessionId, target.workspaceId, probe.value, snapshot))
    } catch (error) {
      const targetCleaned = createdTargetWorkspaceId ? await cleanupFlowWorkspace(createdTargetWorkspaceId) : true
      setSnapshotBusy(false)
      closeSnapshotFlow(false)
      setSnapshotNote(error instanceof FlowWorkspaceCleanupError || !targetCleaned
        ? '恢复没有开始；临时工作区入口未能自动移除。'
        : '恢复目标没有打开，请重试。')
    }
  }
  const finishRestoredCopy = async (targetSessionId: string, targetWorkspaceId: string, sourceSessionId: string) => {
    const sourceCleaned = await cleanupTemporarySource(sourceSessionId)
    preserveFlowWorkspace(targetWorkspaceId)
    probedRestoreSessions.current.add(targetSessionId)
    verifiedRestoreSessions.current.add(targetSessionId)
    ctx.sessions.open(targetSessionId as SessionId)
    triggerExistingIndex(targetWorkspaceId as WorkspaceId, targetSessionId as SessionId)
    closeSnapshotFlow(false)
    setSnapshotNote(sourceCleaned ? '已恢复为新的作品副本。' : '已恢复作品副本；临时来源入口未能自动移除。')
  }
  const applySnapshotRestore = async () => {
    if (snapshotFlow.kind !== 'review') return
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    const flow = snapshotFlow
    setSnapshotBusy(true)
    setSnapshotFlow({ kind: 'working', message: '正在恢复新的作品副本…' })
    const applied = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreApply', {
      sourceSessionId: flow.sourceSessionId,
      targetSessionId: flow.targetSessionId,
      snapshotId: flow.probe.snapshotId,
      token: flow.probe.token,
    }))
    setSnapshotBusy(false)
    if (applied.ok) { await finishRestoredCopy(flow.targetSessionId, flow.targetWorkspaceId, flow.sourceSessionId); return }
    const recovery = await safeRpcCall<RestoreView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreProbe', { targetSessionId: flow.targetSessionId }))
    if (recovery.ok && recovery.value.state === 'complete') {
      await finishRestoredCopy(flow.targetSessionId, flow.targetWorkspaceId, flow.sourceSessionId)
      return
    }
    if (recovery.ok && recovery.value.state === 'recoverable') {
      const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
      setSnapshotFlow(recoverSnapshot(flow.targetSessionId, flow.targetWorkspaceId, recovery.value))
      if (!sourceCleaned) setSnapshotNote('未完成恢复仍可继续，但临时来源入口未能自动移除。')
      return
    }
    const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
    const targetCleaned = await cleanupFlowWorkspace(flow.targetWorkspaceId)
    closeSnapshotFlow(false)
    setSnapshotNote(sourceCleaned && targetCleaned
      ? '恢复没有完成；目标文件未被当成完整作品打开。'
      : '恢复没有完成；临时工作区入口未能自动移除。')
  }
  const continueSnapshotRestore = async () => {
    if (snapshotFlow.kind !== 'recover') return
    const recover = snapshotFlow
    setSnapshotBusy(true)
    setSnapshotFlow({ kind: 'working', message: '请选择创建这份快照的原作品目录…' })
    const sourcePath = await ctx.workspaces.pickDirectory()
    if (!sourcePath) { setSnapshotBusy(false); setSnapshotFlow(recover); return }
    let sourceSessionId: SessionId | undefined
    let createdSourceWorkspaceId: WorkspaceId | undefined
    try {
      const sourceRegistration = await registerFlowWorkspace(sourcePath)
      const source = sourceRegistration.workspace
      if (sourceRegistration.created) createdSourceWorkspaceId = source.workspaceId
      sourceSessionId = await ctx.workspaces.connectWorkspace(source.workspaceId)
      bindTemporarySource(sourceSessionId, source.workspaceId, sourceRegistration.created)
      const probe = await safeRpcCall<RestoreView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreProbe', {
        sourceSessionId,
        targetSessionId: recover.targetSessionId,
        snapshotId: recover.probe.snapshotId,
      }))
      setSnapshotBusy(false)
      if (probe.ok && probe.value.state === 'ready' && probe.value.token) {
        setSnapshotFlow(snapshotReview(sourceSessionId, recover.targetSessionId, recover.targetWorkspaceId, probe.value))
        return
      }
      const sourceCleaned = await cleanupTemporarySource(sourceSessionId)
      setSnapshotFlow({ ...recover, probe: { ...recover.probe, message: probe.ok ? probe.value.message ?? '所选原作品不匹配。' : '原作品没有验证完成。' } })
      if (!sourceCleaned) setSnapshotNote('临时来源入口未能自动移除。')
    } catch (error) {
      const sourceCleaned = sourceSessionId
        ? await cleanupTemporarySource(sourceSessionId)
        : createdSourceWorkspaceId ? await cleanupFlowWorkspace(createdSourceWorkspaceId) : true
      setSnapshotBusy(false)
      setSnapshotFlow({ ...recover, probe: { ...recover.probe, message: error instanceof FlowWorkspaceCleanupError || !sourceCleaned
        ? '临时来源入口未能自动移除。'
        : '原作品目录没有打开。' } })
    }
  }
  const cleanupSnapshotRestore = async () => {
    if (snapshotFlow.kind === 'recover') {
      setSnapshotFlow({
        kind: 'cleanup-confirm',
        targetSessionId: snapshotFlow.targetSessionId,
        targetWorkspaceId: snapshotFlow.targetWorkspaceId,
        receiptId: snapshotFlow.probe.receiptId!,
      })
      return
    }
    if (snapshotFlow.kind !== 'cleanup-confirm') return
    const flow = snapshotFlow
    setSnapshotBusy(true)
    setSnapshotFlow({ kind: 'working', message: '正在安全清理未完成恢复…' })
    const cleaned = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreCleanup', {
      targetSessionId: flow.targetSessionId,
      receiptId: flow.receiptId,
    }))
    setSnapshotBusy(false)
    if (cleaned.ok) {
      if (current === flow.targetSessionId) ctx.sessions.clear()
      const targetCleaned = await cleanupFlowWorkspace(flow.targetWorkspaceId)
      closeSnapshotFlow()
      setHomeNote(targetCleaned ? '已清理未完成恢复。' : '已清理未完成恢复，但临时工作区入口未能自动移除。')
      return
    }
    const recovery = await safeRpcCall<RestoreView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreProbe', { targetSessionId: flow.targetSessionId }))
    if (recovery.ok && recovery.value.state === 'recoverable') {
      setSnapshotFlow(recoverSnapshot(flow.targetSessionId, flow.targetWorkspaceId, { ...recovery.value, message: recovery.value.message ?? '清理没有完成；文件未被自动删除。' }))
      return
    }
    if (current === flow.targetSessionId) ctx.sessions.clear()
    closeSnapshotFlow()
    setHomeNote('清理没有完成；文件未被自动删除。')
  }
  const cancelImportFlow = async () => {
    const flow = importFlow
    let cleaned = true
    if (flow.kind === 'review') {
      const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
      const targetCleaned = await cleanupFlowWorkspace(flow.targetWorkspaceId)
      cleaned = sourceCleaned && targetCleaned
    }
    if ((flow.kind === 'recover' || flow.kind === 'cleanup-confirm') && current === flow.targetSessionId) ctx.sessions.clear()
    closeImportFlow()
    if (!cleaned) setHomeNote('已取消导入，但临时工作区入口未能自动移除。')
  }
  const cancelSnapshotFlow = async () => {
    const flow = snapshotFlow
    let cleaned = true
    if (flow.kind === 'review') {
      const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
      const targetCleaned = await cleanupFlowWorkspace(flow.targetWorkspaceId)
      cleaned = sourceCleaned && targetCleaned
    }
    if ((flow.kind === 'recover' || flow.kind === 'cleanup-confirm') && current === flow.targetSessionId) ctx.sessions.clear()
    closeSnapshotFlow()
    if (!cleaned) setSnapshotNote('已取消恢复，但临时工作区入口未能自动移除。')
  }
  const renderImportDialog = () => e(ImportDialog, {
    flow: importFlow,
    onCancel: () => void cancelImportFlow(),
    onApply: () => void applyImportFlow(),
    onContinue: () => importFlow.kind === 'recover' ? void selectImportSource(importFlow.targetSessionId as SessionId, importFlow.targetWorkspaceId as WorkspaceId).catch(() => closeImportFlow()) : undefined,
    onCleanup: () => void cleanupImportFlow(),
  })
  const renderSnapshotDialog = () => e(SnapshotDialog, {
    flow: snapshotFlow,
    dirty: editorDirty,
    onCancel: () => void cancelSnapshotFlow(),
    onCreate: () => void createSnapshot(),
    onSelect: (snapshot: SnapshotView) => void restoreAsCopy(snapshot),
    onApply: () => void applySnapshotRestore(),
    onContinue: () => void continueSnapshotRestore(),
    onCleanup: () => void cleanupSnapshotRestore(),
  })

  if (view === 'settings' || setupGate !== 'ready') {
    return e('div', { className: 'settings-shell' },
      e('style', null, redesignedStyles),
      e('style', null, playfulStyles),
      e(ModelSetup, {
        connection: ctx.connection,
        onBack: setupGate === 'ready' ? () => setView('workspace') : undefined,
        onConfigured: () => { setSetupGate('ready'); setView('workspace') },
        onTestFailure: () => { setSetupGate('required'); setView('settings') },
        completionPreference,
        onCompletionPreferenceChange: setCompletionPreference,
      }),
    )
  }

  if (session && current && !verifiedRestoreSessions.current.has(current)) {
    return e('main', { className: 'shell no-session', style: { minWidth: 0, display: 'grid' } },
      e('style', null, redesignedStyles),
      e('style', null, playfulStyles),
      e('section', { className: 'empty-paper', 'aria-label': '正在验证作品恢复状态' },
        e('h1', null, '正在检查作品'),
        e('p', { role: 'status', 'aria-live': 'polite' }, '确认没有未完成恢复后再打开编辑器…'),
      ),
      renderImportDialog(),
      renderSnapshotDialog(),
    )
  }

  if (!session || !current) {
    return e('main', { className: 'shell no-session', style: { minWidth: 0, display: 'grid' } },
      e('style', null, redesignedStyles),
      e('style', null, homeStyles),
      e('style', null, playfulStyles),
      e('style', null, homePlayStyles),
      e('header', { className: 'chrome' },
        e('div', { className: 'brand-lockup' },
          e('span', { className: 'brand-mark', 'aria-hidden': 'true' }, 'D'),
          e('strong', null, 'DSH'),
        ),
        e('span', { className: 'local-state' }, e('i', { 'aria-hidden': 'true' }), '本地'),
        e('button', { className: 'settings-link icon-button', type: 'button', title: '设置', 'aria-label': '设置', onClick: openSettings }, '⌁'),
      ),
      e('aside', { className: 'sidebar', 'aria-label': '工作区与稿件' },
        e('div', { className: 'side-title' }, e('span', null, '文件')),
        workspaces.items.length ? e('div', { className: 'workspace-caption' }, '最近') : e('div', { className: 'workspace-empty' },
          e('span', { className: 'folder-glyph', 'aria-hidden': 'true' }),
          e('small', null, '未打开'),
        ),
        workspaces.items.map((workspace) => e('div', { className: 'workspace-row', key: workspace.workspaceId },
          e('button', {
            className: 'tree-row',
            type: 'button',
            onClick: () => void connectAndInitialize(workspace.workspaceId, false).catch(() => setHomeNote('工作区没有打开，请重试。')),
          }, workspace.title || workspace.path),
          e('button', { className: 'workspace-manage icon-button', type: 'button', 'aria-label': `管理作品 ${workspace.title || workspace.path}`, title: '管理作品', onClick: () => openWorkspaceManage(workspace, true) }, '···'),
        )),
      ),
      e('section', { className: 'empty-paper home-stage', 'aria-label': '空白稿纸' },
        e('div', { className: 'home-ink', 'aria-hidden': 'true' }, '写'),
        e('div', { className: 'home-card' },
          e('p', { className: 'home-eyebrow' }, 'DSH EDITOR'),
          e('h1', null, '开始写。'),
          e('div', { className: 'home-actions' },
            e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace, onClick: () => void pickWorkspace(false) }, openingWorkspace ? '打开中' : '打开作品', e('span', { 'aria-hidden': 'true' }, '↗')),
            e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void pickWorkspace(true) }, '新建'),
            e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void selectImportSource().catch(() => { closeImportFlow(); setHomeNote('导入目录没有打开，请重试。') }) }, '导入作品'),
          ),
          manualWorkspaceMode ? e('form', { className: 'path-fallback', onSubmit: submitWorkspacePath },
            e('label', null,
              e('span', null, '作品文件夹路径'),
              e('input', {
                value: manualWorkspacePath,
                onChange: (event: ChangeEvent<HTMLInputElement>) => setManualWorkspacePath(event.target.value),
                placeholder: '例如 D:/小说/作品',
                'aria-label': '作品文件夹路径',
                autoFocus: true,
              }),
            ),
            e('div', null,
              e('button', { className: 'primary-action', type: 'submit', disabled: openingWorkspace },
                openingWorkspace ? '打开中' : manualWorkspaceMode === 'new' ? '在此新建' : '打开此目录',
              ),
              e('button', {
                type: 'button',
                disabled: openingWorkspace,
                onClick: () => { setManualWorkspaceMode(null); setHomeNote('') },
              }, '取消'),
            ),
          ) : null,
          homeNote ? e('p', { className: 'warning', role: 'alert' }, homeNote) : null,
        ),
        e('div', { className: 'paper-motion', 'aria-hidden': 'true' },
          e('i', { className: 'paper-sheet sheet-back' }),
          e('i', { className: 'paper-sheet sheet-mid' }),
          e('div', { className: 'paper-sheet sheet-front' },
            e('span'), e('span'), e('span'), e('b'),
          ),
        ),
      ),
      workspaceManage ? e(WorkspaceManageDialog, {
        workspace: workspaceManage,
        busy: workspaceManageBusy,
        note: workspaceManageNote,
        onClose: () => closeWorkspaceManage(),
        onRename: (title: string) => void renameWorkspace(title),
        onRemove: () => void removeWorkspace(),
      }) : null,
      renderImportDialog(),
      renderSnapshotDialog(),
    )
  }

  const sidebarVisible = sidebarOpen && !focusMode
  const assistantVisible = assistantOpen && !focusMode
  const layoutColumns = [
    sidebarVisible ? `${sidebarWidth}px 7px` : '',
    'minmax(420px,1fr)',
    assistantVisible ? `7px ${assistantWidth}px` : '',
  ].filter(Boolean).join(' ')

  return e('main', {
    className: `shell layout-shell${focusMode ? ' focus-mode' : ''}${sidebarVisible ? ' files-open' : ''}${assistantVisible ? ' assistant-open' : ''}`,
    style: { minWidth: 0, gridTemplateColumns: layoutColumns },
  },
    e('style', null, redesignedStyles),
    e('style', null, playfulStyles),
    e('header', { className: 'chrome' },
      e('strong', null, 'DSH'),
      e('button', {
        className: 'workspace-home-button',
        type: 'button',
        title: '返回作品列表',
        'aria-label': '返回作品列表',
        onClick: () => void (async () => {
          if (editorDirty) { setWorkbenchNote('请先保存当前文档，再返回作品列表。'); return }
          if (!(await canLeaveAssistantDraft())) return
          setAssistantDraftDirty(false)
          setAssistantOpen(false)
          setFocusMode(false)
          ctx.sessions.clear()
        })(),
      }, '作品'),
      e('label', { className: 'workspace-select' }, e('span', { className: 'sr-only' }, '工作区'), e('select', {
        'aria-label': '选择工作区',
        value: currentWorkspace?.workspaceId ?? '',
        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
          const id = event.target.value as WorkspaceId
          if (!id || id === currentWorkspace?.workspaceId) return
          void (async () => {
            if (!(await canLeaveAssistantDraft())) return
            setAssistantDraftDirty(false)
            await connectAndInitialize(id, false).catch(() => setExportNote('工作区没有打开，请重试。'))
          })()
        },
      }, workspaces.items.map((workspace) => e('option', { key: workspace.workspaceId, value: workspace.workspaceId }, workspace.title || workspace.path)))),
      currentWorkspace ? e('button', { className: 'workspace-current-manage icon-button', type: 'button', 'aria-label': '管理当前作品', title: '修改作品显示名', onClick: () => openWorkspaceManage(currentWorkspace, false) }, '···') : null,
      e('nav', { className: 'layout-controls', 'aria-label': '工作台布局' },
        e('button', {
          type: 'button',
          disabled: focusMode,
          'aria-pressed': sidebarOpen,
          title: sidebarOpen ? '隐藏文件栏' : '显示文件栏',
          onClick: () => setSidebarOpen((value) => !value),
        }, '文件'),
        e('button', {
          type: 'button',
          'aria-pressed': focusMode,
          title: focusMode ? '退出专注写作' : '进入专注写作',
          onClick: () => setFocusMode((value) => !value),
        }, focusMode ? '退出专注' : '专注'),
        e('button', {
          type: 'button',
          disabled: focusMode,
          'aria-pressed': assistantOpen,
          title: assistantOpen ? '隐藏写作搭档' : '显示写作搭档',
          onClick: () => setAssistantOpen((value) => !value),
        }, '搭档'),
      ),
      e('div', { className: 'export-actions' },
        e('button', {
          type: 'button',
          disabled: snapshotBusy,
          onClick: openSnapshotPanel,
        }, snapshotBusy ? '快照处理中' : '作品快照'),
        e('details', { className: 'export-menu' },
          e('summary', null, exporting ? '导出中' : '导出'),
          e('div', null,
            e('button', { type: 'button', disabled: exporting, onClick: () => void exportNovel('markdown') }, 'Markdown'),
            e('button', { type: 'button', disabled: exporting, onClick: () => void exportNovel('text') }, 'TXT'),
          ),
        ),
        snapshotNote ? e('span', { role: /没有|请先|失败|未/.test(snapshotNote) ? 'alert' : 'status' }, snapshotNote) : null,
        exportNote ? e('span', { role: /无法|失败|为空/.test(exportNote) ? 'alert' : 'status' }, exportNote) : null,
        e('button', { className: 'settings-link icon-button', type: 'button', title: '键盘快捷键', 'aria-label': '键盘快捷键', onClick: openShortcuts }, '?'),
        e('button', { className: 'settings-link icon-button', type: 'button', title: '设置', 'aria-label': '设置', onClick: openSettings }, '⌁'),
      ),
    ),
    sidebarVisible ? e('aside', { className: 'sidebar', 'aria-label': '文件与项目资料' },
      e('div', { className: 'side-title' }, e('span', null, '文件'), e('button', { className: 'icon-button', type: 'button', onClick: () => openCreateDialog('chapter'), title: '新建章节', 'aria-label': '新建章节' }, '＋')),
      e('details', { className: 'project-actions' },
        e('summary', null, '新建资料'),
        e('div', null,
          e('button', { type: 'button', onClick: () => openCreateDialog('group') }, '卷/部'),
          e('button', { type: 'button', onClick: () => openCreateDialog('outline') }, '大纲'),
          e('button', { type: 'button', onClick: () => openCreateDialog('character') }, '人物'),
          e('button', { type: 'button', onClick: () => openCreateDialog('world') }, '设定'),
        ),
      ),
      createNote ? e('p', { className: 'warning pad', role: 'alert' }, createNote) : null,
      e(SearchPanel, {
        ctx,
        sessionId: session.sessionId,
        revision: treeRevision,
        navigationBlocked: editorDirty,
        onOpen: (hit: SearchHit) => openDocument(hit.path, hit),
      }),
      e('details', { className: 'archive-panel', onToggle: (event: ChangeEvent<HTMLDetailsElement>) => { if (event.currentTarget.open) void loadArchives() } },
        e('summary', null,
          e('span', null, '已归档'),
          visibleArchives(archives).length ? e('small', null, visibleArchives(archives).length) : null,
        ),
        e('div', { className: 'archive-list' },
          archiveBusy && !archives.length ? e('p', { className: 'muted' }, '读取中…') : null,
          !archiveBusy && !visibleArchives(archives).length ? e('p', { className: 'muted' }, '还没有归档文档。') : null,
          visibleArchives(archives).map((item) => e('article', { key: item.archiveId },
            e('div', null,
              e('strong', null, documentName(item.path)),
              e('small', null, `${archiveStateText(item)} · ${new Date(item.createdAt).toLocaleString()}`),
              e('code', null, item.path),
            ),
            item.state === 'archived' || item.state === 'pending-restore'
              ? e('button', { type: 'button', disabled: archiveBusy || editorDirty, onClick: () => void restoreArchived(item) }, item.state === 'pending-restore' ? '继续恢复' : '恢复')
              : item.state === 'pending-archive'
                ? e('button', { type: 'button', disabled: archiveBusy || editorDirty, onClick: () => void continueArchive(item) }, '继续归档')
                : null,
            item.message ? e('p', { className: 'warning' }, '归档内容无法安全操作，已停止。') : null,
          )),
          archiveInvalid ? e('p', { className: 'warning', role: 'alert' }, `${archiveInvalid} 条归档记录已损坏，未提供恢复操作。`) : null,
          archiveNote ? e('p', { className: 'warning', role: 'alert' }, archiveNote) : null,
        ),
      ),
      workbenchNote ? e('p', { className: 'warning pad', role: 'alert' }, workbenchNote) : null,
      currentWorkspace && indexStatus[currentWorkspace.workspaceId] ? e('div', { className: 'index-status', role: indexStatus[currentWorkspace.workspaceId] === 'failed' ? 'alert' : 'status' },
        e('span', null, indexStatus[currentWorkspace.workspaceId] === 'initializing' ? '索引中' : indexStatus[currentWorkspace.workspaceId] === 'queued' ? '索引已排队' : indexStatus[currentWorkspace.workspaceId] === 'failed' ? '索引失败' : '未索引'),
        e('button', { type: 'button', onClick: () => triggerExistingIndex(currentWorkspace.workspaceId, session.sessionId, true) }, indexStatus[currentWorkspace.workspaceId] === 'failed' ? '重试' : '重建索引'),
      ) : null,
      e(Tree, { ctx, sessionId: session.sessionId, active: path, onOpen: openDocument, onManage: openManage, onCreateChapter: (directory: string) => openCreateDialog('chapter', directory), revision: treeRevision }),
    ) : null,
    sidebarVisible ? e(PanelResizer, {
      side: 'left',
      value: sidebarWidth,
      minimum: SIDEBAR_MIN,
      maximum: SIDEBAR_MAX,
      defaultValue: SIDEBAR_DEFAULT,
      label: '调整文件栏宽度',
      onChange: setSidebarWidth,
    }) : null,
    e(Editor, { ctx, session, path, files, onOpen: openDocument, create: () => openCreateDialog('chapter'), externalRevision: contentRevision, onDirtyChange: setEditorDirty, reveal, completionPreference }),
    assistantVisible ? e(PanelResizer, {
      side: 'right',
      value: assistantWidth,
      minimum: ASSISTANT_MIN,
      maximum: ASSISTANT_MAX,
      defaultValue: ASSISTANT_DEFAULT,
      label: '调整写作搭档宽度',
      onChange: setAssistantWidth,
    }) : null,
    e(Chat, {
      key: session.sessionId,
      ctx,
      session,
      workspaceId: currentWorkspace?.workspaceId,
      activePath: path,
      hidden: !assistantVisible,
      onClose: () => setAssistantOpen(false),
      onConfigure: openSettings,
      onDraftDirtyChange: setAssistantDraftDirty,
      onApplied: (appliedPath: string) => {
        setTreeRevision((old) => old + 1)
        if (appliedPath === path) setContentRevision((old) => old + 1)
      },
    }),
    !assistantVisible && !focusMode ? e('button', {
      className: 'assistant-launcher',
      type: 'button',
      'aria-label': '打开写作搭档',
      'aria-expanded': false,
      onClick: () => setAssistantOpen(true),
    }, e('span', { 'aria-hidden': 'true' }, '⌁'), e('strong', null, '搭档')) : null,
    shortcutsOpen ? e(ShortcutDialog, { onClose: closeShortcuts }) : null,
    leaveConfirm ? e(ConfirmDialog, {
      id: 'leave-assistant-draft',
      title: '放弃未发送的消息？',
      message: '离开当前作品或打开设置后，这段文字不会自动保存。',
      confirmLabel: '放弃并继续',
      onCancel: () => resolveLeaveConfirm(false),
      onConfirm: () => resolveLeaveConfirm(true),
    }) : null,
    createRequest ? e(CreateDocumentDialog, {
      key: `${createRequest.kind}:${createRequest.directory}`,
      request: createRequest,
      busy: createBusy,
      note: createNote,
      onClose: closeCreateDialog,
      onCreate: (title: string) => void create(title),
    }) : null,
    workspaceManage ? e(WorkspaceManageDialog, {
      workspace: workspaceManage,
      busy: workspaceManageBusy,
      note: workspaceManageNote,
      onClose: () => closeWorkspaceManage(),
      onRename: (title: string) => void renameWorkspace(title),
      onRemove: () => void removeWorkspace(),
    }) : null,
    renderImportDialog(),
    renderSnapshotDialog(),
    managePath ? e(FileManageDialog, {
      key: managePath,
      path: managePath,
      busy: manageBusy,
      note: manageNote,
      moveDirectories: manageDirectories,
      onClose: closeManage,
      onRename: (name: string) => void renameManaged(name),
      onMove: (directory: string) => void moveManaged(directory),
      onArchive: () => void archiveManaged(),
    }) : null,
  )
}

const styles = `.shell{height:100vh;min-width:1280px;display:grid;grid-template-columns:220px minmax(0,1fr) 360px;grid-template-rows:40px minmax(0,1fr);background:#faf9f5;color:#171714;font:13px "Noto Sans SC","Microsoft YaHei",sans-serif}.chrome{grid-column:1/-1;display:flex;gap:18px;align-items:center;padding:0 14px;border-bottom:1px solid #e3e0d6}.chrome>span{color:#6b6a64;overflow:hidden;text-overflow:ellipsis}.workspace-select,.compact-control{display:flex;align-items:center;gap:6px;color:#6b6a64}.compact-control label{display:flex;align-items:center;gap:5px}.model-empty{align-items:flex-start;flex-wrap:wrap}.model-empty small{flex-basis:100%}.workspace-select select,.compact-control select{max-width:210px;border:0;background:transparent;color:#35342f}.sidebar{grid-column:1;border-right:1px solid #e3e0d6;min-height:0;display:flex;flex-direction:column;background:#f4f2ea}.side-title,.editor-header,.chat-header,.editor-tools{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e3e0d6}.project-actions{display:flex;gap:3px;padding:6px;border-bottom:1px solid #e3e0d6}.project-actions button,.export-actions button{padding:4px 7px;border:1px solid #d2cec2;border-radius:3px;background:#fffef9;color:inherit;cursor:pointer}.export-actions{margin-left:auto;display:flex;align-items:center;gap:6px;color:#6b6a64}.export-actions span{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.session-list{padding:6px;border-bottom:1px solid #e3e0d6;display:flex;gap:3px;flex-direction:column;max-height:132px;overflow:auto}.session-list button,.tree-row{display:block;width:100%;padding:5px 7px;text-align:left;border:0;border-radius:3px;background:none;color:inherit;cursor:pointer}.session-list .selected,.tree-row[aria-current=page]{background:#e0e9f2;color:#1b365d}.tree{overflow:auto;min-height:0;padding:7px 0}.editor{grid-column:2;min-width:0;min-height:0;display:grid;position:relative;grid-template-rows:auto minmax(0,1fr) auto;background:#faf9f5}.editor-header{font-size:12px;color:#6b6a64}.paper-input{box-sizing:border-box;width:100%;height:100%;padding:42px max(48px,10%);border:0;resize:none;background:transparent;color:#171714;font:18px/1.9 "Noto Serif SC","Songti SC",serif;outline:0}.ghost{position:absolute;left:10%;bottom:52px;max-width:58%;padding:5px 8px;color:#77746c;background:#f2f0e8;border-radius:3px;font:16px/1.8 "Noto Serif SC",serif;pointer-events:none}.proposal{position:absolute;right:18px;bottom:54px;width:min(380px,48%);padding:12px;border:1px solid #d5d1c5;border-radius:5px;background:#fffef9;box-shadow:0 8px 28px #342f251a}.proposal p{margin:4px 0 10px;white-space:pre-wrap}.proposal div,.pending-card div{display:flex;gap:8px}.editor-tools{border-top:1px solid #e3e0d6;border-bottom:0;justify-content:flex-start;gap:9px;color:#6b6a64;overflow:auto}.chat{grid-column:3;min-width:0;min-height:0;border-left:1px solid #e3e0d6;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#f4f2ea}.chat-header{align-items:flex-start;gap:8px}.chat-controls{display:grid;gap:4px;min-width:0}.chat-history{overflow:auto;padding:12px;display:flex;gap:9px;flex-direction:column}.chat-row,.pending-card{margin:0;padding:9px 10px;border:1px solid #dedbd1;border-radius:5px;background:#fffef9}.chat-row p,.pending-card p{margin:0;white-space:pre-wrap;line-height:1.6}.chat-row.user{margin-left:24px;background:#e0e9f2}.chat-row.tool,.chat-row.notice,.chat-row.unknown{font-size:12px;color:#504e49}.pending-card{display:grid;gap:8px;border-color:#c8a86a;background:#fffaf0}.pending-card fieldset{border:0;padding:0;margin:0;display:grid;gap:5px}.pending-card input{box-sizing:border-box;width:100%;padding:6px}.composer{border-top:1px solid #e3e0d6;padding:9px}.composer textarea{box-sizing:border-box;width:100%;min-height:66px;border:1px solid #d8d4c8;border-radius:4px;padding:7px;background:#fffef9;resize:vertical}.composer div{display:flex;justify-content:flex-end;gap:8px;padding-top:6px}.composer button,.editor-tools button,.proposal button,.pending-card button,.empty-paper button,.model-empty button,.home-actions button,.compact-control button,.model-panel button,.proposal-card button{padding:4px 9px;border:1px solid #d2cec2;border-radius:3px;background:#fffef9;color:inherit;cursor:pointer}.warning{color:#8a3a30}.success{color:#2f6b42}.muted{color:#77746c}.pad{padding:8px}.empty-paper{grid-column:2;display:grid;place-content:center;gap:12px;padding:48px;text-align:center;font:16px/1.8 "Noto Serif SC","Songti SC",serif}.empty-paper h1{font-size:28px;font-weight:500}.home-actions{display:flex;justify-content:center;gap:10px}.no-session{display:block;min-width:0}.no-session .empty-paper{height:100vh}.proposal-card{display:grid;gap:9px;padding:10px;border:1px solid #c8a86a;border-radius:6px;background:#fffaf0}.proposal-card header,.proposal-card footer{display:flex;align-items:center;justify-content:space-between;gap:7px}.proposal-card code{font-size:11px;color:#6b6a64}.proposal-diff{display:grid;gap:7px}.proposal-card pre{max-height:180px;margin:3px 0 0;padding:7px;overflow:auto;white-space:pre-wrap;border-radius:3px;background:#f4f2ea;font:12px/1.55 monospace}.proposal-card footer span{margin-right:auto;font-size:12px;color:#6b6a64}.proposal-card.expired{border-color:#b56a61}.proposal-card.applied{border-color:#6d9a78}.model-overlay{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:#25231f66}.model-panel{width:min(520px,calc(100vw - 48px));box-sizing:border-box;padding:22px;display:grid;gap:15px;border:1px solid #d4d0c4;border-radius:8px;background:#fffef9;box-shadow:0 24px 80px #17171433}.model-panel header,.model-panel footer{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.model-panel h2,.model-panel p{margin:0}.model-panel header p{margin-top:5px;color:#77746c}.model-panel>label{display:grid;gap:6px}.model-panel input[type=password],.model-panel input:not([type]){box-sizing:border-box;width:100%;padding:9px;border:1px solid #cbc7ba;border-radius:4px;background:white}.provider-tabs{display:flex;gap:16px;border:0;padding:0;margin:0}.provider-tabs legend{margin-bottom:7px}.provider-tabs label{display:flex;gap:5px}.model-panel footer{justify-content:flex-end}button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #1b365d;outline-offset:2px}@media(max-width:1320px){.shell{grid-template-columns:210px minmax(0,1fr) 340px}.paper-input{padding-inline:42px}}`

const redesignedStyles = `${styles}
.shell{height:100dvh;min-width:1280px;grid-template-columns:248px minmax(520px,1fr) 384px;grid-template-rows:52px minmax(0,1fr);background:#f5f0e5;color:#253b32;font:14px/1.5 "Noto Sans SC","Microsoft YaHei",sans-serif}.chrome{gap:14px;padding:0 20px;background:#fbf8ef;border-color:#d8d0bf}.chrome strong{font-family:"Noto Serif SC","Songti SC",serif;font-size:17px;letter-spacing:.04em}.chrome>span{color:#6d7468}.sidebar{background:#eee8da;border-color:#d8d0bf}.side-title,.editor-header,.chat-header,.editor-tools{padding:10px 14px;border-color:#ddd5c6}.side-title{font-weight:600;letter-spacing:.04em}.project-actions{display:block;padding:8px 12px;border-color:#ddd5c6}.project-actions summary{cursor:pointer;color:#647268}.project-actions div{display:flex;gap:6px;padding-top:7px}.project-actions button,.export-actions button,.settings-link{border-color:#c9c5b4;background:#fbf8ef;color:#304f41}.tree{padding:8px}.tree-row{padding:7px 8px;border-radius:4px;transition:transform 160ms ease,background-color 160ms ease,color 160ms ease}.tree-row:hover{background:#e1eadc;transform:translateX(2px)}.session-list .selected,.tree-row[aria-current=page]{background:#dbe8d7;color:#214838;font-weight:600}.index-status{display:grid;gap:6px;margin:10px 12px;padding:9px 10px;border-left:2px solid #5d806b;background:#f8f4e9;color:#53665a;font-size:12px}.index-status button{justify-self:start;padding:3px 0;border:0;background:transparent;color:#285c45;text-decoration:underline;cursor:pointer}.editor{background:#f8f3e8}.editor-header{color:#697269;background:#f3ecdf;font-variant-numeric:tabular-nums}.paper-input{margin:22px auto;width:min(100% - 48px,880px);height:calc(100% - 44px);padding:58px clamp(34px,7vw,92px);border:1px solid #e2dac9;border-radius:2px;background:#fffdf6;box-shadow:0 8px 26px #5a4d3510;color:#28382f;font:19px/1.95 "Noto Serif SC","Songti SC",serif}.editor-tools{background:#f3ecdf}.chat{border-color:#d8d0bf;background:#f0ebdf}.chat-header{background:#f7f3e9}.chat-row,.pending-card{border-color:#ddd5c6;border-radius:4px;background:#fffdf7}.chat-row.user{background:#dce9dd}.composer{border-color:#d8d0bf;background:#f7f3e9}.composer textarea{border-color:#cbc5b7;border-radius:3px;background:#fffdf7}.composer button,.editor-tools button,.proposal button,.pending-card button,.empty-paper button,.model-empty button,.home-actions button,.compact-control button,.model-panel button,.proposal-card button{border-color:#bfc5b8;border-radius:3px;background:#fffdf7;color:#2c5744;transition:transform 160ms ease,background-color 160ms ease}.composer button:hover,.editor-tools button:hover,.proposal button:hover,.pending-card button:hover,.empty-paper button:hover,.model-empty button:hover,.home-actions button:hover,.compact-control button:hover,.model-panel button:hover,.proposal-card button:hover{background:#e1eadc;transform:translateY(-1px)}.empty-paper{background:#f8f3e8;color:#33483c}.no-session .empty-paper{height:100dvh}.settings-shell{min-height:100dvh;background:#f5f0e5}.settings-view{box-sizing:border-box;min-height:100dvh;display:grid;place-items:center;padding:32px}.model-panel{width:min(620px,100%);padding:34px 36px;border:1px solid #d9d0bd;border-left:4px solid #386a50;border-radius:4px;background:#fffdf6;box-shadow:0 18px 48px #56483314}.settings-brand{margin:0 0 8px!important;color:#557062!important;font-size:12px;letter-spacing:.1em}.model-panel h2{margin:0;font:600 28px/1.25 "Noto Serif SC","Songti SC",serif;color:#294938}.model-panel header p{max-width:36em;line-height:1.7}.provider-tabs{gap:10px}.provider-tabs label{min-width:128px;padding:10px 12px;border:1px solid #d6d2c4;border-radius:4px;background:#fbf8ef;color:#315640;cursor:pointer}.provider-tabs input{accent-color:#386a50}.completion-preference{display:grid;grid-template-columns:1fr 1fr;gap:7px 10px;margin:0;padding:14px 0 0;border:0;border-top:1px solid #ded6c7}.completion-preference legend{padding:0;color:#294938;font-weight:600}.completion-preference p{grid-column:1/-1;color:#69766e;font-size:12px;line-height:1.65}.completion-preference label{display:flex;align-items:center;gap:7px;padding:9px 11px;border-radius:12px 4px 12px 4px;background:#f1ecdf;color:#315640;cursor:pointer}.completion-preference label:has(input:checked){background:#dce9dd;box-shadow:inset 0 0 0 1px #78917f}.completion-preference input{accent-color:#386a50}.model-panel>label input{transition:border-color 160ms ease,box-shadow 160ms ease}.model-panel>label input:focus{border-color:#6d8c79;box-shadow:0 0 0 3px #386a5014}.model-panel footer{padding-top:8px}.model-panel .primary-action{border-color:#315e48;background:#315e48;color:#fff}.model-panel .primary-action:hover{background:#284f3c}.settings-link{margin-left:auto;padding:5px 10px;cursor:pointer}.warning{color:#9a4b3b}.success{color:#356446}button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #386a50;outline-offset:3px}@media(max-width:1320px){.shell{grid-template-columns:216px minmax(440px,1fr) 330px}.paper-input{width:calc(100% - 32px);padding-inline:42px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:0.01ms!important;animation-duration:0.01ms!important}}
`

const playfulStyles = `
:root{--ink:#173f30;--leaf:#3d755a;--mint:#dcebdd;--paper:#fffdf6;--sand:#f2ecdf;--line:#d8cfbd;--ease:cubic-bezier(.22,1,.36,1)}
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.search-panel{display:grid;gap:7px;padding:9px 10px;border-bottom:1px solid var(--line);background:#f5efe2}.search-panel form{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:5px}.search-panel input,.search-panel select{box-sizing:border-box;min-width:0;border:1px solid #c9c3b5;background:#fffdf7;color:#294638}.search-panel input{padding:7px 9px;border-radius:12px 3px 3px 12px}.search-panel form>button{padding:0;border:1px solid #b9c5b8;border-radius:3px 10px 10px 3px;background:#dfeadd;color:#285c45}.search-panel select{grid-column:1/-1;padding:4px 7px;border:0;background:transparent;color:#657168;font-size:11px}.search-summary{display:flex;gap:6px;flex-wrap:wrap;color:#687168;font-size:11px}.search-summary strong{color:#9a4b3b}.search-results{max-height:210px;margin:0;padding:0;overflow:auto;list-style:none;display:grid;gap:4px}.search-results button{box-sizing:border-box;width:100%;display:grid;gap:2px;padding:7px 8px;border:0;border-radius:5px;background:#fffaf0;text-align:left;color:#304a3d}.search-results button:hover:not(:disabled){background:#dfeadd;transform:translateX(2px)}.search-results button:disabled{opacity:.55}.search-results strong,.search-results span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.search-results strong{font-size:11px}.search-results span{font-size:11px;color:#687168}.search-panel p{margin:0;font-size:11px}.chapter-navigation{display:flex;align-items:center;gap:5px;margin-left:auto}.chapter-navigation button{width:26px;height:26px;padding:0;border:1px solid #c7c4b7;border-radius:50%;background:#fffdf7;color:#315b47;font-size:18px;line-height:1}.chapter-navigation span{min-width:48px;text-align:center;color:#6a746b;font-variant-numeric:tabular-nums}.editor-header>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.editor-header>span:last-child{white-space:nowrap;margin-left:10px}
.tree-file-row,.tree-directory-row{position:relative;display:flex;align-items:center}.tree-file-row .tree-main,.tree-directory-row .tree-row{min-width:0;padding-right:34px}.tree-file-row .tree-manage,.tree-directory-row .tree-directory-add{position:absolute;right:4px;width:28px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:#667269;opacity:0}.tree-file-row:hover .tree-manage,.tree-file-row:focus-within .tree-manage,.tree-directory-row:hover .tree-directory-add,.tree-directory-row:focus-within .tree-directory-add{opacity:1}.tree-manage:hover,.tree-directory-add:hover{background:#d5e3d3!important;transform:none!important}.archive-panel{border-bottom:1px solid var(--line);background:#eee8da}.archive-panel>summary{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;color:#596a60;list-style:none}.archive-panel>summary::-webkit-details-marker{display:none}.archive-panel>summary small{display:grid;place-items:center;min-width:19px;height:19px;border-radius:50%;background:#d5e3d3}.archive-list{display:grid;gap:6px;max-height:230px;padding:0 9px 9px;overflow:auto}.archive-list>p{margin:4px;font-size:11px}.archive-list article{display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding:8px;border:1px solid #d7d0c1;border-radius:7px;background:#fffaf0}.archive-list article>div{min-width:0;display:grid;gap:1px;margin-right:auto}.archive-list article strong,.archive-list article small,.archive-list article code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.archive-list article small,.archive-list article code{color:#6c756d;font-size:10px}.archive-list article>button{flex:none;padding:4px 7px;border:1px solid #b9c5b8;border-radius:10px;background:#e3ecdf;color:#285c45}.archive-list article>p{flex-basis:100%;margin:0}.file-dialog-overlay{position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:24px;background:#272a2666;backdrop-filter:blur(4px)}.file-dialog{box-sizing:border-box;width:min(520px,100%);display:grid;gap:18px;padding:24px;border:1px solid #d8cfbd;border-radius:22px 6px 22px 6px;background:#fffdf6;box-shadow:0 28px 90px #2c2d2838}.file-dialog header,.file-dialog footer{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.file-dialog header>div{min-width:0;display:grid;gap:3px}.file-dialog h2{margin:0;color:#264b3a;font:600 26px/1.25 "Noto Serif SC","Songti SC",serif}.file-dialog small,.file-dialog code,.file-dialog p{color:#687168}.file-dialog code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-dialog-actions{display:grid;gap:8px}.file-dialog-actions>button{display:grid;gap:3px;padding:13px 14px;border:1px solid #d7d0c1;border-radius:12px 4px 12px 4px;background:#f8f3e8;text-align:left;color:#2f4e40}.file-dialog-actions>button span{color:#6c756d;font-size:12px}.file-dialog form,.archive-confirm{display:grid;gap:12px}.file-dialog label{display:grid;gap:6px}.file-dialog input,.file-dialog select{box-sizing:border-box;width:100%;padding:10px 11px;border:1px solid #c9c3b5;border-radius:8px;background:#fff}.file-dialog footer{justify-content:flex-end;align-items:center}.file-dialog footer button{padding:7px 12px;border:1px solid #bfc5b8;border-radius:12px 4px 12px 4px;background:#fff;color:#2c5744}.file-dialog footer .primary-action{background:#315e48;color:#fff}.file-dialog footer .danger-action{border-color:#a9695f;background:#8f4d43;color:#fff}.file-dialog>.warning{margin:0}.archive-confirm p{margin:0;line-height:1.7}
button,summary,.tree-row,.provider-tabs label{transition:transform 220ms var(--ease),background-color 220ms ease,border-color 220ms ease,color 220ms ease,box-shadow 220ms ease}button:active,.tree-row:active,summary:active{transform:scale(.96)}
.icon-button{display:grid!important;place-items:center;min-width:30px!important;width:30px;height:30px;padding:0!important;border-radius:50%!important;font-size:17px;line-height:1}.icon-button:hover{transform:rotate(8deg) scale(1.06)!important}
.chrome{animation:bar-drop 520ms var(--ease) both}.shell>.sidebar{animation:panel-left 560ms 70ms var(--ease) both}.shell>.editor,.shell>.empty-paper{animation:panel-rise 560ms 120ms var(--ease) both}.shell>.chat{animation:panel-right 560ms 170ms var(--ease) both}
.local-state{display:flex;align-items:center;gap:7px;border:0!important;padding:0!important;font-size:11px}.local-state i,.live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4c8a68;box-shadow:0 0 0 0 #4c8a6866;animation:signal 2.2s ease-out infinite}
.tree-row:hover{transform:translateX(4px)!important}.tree-row[aria-current=page]{box-shadow:inset 3px 0 #3d755a}.tree-row[aria-expanded=true]{color:var(--ink);font-weight:600}
.paper-input{transition:transform 360ms var(--ease),box-shadow 360ms ease,border-color 360ms ease}.paper-input:focus{transform:translateY(-2px);border-color:#b9c9ba;box-shadow:0 18px 44px #4b67471c,0 0 0 4px #5c8a6820}
.composer{transition:background-color 240ms ease,box-shadow 240ms ease}.composer:focus-within{background:#fffaf0;box-shadow:0 -12px 34px #5a4d3210}.composer textarea:focus{border-color:#73917d;box-shadow:0 0 0 3px #4d7d5d17}
.ghost-suggestion{box-sizing:border-box;max-height:42%;display:grid;gap:8px;overflow:auto;padding:12px 14px;border:1px solid #b9cbb9;border-radius:14px 4px 14px 14px;background:#f5faef;box-shadow:0 12px 32px #3f624719;pointer-events:auto}.ghost-suggestion strong,.proposal>strong{color:#28523f}.ghost-suggestion p{margin:0;overflow:auto;white-space:pre-wrap;line-height:1.7}.ghost-suggestion div,.proposal-actions{display:flex;gap:7px}.ghost-suggestion button,.proposal button{padding:5px 9px;border:1px solid #b8c5b7;border-radius:9px 3px 9px 9px;background:#fffdf7;color:#285640;cursor:pointer}.proposal{box-sizing:border-box;max-height:56%;overflow:auto}.selection-diff{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px!important;margin:9px 0}.selection-diff section{min-width:0;padding:8px;border:1px solid #ddd5c6;border-radius:7px;background:#f8f4e9}.selection-diff small{color:#68776d}.selection-diff p{max-height:150px;overflow:auto;white-space:pre-wrap;line-height:1.65}.proposal-actions{justify-content:flex-end}@media(max-width:1320px){.ghost-suggestion{max-width:72%}.proposal{width:min(430px,58%)}}
.export-actions .settings-link{margin-left:0}.shortcut-overlay{position:fixed;z-index:60;inset:0;display:grid;place-items:center;padding:24px;background:#202a246b;backdrop-filter:blur(5px)}.shortcut-dialog{box-sizing:border-box;width:min(620px,100%);max-height:min(760px,calc(100dvh - 48px));display:grid;gap:14px;overflow:auto;padding:26px;border:1px solid #d8cfbd;border-radius:22px 6px 22px 6px;background:#fffdf6;box-shadow:0 30px 90px #222a2538}.shortcut-dialog header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.shortcut-dialog header>div{display:grid;gap:4px}.shortcut-dialog h2,.shortcut-dialog p{margin:0}.shortcut-dialog h2{color:#244b39;font:600 28px/1.25 "Noto Serif SC","Songti SC",serif}.shortcut-dialog header small{color:#708078;font:10px/1 ui-monospace,Consolas,monospace;letter-spacing:.16em}.shortcut-dialog>p{color:#6c756d}.shortcut-dialog dl{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:0}.shortcut-dialog dl>div{display:flex;align-items:center;gap:12px;padding:10px 11px;border:1px solid #e0d8c9;border-radius:10px 3px 10px 10px;background:#f8f3e8}.shortcut-dialog dt{flex:none;min-width:112px;padding:3px 6px;border:1px solid #c7cebf;border-radius:5px;background:#fffdf7;color:#285640;font:11px/1.4 ui-monospace,Consolas,monospace}.shortcut-dialog dd{margin:0;color:#53645b;font-size:12px}@media(max-width:720px){.shortcut-dialog dl{grid-template-columns:1fr}}
.workspace-row{position:relative;display:flex;align-items:center;margin:0 9px}.workspace-row>.tree-row{min-width:0;padding-right:38px}.workspace-manage{position:absolute;right:3px;opacity:0}.workspace-row:hover .workspace-manage,.workspace-row:focus-within .workspace-manage{opacity:1}.workspace-home-button{padding:4px 9px;border:1px solid #d0c8b8;border-radius:12px 3px 12px 12px;background:#f7f2e8;color:#456250;cursor:pointer}.workspace-current-manage{flex:none;padding:3px 6px!important;border:0!important;background:transparent!important;color:#65756b!important}.workspace-dialog form>footer .danger-link{margin-right:auto;border-color:transparent;background:transparent;color:#914b40}.workspace-dialog form>footer .danger-link:hover{background:#f4e5df}.workspace-dialog code{max-width:420px}
.chat-row,.pending-card{animation:message-in 360ms var(--ease) both}.chat-row.user{transform-origin:right bottom}.chat-row.assistant{transform-origin:left bottom}.chat-row.tool strong::after{content:'···';display:inline-block;width:1.5em;overflow:hidden;vertical-align:bottom;animation:dots 1.2s steps(4,end) infinite}
.index-status{animation:index-breathe 2.4s ease-in-out infinite}.index-status button:hover{transform:translateX(2px)}
.export-actions{position:relative;z-index:12}.export-menu{position:relative}.export-menu summary{padding:5px 10px;border:1px solid #c9c5b4;border-radius:16px;background:#fbf8ef;color:#304f41;cursor:pointer;list-style:none}.export-menu summary::-webkit-details-marker{display:none}.export-menu[open] summary{background:#dce9dd}.export-menu>div{position:absolute;z-index:13;top:calc(100% + 8px);right:0;display:grid;min-width:130px;padding:6px;border:1px solid #d8cfbd;border-radius:10px 3px 10px 10px;background:#fffdf6;box-shadow:0 16px 40px #4e42261f;animation:menu-pop 180ms var(--ease)}.export-menu>div button{border:0;background:transparent;text-align:left;padding:8px 10px;border-radius:6px}.export-menu>div button:hover{background:#e4eee1}
.chat{position:relative}.conversation-setup{position:absolute;z-index:12;top:58px;right:12px;box-sizing:border-box;width:calc(100% - 24px);display:grid;gap:16px;padding:18px;border:1px solid #d8cfbd;border-radius:18px 5px 18px 18px;background:#fffdf6f5;box-shadow:0 22px 60px #4d41262b;backdrop-filter:blur(16px);animation:conversation-in 240ms var(--ease) both}.conversation-setup header,.conversation-setup footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.conversation-setup header{padding-bottom:4px}.conversation-setup header strong{font:600 22px/1.2 "Noto Serif SC","Songti SC",serif;color:#173f30}.conversation-setup label{display:block}.conversation-setup select{box-sizing:border-box;width:100%;padding:10px 12px;border:0;border-bottom:1px solid #aeb9ad;background:transparent;color:#264838}.conversation-setup footer{justify-content:flex-end}.conversation-setup footer button{padding:7px 13px;border:0;border-radius:14px 4px 14px 14px;background:#ece6d9}.conversation-setup footer .primary-action{min-width:72px;background:#285c45;color:#fff;box-shadow:0 8px 20px #285c4526}.conversation-setup footer .primary-action:hover{transform:translateY(-2px)!important;box-shadow:0 12px 26px #285c4533}
.settings-shell{position:relative;overflow:hidden;background:radial-gradient(circle at 18% 20%,#dfeadc 0 8%,transparent 28%),radial-gradient(circle at 84% 78%,#eadfc8 0 7%,transparent 25%),#f4efe3}.settings-view{position:relative;isolation:isolate}.settings-view::before,.settings-view::after{content:'';position:absolute;z-index:-1;border-radius:50%;pointer-events:none}.settings-view::before{width:280px;height:280px;left:8%;top:12%;border:1px solid #73917d55;box-shadow:inset 0 0 0 34px #dce8db55;animation:orbit-drift 9s ease-in-out infinite}.settings-view::after{width:160px;height:160px;right:10%;bottom:10%;background:#d7e5d6;filter:blur(1px);animation:blob-drift 7s ease-in-out infinite alternate}.model-panel{position:relative;width:min(660px,100%);padding:38px 42px 40px;border:0;border-radius:28px 7px 28px 7px;overflow:hidden;box-shadow:0 30px 80px #4e422621,0 0 0 1px #d8cfbd;background:#fffdf6eF;backdrop-filter:blur(18px);animation:settings-pop 560ms var(--ease) both}.model-panel::after{content:'⌁';position:absolute;right:-24px;top:-38px;color:#dce8da;font:160px/1 Georgia,serif;transform:rotate(18deg);pointer-events:none}.model-panel>*{position:relative;z-index:1}.model-panel>label,.provider-tabs{animation:field-in 420ms var(--ease) both}.model-panel>label:nth-of-type(1){animation-delay:90ms}.model-panel>label:nth-of-type(2){animation-delay:140ms}.model-panel>label:nth-of-type(3){animation-delay:190ms}.model-panel h2{font-size:42px!important;letter-spacing:-.06em!important}.model-panel header p{margin-top:3px!important}.provider-tabs label{border:0!important;border-radius:14px 4px 14px 4px!important;background:#f1ecdf!important}.provider-tabs label:has(input:checked){background:#dce9dd!important;color:#173f30!important;box-shadow:inset 0 0 0 1px #78917f;transform:translateY(-2px)}.model-panel input[type=password],.model-panel input:not([type]){border:0!important;border-bottom:1px solid #bfb8a9!important;border-radius:0!important;padding:11px 2px!important;background:transparent!important}.model-panel input:focus{box-shadow:none!important;border-color:#35684f!important}.model-panel .primary-action{min-width:104px;padding:10px 18px;border-radius:18px 5px 18px 18px!important;box-shadow:0 9px 22px #315e4826}.model-panel .primary-action:hover{transform:translateY(-3px) rotate(-1deg)!important;box-shadow:0 14px 28px #315e4833}
.brand-mark{animation:mark-arrive 620ms 120ms var(--ease) both}.brand-mark:hover{transform:rotate(7deg) scale(1.08)!important}.empty-paper-mark{display:block;color:#72927e;font-size:34px;animation:mark-float 3s ease-in-out infinite}.empty-paper h1{margin:0}.empty-paper>button{margin-inline:auto}
@keyframes bar-drop{from{opacity:0;transform:translateY(-100%)}to{opacity:1;transform:none}}@keyframes panel-left{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}@keyframes panel-right{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}@keyframes panel-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}@keyframes message-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}@keyframes menu-pop{from{opacity:0;transform:translateY(-5px) scale(.96)}to{opacity:1;transform:none}}@keyframes conversation-in{from{opacity:0;transform:translateY(-8px) scale(.96);transform-origin:top right}to{opacity:1;transform:none}}@keyframes signal{60%,100%{box-shadow:0 0 0 10px #4c8a6800}}@keyframes dots{0%{width:0}100%{width:1.5em}}@keyframes index-breathe{50%{border-left-color:#9db7a2;background:#f5f2e6}}@keyframes orbit-drift{50%{transform:translate(28px,18px) rotate(35deg)}}@keyframes blob-drift{to{transform:translate(-36px,-22px) scale(1.18);border-radius:38% 62% 54% 46%}}@keyframes settings-pop{from{opacity:0;transform:translateY(24px) rotate(.8deg) scale(.97)}to{opacity:1;transform:none}}@keyframes field-in{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}@keyframes mark-arrive{from{opacity:0;transform:rotate(-18deg) scale(.6)}to{opacity:1;transform:rotate(-2deg) scale(1)}}@keyframes mark-float{50%{transform:translateY(-7px) rotate(5deg)}}
@media(prefers-reduced-motion:reduce){.chrome,.shell>.sidebar,.shell>.editor,.shell>.empty-paper,.shell>.chat,.chat-row,.pending-card,.conversation-setup,.model-panel,.model-panel>label,.provider-tabs,.brand-mark,.empty-paper-mark,.settings-view::before,.settings-view::after,.local-state i,.live-dot,.index-status{animation:none!important}.paper-input:focus,.tree-row:hover,.icon-button:hover,.model-panel .primary-action:hover{transform:none!important}}
.shell:not(.no-session){grid-template-columns:248px minmax(0,1fr)}.chat{position:fixed;z-index:10;inset:52px 0 0 auto;width:min(404px,calc(100vw - 280px));grid-column:auto;border:1px solid #d8d0bf;border-right:0;border-bottom:0;border-radius:22px 0 0 0;box-shadow:-24px 0 64px #4d41261f;overflow:hidden}.chat-header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center}.conversation-select{grid-column:2;grid-row:1;min-width:0}.conversation-select select{box-sizing:border-box;width:100%;min-width:84px;max-width:none;padding:4px 22px 4px 7px;border:1px solid #d6d0c2;border-radius:4px;background:#fffdf7;color:#315640;text-overflow:ellipsis}.chat-controls{grid-column:1/-1;grid-row:2}.chat-controls .compact-control{min-width:0}.chat-controls .model-indicator{max-width:280px}.chat-header-actions{grid-column:3;grid-row:1;display:flex;gap:4px}.assistant-launcher{position:fixed;z-index:9;right:24px;bottom:24px;display:flex;align-items:center;gap:9px;padding:10px 15px 10px 10px;border:1px solid #95a89a;border-radius:22px 7px 22px 22px;background:#fffdf6ef;color:#244f3c;box-shadow:0 16px 42px #4d412626;backdrop-filter:blur(14px);cursor:pointer;animation:launcher-in 420ms var(--ease) both}.assistant-launcher span{display:grid;width:28px;height:28px;place-items:center;border-radius:50%;background:#dce9dd;font-size:17px;animation:mark-float 3s ease-in-out infinite}.assistant-launcher strong{font-size:13px}.assistant-launcher:hover{transform:translateY(-5px) rotate(-1deg);box-shadow:0 22px 50px #4d412633}.model-panel>label>span,.provider-tabs legend{color:#42594c!important;font-weight:500}.model-panel input[type=password],.model-panel input:not([type]){color:#2e4438!important}.model-panel input::placeholder{color:#7d857e!important;opacity:1}@keyframes launcher-in{from{opacity:0;transform:translateY(12px) scale(.9)}to{opacity:1;transform:none}}@media(max-width:1320px){.shell:not(.no-session){grid-template-columns:216px minmax(0,1fr)}}@media(prefers-reduced-motion:reduce){.assistant-launcher,.assistant-launcher span{animation:none!important}.assistant-launcher:hover{transform:none!important}}
.model-indicator{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#647268}
.project-context-receipt{margin-top:7px;color:#637269;font-size:11px}.project-context-receipt summary{cursor:pointer}.project-context-receipt ul{display:grid;gap:3px;margin:6px 0 0;padding-left:16px}.project-context-receipt code{font-size:10px;color:#466354}
.editor:has(>.worldbook-settings){grid-template-rows:auto auto minmax(0,1fr) auto}.worldbook-settings{display:grid;grid-template-columns:minmax(160px,1fr) auto 88px auto;align-items:end;gap:8px 12px;padding:10px 14px;border-bottom:1px solid #ddd5c6;background:#f7f3e9;color:#53665a}.worldbook-settings>div{grid-column:1/-1;display:flex;align-items:baseline;gap:9px;min-width:0}.worldbook-settings>div small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.worldbook-settings>div .warning{margin-left:auto}.worldbook-settings label{display:grid;gap:3px;font-size:11px}.worldbook-settings textarea,.worldbook-settings input[type=number],.worldbook-settings label:not(.worldbook-enabled)>input{box-sizing:border-box;width:100%;min-width:0;padding:6px 7px;border:1px solid #cbc5b7;border-radius:4px;background:#fffdf7;color:#28382f}.worldbook-settings textarea{min-height:30px;max-height:78px;resize:vertical;font:inherit}.worldbook-settings .worldbook-enabled{display:flex;align-items:center;gap:5px;padding-bottom:6px;white-space:nowrap}.worldbook-settings button{margin-bottom:0;padding:6px 9px;border:1px solid #bfc5b8;border-radius:3px;background:#fffdf7;color:#2c5744;cursor:pointer}.worldbook-settings button:hover{background:#e1eadc}.worldbook-settings button:disabled,.worldbook-settings input:disabled,.worldbook-settings textarea:disabled{cursor:not-allowed;opacity:.55}@media(max-width:1180px){.worldbook-settings>div small{display:none}.worldbook-settings{grid-template-columns:minmax(130px,1fr) auto 78px auto;gap-inline:8px}}
.import-overlay{position:fixed;z-index:40;inset:0;display:grid;place-items:center;padding:24px;background:#1f2d2570}.import-dialog{box-sizing:border-box;width:min(520px,100%);display:grid;gap:14px;padding:24px;border:1px solid #d8cfbd;border-radius:16px 4px 16px 4px;background:#fffdf6;box-shadow:0 28px 80px #1c28221f}.import-dialog h2,.import-dialog p{margin:0}.import-dialog ul{max-height:170px;margin:0;overflow:auto;padding-left:20px;color:#5c6e62}.import-dialog footer{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px}.import-dialog button{padding:7px 11px;border:1px solid #b9c8ba;border-radius:4px;background:#f5f1e6;color:#2c5744;cursor:pointer}.snapshot-dialog{width:min(620px,100%)}.snapshot-list{display:grid;gap:8px;max-height:280px!important;padding:0!important;list-style:none}.snapshot-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid #ded6c7;border-radius:8px;background:#faf6ec}.snapshot-list li div{display:grid;gap:3px;min-width:0}.snapshot-list li strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#294938}.snapshot-list li small{color:#6b776e}
.layout-shell{grid-template-rows:52px minmax(0,1fr);overflow:hidden}.layout-shell>.sidebar,.layout-shell>.editor,.layout-shell>.empty-paper,.layout-shell>.chat,.layout-shell>.panel-resizer{grid-column:auto;grid-row:2;min-width:0}.layout-shell>.chat{position:relative;z-index:1;inset:auto;width:auto;min-width:0;border:0;border-left:1px solid #d8d0bf;border-radius:0;box-shadow:none;overflow:hidden}.layout-shell>.chat[hidden]{display:none!important}.layout-shell>.editor{grid-column:auto}.layout-shell>.sidebar{grid-column:auto}.layout-controls{display:flex;align-items:center;gap:3px;padding:3px;border:1px solid #d8d0bf;border-radius:15px 5px 15px 15px;background:#f1ecdf}.layout-controls button{min-width:42px;padding:4px 8px;border:0;border-radius:11px 3px 11px 11px;background:transparent;color:#526b5d;cursor:pointer}.layout-controls button[aria-pressed=true]{background:#d8e6d8;color:#183f2f;font-weight:600}.layout-controls button:disabled{cursor:not-allowed;opacity:.45}.panel-resizer{position:relative;z-index:4;min-width:0;cursor:col-resize;touch-action:none;user-select:none;background:#e6dfd1;transition:background-color 140ms ease}.panel-resizer span{position:absolute;inset:0 2px;border-radius:4px;background:transparent}.panel-resizer:hover,.panel-resizer:focus-visible,.panel-resizer[aria-valuenow]{outline:0}.panel-resizer:hover span,.panel-resizer:focus-visible span{background:#6f927c}.layout-shell.focus-mode .paper-input{width:min(calc(100% - 64px),980px);padding-inline:clamp(52px,10vw,128px);box-shadow:0 14px 42px #4b674719}.layout-shell.focus-mode .editor-header{padding-inline:20px}.layout-shell.focus-mode .editor-tools{justify-content:center}.layout-shell.assistant-open .assistant-launcher{display:none}@media(max-width:1180px){.layout-controls button{min-width:36px;padding-inline:6px}.layout-shell .paper-input{width:calc(100% - 28px);padding-inline:34px}}@media(prefers-reduced-motion:reduce){.panel-resizer{transition:none!important}}
`

const homeStyles = `
.brand-lockup{display:flex;align-items:center;gap:10px}.brand-lockup>div{display:grid;line-height:1.05}.brand-lockup small{margin-top:4px;color:#728078;font-size:10px;letter-spacing:.12em}.brand-mark{display:grid;width:28px;height:28px;place-content:center;border:1px solid #6c8575;border-radius:8px 3px 8px 3px;background:#e4ecdf;color:#285640;font:600 15px/1 "Noto Serif SC","Songti SC",serif;transform:rotate(-2deg)}.local-state{padding-left:8px!important;border-left:1px solid #d7d0c1}.sidebar .side-title small{color:#889087;font-size:10px;font-weight:400}.workspace-caption{padding:14px 14px 4px;color:#7d857d;font-size:11px;letter-spacing:.08em}.workspace-empty{display:grid;justify-items:start;gap:5px;margin:18px 14px;padding:18px 14px;border:1px dashed #cfc8b8;border-radius:8px;background:#f5f0e4;color:#617066}.workspace-empty>span{color:#3f6a53;font-size:24px}.workspace-empty strong{font-size:13px}.workspace-empty small{line-height:1.6}.home-stage{display:grid;place-items:center;padding:54px;background:#f7f2e7;text-align:left}.home-card{box-sizing:border-box;width:min(650px,88%);padding:58px 62px 54px;border:1px solid #ddd3bf;border-left:4px solid #386a50;border-radius:5px 14px 5px 5px;background:#fffdf6;box-shadow:0 20px 55px #594b3214;animation:home-rise 320ms ease-out}.home-card h1{max-width:12em;margin:0 0 18px;color:#284b3a;font-size:34px;line-height:1.35;letter-spacing:-.03em}.home-card>p:not(.home-eyebrow){max-width:34em;margin:0;color:#657168;font:16px/1.9 "Noto Serif SC","Songti SC",serif}.home-eyebrow{margin:0 0 12px;color:#537263;font-size:12px;letter-spacing:.16em}.home-card>small{display:block;margin-top:22px;color:#7b827b;line-height:1.6}.home-actions{justify-content:flex-start;margin-top:28px;gap:12px}.home-actions button{min-width:116px;padding:9px 16px}.home-actions .primary-action{border-color:#315e48;background:#315e48;color:#fff}.home-actions .primary-action:hover{background:#284f3c}.empty-chat .chat-header>div{display:grid;gap:2px}.empty-chat .chat-header small{color:#7b847d;font-size:10px;letter-spacing:.08em}.chat-empty-body{display:grid;align-content:start;gap:22px;padding:28px 20px;color:#667168}.chat-empty-body p{margin:0;line-height:1.8}.chat-empty-body div{display:flex;flex-wrap:wrap;gap:8px}.chat-empty-body span{padding:5px 9px;border:1px solid #d5cebe;border-radius:3px;background:#faf6ec;color:#52705f;font-size:12px}@keyframes home-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.home-card{animation:none}}
`

const homePlayStyles = `
.no-session{grid-template-columns:230px minmax(560px,1fr) 300px;grid-template-rows:52px minmax(0,1fr);background:#f3eddf}.no-session .chrome{background:#fffaf0cc;backdrop-filter:blur(14px)}.no-session .empty-paper{height:auto}.brand-lockup{gap:9px}.brand-lockup>strong{font-size:18px;letter-spacing:-.04em}.brand-mark{width:30px;height:30px;border:0;border-radius:50% 50% 50% 12%;background:#234f3b;color:#fff;font:700 13px/1 Georgia,serif;box-shadow:0 7px 18px #234f3b33}.sidebar .side-title{padding:16px 18px 12px;border:0}.workspace-caption{padding:12px 18px 5px}.workspace-empty{justify-items:center;gap:10px;margin:30px 18px;padding:22px 8px;border:0;background:transparent;color:#7e877f}.folder-glyph{position:relative;width:42px;height:30px;border:1px solid #a9b4aa;border-radius:4px 10px 7px 7px;background:#f8f3e8;transform:rotate(-3deg);animation:folder-wiggle 5s ease-in-out infinite}.folder-glyph::before{content:'';position:absolute;left:4px;top:-7px;width:17px;height:8px;border:1px solid #a9b4aa;border-bottom:0;border-radius:5px 5px 0 0;background:#f8f3e8}.home-stage{position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(260px,.85fr) minmax(260px,.72fr);align-items:center;justify-content:center;gap:clamp(32px,6vw,90px);overflow:hidden;padding:clamp(40px,7vw,96px);background:radial-gradient(circle at 65% 46%,#fffaf0 0 16%,transparent 42%),#f7f2e7;text-align:left}.home-ink{position:absolute;z-index:-1;left:4%;bottom:-18%;color:#1f503b;font:700 clamp(360px,40vw,640px)/.8 "Noto Serif SC","Songti SC",serif;opacity:.035;animation:ink-drift 12s ease-in-out infinite alternate}.home-card{width:auto;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;animation:copy-arrive 620ms 180ms var(--ease) both}.home-card h1{max-width:none;margin:2px 0 34px;color:#173f30;font-size:clamp(58px,6vw,86px);line-height:.98;letter-spacing:-.09em;text-wrap:balance}.home-eyebrow{margin:0 0 16px;color:#60806d;font:600 11px/1.2 ui-monospace,"SFMono-Regular",Consolas,monospace;letter-spacing:.24em}.home-actions{justify-content:flex-start;margin:0;gap:12px}.home-actions button{min-width:auto;padding:11px 18px;border:0;border-radius:18px 6px 18px 18px;background:#e5dfd2}.home-actions button:hover{transform:translateY(-4px) rotate(1deg)!important;box-shadow:0 12px 24px #4c3e2517}.home-actions .primary-action{display:flex;align-items:center;gap:18px;padding-left:20px;border:0;background:#244f3c;color:#fff;box-shadow:0 10px 28px #244f3c2b}.home-actions .primary-action span{transition:transform 220ms var(--ease)}.home-actions .primary-action:hover span{transform:translate(3px,-3px)}.paper-motion{position:relative;width:min(30vw,330px);aspect-ratio:.78;justify-self:center;perspective:900px;animation:paper-hover 5.8s ease-in-out infinite}.paper-sheet{position:absolute;inset:0;border:1px solid #ded4bf;background:#fffdf6;box-shadow:0 28px 56px #55472c1b}.sheet-back{transform:translate(25px,17px) rotate(8deg);border-radius:6px 18px 6px 6px;background:#e5eadc}.sheet-mid{transform:translate(10px,8px) rotate(3deg);border-radius:7px 16px 7px 7px;background:#f1e9d7}.sheet-front{display:grid;align-content:start;gap:18px;box-sizing:border-box;padding:27% 17%;border-radius:8px 24px 8px 8px;transform:rotate(-2deg);transition:transform 450ms var(--ease),box-shadow 450ms ease}.paper-motion:hover .sheet-front{transform:translateY(-9px) rotate(-4deg);box-shadow:0 38px 70px #55472c28}.sheet-front span{height:3px;border-radius:3px;background:#86a18f;transform:scaleX(0);transform-origin:left;animation:line-write 4.6s var(--ease) infinite}.sheet-front span:nth-child(2){width:82%;animation-delay:.22s}.sheet-front span:nth-child(3){width:58%;animation-delay:.44s}.sheet-front b{width:2px;height:22px;margin-top:4px;background:#315e48;animation:cursor-blink .9s steps(1) infinite}.home-stage>.warning{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);margin:0}.empty-chat .chat-header{align-items:center}.chat-empty-body{place-items:center;align-content:center;gap:20px;padding:28px}.chat-empty-body>small{color:#809087;font-size:11px;letter-spacing:.14em}.agent-orb{position:relative;display:grid;width:110px;height:110px;place-items:center;border:1px solid #8ca090;border-radius:45% 55% 52% 48%;color:#315e48;font-size:30px;animation:orb-morph 7s ease-in-out infinite}.agent-orb::before,.agent-orb::after{content:'';position:absolute;border-radius:50%}.agent-orb::before{inset:12px;border:1px dashed #9daf9f;animation:orb-spin 12s linear infinite}.agent-orb::after{width:9px;height:9px;right:5px;top:24px;background:#4e8867;box-shadow:0 0 0 6px #4e88671a}.agent-orb span{animation:mark-float 3s ease-in-out infinite}
@keyframes copy-arrive{from{opacity:0;transform:translateX(-22px)}to{opacity:1;transform:none}}@keyframes ink-drift{to{transform:translate(5%,3%) rotate(-3deg)}}@keyframes paper-hover{50%{transform:translateY(-12px) rotate(.8deg)}}@keyframes line-write{0%,10%{transform:scaleX(0);opacity:.3}32%,76%{transform:scaleX(1);opacity:1}94%,100%{transform:scaleX(1);opacity:0}}@keyframes cursor-blink{50%{opacity:0}}@keyframes folder-wiggle{50%{transform:translateY(-4px) rotate(2deg)}}@keyframes orb-spin{to{transform:rotate(360deg)}}@keyframes orb-morph{0%,100%{border-radius:45% 55% 52% 48%;transform:rotate(-2deg)}50%{border-radius:56% 44% 42% 58%;transform:translateY(-8px) rotate(3deg)}}
@media(max-width:1180px){.no-session{grid-template-columns:210px minmax(480px,1fr) 250px}.home-stage{gap:28px;padding:48px}.home-card h1{font-size:58px}.paper-motion{width:250px}}@media(prefers-reduced-motion:reduce){.folder-glyph,.home-ink,.home-card,.paper-motion,.sheet-front span,.sheet-front b,.agent-orb,.agent-orb::before,.agent-orb span{animation:none!important}.sheet-front span{transform:scaleX(1);opacity:1}}
.no-session{grid-template-columns:230px minmax(560px,1fr)}@media(max-width:1180px){.no-session{grid-template-columns:210px minmax(480px,1fr)}}
.path-fallback{display:grid;gap:10px;margin-top:18px}.path-fallback label{display:grid;gap:6px;color:#52695b;font-size:12px}.path-fallback input{box-sizing:border-box;width:min(520px,100%);padding:10px 12px;border:1px solid #b9c3b8;border-radius:4px;background:#fffdf7;color:#253b32}.path-fallback>div{display:flex;gap:8px}.path-fallback button{padding:8px 13px;border:0;border-radius:14px 4px 14px 14px;background:#e5dfd2;color:#2c5744}.path-fallback .primary-action{background:#244f3c;color:#fff}.home-card>.warning{max-width:36em;margin:12px 0 0;font-size:13px}
`

export function apply(ctx: Context): void {
  const client = ctx as ShellContext
  registerRoot(client, () => e(Root, { ctx: client }))
}
