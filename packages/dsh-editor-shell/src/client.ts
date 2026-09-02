import type { Context } from '@deepseek-ai/cordis'
import type {
  ClientContext,
  ConversationSnapshot,
  PendingInteraction,
  SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConnectionHandle,
  SessionId,
  SessionModels,
  WorkspaceId,
  WorkspaceView,
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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  WORKBENCH_RPC_CHANNEL,
  formatWorldbookTriggerLines,
  parseWorldbookTriggerLines,
  worldbookEditorMetadata,
  writeWorldbookFrontmatter,
  type WorkbenchRpcResult,
  type ArchiveListResponse,
  type ChapterStatus,
  type ProjectOverview,
  type ProjectInspectionResponse,
  type ProjectContextReceiptBundle,
} from 'dsh-editor-workbench/contracts'
import type { ProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import {
  answerApproval,
  answerQuestions,
  chatRows,
  internalIndexTurnActive,
  loadOlder,
  partialText,
  readModels,
  selectModel,
  sendProjectContext,
  stop,
  visibleRunningCalls,
  type QuestionAnswerItem,
} from './adapter.ts'
import type { EditorDraft } from './drafts.ts'
import { DraftSyncQueue } from './drafts.ts'
import {
  addCompletionCandidate,
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
import { buildNovelIndexPrompt } from './novel-index.ts'
import { prepareExport, type ChapterExport, type ExportFormat, type PreparedExport } from './export.ts'
import { archiveStateText, documentName, visibleArchives, type ArchiveView } from './file-lifecycle.ts'
import { documentTemplate, manuscriptGroupPath, nextChapterPath, nextDocumentPath, sortChapterPaths, type DocumentKind } from './project-files.ts'
import { idleImportFlow, importReview, recoverImport, importSummary, type ImportFlow, type ImportProbeView } from './import-flow.ts'
import { ConversationRenameQueue, conversationRows, nextAutomaticConversationTitle, shouldConfirmConversationSwitch } from './conversation-lifecycle.ts'
import { automaticCompletionReady, type CompletionPreference } from './completion-preference.ts'
import { normalizeAuthorPreferences } from './author-preferences.ts'
import {
  idleSnapshotFlow,
  recoverSnapshot,
  restoreSummary,
  snapshotReview,
  snapshotSummary,
  type RestoreView,
  type SnapshotFlow,
  type SnapshotView,
} from './snapshot-flow.ts'
import { referenceQuery, type ReferenceQuery } from './reference-navigation.ts'
import { chapterStatusText, ExportPreviewDialog } from './project-views.ts'
import { homePlayStyles, homeStyles, playfulStyles, redesignedStyles } from './styles.ts'
import { WRITING_SETTINGS_NAMESPACE, createWritingMigration, decodeWritingPreferences, registerWritingSettings, writingPreferences, type WritingPreferences, type WritingSettingsSlots } from './writing-settings.ts'

export const name = 'dsh-editor-shell-client'
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'settingsScope'] as const

type Entry = { name: string; type: 'file' | 'directory' | 'other' }
type SearchHit = { path: string; line: number; column: number; start: number; end: number; excerpt: string; version: string }
type SearchResponse = { results: SearchHit[]; scannedFiles: number; scannedBytes: number; skipped: number; truncated: boolean }
type RevealRequest = SearchHit & { nonce: number }
type ReferenceSearchRequest = ReferenceQuery & { nonce: number }
type RpcResult<T = unknown> = WorkbenchRpcResult<T>
type WorkspaceIntent = 'open' | 'create'
type WorkspaceOpenState =
  | { kind: 'idle' }
  | { kind: 'checking'; workspaceId?: WorkspaceId; path: string; title: string }
  | { kind: 'ready'; workspaceId: WorkspaceId; sessionId: SessionId; path: string; warning?: string }
  | { kind: 'needs-relocation'; workspaceId: WorkspaceId; path: string; title: string; message: string }
  | { kind: 'needs-recovery'; workspaceId: WorkspaceId; sessionId: SessionId; path: string; title: string; recovery: 'import' | 'restore' }
  | { kind: 'needs-intent'; workspaceId: WorkspaceId; path: string; title: string; intent: WorkspaceIntent; message: string }
  | { kind: 'error'; workspaceId?: WorkspaceId; path: string; title: string; message: string }
type ShellContext = ClientContext & { connection: ConnectionHandle } & WritingSettingsSlots & {
  settingsScope: { bind(spec: { namespace: string; decode(value: unknown): WritingPreferences | undefined }): import('@deepseek-ai/dsh-client-runtime/client').SettingsScope<WritingPreferences> }
}

const SIDEBAR_DEFAULT = 248
const SIDEBAR_MIN = 196
const SIDEBAR_MAX = 420
const ASSISTANT_DEFAULT = 384
const conversationRenameQueue = new ConversationRenameQueue()
const ASSISTANT_MIN = 300
const ASSISTANT_MAX = 560

function DeepSeekWhaleMark() {
  return e('svg', {
    className: 'whale-mark',
    viewBox: '0 0 32 32',
    'aria-hidden': 'true',
    focusable: 'false',
  },
    e('path', {
      fill: 'currentColor',
      d: 'M3.4 12.2c1.2-3.6 4.2-5.4 7.6-5.2.6-2.6 2.8-4.6 5.8-5 3.2-.4 6 1.2 7.2 4.2 2.8.4 5 2.6 5.4 5.4.4 3-1.2 5.8-4 7.2-2 .9-4.4 1.3-7 1.3-3.4 0-6.4-.8-8.8-2.4C6 16.2 4.2 14.2 3.8 12c1.2.6 2.4 1 3.6 1.2-.4-1.2-.6-2.4-.4-3.6-1.4.4-2.6 1.2-3.6 2.6Z',
    }),
    e('circle', { cx: '21.2', cy: '11.6', r: '1.55', fill: '#fffdf6' }),
  )
}

function PaperStage(props: { label: string; children?: ReactNode }) {
  return e('section', { className: 'empty-paper home-stage', 'aria-label': props.label },
    e('div', { className: 'home-card' },
      e('p', { className: 'home-eyebrow' }, 'DSH EDITOR'),
      e('h1', null, '开始写作'),
      props.children,
    ),
  )
}

export function createDialogDirectory(kind: DocumentKind | 'group', directory?: string): string {
  if (kind === 'outline') return '大纲'
  if (kind === 'character') return '人物卡'
  if (kind === 'world') return '世界书'
  return directory || '正文'
}

export function orderTreeEntries<T extends { type: 'file' | 'directory' | 'other' }>(path: string, entries: readonly T[]): T[] {
  if (path) return [...entries]
  return [...entries].sort((left, right) => {
    const leftRootFile = left.type === 'file' ? 0 : 1
    const rightRootFile = right.type === 'file' ? 0 : 1
    return leftRootFile - rightRootFile
  })
}

export function treeRowPadding(level: number): number {
  return 14 + Math.max(0, level) * 14
}

export function isChapterDocumentPath(path: string): boolean {
  return /^正文\/.+\.(?:md|txt)$/i.test(path)
}

export function treeExpansionPaths(path: string): string[] {
  if (!path.startsWith('正文/')) return []
  const parts = path.split('/').filter(Boolean)
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

export function proposalAppliedNavigation(appliedPath: string, currentPath: string, editorDirty: boolean): {
  openPath?: string
  expandPath?: string
  refreshContent: boolean
} {
  return {
    ...(!editorDirty ? { openPath: appliedPath } : {}),
    ...(appliedPath.startsWith('正文/') ? { expandPath: appliedPath } : {}),
    refreshContent: !editorDirty && appliedPath === currentPath,
  }
}

export function worldbookPaperProjection(path: string, text: string): { text: string; offset: number } {
  if (!/^世界书\/.+\.md$/i.test(path)) return { text, offset: 0 }
  const metadata = worldbookEditorMetadata(path, text)
  if (!metadata.valid || !metadata.explicit) return { text, offset: 0 }
  const bomLength = text.startsWith('\uFEFF') ? 1 : 0
  const source = text.slice(bomLength)
  const close = /\r?\n---(?:\r?\n|$)/g
  close.lastIndex = source.indexOf('\n') + 1
  const match = close.exec(source)
  if (!match) return { text, offset: 0 }
  const offset = bomLength + match.index + match[0].length
  return { text: text.slice(offset), offset }
}

export function replaceWorldbookPaperText(path: string, text: string, paperText: string): string {
  const projection = worldbookPaperProjection(path, text)
  return projection.offset ? `${text.slice(0, projection.offset)}${paperText}` : paperText
}

export function isSuccessWorkbenchNote(note: string): boolean {
  return /^已(?:创建|重命名为|移动到|归档|恢复)(?:\s|$)/.test(note)
}

export function searchSkippedText(skipped: number): string {
  return skipped > 0 ? `未搜索 ${skipped} 个隐藏、生成、非文本或过大项目` : ''
}

export type AuthorFlowExample = Readonly<{
  label: string
  description: string
  prompt: string
}>

export function authorFlowExamples(activePath?: string): readonly AuthorFlowExample[] {
  const chapterTarget = activePath?.startsWith('正文/')
    ? `当前章节《${documentName(activePath)}》`
    : '第一章'
  return [
    {
      label: '从零规划',
      description: '先确认题材、冲突与结局，再建立世界观。',
      prompt: '我要从零规划一部长篇小说。请先用少量关键问题确认题材、主角、核心冲突和结局方向，再为项目总览与世界观提出可应用的文件建议。',
    },
    {
      label: '建立人物卡',
      description: '整理主角、配角、关系和人物弧光。',
      prompt: '请阅读现有项目资料，建立主要人物卡和人物索引，写清目标、动机、秘密、关系、成长弧与说话习惯，并以可应用的文件建议给我。',
    },
    {
      label: '编排十章',
      description: '把总纲拆成连续、可执行的十章章纲。',
      prompt: '请基于世界观和人物卡规划故事总纲，并编排前 10 章章纲。每章写清目标、冲突、转折、结果和下一章钩子，以可应用的文件建议给我。',
    },
    {
      label: '生成正文',
      description: `依据资料起草${chapterTarget}，先提案后写入。`,
      prompt: `请阅读项目总览、世界观、人物卡、总纲和章纲，为${chapterTarget}生成至少 2000 字正文。保持设定一致、场景完整，并以可应用的文件建议给我。`,
    },
  ]
}

export async function safeRpcCall<T>(request: () => Promise<unknown>): Promise<RpcResult<T>> {
  try {
    return await request() as RpcResult<T>
  } catch (error) {
    return {
      ok: false,
      error: { code: 'internal', message: error instanceof Error ? error.message : 'request failed', details: {} },
    }
  }
}

type RequestTicket = Readonly<{ scope: string; sequence: number }>
type PendingWorkspaceOpen = {
  ticket: RequestTicket
  workspace: WorkspaceView
  intent: WorkspaceIntent
  registrationCreated: boolean
  sessionId?: SessionId
  replaceWorkspaceId?: WorkspaceId
  warning?: string
}

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

export function hasVisibleWorkspaceEntries(entries: readonly { name: string }[]): boolean {
  return entries.some((entry) => entry.name !== '.dsh-editor')
}

export function hasRelocatableManuscriptFiles(files: readonly string[]): boolean {
  return files.some((path) => /^正文\/.+\.(?:md|txt)$/i.test(path))
}

export function supportedWorkspaceTextPaths(files: readonly string[]): string[] {
  return files.filter((path) => /\.(?:md|txt)$/i.test(path) && !path.split('/').some((part) => part.startsWith('.')))
}

export function relocationFailureMessage(cleanupFailed: boolean): string {
  return cleanupFailed
    ? '所选文件夹没有可验证的现有正文；原作品入口已保留。新位置入口未能自动移除，可从最近作品中手动移除。'
    : '所选文件夹没有可验证的现有正文；原作品入口已保留。'
}

export function claimInitialWorkspaceResume(guard: { current: boolean }): boolean {
  if (guard.current) return false
  guard.current = true
  return true
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
      e('p', null, '也可以依次按 Ctrl+K、Ctrl+S 打开本页。'),
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
  if (/directory-unreadable|unreadable/i.test(blob)) return '未能读取作品目录，请重试。'
  if (/session-not-found|session is not live/i.test(blob)) return '作品会话已失效，请重试。'
  if (/not-found|missing/i.test(blob)) return '未找到所需的文件。'
  return '操作未能完成，请重试。'
}

export function isSessionMissing(result: RpcResult): boolean {
  return !result.ok && /session-not-found|session is not live/i.test(rpcFailureText(result))
}

export function workspaceOpenFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : ''
  if (/no supported text files/i.test(detail)) return '没有找到可打开的 Markdown 或 TXT 作品文件。'
  if (/session is not live|session-not-found|作品会话已失效/i.test(detail)) return '作品会话未能建立，请重试。'
  if (detail && detail !== '操作未能完成，请重试。') return `作品未能打开：${detail}`
  return '作品会话或正文检查未能完成，请重试。'
}

export function isStaleFailure(result: RpcResult): boolean {
  return !result.ok && /stale|changed|version|版本/i.test(`${rpcFailureText(result)} ${errorMessage(result)}`)
}

function Tree(props: {
  ctx: ShellContext
  sessionId: string
  active: string
  expandPath: string
  revision: number
  onOpen(path: string): void
  onFileMenu(path: string, position: { x: number; y: number }): void
  onCreateChapter(directory: string): void
}) {
  const { ctx, sessionId, active, expandPath, revision, onOpen, onFileMenu, onCreateChapter } = props
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
    for (const directory of treeExpansionPaths(expandPath)) void load(directory)
  }, [sessionId, revision, expandPath])

  const rows = (path: string, level: number): ReactNode[] => orderTreeEntries(path, open[path] ?? [])
    .filter((item) => !item.name.startsWith('.'))
    .map((item) => {
      const child = path ? `${path}/${item.name}` : item.name
      if (item.type === 'directory') {
        return e('div', { key: child },
          e('div', { className: 'tree-directory-row' },
            e('button', {
              className: 'tree-row', type: 'button', style: { paddingLeft: treeRowPadding(level) },
              'data-tree-depth': level,
              'aria-expanded': child in open,
              onClick: () => child in open
                ? setOpen((old) => { const next = { ...old }; delete next[child]; return next })
                : void load(child),
            }, e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, child in open ? '⌄' : '›'), e('span', null, item.name)),
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
          style: { paddingLeft: treeRowPadding(level) },
          'data-tree-depth': level,
          onClick: () => onOpen(child),
          onContextMenu: /\.(md|txt)$/i.test(child) ? (event: ReactMouseEvent<HTMLButtonElement>) => {
            event.preventDefault()
            onFileMenu(child, { x: event.clientX, y: event.clientY })
          } : undefined,
        }, e('span', { className: 'tree-marker', 'aria-hidden': 'true' }, '·'), e('span', null, item.name)),
      )
    })

  return e('nav', { className: 'tree', 'aria-label': '稿件目录' }, rows('', 0), note ? e('p', { className: 'warning pad' }, note) : null)
}

function SearchPanel(props: {
  ctx: ShellContext
  sessionId: string
  revision: number
  navigationBlocked: boolean
  referenceRequest: ReferenceSearchRequest | null
  onOpen(hit: SearchHit): void
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'project' | 'manuscript'>('project')
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.revision}`
  requestGate.setScope(requestScope)

  useEffect(() => { setQuery(''); setResult(null); setNote(''); setBusy(false) }, [props.sessionId, props.revision])

  const search = async (raw: string, nextScope: 'project' | 'manuscript') => {
    const value = raw.trim()
    if (!value) { setNote('请输入要查找的文字。'); return }
    const ticket = requestGate.begin(requestScope)
    setBusy(true); setNote('')
    const searched = await safeRpcCall<SearchResponse>(() => props.ctx.connection.rpc.call('/manuscript', 'search.text', {
      sessionId: props.sessionId,
      query: value,
      scope: nextScope,
    }))
    if (!requestGate.isCurrent(ticket)) return
    setBusy(false)
    if (!searched.ok) { setResult(null); setNote(errorMessage(searched)); return }
    setResult(searched.value)
    setNote(searched.value.results.length ? '' : '未找到匹配内容。')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void search(query, scope)
  }

  useEffect(() => {
    if (!props.referenceRequest) return
    setScope('manuscript')
    setResult(null)
    const value = props.referenceRequest.query ?? ''
    setQuery(value)
    if (value) void search(value, 'manuscript')
    else setNote('请输入具体人物或设定名称，再查找正文引用。')
    globalThis.setTimeout(() => input.current?.focus(), 0)
  }, [props.referenceRequest?.nonce])

  return e('section', { className: 'search-panel', 'aria-label': '全文搜索' },
    e('form', { role: 'search', onSubmit: (event: FormEvent) => void submit(event) },
      e('input', {
        ref: input,
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
      result.skipped ? e('span', null, searchSkippedText(result.skipped)) : null,
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
          e('small', null, request.kind === 'group' ? '将在作品文件夹中创建目录；现有章节不会移动。' : `保存到 ${request.directory}`),
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

function NewProjectDialog(props: {
  busy: boolean
  note: string
  onClose(): void
  onCreate(title: string): void
}) {
  const [title, setTitle] = useState('')
  const dialog = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    globalThis.setTimeout(() => input.current?.focus(), 0)
    return () => { const target = returnFocus.current; globalThis.setTimeout(() => { if (target?.isConnected) target.focus() }, 0) }
  }, [])
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
    e('div', { ref: dialog, className: 'file-dialog create-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'new-project-dialog-title', onKeyDown },
      e('header', null,
        e('div', null,
          e('h2', { id: 'new-project-dialog-title' }, '新建作品'),
          e('small', null, '将保存在「文档/dsh-editor」下。'),
        ),
        e('button', { className: 'icon-button', type: 'button', disabled: props.busy, 'aria-label': '关闭', onClick: props.onClose }, '×'),
      ),
      e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (title.trim()) props.onCreate(title.trim()) } },
        e('label', null, '作品名称',
          e('input', {
            ref: input,
            value: title,
            maxLength: 80,
            placeholder: '例如：未名之书',
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

function FileContextMenu(props: {
  path: string
  x: number
  y: number
  onClose(): void
  onRename(): void
  onMove(): void
  onArchive(): void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const first = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    globalThis.setTimeout(() => first.current?.focus(), 0)
    const onPointer = (event: globalThis.MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) props.onClose()
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose()
    }
    globalThis.addEventListener('mousedown', onPointer)
    globalThis.addEventListener('keydown', onKey)
    return () => {
      globalThis.removeEventListener('mousedown', onPointer)
      globalThis.removeEventListener('keydown', onKey)
    }
  }, [props.path, props.x, props.y])
  const left = Math.max(8, Math.min(props.x, globalThis.innerWidth - 188))
  const top = Math.max(8, Math.min(props.y, globalThis.innerHeight - 148))
  return e('div', {
    ref: panel,
    className: 'file-context-menu',
    role: 'menu',
    'aria-label': '文档操作',
    style: { left, top },
    onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault(),
  },
    props.path.startsWith('正文/') ? e('button', { ref: first, type: 'button', role: 'menuitem', onClick: props.onMove }, '移动到卷/部') : null,
    e('button', { ref: props.path.startsWith('正文/') ? undefined : first, type: 'button', role: 'menuitem', onClick: props.onRename }, '重命名'),
    e('button', { type: 'button', role: 'menuitem', onClick: props.onArchive }, '归档'),
  )
}

function FileManageDialog(props: {
  path: string
  mode: 'rename' | 'move'
  busy: boolean
  note: string
  moveDirectories: string[] | null
  onClose(): void
  onRename(name: string): void
  onMove(directory: string): void
}) {
  const [name, setName] = useState(() => documentName(props.path))
  const [targetDirectory, setTargetDirectory] = useState('')
  const dialog = useRef<HTMLDivElement | null>(null)
  const close = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { setName(documentName(props.path)); globalThis.setTimeout(() => close.current?.focus(), 0) }, [props.path, props.mode])
  useEffect(() => {
    setTargetDirectory((current) => props.moveDirectories?.includes(current) ? current : (props.moveDirectories?.[0] ?? ''))
  }, [props.moveDirectories])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) { event.preventDefault(); props.onClose(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')]
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
        e('h2', { id: 'file-dialog-title' }, props.mode === 'rename' ? '重命名' : '移动到卷/部'),
        e('code', null, props.path),
      ),
      e('button', { ref: close, className: 'icon-button', type: 'button', disabled: props.busy, onClick: props.onClose, 'aria-label': '关闭' }, '×'),
    ),
    props.mode === 'rename' ? e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); props.onRename(name) } },
      e('label', null, e('span', null, '新名称'), e('input', { value: name, maxLength: 120, autoFocus: true, onChange: (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value) })),
      e('p', null, '所在目录与 .md/.txt 类型保持不变。'),
      e('footer', null,
        e('button', { type: 'button', disabled: props.busy, onClick: props.onClose }, '取消'),
        e('button', { className: 'primary-action', type: 'submit', disabled: props.busy || !name.trim() }, props.busy ? '处理中…' : '保存新名称'),
      ),
    ) : e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (targetDirectory) props.onMove(targetDirectory) } },
      e('label', null, e('span', null, '目标卷/部'), e('select', {
        value: targetDirectory,
        autoFocus: true,
        'aria-label': '目标卷或部',
        onChange: (event: ChangeEvent<HTMLSelectElement>) => setTargetDirectory(event.target.value),
      }, props.moveDirectories?.map((directory) => e('option', { key: directory, value: directory }, directory === '正文' ? '正文（根目录）' : directory.slice('正文/'.length))))),
      targetDirectory ? e('p', null, `移动后：${targetDirectory}/${props.path.split('/').at(-1)}`) : null,
      e('p', null, props.moveDirectories === null ? '正在读取可用位置…' : props.moveDirectories.length ? '不会覆盖同名文件。' : '没有其他可用位置；可以先新建卷/部。'),
      e('footer', null,
        e('button', { type: 'button', disabled: props.busy, onClick: props.onClose }, '取消'),
        e('button', { className: 'primary-action', type: 'submit', disabled: props.busy || !targetDirectory }, props.busy ? '移动中…' : '确认移动'),
      ),
    ),
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
        e('p', null, '这里只移除首页的作品入口。作品文件夹、正文、对话和日志都不会删除。'),
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
  authorPreferences: string
  chapterStatus?: ChapterStatus
  statusBusy: boolean
  onChapterStatus(path: string, status: ChapterStatus): void
  onReferenceSearch(request: ReferenceQuery): void
  onSaved(): void
}) {
  const { ctx, session, path, files, onOpen, create, externalRevision, onDirtyChange, reveal, completionPreference, authorPreferences } = props
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
  const documentPath = doc?.path ?? path
  const paperProjection = worldbookPaperProjection(documentPath, text)
  const paperText = paperProjection.text
  const paperOffset = paperProjection.offset
  const state = saveState(doc, text, conflict)
  const ghost = ghostCandidates[ghostIndex] ?? ''
  const clearGhost = () => { setGhostCandidates([]); setGhostIndex(0) }

  useEffect(() => {
    onDirtyChange(Boolean(doc && isDirty(doc, text)) || conflict)
    return () => onDirtyChange(false)
  }, [doc, text, conflict, onDirtyChange])

  const setText = (value: string) => {
    if (loadingFim || patching) setNote('正文已变化，已停止此前的建议。')
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setLoadingFim(false)
    setPatching(false)
    setTextState(value)
    setRevision((old) => old + 1)
    clearGhost()
    setProposal(null)
  }

  useEffect(() => {
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setLoadingFim(false)
    setPatching(false)
    setProposal(null)
    clearGhost()
    setConflict(false)
    setReloadConfirm(false)
    setSelection({ start: 0, end: 0 })
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
        setNote(stale ? '磁盘版本已变化；本地草稿已保留，请另存或手动合并。' : '已恢复未保存的草稿')
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
      setNote('搜索后文件已变化，已打开文档但未定位到原位置。')
      return
    }
    const start = Math.max(0, Math.min(text.length, reveal.start))
    const end = Math.max(start, Math.min(text.length, reveal.end))
    globalThis.setTimeout(() => {
      if (!ta.current) return
      ta.current.focus()
      ta.current.setSelectionRange(Math.max(0, start - paperOffset), Math.max(0, end - paperOffset))
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
    props.onSaved()
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

  const complete = async (append = false) => {
    if (!doc || !ta.current) return
    // A manual request also consumes the pending pause trigger for this edit.
    lastAutomaticCompletion.current = Math.max(lastAutomaticCompletion.current, userEditRevision)
    fimAbort.current?.abort()
    patchAbort.current?.abort()
    setProposal(null)
    const requestDoc = doc
    const requestRevision = revision
    const pos = append && ghost ? ghostAt : ta.current.selectionStart + paperOffset
    const controller = new AbortController()
    fimAbort.current = controller
    setLoadingFim(true)
    setNote('正在生成补全…')
    const result = await safeRpcCall<{ text?: string }>(() => ctx.connection.rpc.call('/manuscript', 'fim.complete', {
      sessionId: doc.sessionId,
      path: doc.path,
      prefix: text.slice(0, pos),
      suffix: text.slice(pos),
      authorPreferences,
    }, controller.signal))
    if (fimAbort.current === controller) {
      fimAbort.current = null
      setLoadingFim(false)
    }
    if (controller.signal.aborted) return
    if (docRef.current?.sessionId !== requestDoc.sessionId || docRef.current.path !== requestDoc.path || revisionRef.current !== requestRevision) return
    if (!result.ok) { setNote(errorMessage(result)); return }
    const suggestion = String(result.value.text ?? '')
    if (!suggestion.trim()) { setNote('模型未返回可用补全。'); return }
    const next = append
      ? addCompletionCandidate(ghostCandidates, suggestion)
      : { candidates: [suggestion], index: 0, added: true }
    setGhostCandidates(next.candidates)
    setGhostIndex(next.index)
    setGhostAt(pos)
    setNote(next.added
      ? `补全候选 ${next.index + 1}/${next.candidates.length} 已就绪。`
      : '新候选与已有建议相同，已保留原建议。')
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
    clearGhost()
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
      authorPreferences,
    }, controller.signal))
    if (patchAbort.current === controller) {
      patchAbort.current = null
      setPatching(false)
    }
    if (controller.signal.aborted || !isSelectionCurrent(ticket, docRef.current, textRef.current, revisionRef.current)) return
    if (!result.ok) { setNote(errorMessage(result)); return }
    const replacement = String(result.value.text ?? '').trim()
    if (!replacement) { setNote('模型未返回可用改写。'); return }
    setProposal({ ticket, text: replacement })
    setNote('修改建议已就绪。')
  }

  const acceptGhost = () => {
    if (!canApplyGhost(state, ghost)) return
    const cursor = ghostAt + ghost.length
    setText(applyGhost(text, ghostAt, ghost))
    setSelection({ start: cursor, end: cursor })
    clearGhost()
    setNote('补全已加入草稿。')
    globalThis.setTimeout(() => { ta.current?.focus(); ta.current?.setSelectionRange(Math.max(0, cursor - paperOffset), Math.max(0, cursor - paperOffset)) }, 0)
  }

  const acceptPatch = () => {
    if (!proposal || !isSelectionCurrent(proposal.ticket, doc, text, revision)) {
      setProposal(null)
      setNote('所选内容已变化，过期的建议已丢弃。')
      return
    }
    const cursor = proposal.ticket.start + proposal.text.length
    setText(applySelectionPatch(text, proposal.ticket, proposal.text))
    setSelection({ start: cursor, end: cursor })
    setProposal(null)
    setNote('修改已加入草稿。')
    globalThis.setTimeout(() => { ta.current?.focus(); ta.current?.setSelectionRange(Math.max(0, cursor - paperOffset), Math.max(0, cursor - paperOffset)) }, 0)
  }

  if (!path) {
    return e(PaperStage, { label: '空白章' },
      e('p', { className: 'home-hint' }, '从左侧新建章节或资料；也可以先让搭档按这部作品的需要创建总览、人物卡与章纲。'),
      e('div', { className: 'home-actions' },
        e('button', { className: 'primary-action', type: 'button', onClick: create }, '新建一章'),
      ),
    )
  }

  const index = files.indexOf(path)
  const navigationBlocked = state === 'draft' || state === 'conflict'
  const editableWorldbook = Boolean(doc && /^世界书\/.+\.md$/i.test(doc.path)
    && doc.path.toLowerCase() !== '世界书/设定总汇.md'.toLowerCase())
  return e('section', { className: 'editor', 'aria-label': '正文编辑区' },
    e('header', { className: 'editor-header' },
      e('span', null, doc?.path ?? path),
      isChapterDocumentPath(documentPath) ? e('nav', { className: 'chapter-navigation', 'aria-label': '章节导航' },
        e('button', { type: 'button', onClick: () => index > 0 && onOpen(files[index - 1]!), disabled: navigationBlocked || index <= 0, title: navigationBlocked ? '请先保存' : '上一章' }, '‹'),
        e('span', null, index >= 0 ? `${index + 1} / ${files.length}` : `— / ${files.length}`),
        e('button', { type: 'button', onClick: () => index >= 0 && index < files.length - 1 && onOpen(files[index + 1]!), disabled: navigationBlocked || index < 0 || index >= files.length - 1, title: navigationBlocked ? '请先保存' : '下一章' }, '›'),
      ) : null,
      isChapterDocumentPath(documentPath) && props.chapterStatus ? e('label', { className: 'chapter-status-control' },
        e('span', { className: 'sr-only' }, '章节状态'),
        e('select', {
          value: props.chapterStatus,
          disabled: props.statusBusy || navigationBlocked,
          'aria-label': `设置 ${documentName(documentPath)} 状态`,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => props.onChapterStatus(documentPath, event.target.value as ChapterStatus),
        },
        e('option', { value: 'draft' }, '草稿'),
        e('option', { value: 'revising' }, '修订中'),
        e('option', { value: 'final' }, '已定稿')),
      ) : null,
      e('span', null, `${paperText.replace(/\s/g, '').length} 字 · ${state === 'draft' ? '草稿未保存' : state === 'conflict' ? '版本冲突' : state === 'saved' ? '已保存' : '读取中'}`),
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
      value: paperText,
      className: 'paper-input',
      'aria-label': '正文',
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
        setText(replaceWorldbookPaperText(documentPath, text, event.target.value))
        setUserEditRevision((old) => old + 1)
      },
      onSelect: (event: ChangeEvent<HTMLTextAreaElement>) => setSelection({ start: event.target.selectionStart + paperOffset, end: event.target.selectionEnd + paperOffset }),
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
          clearGhost()
          setProposal(null)
          setNote('已放弃当前建议。')
        }
      },
    }),
    ghost ? e('section', { className: 'ghost ghost-suggestion', 'aria-label': '补全建议', 'aria-live': 'polite' },
      e('header', null,
        e('strong', null, '补全建议'),
        e('small', null, `候选 ${ghostIndex + 1} / ${ghostCandidates.length}`),
      ),
      e('p', null, ghost),
      ghostCandidates.length > 1 ? e('nav', { 'aria-label': '切换补全候选' },
        e('button', { type: 'button', disabled: ghostIndex <= 0, onClick: () => setGhostIndex((old) => Math.max(0, old - 1)) }, '上一条'),
        e('button', { type: 'button', disabled: ghostIndex >= ghostCandidates.length - 1, onClick: () => setGhostIndex((old) => Math.min(ghostCandidates.length - 1, old + 1)) }, '下一条'),
      ) : null,
      e('div', null,
        e('button', { type: 'button', onClick: acceptGhost }, '接受补全'),
        e('button', { type: 'button', disabled: loadingFim || ghostCandidates.length >= 3, onClick: () => void complete(true) }, loadingFim ? '生成中…' : ghostCandidates.length >= 3 ? '已满 3 条' : '再来一个'),
        e('button', { type: 'button', onClick: () => { clearGhost(); setNote('已放弃补全。'); ta.current?.focus() } }, '放弃'),
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
      }, loadingFim ? '停止补全' : ghost ? '重新补全' : '补全'),
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
      /^(?:人物卡|世界书)\/.+\.md$/i.test(documentPath) ? e('button', {
        type: 'button',
        onClick: () => props.onReferenceSearch(referenceQuery(documentPath, text, selection.start, selection.end)),
      }, '查找正文引用') : null,
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
      e('span', null, note || (models ? '暂无可用模型' : '读取中…')),
      e('button', { type: 'button', onClick: () => void refresh() }, '重试'),
      e('button', { type: 'button', onClick: onConfigure }, '设置接口'),
    )
  }
  return e('div', { className: 'compact-control' },
    e('span', { className: 'model-indicator', title: '本次对话使用的模型' }, current ? `${current.providerName} · ${current.model.name}` : models.current.model),
    e('button', { type: 'button', onClick: onConfigure }, '模型设置'),
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
      setNote('新对话未能建立，请重试。')
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
      e('button', { className: 'primary-action', type: 'submit', disabled: busy || !workspaceId || !value }, busy ? '创建中…' : '开始'),
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
      }).catch(() => setNote('提交未能完成，请重试。')).finally(() => setBusy(false))
    }
    return e('article', { className: 'pending-card', 'aria-label': '工具审批' },
      e('strong', null, '需要授权'),
      e('p', null, '允许搭档执行这一步操作？'),
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
    }).catch(() => setNote('提交未能完成，请重试。')).finally(() => setBusy(false))
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
  const [appliedVersion, setAppliedVersion] = useState('')
  const [undoText, setUndoText] = useState('')
  const [state, setState] = useState<'checking' | 'ready' | 'applying' | 'applied' | 'deferred' | 'ignored' | 'undoing' | 'undone' | 'expired'>('checking')
  const [note, setNote] = useState('正在核对文件…')
  const requestGeneration = useRef(0)

  const check = async () => {
    const generation = ++requestGeneration.current
    setAppliedVersion('')
    setUndoText('')
    setState('checking'); setNote('正在核对文件…')
    const raw = await props.ctx.connection.rpc.call('/manuscript', 'proposal.prepare', {
      sessionId: props.sessionId,
      ...props.proposal,
    })
    if (requestGeneration.current !== generation) return
    const result = raw as RpcResult<{ version?: string; before?: string; after?: string; text?: string }>
    if (!result.ok) { setState('expired'); setNote('文件已变化，未写入任何内容；请让写作助手重新生成建议。'); return }
    setPrepared(result.value); setState('ready'); setNote('可以安全应用')
  }

  useEffect(() => {
    void check()
    return () => { requestGeneration.current += 1 }
  }, [props.sessionId, props.proposal.path, props.proposal.summary, props.proposal.oldText, props.proposal.newText, props.proposal.text])

  const apply = async () => {
    if (!prepared) return
    const generation = ++requestGeneration.current
    setState('applying'); setNote('正在应用…')
    let beforeApplyText = ''
    if (props.proposal.kind === 'edit') {
      const read = await props.ctx.connection.rpc.call('/manuscript', 'file.read', {
        sessionId: props.sessionId,
        path: props.proposal.path,
      }) as RpcResult<{ text: string; version: string }>
      if (requestGeneration.current !== generation) return
      if (!read.ok || !prepared.version || read.value.version !== prepared.version) {
        setState('expired'); setNote('文件已变化，未写入任何内容；请让写作助手重新生成建议。')
        return
      }
      beforeApplyText = read.value.text
    }
    const result = await props.ctx.connection.rpc.call('/manuscript', 'proposal.apply', {
      sessionId: props.sessionId,
      ...props.proposal,
      expectedVersion: prepared.version ?? '',
    }) as RpcResult<{ path: string; version: string }>
    if (requestGeneration.current !== generation) return
    if (!result.ok) { setState('expired'); setNote('文件已变化，未写入任何内容；请让写作助手重新生成建议。'); return }
    setAppliedVersion(result.value.version)
    setUndoText(beforeApplyText)
    setState('applied'); setNote('已应用到作品')
    props.onApplied(result.value.path)
  }

  const undo = async () => {
    if (props.proposal.kind !== 'edit' || !appliedVersion || !undoText) return
    const generation = ++requestGeneration.current
    setState('undoing'); setNote('正在撤销…')
    const result = await props.ctx.connection.rpc.call('/manuscript', 'file.write', {
      sessionId: props.sessionId,
      path: props.proposal.path,
      text: undoText,
      version: appliedVersion,
    }) as RpcResult<{ version: string }>
    if (requestGeneration.current !== generation) return
    if (!result.ok) {
      setState('expired')
      setNote('文件此后又有变化，无法自动撤销；未写入任何内容。')
      return
    }
    setAppliedVersion(result.value.version)
    setState('undone'); setNote('已撤销，作品已恢复到应用前的内容')
    props.onApplied(props.proposal.path)
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
      state === 'ready' ? e('button', { type: 'button', onClick: () => { setState('deferred'); setNote('已留待稍后处理') } }, '稍后处理') : null,
      state === 'ready' ? e('button', { type: 'button', onClick: () => { setState('ignored'); setNote('已忽略，未修改作品') } }, '忽略') : null,
      state === 'deferred' ? e('button', { type: 'button', onClick: () => void check() }, '重新核对') : null,
      state === 'applied' && props.proposal.kind === 'edit' ? e('button', { type: 'button', onClick: () => void undo() }, '撤销此次修改') : null,
    ),
    state === 'ready' ? e('small', { className: 'proposal-help' }, '应用后才会写入作品。') : null,
  )
}

function ProjectContextReceiptView({ receipt }: { receipt: ProjectContextReceiptBundle }) {
  const fixed = receipt.sources.filter((item) => item.kind !== 'worldbook')
  const includedFixed = fixed.filter((item) => item.status === 'included' && item.includedChars > 0).length
  const worldbook = receipt.sources.filter((item) => item.kind === 'worldbook')
  const matchedByText = (value: string | undefined) => value === 'both' ? '请求与当前文档' : value === 'saved-document' ? '当前文档' : '本次请求'
  return e('details', { className: 'project-context-receipt' },
    e('summary', null, `项目上下文：固定 ${includedFixed}/${fixed.length}，触发世界书 ${worldbook.length}${receipt.authorPreferencesChars ? `，作者约定 ${receipt.authorPreferencesChars} 字` : ''}`),
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
    if (!metadata.valid) { props.onNote('世界书文件头格式无效；为避免丢失未知内容，请先在正文中手动修复。'); return }
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
      props.onNote('世界书触发设置已加入草稿。')
    } catch {
      props.onNote('世界书文件头没有正确闭合，请先在正文中修复后再应用。')
    }
  }
  return e('section', { className: 'worldbook-settings', 'aria-label': '世界书触发设置' },
    e('div', null,
      e('strong', null, '触发设置'),
      e('small', null, '只决定何时把这篇设定带给搭档。'),
      !metadata.valid ? e('span', { className: 'warning', role: 'alert' }, '现有文件头格式无效，当前不会触发。') : null,
    ),
    e('label', null, e('span', null, '触发词（一行一个）'), e('textarea', {
      value: triggers,
      disabled: !metadata.valid,
      rows: Math.min(3, Math.max(1, triggers.split(/\r?\n/).length)),
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setTriggers(event.target.value),
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
        : cleanup ? e('p', null, '只会删除导入清单中记录且内容未变化的文件；不会删除目标文件夹或其他文件。')
          : recover ? e('div', null,
              e('p', null, cleaning ? '上次清理尚未完成。只能继续安全清理。' : `上次导入未完成（${importSummary(probe!)}）。重新选择原来源目录即可继续，也可以安全清理。`),
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

function SnapshotLibraryDialog(props: {
  open: boolean
  available: boolean
  workspaceTitle?: string
  dirty: boolean
  busy: boolean
  snapshots: SnapshotView[] | null
  note: string
  onCreate(): void
  onRestore(snapshot: SnapshotView): void
  onRetry(): void
  onClose(): void
}) {
  const close = () => { if (!props.busy) props.onClose() }
  const focus = useRef<HTMLButtonElement | null>(null)
  const dialog = useRef<HTMLElement | null>(null)
  useEffect(() => { if (props.open) focus.current?.focus() }, [props.open])
  if (!props.open) return null
  return e('div', { className: 'import-overlay', onKeyDown: (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
    if (event.key !== 'Tab' || !dialog.current) return
    const buttons = [...dialog.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    if (!buttons.length) return
    const first = buttons[0]; const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  } },
    e('section', { ref: dialog, className: 'import-dialog snapshot-library', role: 'dialog', tabIndex: -1, 'aria-modal': true, 'aria-labelledby': 'snapshot-library-title' },
      e('header', null,
        e('h2', { id: 'snapshot-library-title' }, '作品快照'),
        e('p', { title: '备份已保存的作品；恢复时生成新副本，不会覆盖当前作品' },
          props.available
            ? '快照只保存已经写入磁盘的 Markdown/TXT 作品文件和章节状态；不包含未保存内容、对话、隐藏目录或构建文件。恢复始终生成新副本。'
            : '打开作品后，可在此备份已保存文本，并恢复为新副本。',
        ),
      ),
      props.available && props.workspaceTitle ? e('p', { className: 'muted' }, `当前作品：${props.workspaceTitle}`) : null,
      props.available && props.dirty ? e('p', { className: 'warning', role: 'alert' }, '当前有未保存内容，请先回到稿纸保存，再创建快照。') : null,
      props.note ? e('p', {
        className: /正在/.test(props.note) ? 'muted' : /没有|请先|失败|未|取消/.test(props.note) ? 'warning' : 'success',
        role: /没有|请先|失败|未|取消/.test(props.note) ? 'alert' : 'status',
      }, props.note) : null,
      !props.available ? null
        : props.snapshots === null && props.busy ? e('p', { className: 'muted', role: 'status' }, '正在读取作品快照…')
        : props.snapshots === null ? e('p', { className: 'muted' }, '快照列表尚未读取。')
        : props.snapshots.length
          ? e('ul', { className: 'snapshot-list', 'aria-label': '可恢复快照' }, props.snapshots.map((snapshot) => e('li', { key: snapshot.snapshotId },
              e('div', null,
                e('strong', null, snapshot.label || new Date(snapshot.createdAt).toLocaleString()),
                e('small', null, snapshotSummary(snapshot)),
              ),
              e('button', { type: 'button', disabled: props.busy, onClick: () => props.onRestore(snapshot) }, '恢复为新副本'),
            )))
          : e('p', { className: 'muted' }, '暂无作品快照。'),
      e('footer', null,
        e('button', { ref: focus, type: 'button', disabled: props.busy, onClick: close }, '关闭'),
        props.available && /未能读取/.test(props.note) ? e('button', { type: 'button', disabled: props.busy, onClick: props.onRetry }, '重试读取') : null,
        props.available ? e('button', {
          className: 'primary-action',
          type: 'button',
          disabled: props.busy || props.dirty,
          title: '备份已保存的作品；恢复时生成新副本，不会覆盖当前作品',
          'aria-label': props.busy ? '快照处理中' : '创建快照',
          onClick: props.onCreate,
        }, props.busy ? '快照处理中' : '创建快照') : null,
      ),
    ),
  )
}

function SnapshotDialog(props: {
  flow: SnapshotFlow
  onCancel(): void
  onApply(): void
  onContinue(): void
  onCleanup(): void
}) {
  const focus = useRef<HTMLButtonElement | null>(null)
  const dialog = useRef<HTMLElement | null>(null)
  useEffect(() => { if (focus.current) focus.current.focus(); else dialog.current?.focus() }, [props.flow.kind])
  if (props.flow.kind === 'idle') return null
  const working = props.flow.kind === 'working'
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
      e('h2', { id: 'snapshot-dialog-title' }, working ? '作品快照' : cleanup ? '清理未完成恢复？' : recover ? '发现未完成恢复' : '确认恢复为新副本'),
      working ? e('p', { role: 'status', 'aria-live': 'polite' }, props.flow.kind === 'working' ? props.flow.message : '') : null,
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
      cleanup ? e('p', null, '只会删除恢复清单中记录且内容仍匹配的文件；检测到作者修改、链接或路径变化时会停止。') : null,
      !working ? e('footer', null,
        e('button', { ref: focus, type: 'button', onClick: props.onCancel }, '取消'),
        review ? e('button', { type: 'button', onClick: props.onApply }, '确认恢复为新副本') : null,
        recover && recover.probe.message !== 'cleaning' ? e('button', { type: 'button', onClick: props.onContinue }, '选择原作品并继续') : null,
        recover ? e('button', { type: 'button', onClick: props.onCleanup }, '清理未完成恢复') : null,
        cleanup ? e('button', { type: 'button', onClick: props.onCleanup }, '确认安全清理') : null,
      ) : null,
    ),
  )
}

function Chat({ ctx, session, workspaceId, activePath, authorPreferences, hidden, onClose, onConfigure, onApplied, onDraftDirtyChange }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; activePath?: string; authorPreferences: string; hidden: boolean; onClose(): void; onConfigure(): void; onApplied(path: string): void; onDraftDirtyChange(dirty: boolean): void }) {
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
  const [modelRevision, setModelRevision] = useState(0)
  const titleAttempted = useRef(new Set<string>())
  const internalIndexActive = internalIndexTurnActive(snapshot)
  const partial = internalIndexActive ? '' : partialText(snapshot)
  const rows = chatRows(snapshot)
  const hasTurnError = rows.some((row) => row.id.startsWith('turn-error:'))
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
    queueConversationRename(title, '对话名称未能自动保存，可手动重命名。')
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
    setModelRevision((value) => value + 1)
  }
  const switchConversation = async (nextId: string) => {
    if (!(await canDiscardDraft(nextId))) return
    openConversation(nextId as SessionId)
  }
  const renameConversation = (title: string) => {
    setRenamingConversation(false)
    titleAttempted.current.add(session.sessionId)
    setNote('')
    queueConversationRename(title, '对话名称未能保存，请重试。')
  }
  const outgoingIsCanonical = Boolean(outgoing && rows.slice(outgoing.afterRows)
    .some((row) => row.role === 'user' && row.text.trim() === outgoing.text))
  const composerCanSubmit = canSubmitComposer({
    draft,
    connected: Boolean(connected),
    removed: snapshot.removed,
    outgoingState: outgoing?.state,
  })
  const examples = authorFlowExamples(activePath)
  const showGuide = rows.length === 0 && !outgoing && (!snapshot.running || internalIndexActive) && !partial && snapshot.pending.length === 0
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
      const compiled = await safeRpcCall<{ serialized: string; receipt: ProjectContextReceiptBundle }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'context.compile', { sessionId: session.sessionId, userRequest: value, activePath, authorPreferences }))
      if (!compiled.ok) { contextCompileFailed = true; throw new Error('context unavailable') }
      return { serialized: compiled.value.serialized, receipt: compiled.value.receipt }
    }).then((outcome) => {
      const result = outcome?.result
      if (outcome) setOutgoing((current) => current?.text === value ? { ...current, projectContextReceipt: outcome.receipt } : current)
      if (!result || !result.ok) {
        setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
        setNote('消息未发送成功，请重试。')
        return
      }
      setOutgoing((current) => current?.text === value ? { ...current, state: 'accepted' } : current)
    }).catch(() => {
      setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
      if (contextCompileFailed) {
        setDraft((current) => current || value)
        setNote('项目资料暂时无法整理，消息未发送。内容已保留，请重试。')
      } else setNote('消息未发送成功，请重试。')
    })
  }
  return e('aside', { className: 'chat', 'aria-label': '写作助手', hidden },
    e('header', { className: 'chat-header' },
      e('strong', { className: 'chat-brand' }, e(DeepSeekWhaleMark), connected ? '搭档' : '重连中'),
      e('label', { className: 'conversation-select' }, e('span', { className: 'sr-only' }, '切换对话'), e('select', { value: session.sessionId, 'aria-label': '切换对话', onChange: (event: ChangeEvent<HTMLSelectElement>) => void switchConversation(event.target.value) }, conversations.map((item) => e('option', { key: item.id, value: item.id }, item.title)))),
      e('div', { className: 'chat-controls' }, e(ModelIndicator, { key: `${session.sessionId}:${modelRevision}`, ctx, session, onConfigure })),
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
      showGuide ? e('section', { className: 'chat-guide', 'aria-label': '写作搭档功能与示例' },
        e('header', null,
          e('strong', null, '从构思到正文'),
          e('small', null, '搭档会读取项目总览、总纲、人物卡与世界书；所有文件修改都会先成为提案。'),
        ),
        e('div', { className: 'chat-guide-examples' }, examples.map((item) => e('button', {
          key: item.label,
          type: 'button',
          onClick: () => setDraft(item.prompt),
          title: `填入示例：${item.label}`,
        },
        e('strong', null, item.label),
        e('span', null, item.description),
        ))),
        e('small', null, '点击示例只会填入输入框。'),
      ) : null,
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
      (internalIndexActive ? [] : visibleRunningCalls(snapshot.runningCalls)).map((call) => e('article', { className: 'chat-row tool', key: `running:${call.callId}` }, e('strong', null,
        call.name === 'glob' || call.name === 'grep' ? '正在查找作品资料…' : call.name === 'read' ? '正在阅读作品资料…' : call.name === 'novel_propose' ? '正在准备修改建议…' : '正在处理…'
      ))),
      (internalIndexActive ? [] : snapshot.queue).map((item) => e('article', { className: 'chat-row notice', key: `queue:${item.id}` }, e('p', null, item.preview), e('small', null, item.placement === 'queued' ? '已排队' : '正在转向'))),
      partial ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, e('p', null, partial)) : snapshot.partial ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, '正在回复…') : null,
      snapshot.pending.map((item) => e(PendingCard, { key: item.key, item })),
      snapshot.openState === 'error' ? e('p', { className: 'warning' }, '连接暂时中断，正在恢复…') : null,
      snapshot.promptError && !internalIndexActive && !hasTurnError ? e('p', { className: 'warning' }, '写作助手未能完成这次请求，请重试。') : null,
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
      else if (entry.type === 'file' && /\.(?:md|txt)$/i.test(entry.name)) files.push(child)
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

async function verifyWorkspaceSession(ctx: ShellContext, sessionId: SessionId): Promise<string | undefined> {
  const files = await collectWorkspaceFiles(ctx, sessionId)
  const textFiles = supportedWorkspaceTextPaths(files)
  const initialPath = sortChapterPaths(textFiles)[0] ?? textFiles[0]
  if (!initialPath) return undefined
  const read = await safeRpcCall<{ text: string; version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', {
    sessionId,
    path: initialPath,
  }))
  if (!read.ok) throw new Error(errorMessage(read))
  return initialPath
}

async function inspectRegisteredWorkspace(ctx: ShellContext, workspacePath: string): Promise<ProjectInspectionResponse> {
  const inspected = await safeRpcCall<ProjectInspectionResponse>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.inspect', { workspacePath }))
  if (!inspected.ok) throw new Error(errorMessage(inspected))
  return inspected.value
}

async function pingWorkspaceSession(ctx: ShellContext, sessionId: SessionId): Promise<RpcResult<{ entries?: Entry[] }>> {
  return await safeRpcCall<{ entries?: Entry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: '.' }))
}

async function connectUsableWorkspaceSession(
  ctx: ShellContext,
  workspaceId: WorkspaceId,
  preferred?: SessionId,
): Promise<SessionId> {
  if (preferred) {
    const listed = await pingWorkspaceSession(ctx, preferred)
    if (listed.ok) return preferred
    if (!isSessionMissing(listed)) throw new Error(errorMessage(listed))
  }
  const first = await ctx.workspaces.connectWorkspace(workspaceId)
  if (first !== preferred) {
    const listed = await pingWorkspaceSession(ctx, first)
    if (listed.ok) return first
    if (!isSessionMissing(listed)) throw new Error(errorMessage(listed))
  }
  await ctx.workspaces.archiveSession(first)
  const second = await ctx.workspaces.connectWorkspace(workspaceId)
  if (second === first) throw new Error('session is not live')
  const retry = await pingWorkspaceSession(ctx, second)
  if (!retry.ok) throw new Error(isSessionMissing(retry) ? 'session is not live' : errorMessage(retry))
  return second
}

async function verifyRelocatedWorkspaceSession(ctx: ShellContext, sessionId: SessionId): Promise<string> {
  const files = await collectWorkspaceFiles(ctx, sessionId)
  if (!hasRelocatableManuscriptFiles(files)) throw new Error('relocated workspace has no readable manuscript')
  const initialPath = sortChapterPaths(files)[0]!
  const read = await safeRpcCall<{ text: string; version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', {
    sessionId,
    path: initialPath,
  }))
  if (!read.ok) throw new Error(errorMessage(read))
  return initialPath
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

function Root({ ctx, writingScope, settingsControl }: {
  ctx: ShellContext
  writingScope: import('@deepseek-ai/dsh-client-runtime/client').SettingsScope<WritingPreferences>
  settingsControl: ReactNode
}) {
  const sessions = useObservable(ctx.sessions.list)
  const workspaces = useObservable(ctx.workspaces.list)
  const session = currentSession(ctx)
  const current = sessions.current
  const selectedWorkspace = workspaces.items.find((workspace) => current && workspace.sessionIds.includes(current))
    ?? workspaces.items.find((workspace) => workspace.path === (current ? sessions.byId[current]?.cwd : undefined))
  const [workspaceOpen, setWorkspaceOpen] = useState<WorkspaceOpenState>({ kind: 'idle' })
  const fileSessionId = workspaceOpen.kind === 'ready' ? workspaceOpen.sessionId : undefined
  const fileSession = fileSessionId ? ctx.sessions.binding(fileSessionId)?.session : undefined
  const fileSessionIdRef = useRef<SessionId | undefined>(fileSessionId)
  fileSessionIdRef.current = fileSessionId
  const openWorkspaceId = workspaceOpen.kind === 'ready' ? workspaceOpen.workspaceId : undefined
  const currentWorkspace = workspaceOpen.kind === 'ready'
    ? workspaces.items.find((workspace) => workspace.workspaceId === workspaceOpen.workspaceId) ?? selectedWorkspace
    : selectedWorkspace
  const writingSnapshot = useSyncExternalStore(
    writingScope.subscribe.bind(writingScope),
    writingScope.getSnapshot.bind(writingScope),
    writingScope.getSnapshot.bind(writingScope),
  )
  const writing = writingPreferences(writingSnapshot, globalThis.localStorage)
  const [path, setPath] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [reveal, setReveal] = useState<RevealRequest | null>(null)
  const [workbenchNote, setWorkbenchNote] = useState('')
  const [treeRevision, setTreeRevision] = useState(0)
  const [treeExpansionPath, setTreeExpansionPath] = useState('')
  const [contentRevision, setContentRevision] = useState(0)
  const [homeNote, setHomeNote] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false)
  const [manualWorkspaceMode, setManualWorkspaceMode] = useState<'existing' | null>(null)
  const [manualWorkspacePath, setManualWorkspacePath] = useState('')
  const [newProject, setNewProject] = useState<{ busy: boolean; note: string } | null>(null)
  const [relocatingWorkspaceId, setRelocatingWorkspaceId] = useState<WorkspaceId | undefined>()
  const [sidebarOpen, setSidebarOpen] = useState(() => storedPanelOpen('dsh-editor.layout.sidebar-open', true))
  const [sidebarWidth, setSidebarWidth] = useState(() => storedPanelWidth('dsh-editor.layout.sidebar-width', SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX))
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantWidth, setAssistantWidth] = useState(() => storedPanelWidth('dsh-editor.layout.assistant-width', ASSISTANT_DEFAULT, ASSISTANT_MIN, ASSISTANT_MAX))
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
  const settingsControlRef = useRef<HTMLSpanElement | null>(null)
  const openSettings = () => {
    const trigger = settingsControlRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
    if (trigger) { trigger.click(); return }
    if (session) setWorkbenchNote('设置当前不可用，请稍后重试。')
    else setHomeNote('设置当前不可用，请稍后重试。')
  }
  const [focusMode, setFocusMode] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [chatFocusNonce, setChatFocusNonce] = useState(0)
  const [indexStatus, setIndexStatus] = useState<Record<string, 'idle' | 'initializing' | 'queued' | 'failed'>>({})
  const indexedWorkspaces = useRef(new Set<string>())
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState('')
  const [exportPreview, setExportPreview] = useState<PreparedExport | null>(null)
  const [overview, setOverview] = useState<ProjectOverview | null>(null)
  const [overviewBusy, setOverviewBusy] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [overviewRevision, setOverviewRevision] = useState(0)
  const [statusBusy, setStatusBusy] = useState(false)
  const [referenceRequest, setReferenceRequest] = useState<ReferenceSearchRequest | null>(null)
  const [importFlow, setImportFlow] = useState<ImportFlow>(idleImportFlow)
  const [snapshotNote, setSnapshotNote] = useState('')
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [snapshotList, setSnapshotList] = useState<SnapshotView[] | null>(null)
  const [snapshotFlow, setSnapshotFlow] = useState<SnapshotFlow>(idleSnapshotFlow)
  const [snapshotLibraryOpen, setSnapshotLibraryOpen] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [fileMenu, setFileMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [managePath, setManagePath] = useState<string | null>(null)
  const [manageMode, setManageMode] = useState<'rename' | 'move' | null>(null)
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
  const overviewRequestGate = useRef(new LatestRequestGate()).current
  const manageDirectoryGate = useRef(new LatestRequestGate()).current
  const workspaceOpenGate = useRef(new LatestRequestGate()).current
  const pendingWorkspaceOpen = useRef<PendingWorkspaceOpen | null>(null)
  const initialWorkspaceResumeStarted = useRef(false)
  const importReturnFocus = useRef<HTMLElement | null>(null)
  const snapshotReturnFocus = useRef<HTMLElement | null>(null)
  const fileManageReturnFocus = useRef<HTMLElement | null>(null)
  const createReturnFocus = useRef<HTMLElement | null>(null)
  const workspaceManageReturnFocus = useRef<HTMLElement | null>(null)
  const shortcutReturnFocus = useRef<HTMLElement | null>(null)
  const shortcutChordAt = useRef(0)
  const temporaryFlowWorkspaces = useRef(new Set<string>())
  const temporarySourceWorkspaces = useRef(new Map<string, string>())
  archiveRequestGate.setScope(fileSessionId ?? '')
  overviewRequestGate.setScope(fileSessionId ?? '')
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
      if (action !== 'settings' && !session) return
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
  }, [assistantDraftDirty, editorDirty, focusMode, session?.sessionId, shortcutsOpen])
  useEffect(() => {
    if (!chatFocusNonce || !assistantOpen || focusMode) return
    globalThis.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus(), 0)
  }, [assistantOpen, chatFocusNonce, focusMode])
  useEffect(() => {
    if (!openWorkspaceId) setPath('')
    setFiles([]); setReveal(null); setWorkbenchNote(''); setEditorDirty(false); setTreeExpansionPath('')
    setFileMenu(null); setManagePath(null); setManageMode(null); setManageNote(''); setArchives([]); setArchiveInvalid(0); setArchiveNote('')
    setOverview(null); setOverviewError(''); setOverviewBusy(false); setStatusBusy(false); setWorkspaceMenuOpen(false); setWorkspaceSwitcherOpen(false)
    setReferenceRequest(null); setExportPreview(null); setExporting(false); setExportNote('')
  }, [openWorkspaceId])
  useEffect(() => {
    if (!fileSession) { setFiles([]); return }
    let live = true
    void collectWorkspaceFiles(ctx, fileSession.sessionId).then((paths) => {
      if (live) setFiles(sortChapterPaths(paths))
    }).catch(() => {
      if (live) { setFiles([]); setWorkbenchNote('未能读取完整章节顺序。') }
    })
    return () => { live = false }
  }, [ctx.connection.rpc, fileSession?.sessionId, treeRevision])
  const loadOverview = async () => {
    if (!fileSession) return
    const ticket = overviewRequestGate.begin(fileSession.sessionId)
    setOverviewBusy(true); setOverviewError('')
    const result = await safeRpcCall<ProjectOverview>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.overview', { sessionId: fileSession.sessionId }))
    if (!overviewRequestGate.isCurrent(ticket)) return
    setOverviewBusy(false)
    if (!result.ok) {
      setOverview(null)
      setOverviewError(/invalid|status|状态/i.test(rpcFailureText(result))
        ? '章节状态文件已损坏，为避免覆盖数据，状态修改已停用。正文仍可正常编辑和导出。'
        : errorMessage(result))
      return
    }
    setOverview(result.value)
  }
  useEffect(() => {
    if (!fileSession) { setOverview(null); setOverviewBusy(false); return }
    void loadOverview()
  }, [ctx.connection.rpc, fileSession?.sessionId, treeRevision, contentRevision, overviewRevision])
  const updateChapterStatus = async (chapterPath: string, status: ChapterStatus) => {
    if (!fileSession || !overview || statusBusy) return
    const requestSessionId = fileSession.sessionId
    const ticket = overviewRequestGate.begin(requestSessionId)
    setStatusBusy(true); setOverviewError('')
    const result = await safeRpcCall<ProjectOverview>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'chapter.statusSet', {
      sessionId: fileSession.sessionId,
      path: chapterPath,
      status,
      expectedStatusRevision: overview.statusRevision,
    }))
    if (fileSessionIdRef.current !== requestSessionId) return
    setStatusBusy(false)
    if (!overviewRequestGate.isCurrent(ticket)) {
      setOverviewRevision((value) => value + 1)
      return
    }
    if (!result.ok) {
      setOverviewError(isStaleFailure(result) ? '作品进度已在别处变化，已重新读取；请再次选择状态。' : errorMessage(result))
      setOverviewRevision((value) => value + 1)
      return
    }
    setOverview(result.value)
    setWorkbenchNote(`已将 ${documentName(chapterPath)} 标记为${chapterStatusText(status)}`)
  }
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
    if (!fileSession) return
    const ticket = archiveRequestGate.begin(fileSession.sessionId)
    setArchiveBusy(true); setArchiveNote('')
    const result = await safeRpcCall<ArchiveListResponse>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.list', { sessionId: fileSession.sessionId }))
    if (!archiveRequestGate.isCurrent(ticket)) return
    setArchiveBusy(false)
    if (!result.ok) { setArchiveNote(errorMessage(result)); return }
    setArchives(result.value.items)
    setArchiveInvalid(result.value.invalid)
  }
  const openFileMenu = (selectedPath: string, position: { x: number; y: number }) => {
    if (editorDirty) { setWorkbenchNote('请先保存当前文档。'); return }
    setWorkbenchNote('')
    setFileMenu({ path: selectedPath, x: position.x, y: position.y })
  }
  const openManageAction = (selectedPath: string, mode: 'rename' | 'move') => {
    if (editorDirty) { setWorkbenchNote('请先保存当前文档。'); return }
    fileManageReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFileMenu(null)
    setManagePath(selectedPath)
    setManageMode(mode)
    setManageNote('')
    if (mode !== 'move' || !fileSession || !selectedPath.startsWith('正文/')) {
      setManageDirectories([])
      return
    }
    setManageDirectories(null)
    const ticket = manageDirectoryGate.begin(`${fileSession.sessionId}\0${selectedPath}`)
    const currentDirectory = selectedPath.slice(0, selectedPath.lastIndexOf('/'))
    void collectManuscriptDirectories(ctx, fileSession.sessionId).then((directories) => {
      if (!manageDirectoryGate.isCurrent(ticket)) return
      setManageDirectories(directories.filter((directory) => directory.normalize('NFC').toLocaleLowerCase() !== currentDirectory.normalize('NFC').toLocaleLowerCase()))
    }).catch(() => {
      if (!manageDirectoryGate.isCurrent(ticket)) return
      setManageDirectories([])
      setManageNote('未能读取可用卷/部。')
    })
  }
  const closeManage = () => {
    if (manageBusy) return
    const target = fileManageReturnFocus.current
    manageDirectoryGate.setScope('')
    setManagePath(null); setManageMode(null); setManageNote(''); setManageDirectories(null)
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
      setWorkspaceManageNote('作品名未能修改；请检查是否与其他作品重名。')
    }
  }
  const removeWorkspace = async () => {
    if (!workspaceManage?.removable || workspaceManageBusy) return
    setWorkspaceManageBusy(true); setWorkspaceManageNote('')
    try {
      await ctx.workspaces.delete(workspaceManage.workspaceId)
      setWorkspaceManageBusy(false)
      closeWorkspaceManage(true)
      setHomeNote('已从最近移除；磁盘中的作品未被删除。')
    } catch {
      setWorkspaceManageBusy(false)
      setWorkspaceManageNote('最近入口未能移除，请重试。')
    }
  }
  const observedVersion = async (selectedPath: string, onError: (message: string) => void): Promise<string | undefined> => {
    if (!fileSession) return undefined
    const read = await safeRpcCall<{ version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: fileSession.sessionId, path: selectedPath }))
    if (!read.ok) { onError(errorMessage(read)); return undefined }
    return read.value.version
  }
  const renameManaged = async (name: string) => {
    if (!fileSession || !managePath || manageBusy) return
    setManageBusy(true); setManageNote('')
    const version = await observedVersion(managePath, setManageNote)
    if (!version) { setManageBusy(false); return }
    const renamed = await safeRpcCall<{ path: string; metadataWarning?: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'file.rename', {
      sessionId: fileSession.sessionId,
      path: managePath,
      newName: name,
      expectedVersion: version,
    }))
    setManageBusy(false)
    if (!renamed.ok) { setManageNote(errorMessage(renamed)); return }
    if (path === managePath) { setPath(renamed.value.path); setReveal(null) }
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(renamed.value.metadataWarning ? `已重命名为 ${renamed.value.path}；${renamed.value.metadataWarning}` : `已重命名为 ${renamed.value.path}`)
    manageDirectoryGate.setScope('')
    setManageDirectories(null)
    setManagePath(null)
    setManageMode(null)
  }
  const moveManaged = async (targetDirectory: string) => {
    if (!fileSession || !managePath || manageBusy) return
    setManageBusy(true); setManageNote('')
    const version = await observedVersion(managePath, setManageNote)
    if (!version) { setManageBusy(false); return }
    const moved = await safeRpcCall<{ path: string; metadataWarning?: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'file.moveManuscript', {
      sessionId: fileSession.sessionId,
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
    setWorkbenchNote(moved.value.metadataWarning ? `已移动到 ${moved.value.path}；${moved.value.metadataWarning}` : `已移动到 ${moved.value.path}`)
    setManagePath(null)
    setManageMode(null)
  }
  const archiveManaged = async (selectedPath: string) => {
    setFileMenu(null)
    if (!fileSession || archiveBusy) return
    if (editorDirty) { setWorkbenchNote('请先保存当前文档。'); return }
    setArchiveBusy(true)
    setWorkbenchNote('')
    const version = await observedVersion(selectedPath, setWorkbenchNote)
    if (!version) {
      setArchiveBusy(false)
      return
    }
    const archived = await safeRpcCall<ArchiveView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.apply', {
      sessionId: fileSession.sessionId,
      path: selectedPath,
      expectedVersion: version,
    }))
    setArchiveBusy(false)
    if (!archived.ok) { setWorkbenchNote(errorMessage(archived)); return }
    if (archived.value.state !== 'archived') { setWorkbenchNote('归档未完成，请在已归档列表中检查。'); await loadArchives(); return }
    if (path === selectedPath) { setPath(''); setReveal(null) }
    setTreeRevision((value) => value + 1)
    setWorkbenchNote(archived.value.metadataWarning ? `已归档 ${archived.value.path}；${archived.value.metadataWarning}` : `已归档 ${archived.value.path}`)
    await loadArchives()
  }
  const continueArchive = async (item: ArchiveView) => {
    if (!fileSession || archiveBusy || editorDirty) { if (editorDirty) setArchiveNote('请先保存当前文档。'); return }
    setArchiveBusy(true); setArchiveNote('')
    const result = await safeRpcCall<ArchiveView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.apply', { sessionId: fileSession.sessionId, archiveId: item.archiveId }))
    setArchiveBusy(false)
    if (!result.ok) { setArchiveNote(errorMessage(result)); return }
    if (result.value.metadataWarning) setArchiveNote(result.value.metadataWarning)
    setTreeRevision((value) => value + 1)
    await loadArchives()
  }
  const restoreArchived = async (item: ArchiveView) => {
    if (!fileSession || archiveBusy || editorDirty) { if (editorDirty) setArchiveNote('请先保存当前文档。'); return }
    if (!item.version) { setArchiveNote('归档状态无法验证，未恢复。'); return }
    setArchiveBusy(true); setArchiveNote('')
    const result = await safeRpcCall<ArchiveView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'archive.restore', {
      sessionId: fileSession.sessionId,
      archiveId: item.archiveId,
      expectedVersion: item.version,
    }))
    setArchiveBusy(false)
    if (!result.ok) { setArchiveNote(errorMessage(result)); return }
    if (result.value.state !== 'restored') { setArchiveNote('原路径已有文件或归档已变化，未覆盖。'); await loadArchives(); return }
    setTreeRevision((value) => value + 1)
    openDocument(result.value.path)
    setWorkbenchNote(result.value.metadataWarning ? `已恢复 ${result.value.path}；${result.value.metadataWarning}` : `已恢复 ${result.value.path}`)
    await loadArchives()
  }
  const openCreateDialog = (kind: DocumentKind | 'group', directory?: string) => {
    if (!fileSession) return
    if (editorDirty) { setCreateNote('请先保存当前文档。'); return }
    createReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCreateNote('')
    setCreateRequest({ kind, directory: createDialogDirectory(kind, directory) })
  }
  const closeCreateDialog = () => {
    if (createBusy) return
    const target = createReturnFocus.current
    setCreateRequest(null)
    setCreateNote('')
    globalThis.setTimeout(() => target?.focus(), 0)
  }
  const create = async (title: string) => {
    if (!fileSession || !createRequest) return
    const request = createRequest
    setCreateBusy(true)
    setCreateNote('')
    if (request.kind === 'group') {
      const groupPath = manuscriptGroupPath(title)
      const result = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'structure.groupCreate', {
        sessionId: fileSession.sessionId,
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
      workspaceFiles = await collectWorkspaceFiles(ctx, fileSession.sessionId)
    } catch {
      setCreateBusy(false)
      setCreateNote('未能读取完整目录，请重试。')
      return
    }
    const file = kind === 'chapter'
      ? nextChapterPath(workspaceFiles, request.directory)
      : nextDocumentPath(kind, title, workspaceFiles)
    const result = await safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'file.create', {
      sessionId: fileSession.sessionId,
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
    if (!fileSession) return
    if (editorDirty) { setExportNote('请先保存当前文档，再预览导出。'); return }
    const requestSessionId = fileSession.sessionId
    setExporting(true); setExportNote('正在整理正文…')
    try {
      const chapters = await collectChapters(ctx, requestSessionId)
      if (fileSessionIdRef.current !== requestSessionId) return
      const title = currentWorkspace?.title || (current ? sessions.byId[current]?.displayTitle : undefined) || '未命名作品'
      const prepared = prepareExport(chapters, title, format)
      setExportPreview(prepared)
      setExportNote('导出内容已整理，请核对后确认。')
    } catch (error) {
      if (fileSessionIdRef.current !== requestSessionId) return
      const message = error instanceof Error ? error.message : ''
      setExportNote(/没有可导出|正文为空/.test(message) ? message : '导出未能完成，请重试。')
    } finally {
      if (fileSessionIdRef.current === requestSessionId) setExporting(false)
    }
  }
  const confirmExport = () => {
    if (!exportPreview) return
    downloadExport(exportPreview.filename, exportPreview.content, exportPreview.format)
    setExportNote(`已生成 ${exportPreview.filename}`)
    setExportPreview(null)
  }
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
  const finishWorkspaceOpen = async (
    pending: PendingWorkspaceOpen,
    sessionId: SessionId,
    initialPath: string | undefined,
  ) => {
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    let warning = pending.warning
    if (pending.replaceWorkspaceId && pending.replaceWorkspaceId !== pending.workspace.workspaceId) {
      try {
        await ctx.workspaces.delete(pending.replaceWorkspaceId)
      } catch {
        warning = warning ? `${warning} 旧的最近入口未能移除。` : '新位置已打开，但旧的最近入口未能移除。'
      }
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    }
    pendingWorkspaceOpen.current = null
    setPath(initialPath ?? '')
    setWorkspaceOpen({
      kind: 'ready',
      workspaceId: pending.workspace.workspaceId,
      sessionId,
      path: pending.workspace.path,
      warning,
    })
    ctx.sessions.open(sessionId)
    setIndexStatus((old) => ({ ...old, [pending.workspace.workspaceId]: 'idle' }))
  }
  const prepareExistingWorkspace = async (pending: PendingWorkspaceOpen, sessionId: SessionId) => {
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    const relocatedInitialPath = pending.replaceWorkspaceId
      ? await verifyRelocatedWorkspaceSession(ctx, sessionId)
      : undefined
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', { targetSessionId: sessionId }))
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (recovery.ok && recovery.value.state === 'recoverable') {
      const nextImportFlow = recoverImport(sessionId, pending.workspace.workspaceId, recovery.value)
      if (nextImportFlow.kind === 'recover') {
        pendingWorkspaceOpen.current = pending
        importReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setWorkspaceOpen({ kind: 'needs-recovery', workspaceId: pending.workspace.workspaceId, sessionId, path: pending.workspace.path, title: pending.workspace.title, recovery: 'import' })
        setImportFlow(nextImportFlow)
        return
      }
      pending.warning = '发现损坏的旧导入记录；已忽略，正文不会被阻断。'
    }
    if (!recovery.ok) pending.warning = '发现无法验证的旧导入记录；已忽略，正文不会被阻断。'

    const restore = await safeRpcCall<RestoreView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreProbe', { targetSessionId: sessionId }))
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (restore.ok && restore.value.state === 'recoverable') {
      const nextSnapshotFlow = recoverSnapshot(sessionId, pending.workspace.workspaceId, restore.value)
      if (nextSnapshotFlow.kind === 'recover') {
        pendingWorkspaceOpen.current = pending
        snapshotReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setWorkspaceOpen({ kind: 'needs-recovery', workspaceId: pending.workspace.workspaceId, sessionId, path: pending.workspace.path, title: pending.workspace.title, recovery: 'restore' })
        setSnapshotFlow(nextSnapshotFlow)
        return
      }
      pending.warning = pending.warning
        ? `${pending.warning} 另有损坏的旧恢复记录也已忽略。`
        : '发现损坏的旧恢复记录；已忽略，正文不会被阻断。'
    }
    if (!restore.ok) pending.warning = pending.warning
        ? `${pending.warning} 另有无法验证的旧恢复记录也已忽略。`
        : '发现无法验证的旧恢复记录；已忽略，正文不会被阻断。'

    const initialPath = relocatedInitialPath ?? await verifyWorkspaceSession(ctx, sessionId)
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (!initialPath) {
      const root = await safeRpcCall<{ entries?: Entry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: '.' }))
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      if (!root.ok) throw new Error(errorMessage(root))
      if (hasVisibleWorkspaceEntries(root.value.entries ?? [])) throw new Error('workspace has no supported text files')
      pendingWorkspaceOpen.current = pending
      setWorkspaceOpen({
        kind: 'needs-intent', workspaceId: pending.workspace.workspaceId,
        path: pending.workspace.path, title: pending.workspace.title, intent: 'create',
        message: '这个文件夹还没有可打开的 Markdown 或 TXT 作品文件。',
      })
      setHomeNote('')
      return
    }
    await finishWorkspaceOpen(pending, sessionId, initialPath)
  }

  const prepareNewWorkspace = async (pending: PendingWorkspaceOpen, sessionId: SessionId) => {
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    const root = await safeRpcCall<{ entries?: Entry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: '.' }))
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (!root.ok) throw new Error(errorMessage(root))
    if (hasVisibleWorkspaceEntries(root.value.entries ?? [])) {
      const files = supportedWorkspaceTextPaths(await collectWorkspaceFiles(ctx, sessionId))
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      if (!files.length) throw new Error('new workspace folder contains unrelated files')
      pendingWorkspaceOpen.current = pending
      setWorkspaceOpen({
        kind: 'needs-intent', workspaceId: pending.workspace.workspaceId,
        path: pending.workspace.path, title: pending.workspace.title, intent: 'open',
        message: '这个文件夹已经包含 Markdown 或 TXT 作品文件，不会按新作品初始化。',
      })
      setHomeNote('')
      return
    }
    const initialized = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.init', { sessionId, newProject: true }))
    if (!workspaceOpenGate.isCurrent(pending.ticket)) return
    if (!initialized.ok) throw new Error(errorMessage(initialized))
    const initialPath = await verifyWorkspaceSession(ctx, sessionId)
    await finishWorkspaceOpen(pending, sessionId, initialPath)
  }
  const openRegisteredWorkspace = async (workspace: WorkspaceView, sessionId?: SessionId, replaceWorkspaceId?: WorkspaceId) => {
    const ticket = workspaceOpenGate.begin(`workspace:${workspace.workspaceId}:${workspace.path}`)
    const pending: PendingWorkspaceOpen = { ticket, workspace, intent: 'open', registrationCreated: false, replaceWorkspaceId }
    pendingWorkspaceOpen.current = null
    setOpeningWorkspace(true)
    setHomeNote('')
    setWorkspaceOpen({ kind: 'checking', workspaceId: workspace.workspaceId, path: workspace.path, title: workspace.title })
    try {
      const registered = await ctx.workspaces.create({ path: workspace.path })
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending.workspace = registered
    } catch {
      if (!workspaceOpenGate.isCurrent(ticket)) return
      ctx.sessions.clear()
      const message = '原作品文件夹已移动或无法读取。'
      setWorkspaceOpen({ kind: 'needs-relocation', workspaceId: workspace.workspaceId, path: workspace.path, title: workspace.title, message })
      setHomeNote(message)
      setOpeningWorkspace(false)
      return
    }
    const current = pending.workspace
    let inspection: ProjectInspectionResponse
    try {
      inspection = await inspectRegisteredWorkspace(ctx, current.path)
    } catch {
      if (!workspaceOpenGate.isCurrent(ticket)) return
      const message = '作品目录检查未能完成，请重试。'
      setWorkspaceOpen({ kind: 'error', workspaceId: current.workspaceId, path: current.path, title: current.title, message })
      setHomeNote(message)
      setOpeningWorkspace(false)
      return
    }
    if (!workspaceOpenGate.isCurrent(ticket)) return
    if (!inspection.textFiles.length) {
      if (!inspection.hasVisibleEntries) {
        pendingWorkspaceOpen.current = pending
        setWorkspaceOpen({
          kind: 'needs-intent', workspaceId: current.workspaceId, path: current.path, title: current.title,
          intent: 'create', message: '这个文件夹还没有可打开的 Markdown 或 TXT 作品文件。',
        })
        setOpeningWorkspace(false)
        return
      }
      const message = '没有找到可打开的 Markdown 或 TXT 作品文件。'
      setWorkspaceOpen({ kind: 'error', workspaceId: current.workspaceId, path: current.path, title: current.title, message })
      setHomeNote(message)
      setOpeningWorkspace(false)
      return
    }
    try {
      const connectedSessionId = await connectUsableWorkspaceSession(ctx, current.workspaceId, sessionId)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending.sessionId = connectedSessionId
      await prepareExistingWorkspace(pending, connectedSessionId)
    } catch (error) {
      if (!workspaceOpenGate.isCurrent(ticket)) return
      ctx.sessions.clear()
      const message = workspaceOpenFailureMessage(error)
      setWorkspaceOpen({ kind: 'error', workspaceId: current.workspaceId, path: current.path, title: current.title, message })
      setHomeNote(message)
    } finally {
      if (workspaceOpenGate.isCurrent(ticket)) setOpeningWorkspace(false)
    }
  }
  const finishPendingWorkspaceOpen = async (targetSessionId: string): Promise<boolean> => {
    const pending = pendingWorkspaceOpen.current
    if (!pending || workspaceOpen.kind !== 'needs-recovery' || workspaceOpen.sessionId !== targetSessionId) return false
    const initialPath = pending.replaceWorkspaceId
      ? await verifyRelocatedWorkspaceSession(ctx, targetSessionId as SessionId)
      : await verifyWorkspaceSession(ctx, targetSessionId as SessionId)
    if (!initialPath) throw new Error('recovery created no supported text files')
    await finishWorkspaceOpen(pending, targetSessionId as SessionId, initialPath)
    return true
  }
  const openPickedWorkspace = async (path: string, intent: WorkspaceIntent, replaceWorkspaceId?: WorkspaceId) => {
    const ticket = workspaceOpenGate.begin(`path:${path}`)
    const replacedWorkspace = replaceWorkspaceId ? workspaces.items.find((item) => item.workspaceId === replaceWorkspaceId) : undefined
    let pending: PendingWorkspaceOpen | undefined
    let stage: 'registering' | 'inspecting' | 'connecting' | 'initializing' | 'verifying' = 'registering'
    setOpeningWorkspace(true)
    setHomeNote('')
    setWorkspaceOpen({ kind: 'checking', path, title: path })
    try {
      const registration = await createFlowWorkspace(ctx, path)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending = {
        ticket,
        workspace: registration.workspace,
        intent,
        registrationCreated: registration.created,
        replaceWorkspaceId,
      }
      stage = 'inspecting'
      const inspection = await inspectRegisteredWorkspace(ctx, registration.workspace.path)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      if (replaceWorkspaceId && !hasRelocatableManuscriptFiles(inspection.textFiles)) throw new Error('relocated workspace has no readable manuscript')
      if (intent === 'create' && inspection.hasVisibleEntries) {
        if (!inspection.textFiles.length) throw new Error('new workspace folder contains unrelated files')
        pendingWorkspaceOpen.current = pending
        setWorkspaceOpen({
          kind: 'needs-intent', workspaceId: registration.workspace.workspaceId,
          path: registration.workspace.path, title: registration.workspace.title, intent: 'open',
          message: '这个文件夹已经包含 Markdown 或 TXT 作品文件，不会按新作品初始化。',
        })
        setManualWorkspaceMode(null)
        setManualWorkspacePath('')
        return
      }
      if (intent === 'open' && !inspection.textFiles.length) {
        if (inspection.hasVisibleEntries) throw new Error('workspace has no supported text files')
        pendingWorkspaceOpen.current = pending
        setWorkspaceOpen({
          kind: 'needs-intent', workspaceId: registration.workspace.workspaceId,
          path: registration.workspace.path, title: registration.workspace.title, intent: 'create',
          message: '这个文件夹还没有可打开的 Markdown 或 TXT 作品文件。',
        })
        setManualWorkspaceMode(null)
        setManualWorkspacePath('')
        return
      }
      stage = 'connecting'
      const sessionId = await connectUsableWorkspaceSession(ctx, registration.workspace.workspaceId)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      pending.sessionId = sessionId
      stage = intent === 'create' ? 'initializing' : 'verifying'
      if (intent === 'create') await prepareNewWorkspace(pending, sessionId)
      else await prepareExistingWorkspace(pending, sessionId)
      if (!workspaceOpenGate.isCurrent(ticket)) return
      setManualWorkspaceMode(null)
      setManualWorkspacePath('')
      setRelocatingWorkspaceId(undefined)
    } catch (error) {
      if (!workspaceOpenGate.isCurrent(ticket)) return
      let cleanupFailed = false
      if (pending?.registrationCreated && !pending.sessionId) {
        try { await ctx.workspaces.delete(pending.workspace.workspaceId) } catch { cleanupFailed = true }
      }
      if (!workspaceOpenGate.isCurrent(ticket)) return
      const detail = error instanceof Error ? error.message : ''
      const message = replaceWorkspaceId
        ? relocationFailureMessage(cleanupFailed)
        : /unrelated files/i.test(detail)
          ? '新作品必须使用空文件夹；当前文件夹已有其他内容。'
          : /no supported text files/i.test(detail)
            ? '没有找到可打开的 Markdown 或 TXT 作品文件。'
            : stage === 'registering'
              ? '作品文件夹不存在或无法读取，请重新选择。'
              : stage === 'inspecting'
                ? '作品目录检查未能完成，请重试。'
              : stage === 'initializing'
                ? '新作品初始化未能完成；已有文件不会被覆盖。'
                : workspaceOpenFailureMessage(error)
      setWorkspaceOpen(replacedWorkspace
        ? { kind: 'needs-relocation', workspaceId: replacedWorkspace.workspaceId, path: replacedWorkspace.path, title: replacedWorkspace.title, message }
        : { kind: 'error', path, title: path, message })
      setHomeNote(message)
      setManualWorkspaceMode((replaceWorkspaceId || intent === 'create') ? null : 'existing')
      setManualWorkspacePath((replaceWorkspaceId || intent === 'create') ? '' : path)
      if (replaceWorkspaceId) setRelocatingWorkspaceId(undefined)
    } finally {
      if (workspaceOpenGate.isCurrent(ticket)) setOpeningWorkspace(false)
    }
  }
  const continuePendingWorkspaceIntent = async () => {
    const pending = pendingWorkspaceOpen.current
    if (!pending || workspaceOpen.kind !== 'needs-intent' || pending.workspace.workspaceId !== workspaceOpen.workspaceId) return
    pending.intent = workspaceOpen.intent
    setOpeningWorkspace(true)
    setHomeNote('')
    setWorkspaceOpen({ kind: 'checking', workspaceId: pending.workspace.workspaceId, path: pending.workspace.path, title: pending.workspace.title })
    try {
      const sessionId = await connectUsableWorkspaceSession(ctx, pending.workspace.workspaceId, pending.sessionId)
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      pending.sessionId = sessionId
      if (pending.intent === 'create') await prepareNewWorkspace(pending, sessionId)
      else await prepareExistingWorkspace(pending, sessionId)
    } catch (error) {
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      let cleanupFailed = false
      if (pending.registrationCreated && !pending.sessionId) {
        try { await ctx.workspaces.delete(pending.workspace.workspaceId) } catch { cleanupFailed = true }
      }
      if (!workspaceOpenGate.isCurrent(pending.ticket)) return
      pendingWorkspaceOpen.current = null
      const message = pending.intent === 'create'
        ? `新作品初始化未能完成；已有文件不会被覆盖。${cleanupFailed ? ' 最近作品入口未能自动移除。' : ''}`
        : `${workspaceOpenFailureMessage(error)}${cleanupFailed ? ' 最近作品入口未能自动移除。' : ''}`
      setWorkspaceOpen({ kind: 'error', path: pending.workspace.path, title: pending.workspace.title, message })
      setHomeNote(message)
    } finally {
      if (workspaceOpenGate.isCurrent(pending.ticket)) setOpeningWorkspace(false)
    }
  }
  const cancelPendingWorkspaceIntent = async () => {
    const pending = pendingWorkspaceOpen.current
    if (!pending || workspaceOpen.kind !== 'needs-intent') return
    workspaceOpenGate.begin('home')
    pendingWorkspaceOpen.current = null
    setOpeningWorkspace(true)
    let cleanupFailed = false
    if (pending.registrationCreated && !pending.sessionId) {
      try { await ctx.workspaces.delete(pending.workspace.workspaceId) } catch { cleanupFailed = true }
    }
    setOpeningWorkspace(false)
    setWorkspaceOpen({ kind: 'idle' })
    setManualWorkspaceMode(null)
    setManualWorkspacePath('')
    setHomeNote(cleanupFailed
      ? '已取消，但本次新增的最近作品入口未能自动移除。'
      : pending.registrationCreated && pending.sessionId
        ? '已取消；作品会话已经建立，因此最近作品入口已保留。'
        : '')
  }
  useEffect(() => {
    if (workspaceOpen.kind !== 'idle' || !selectedWorkspace || !session) return
    if (!claimInitialWorkspaceResume(initialWorkspaceResumeStarted)) return
    void openRegisteredWorkspace(selectedWorkspace, session.sessionId)
  }, [selectedWorkspace?.workspaceId, session?.sessionId, workspaceOpen.kind])
  const relocateWorkspace = async (workspace: WorkspaceView) => {
    if (openingWorkspace) return
    let path: string | null
    try {
      path = await ctx.workspaces.pickDirectory()
    } catch {
      setRelocatingWorkspaceId(workspace.workspaceId)
      setManualWorkspaceMode('existing')
      setManualWorkspacePath('')
      setHomeNote('目录选择器暂时不可用，请直接输入作品的新位置。')
      return
    }
    if (!path) return
    await openPickedWorkspace(path, 'open', workspace.workspaceId)
  }
  const removeBrokenWorkspace = async (workspace: WorkspaceView) => {
    if (openingWorkspace) return
    try {
      await ctx.workspaces.delete(workspace.workspaceId)
      workspaceOpenGate.begin('home')
      setWorkspaceOpen({ kind: 'idle' })
      setHomeNote('已从最近移除；磁盘中的作品未被删除。')
    } catch {
      setHomeNote('最近入口未能移除，请重试。')
    }
  }
  const startWorkspaceFromPicker = async () => {
    if (openingWorkspace) return
    setHomeNote('')
    setManualWorkspaceMode(null)
    setOpeningWorkspace(true)
    let picked: string | null
    try {
      picked = await ctx.workspaces.pickDirectory()
    } catch {
      setOpeningWorkspace(false)
      setManualWorkspaceMode('existing')
      setHomeNote('目录选择器暂时不可用，请直接输入作品路径。')
      if (session) {
        setWorkbenchNote('目录选择器暂时不可用，请直接输入作品路径。')
        setWorkspaceSwitcherOpen(false)
        setWorkspaceMenuOpen(true)
      }
      return
    }
    if (!picked) {
      setOpeningWorkspace(false)
      return
    }
    await openPickedWorkspace(picked, 'open')
  }
  const pickWorkspaceDirectory = async () => {
    try {
      const path = await ctx.workspaces.pickDirectory()
      if (!path) {
        const message = '未选择文件夹，可直接输入路径。'
        if (session) setWorkbenchNote(message)
        else setHomeNote(message)
        return
      }
      await openPickedWorkspace(path, 'open', relocatingWorkspaceId)
    } catch {
      const message = '目录选择器暂时不可用，请直接输入作品路径。'
      if (session) setWorkbenchNote(message)
      else setHomeNote(message)
    }
  }
  const submitWorkspacePath = async (event: FormEvent) => {
    event.preventDefault()
    const path = manualWorkspacePath.trim()
    if (!path) {
      const message = '请输入作品文件夹路径。'
      if (session) setWorkbenchNote(message)
      else setHomeNote(message)
      return
    }
    await openPickedWorkspace(path, 'open', relocatingWorkspaceId)
  }
  const pathFallbackForm = manualWorkspaceMode ? e('form', { className: 'path-fallback', onSubmit: submitWorkspacePath },
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
      e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void pickWorkspaceDirectory() }, '选择文件夹'),
      e('button', { className: 'primary-action', type: 'submit', disabled: openingWorkspace },
        openingWorkspace ? '打开中…' : '打开此目录',
      ),
      e('button', {
        type: 'button',
        disabled: openingWorkspace,
        onClick: () => {
          setManualWorkspaceMode(null)
          setRelocatingWorkspaceId(undefined)
          setHomeNote('')
          if (session) setWorkbenchNote('')
        },
      }, '取消'),
    ),
  ) : null
  const closeWorkspaceChrome = () => {
    setWorkspaceMenuOpen(false)
    setWorkspaceSwitcherOpen(false)
  }
  const leaveToHome = async () => {
    closeWorkspaceChrome()
    if (editorDirty) { setWorkbenchNote('请先保存当前文档，再返回作品列表。'); return }
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    setAssistantOpen(false)
    setFocusMode(false)
    workspaceOpenGate.begin('home')
    pendingWorkspaceOpen.current = null
    setWorkspaceOpen({ kind: 'idle' })
    ctx.sessions.clear()
  }
  const switchToWorkspace = async (id: WorkspaceId) => {
    closeWorkspaceChrome()
    if (!id || id === currentWorkspace?.workspaceId) return
    if (editorDirty) { setWorkbenchNote('请先保存当前文档，再切换作品。'); return }
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    const workspace = workspaces.items.find((item) => item.workspaceId === id)
    if (!workspace) { setExportNote('作品入口已经变化，请重新选择。'); return }
    await openRegisteredWorkspace(workspace)
  }
  const startNewProject = async () => {
    closeWorkspaceChrome()
    if (openingWorkspace || newProject) return
    if (fileSession) {
      if (editorDirty) { setWorkbenchNote('请先保存当前文档，再新建作品。'); return }
      if (!(await canLeaveAssistantDraft())) return
      setAssistantDraftDirty(false)
    }
    setHomeNote('')
    setManualWorkspaceMode(null)
    setNewProject({ busy: false, note: '' })
  }
  const submitNewProject = async (title: string) => {
    if (!newProject || newProject.busy || openingWorkspace) return
    setNewProject({ busy: true, note: '' })
    setOpeningWorkspace(true)
    const created = await safeRpcCall<{ path: string }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.createHome', { title }))
    if (!created.ok) {
      setOpeningWorkspace(false)
      setNewProject({ busy: false, note: errorMessage(created) })
      return
    }
    setNewProject(null)
    await openPickedWorkspace(created.value.path, 'create')
  }
  const closeNewProject = () => {
    if (newProject?.busy) return
    setNewProject(null)
  }
  const renderNewProjectDialog = () => newProject ? e(NewProjectDialog, {
    busy: newProject.busy,
    note: newProject.note,
    onClose: closeNewProject,
    onCreate: (title: string) => void submitNewProject(title),
  }) : null
  const openAnotherWorkspace = async () => {
    closeWorkspaceChrome()
    if (editorDirty) {
      setWorkbenchNote('请先保存当前文档，再打开作品。')
      return
    }
    if (!(await canLeaveAssistantDraft())) return
    setAssistantDraftDirty(false)
    await startWorkspaceFromPicker()
  }
  const closeImportFlow = (restoreFocus = true) => {
    const target = importReturnFocus.current
    importReturnFocus.current = null
    setImportFlow(idleImportFlow)
    if (restoreFocus && target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const selectImportSource = async (targetSessionId: SessionId, targetWorkspaceId: WorkspaceId) => {
    const sourcePath = await ctx.workspaces.pickDirectory()
    if (!sourcePath) { closeImportFlow(); return }
    let sourceSessionId: SessionId | undefined
    let createdSourceWorkspaceId: WorkspaceId | undefined
    try {
      const sourceRegistration = await registerFlowWorkspace(sourcePath)
      if (sourceRegistration.created) createdSourceWorkspaceId = sourceRegistration.workspace.workspaceId
      sourceSessionId = await ctx.workspaces.connectWorkspace(sourceRegistration.workspace.workspaceId)
      bindTemporarySource(sourceSessionId, sourceRegistration.workspace.workspaceId, sourceRegistration.created)
      setImportFlow({ kind: 'working', message: '正在检查可导入的文件…' })
      const probe = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', {
        sourceSessionId, targetSessionId,
      }))
      if (!probe.ok || probe.value.state !== 'ready') {
        const sourceCleaned = await cleanupTemporarySource(sourceSessionId)
        closeImportFlow()
        const note = probe.ok ? probe.value.message ?? '目录不能导入。' : '导入检查未能完成。'
        setHomeNote(sourceCleaned ? note : `${note} 临时工作区入口未能自动移除。`)
        return
      }
      setImportFlow(importReview(sourceSessionId, targetSessionId, targetWorkspaceId, probe.value))
    } catch (error) {
      const sourceCleaned = sourceSessionId
        ? await cleanupTemporarySource(sourceSessionId)
        : createdSourceWorkspaceId ? await cleanupFlowWorkspace(createdSourceWorkspaceId) : true
      if (error instanceof FlowWorkspaceCleanupError || !sourceCleaned) {
        closeImportFlow()
        setHomeNote('导入未能开始；临时工作区入口未能自动移除。')
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
        setHomeNote(sourceCleaned && targetCleaned ? '导入未能完成，请重试。' : '导入未能完成；临时工作区入口未能自动移除。')
      }
      return
    }
    const initialized = await safeRpcCall(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.init', { sessionId: flow.targetSessionId, newProject: false }))
    const sourceCleaned = await cleanupTemporarySource(flow.sourceSessionId)
    preserveFlowWorkspace(flow.targetWorkspaceId)
    if (!initialized.ok) {
      closeImportFlow(false)
      setHomeNote(sourceCleaned ? '导入已完成，但项目初始化未能完成。' : '导入已完成，但项目初始化和临时入口清理未能完成。')
      return
    }
    try {
      const openedPending = await finishPendingWorkspaceOpen(flow.targetSessionId)
      if (!openedPending) {
        const initialPath = await verifyWorkspaceSession(ctx, flow.targetSessionId as SessionId)
        setPath(initialPath ?? '')
        setWorkspaceOpen({ kind: 'ready', workspaceId: flow.targetWorkspaceId as WorkspaceId, sessionId: flow.targetSessionId as SessionId, path: workspaces.items.find((item) => item.workspaceId === flow.targetWorkspaceId)?.path ?? '' })
        ctx.sessions.open(flow.targetSessionId as SessionId)
        setIndexStatus((old) => ({ ...old, [flow.targetWorkspaceId]: 'idle' }))
      }
      closeImportFlow(false)
      if (!sourceCleaned) setHomeNote('作品已导入；临时来源入口未能自动移除。')
    } catch {
      closeImportFlow(false)
      setHomeNote('导入已完成，但作品文件仍无法读取。')
    }
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
      if (pendingWorkspaceOpen.current?.workspace.workspaceId === flow.targetWorkspaceId) {
        workspaceOpenGate.begin('home')
        pendingWorkspaceOpen.current = null
        setWorkspaceOpen({ kind: 'idle' })
      }
      closeImportFlow()
      setHomeNote(targetCleaned ? '已清理未完成导入。' : '已清理未完成导入，但临时工作区入口未能自动移除。')
      return
    }
    const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.importProbe', { targetSessionId: flow.targetSessionId }))
    if (recovery.ok && recovery.value.state === 'recoverable') {
      setImportFlow(recoverImport(flow.targetSessionId, flow.targetWorkspaceId, { ...recovery.value, message: recovery.value.message ?? '清理未能完成；文件未被自动删除。' }))
      return
    }
    if (current === flow.targetSessionId) ctx.sessions.clear()
    if (pendingWorkspaceOpen.current?.workspace.workspaceId === flow.targetWorkspaceId) {
      workspaceOpenGate.begin('home')
      pendingWorkspaceOpen.current = null
      setWorkspaceOpen({ kind: 'idle' })
    }
    closeImportFlow()
    setHomeNote('清理未能完成；文件未被自动删除。')
  }
  const closeSnapshotFlow = (restoreFocus = true) => {
    const target = snapshotReturnFocus.current
    snapshotReturnFocus.current = null
    setSnapshotFlow(idleSnapshotFlow)
    if (restoreFocus && target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const openSnapshotLibrary = () => {
    if (!fileSession) return
    if (editorDirty) { setExportNote('请先保存当前文档，再查看作品快照。'); return }
    snapshotReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSnapshotLibraryOpen(true)
  }
  const closeSnapshotLibrary = () => {
    if (snapshotBusy) return
    const target = snapshotReturnFocus.current
    snapshotReturnFocus.current = null
    setSnapshotLibraryOpen(false)
    if (target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const loadSnapshotList = async (note?: string) => {
    if (!fileSession) {
      setSnapshotList(null)
      return
    }
    setSnapshotBusy(true)
    const listed = await safeRpcCall<SnapshotView[]>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.list', { sessionId: fileSession.sessionId }))
    setSnapshotBusy(false)
    if (!listed.ok) { setSnapshotNote('快照列表未能读取，请重试。'); return }
    setSnapshotList(listed.value)
    setSnapshotNote(note ?? '')
  }
  useEffect(() => {
    if (!snapshotLibraryOpen) return
    setSnapshotList(null)
    setSnapshotNote('')
    void loadSnapshotList()
  }, [snapshotLibraryOpen, fileSession?.sessionId])
  const createSnapshot = async () => {
    if (!fileSession) return
    if (editorDirty) { setSnapshotNote('请先保存当前未保存内容，再创建快照。'); return }
    setSnapshotBusy(true)
    setSnapshotNote('正在创建整部作品文本快照…')
    const result = await safeRpcCall<SnapshotView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.create', { sessionId: fileSession.sessionId }))
    if (!result.ok) { setSnapshotBusy(false); setSnapshotNote('快照未能创建，请重试。'); return }
    await loadSnapshotList(`已创建快照：${snapshotSummary(result.value)}`)
  }
  const restoreAsCopy = async (snapshot: SnapshotView) => {
    if (!fileSession) return
    if (snapshotLibraryOpen) setSnapshotLibraryOpen(false)
    else snapshotReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSnapshotBusy(true)
    setSnapshotFlow({ kind: 'working', message: '请选择一个新的空文件夹作为恢复目标…' })
    const targetPath = await ctx.workspaces.pickDirectory()
    if (!targetPath) { setSnapshotBusy(false); closeSnapshotFlow(); setSnapshotNote('已取消选择恢复目标。'); return }
    let createdTargetWorkspaceId: WorkspaceId | undefined
    try {
      const targetRegistration = await registerFlowWorkspace(targetPath)
      const target = targetRegistration.workspace
      if (targetRegistration.created) createdTargetWorkspaceId = target.workspaceId
      const targetSessionId = await ctx.workspaces.connectWorkspace(target.workspaceId)
      const probe = await safeRpcCall<RestoreView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreProbe', {
        sourceSessionId: fileSession.sessionId,
        targetSessionId,
        snapshotId: snapshot.snapshotId,
      }))
      setSnapshotBusy(false)
      if (!probe.ok || probe.value.state !== 'ready' || !probe.value.token) {
        const targetCleaned = createdTargetWorkspaceId ? await cleanupFlowWorkspace(createdTargetWorkspaceId) : true
        closeSnapshotFlow(false)
        const note = probe.ok ? probe.value.message ?? '目标目录不能用于恢复。' : '恢复检查未能完成。'
        setSnapshotNote(targetCleaned ? note : `${note} 临时工作区入口未能自动移除。`)
        return
      }
      setSnapshotFlow(snapshotReview(fileSession.sessionId, targetSessionId, target.workspaceId, probe.value, snapshot))
    } catch (error) {
      const targetCleaned = createdTargetWorkspaceId ? await cleanupFlowWorkspace(createdTargetWorkspaceId) : true
      setSnapshotBusy(false)
      closeSnapshotFlow(false)
      setSnapshotNote(error instanceof FlowWorkspaceCleanupError || !targetCleaned
        ? '恢复未能开始；临时工作区入口未能自动移除。'
        : '恢复目标未能打开，请重试。')
    }
  }
  const finishRestoredCopy = async (targetSessionId: string, targetWorkspaceId: string, sourceSessionId: string) => {
    const sourceCleaned = await cleanupTemporarySource(sourceSessionId)
    preserveFlowWorkspace(targetWorkspaceId)
    const openedPending = await finishPendingWorkspaceOpen(targetSessionId)
    if (!openedPending) {
      const initialPath = await verifyWorkspaceSession(ctx, targetSessionId as SessionId)
      setPath(initialPath ?? '')
      setWorkspaceOpen({ kind: 'ready', workspaceId: targetWorkspaceId as WorkspaceId, sessionId: targetSessionId as SessionId, path: workspaces.items.find((item) => item.workspaceId === targetWorkspaceId)?.path ?? '' })
      ctx.sessions.open(targetSessionId as SessionId)
      setIndexStatus((old) => ({ ...old, [targetWorkspaceId]: 'idle' }))
    }
    closeSnapshotFlow(false)
    setSnapshotNote('')
    setWorkbenchNote(sourceCleaned ? '已恢复为新的作品副本。' : '已恢复作品副本；临时来源入口未能自动移除。')
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
      ? '恢复未能完成；目标文件未被当成完整作品打开。'
      : '恢复未能完成；临时工作区入口未能自动移除。')
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
      setSnapshotFlow({ ...recover, probe: { ...recover.probe, message: probe.ok ? probe.value.message ?? '所选原作品不匹配。' : '原作品未能完成验证。' } })
      if (!sourceCleaned) setSnapshotNote('临时来源入口未能自动移除。')
    } catch (error) {
      const sourceCleaned = sourceSessionId
        ? await cleanupTemporarySource(sourceSessionId)
        : createdSourceWorkspaceId ? await cleanupFlowWorkspace(createdSourceWorkspaceId) : true
      setSnapshotBusy(false)
      setSnapshotFlow({ ...recover, probe: { ...recover.probe, message: error instanceof FlowWorkspaceCleanupError || !sourceCleaned
        ? '临时来源入口未能自动移除。'
        : '原作品目录未能打开。' } })
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
      if (pendingWorkspaceOpen.current?.workspace.workspaceId === flow.targetWorkspaceId) {
        workspaceOpenGate.begin('home')
        pendingWorkspaceOpen.current = null
        setWorkspaceOpen({ kind: 'idle' })
      }
      closeSnapshotFlow()
      setHomeNote(targetCleaned ? '已清理未完成恢复。' : '已清理未完成恢复，但临时工作区入口未能自动移除。')
      return
    }
    const recovery = await safeRpcCall<RestoreView>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'snapshot.restoreProbe', { targetSessionId: flow.targetSessionId }))
    if (recovery.ok && recovery.value.state === 'recoverable') {
      setSnapshotFlow(recoverSnapshot(flow.targetSessionId, flow.targetWorkspaceId, { ...recovery.value, message: recovery.value.message ?? '清理未能完成；文件未被自动删除。' }))
      return
    }
    if (current === flow.targetSessionId) ctx.sessions.clear()
    if (pendingWorkspaceOpen.current?.workspace.workspaceId === flow.targetWorkspaceId) {
      workspaceOpenGate.begin('home')
      pendingWorkspaceOpen.current = null
      setWorkspaceOpen({ kind: 'idle' })
    }
    closeSnapshotFlow()
    setHomeNote('清理未能完成；文件未被自动删除。')
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
    if (flow.kind !== 'idle' && flow.kind !== 'working' && pendingWorkspaceOpen.current?.workspace.workspaceId === flow.targetWorkspaceId) {
      workspaceOpenGate.begin('home')
      pendingWorkspaceOpen.current = null
      setWorkspaceOpen({ kind: 'idle' })
    }
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
    if (flow.kind !== 'idle' && flow.kind !== 'working' && pendingWorkspaceOpen.current?.workspace.workspaceId === flow.targetWorkspaceId) {
      workspaceOpenGate.begin('home')
      pendingWorkspaceOpen.current = null
      setWorkspaceOpen({ kind: 'idle' })
    }
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
    onCancel: () => void cancelSnapshotFlow(),
    onApply: () => void applySnapshotRestore(),
    onContinue: () => void continueSnapshotRestore(),
    onCleanup: () => void cleanupSnapshotRestore(),
  })
  const renderSnapshotLibrary = () => e(SnapshotLibraryDialog, {
    open: snapshotLibraryOpen,
    available: Boolean(fileSession),
    workspaceTitle: currentWorkspace?.title || currentWorkspace?.path || '',
    dirty: editorDirty,
    busy: snapshotBusy,
    snapshots: snapshotList,
    note: snapshotNote,
    onCreate: () => void createSnapshot(),
    onRestore: (snapshot: SnapshotView) => void restoreAsCopy(snapshot),
    onRetry: () => void loadSnapshotList(),
    onClose: closeSnapshotLibrary,
  })

  if (workspaceOpen.kind === 'checking') {
    return e('main', { className: 'shell no-session', style: { minWidth: 0, display: 'grid' } },
      e('style', null, redesignedStyles),
      e('style', null, playfulStyles),
      e('section', { className: 'workspace-checking', 'aria-label': '正在验证作品' },
        e('h1', null, '正在检查作品'),
        e('p', { role: 'status', 'aria-live': 'polite' }, '正在确认目录、恢复状态和正文文件…'),
        e('code', null, workspaceOpen.path),
      ),
      renderImportDialog(),
      renderSnapshotDialog(),
    )
  }

  if (!fileSession || workspaceOpen.kind !== 'ready') {
    return e('main', { className: 'shell no-session', style: { minWidth: 0, display: 'grid' } },
      e('style', null, redesignedStyles),
      e('header', { className: 'chrome' },
        e('div', { className: 'brand-lockup' },
          e('span', { className: 'brand-mark', 'aria-hidden': 'true' }, 'D'),
          e('strong', null, 'DSH Editor'),
        ),
        e('span', { className: 'local-state' }, '本地作品'),
        e('span', { ref: settingsControlRef, className: 'native-settings-control' }, settingsControl),
      ),
      e(PaperStage, { label: '空白稿纸' },
        e('p', { className: 'home-hint' }, '打开已有作品，或填写名称后在「文档/dsh-editor」下新建。'),
        e('div', { className: 'home-actions' },
          e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void startWorkspaceFromPicker() }, '打开作品'),
          e('button', { type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void startNewProject() }, '新建'),
        ),
        pathFallbackForm,
        workspaceOpen.kind === 'needs-intent' ? e('section', { className: 'workspace-intent-prompt', role: 'alert' },
          e('strong', null, workspaceOpen.intent === 'create' ? '这个目录还不是作品' : '这里已经有作品内容'),
          e('p', null, workspaceOpen.message),
          e('code', null, workspaceOpen.path),
          e('div', null,
            e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace, onClick: () => void continuePendingWorkspaceIntent() }, workspaceOpen.intent === 'create' ? '在这里新建' : '改为打开'),
            e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void cancelPendingWorkspaceIntent() }, '取消'),
          ),
        ) : null,
        workspaceOpen.kind === 'error' ? e('code', null, workspaceOpen.path) : null,
        homeNote ? e('p', { className: 'warning', role: 'alert' }, homeNote) : null,
        e('section', { className: 'home-recent', 'aria-label': '最近作品' },
          e('header', null, e('h2', null, '最近作品'), e('small', null, workspaces.items.length ? `${workspaces.items.length} 个入口` : '尚无作品入口')),
          workspaces.items.length ? e('div', { className: 'workspace-list' }, workspaces.items.map((workspace) => {
            const needsRelocation = workspaceOpen.kind === 'needs-relocation' && workspaceOpen.workspaceId === workspace.workspaceId
            return e('article', { className: `workspace-row${needsRelocation ? ' needs-relocation' : ''}`, key: workspace.workspaceId },
              e('button', {
                className: 'tree-row', type: 'button', disabled: openingWorkspace,
                onClick: () => void openRegisteredWorkspace(workspace),
              }, e('strong', null, workspace.title || workspace.path), e('small', null, workspace.path)),
              e('button', { className: 'workspace-manage icon-button', type: 'button', 'aria-label': `管理作品 ${workspace.title || workspace.path}`, title: '管理作品', onClick: () => openWorkspaceManage(workspace, true) }, '···'),
              needsRelocation ? e('div', { className: 'workspace-relocation', role: 'alert' },
                e('p', null, workspaceOpen.message), e('code', null, workspaceOpen.path),
                e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace, onClick: () => void relocateWorkspace(workspace) }, '重新定位'),
                e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void removeBrokenWorkspace(workspace) }, '从最近移除'),
              ) : null,
            )
          })) : e('p', { className: 'muted home-recent-empty' }, '打开过的作品会显示在这里。'),
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
      renderNewProjectDialog(),
      renderImportDialog(),
      renderSnapshotDialog(),
    )
  }

  const chatSession = session ?? fileSession
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
    e('header', { className: 'chrome' },
      e('div', { className: 'workspace-chrome', role: 'group', 'aria-label': '作品' },
        e('details', {
          className: 'project-switcher',
          open: workspaceSwitcherOpen,
          onToggle: (event: ChangeEvent<HTMLDetailsElement>) => {
            const open = event.currentTarget.open
            setWorkspaceSwitcherOpen(open)
            if (open) setWorkspaceMenuOpen(false)
          },
        },
          e('summary', {
            role: 'button',
            title: '切换作品',
            'aria-label': '切换作品',
            'aria-expanded': workspaceSwitcherOpen,
            'aria-controls': 'workspace-switcher-list',
          }, e('span', null, currentWorkspace?.title || currentWorkspace?.path || '作品')),
          e('div', { id: 'workspace-switcher-list', className: 'workspace-menu-panel', 'aria-label': '最近作品' },
            e('div', { className: 'workspace-menu-actions' },
              workspaces.items.map((workspace) => e('button', {
                key: workspace.workspaceId,
                type: 'button',
                'aria-current': workspace.workspaceId === currentWorkspace?.workspaceId ? 'true' : undefined,
                disabled: openingWorkspace,
                onClick: () => void switchToWorkspace(workspace.workspaceId),
              }, workspace.title || workspace.path)),
            ),
          ),
        ),
        e('details', {
          className: 'workspace-menu',
          open: workspaceMenuOpen,
          onToggle: (event: ChangeEvent<HTMLDetailsElement>) => {
            const open = event.currentTarget.open
            setWorkspaceMenuOpen(open)
            if (open) setWorkspaceSwitcherOpen(false)
          },
        },
          e('summary', { role: 'button', title: '作品菜单', 'aria-label': '作品菜单', 'aria-expanded': workspaceMenuOpen, 'aria-controls': 'workspace-actions' }, '作品'),
          e('div', { id: 'workspace-actions', className: 'workspace-menu-panel', 'aria-label': '作品操作' },
            e('div', { className: 'workspace-menu-actions' },
              e('button', { type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void openAnotherWorkspace() }, '打开作品'),
              e('button', { type: 'button', disabled: openingWorkspace || Boolean(newProject), onClick: () => void startNewProject() }, '新建'),
              currentWorkspace ? e('button', { type: 'button', 'aria-label': '管理当前作品', title: '修改作品显示名', onClick: () => { closeWorkspaceChrome(); openWorkspaceManage(currentWorkspace, false) } }, '管理当前作品') : null,
              e('button', { type: 'button', disabled: exporting, onClick: () => { closeWorkspaceChrome(); void exportNovel('markdown') } }, exporting ? '导出中…' : '导出 Markdown'),
              e('button', { type: 'button', disabled: exporting, onClick: () => { closeWorkspaceChrome(); void exportNovel('text') } }, '导出 TXT'),
              e('button', { type: 'button', disabled: editorDirty, onClick: () => { closeWorkspaceChrome(); openSnapshotLibrary() } }, '作品快照'),
              e('button', { type: 'button', 'aria-label': '返回作品列表', onClick: () => void leaveToHome() }, '返回作品列表'),
            ),
            pathFallbackForm,
          ),
        ),
      ),
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
      e('div', { className: 'topbar-actions' },
        exportNote ? e('span', { role: /无法|失败|为空/.test(exportNote) ? 'alert' : 'status' }, exportNote) : null,
        e('button', { className: 'settings-link icon-button', type: 'button', title: '键盘快捷键', 'aria-label': '键盘快捷键', onClick: openShortcuts }, '?'),
        e('span', { ref: settingsControlRef, className: 'native-settings-control' }, settingsControl),
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
        sessionId: fileSession.sessionId,
        revision: treeRevision,
        navigationBlocked: editorDirty,
        referenceRequest,
        onOpen: (hit: SearchHit) => openDocument(hit.path, hit),
      }),
      workspaceOpen.warning ? e('p', { className: 'warning pad', role: 'status' }, workspaceOpen.warning) : null,
      workbenchNote ? e('p', { className: `${isSuccessWorkbenchNote(workbenchNote) ? 'success' : 'warning'} pad`, role: isSuccessWorkbenchNote(workbenchNote) ? 'status' : 'alert' }, workbenchNote) : null,
      e(Tree, { ctx, sessionId: fileSession.sessionId, active: path, expandPath: treeExpansionPath, onOpen: openDocument, onFileMenu: openFileMenu, onCreateChapter: (directory: string) => openCreateDialog('chapter', directory), revision: treeRevision }),
      e('details', { className: 'archive-panel', onToggle: (event: ChangeEvent<HTMLDetailsElement>) => { if (event.currentTarget.open) void loadArchives() } },
        e('summary', null,
          e('span', null, '已归档'),
          visibleArchives(archives).length ? e('small', null, visibleArchives(archives).length) : null,
        ),
        e('div', { className: 'archive-list' },
          archiveBusy && !archives.length ? e('p', { className: 'muted' }, '读取中…') : null,
          !archiveBusy && !visibleArchives(archives).length ? e('p', { className: 'muted' }, '暂无归档文档。') : null,
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
      currentWorkspace && indexStatus[currentWorkspace.workspaceId] ? e('div', { className: 'index-status', role: indexStatus[currentWorkspace.workspaceId] === 'failed' ? 'alert' : 'status' },
        e('span', null, indexStatus[currentWorkspace.workspaceId] === 'initializing' ? '正在整理作品资料…' : indexStatus[currentWorkspace.workspaceId] === 'queued' ? '作品资料正在后台整理' : indexStatus[currentWorkspace.workspaceId] === 'failed' ? '作品资料暂未整理好' : '作品资料尚未整理'),
        e('button', { type: 'button', onClick: () => triggerExistingIndex(currentWorkspace.workspaceId, fileSession.sessionId, true) }, indexStatus[currentWorkspace.workspaceId] === 'failed' ? '重试整理' : '重新整理'),
      ) : null,
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
    e(Editor, {
      ctx, session: fileSession, path, files, onOpen: openDocument, create: () => openCreateDialog('chapter'),
      externalRevision: contentRevision, onDirtyChange: setEditorDirty, reveal, completionPreference: writing.completion,
      authorPreferences: normalizeAuthorPreferences(writing.authorPreferences),
      chapterStatus: overview?.chapters.find((chapter) => chapter.path === path)?.status,
      statusBusy,
      onChapterStatus: (chapterPath: string, status: ChapterStatus) => void updateChapterStatus(chapterPath, status),
      onReferenceSearch: (request: ReferenceQuery) => {
        setFocusMode(false); setSidebarOpen(true)
        setReferenceRequest({ ...request, nonce: Date.now() })
      },
      onSaved: () => setOverviewRevision((value) => value + 1),
    }),
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
      key: chatSession.sessionId,
      ctx,
      session: chatSession,
      workspaceId: currentWorkspace?.workspaceId,
      activePath: path,
      authorPreferences: normalizeAuthorPreferences(writing.authorPreferences),
      hidden: !assistantVisible,
      onClose: () => setAssistantOpen(false),
      onConfigure: openSettings,
      onDraftDirtyChange: setAssistantDraftDirty,
      onApplied: (appliedPath: string) => {
        const navigation = proposalAppliedNavigation(appliedPath, path, editorDirty)
        setTreeRevision((old) => old + 1)
        if (navigation.expandPath) setTreeExpansionPath(navigation.expandPath)
        if (!navigation.openPath) {
          setWorkbenchNote('建议已应用；当前文档有未保存内容，请先保存，再打开应用的文件。')
          return
        }
        openDocument(navigation.openPath)
        if (navigation.refreshContent) setContentRevision((old) => old + 1)
      },
    }),
    !assistantVisible && !focusMode ? e('button', {
      className: 'assistant-launcher',
      type: 'button',
      'aria-label': '打开写作搭档',
      'aria-expanded': false,
      onClick: () => setAssistantOpen(true),
    }, e('span', { 'aria-hidden': 'true' }, e(DeepSeekWhaleMark)), e('strong', null, '搭档')) : null,
    shortcutsOpen ? e(ShortcutDialog, { onClose: closeShortcuts }) : null,
    exportPreview ? e(ExportPreviewDialog, {
      prepared: exportPreview,
      busy: exporting,
      onCancel: () => setExportPreview(null),
      onConfirm: confirmExport,
    }) : null,
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
    renderNewProjectDialog(),
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
    renderSnapshotLibrary(),
    fileMenu ? e(FileContextMenu, {
      path: fileMenu.path,
      x: fileMenu.x,
      y: fileMenu.y,
      onClose: () => setFileMenu(null),
      onRename: () => openManageAction(fileMenu.path, 'rename'),
      onMove: () => openManageAction(fileMenu.path, 'move'),
      onArchive: () => void archiveManaged(fileMenu.path),
    }) : null,
    managePath && manageMode ? e(FileManageDialog, {
      key: `${manageMode}:${managePath}`,
      path: managePath,
      mode: manageMode,
      busy: manageBusy,
      note: manageNote,
      moveDirectories: manageDirectories,
      onClose: closeManage,
      onRename: (name: string) => void renameManaged(name),
      onMove: (directory: string) => void moveManaged(directory),
    }) : null,
  )
}

type NativeSettingsRootProps = {
  renderSlot(key: 'sidebar.settings', owner: { wide: boolean }): ReactNode
}

export function apply(ctx: Context): void {
  const client = ctx as ShellContext
  const writingScope = client.settingsScope.bind({ namespace: WRITING_SETTINGS_NAMESPACE, decode: decodeWritingPreferences })
  const migrateWritingPreferences = createWritingMigration(writingScope, globalThis.localStorage)
  void migrateWritingPreferences()
  registerWritingSettings(client, writingScope, migrateWritingPreferences)
  registerRoot(client, (props) => e(Root, {
    ctx: client,
    writingScope,
    settingsControl: (props as typeof props & NativeSettingsRootProps).renderSlot('sidebar.settings', { wide: true }),
  }))
}
