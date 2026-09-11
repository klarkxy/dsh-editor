import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  ConnectionHandle,
  EditorRemote,
  EditorSessions,
  EditorUiConversation,
  EditorUiSession,
  EditorUiWorkspace,
  EditorWorkspaces,
  RpcResult,
  SettingsNamespaceView,
  SettingsScope as CompatSettingsScope,
  SessionId,
  WorkspaceId,
  WorkspaceView,
} from '../dsh-compat.ts'
import { stripChapterFrontmatter, worldbookEditorMetadata, type ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'
import type { WritingSettingsSlots } from '../writing-settings.ts'
import { isChapterMetaPath } from '../chapter-meta-view.ts'
import { intlLocale, t } from '../i18n/index.ts'

export type TreeEntry = { name: string; type: 'file' | 'directory' | 'other' }

export type { RpcResult }

export type SettingsScope<T = unknown> = CompatSettingsScope<T>

/* Locally projected subset of the settings describe face. The shell only
   ever needs the face's four operations: the reactive get-snapshot, the
   subscription, the first-use ensure, and the write-answer fold. */
export interface SettingsDescribeView {
  namespaces: readonly SettingsNamespaceView[]
  writable: boolean
  hasDocument: boolean
}

export interface SettingsMirrorSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  view: SettingsDescribeView | undefined
  error: string | null
}

export interface SettingsDescribeFace {
  getSnapshot(): SettingsMirrorSnapshot
  subscribe(listener: () => void): () => void
  ensure(): Promise<void>
  acceptView(view: SettingsNamespaceView): void
}

export interface SettingsScopeBinder {
  bind<T>(spec: { namespace: string; decode?(value: unknown): T | undefined }): CompatSettingsScope<T>
  describe(): SettingsDescribeFace
}

/** 宿主事件转发面（dsh-api-remotes 的 API_REMOTE_FORWARDED_EVENTS 白名单）。 */
export type RemoteEvents = { $on(event: string, listener: () => void): unknown }

/** ctx.settingsSchema 服务（ui-settings 插件提供）的本地投影。 */
export type SettingsSchemaService = import('./settings-models-store.ts').SettingsSchemaOps & {
  setPath(root: unknown, path: string[], value: unknown): unknown
  deletePath(root: unknown, path: string[]): unknown
  validate(schema: unknown, draft: unknown): string | undefined
}

export type ShellContext = ClientContext & WritingSettingsSlots & {
  connection: ConnectionHandle
  remote: EditorRemote
  sessions: EditorSessions
  workspaces: EditorWorkspaces
  uiWorkspace: EditorUiWorkspace
  uiConversation?: EditorUiConversation
  uiSession?: EditorUiSession
  settingsScope: SettingsScopeBinder
  settingsSchema: SettingsSchemaService
}

export type WorkspaceIntent = 'open' | 'create'

export type WorkspaceOpenState =
  | { kind: 'idle' }
  | { kind: 'checking'; workspaceId?: WorkspaceId; path: string; title: string }
  | { kind: 'ready'; workspaceId: WorkspaceId; sessionId: SessionId; path: string; warning?: string }
  | { kind: 'needs-relocation'; workspaceId: WorkspaceId; path: string; title: string; message: string }
  | { kind: 'needs-recovery'; workspaceId: WorkspaceId; sessionId: SessionId; path: string; title: string; recovery: 'import' | 'restore' }
  | { kind: 'needs-intent'; workspaceId: WorkspaceId; path: string; title: string; intent: WorkspaceIntent; message: string }
  | { kind: 'error'; workspaceId?: WorkspaceId; path: string; title: string; message: string }

export type RequestTicket = Readonly<{ scope: string; sequence: number }>

export type PendingWorkspaceOpen = {
  ticket: RequestTicket
  workspace: WorkspaceView
  intent: WorkspaceIntent
  registrationCreated: boolean
  sessionId?: SessionId
  replaceWorkspaceId?: WorkspaceId
  warning?: string
}

export type ManagedWorkspace = { workspaceId: WorkspaceId; title: string; path: string; removable: boolean }

export type RevealRequest = {
  path: string
  line: number
  column: number
  start: number
  end: number
  excerpt: string
  version: string
  nonce: number
}

/** 普通目录树排序：每一层都是文件夹在前，各自按文件名排序（中文环境、数字感知）。 */
export function orderTreeEntries<T extends { name: string; type: 'file' | 'directory' | 'other' }>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => {
    const leftDirectory = left.type === 'directory' ? 0 : 1
    const rightDirectory = right.type === 'directory' ? 0 : 1
    if (leftDirectory !== rightDirectory) return leftDirectory - rightDirectory
    return left.name.localeCompare(right.name, intlLocale(), { numeric: true, sensitivity: 'base' })
  })
}

export function treeRowPadding(level: number): number {
  return 12 + Math.max(0, level) * 12
}

export function treeExpansionPaths(path: string): string[] {
  if (!/^(正文|人物卡|世界书)\//.test(path)) return []
  const parts = path.split('/').filter(Boolean)
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

export function safeRpcCall<T>(request: () => Promise<unknown>): Promise<RpcResult<T>> {
  return Promise.resolve()
    .then(() => request() as Promise<RpcResult<T>>)
    .catch((error: unknown) => ({
      ok: false as const,
      error: { code: 'internal', message: error instanceof Error ? error.message : 'request failed', details: {} },
    }))
}

function rpcFailureText(result: RpcResult): string {
  if (result.ok) return ''
  return `${result.error.code ?? ''} ${result.error.message ?? ''}`
}

export function errorMessage(result: RpcResult): string {
  if (result.ok) return ''
  /* 部分写入优先：普通重命名/移动也可能触及多个路径，必须让用户看到恢复位置。 */
  const partial = partialApplyDetails(result)
  if (partial) {
    const paths = partial.appliedPaths.length ? t('error.partialPaths', { paths: partial.appliedPaths.join('、') }) : ''
    const recovery = partial.recoveryPath ? t('error.partialRecovery', { path: partial.recoveryPath }) : ''
    const snapshot = partial.safetySnapshotId ? t('error.partialSnapshot', { id: partial.safetySnapshotId }) : ''
    return `${t('error.partialPrefix')}${paths}${recovery}${snapshot}${t('error.partialSuffix')}`
  }
  const blob = rpcFailureText(result)
  if (/stale|changed|version|版本/i.test(blob)) return t('error.diskChanged')
  if (/directory-exists|already exists/i.test(blob)) return t('error.alreadyExists')
  if (/workspace-invalid-path|invalid path/i.test(blob)) return t('error.invalidPath')
  if (/read-only|permission|denied/i.test(blob)) return t('error.readOnly')
  if (/directory-unreadable|unreadable/i.test(blob)) return t('error.directoryUnreadable')
  if (/session-not-found|session is not live/i.test(blob)) return t('error.sessionMissing')
  if (/not-found|missing/i.test(blob)) return t('error.notFound')
  return t('error.generic')
}

export function isSessionMissing(result: RpcResult): boolean {
  return !result.ok && /session-not-found|session is not live/i.test(rpcFailureText(result))
}

export function workspaceOpenFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : ''
  if (/no supported text files/i.test(detail)) return t('error.noTextFiles')
  if (/session is not live|session-not-found|作品会话已失效/i.test(detail)) return t('error.sessionNotEstablished')
  if (detail && detail !== t('error.generic')) return t('error.openFailed', { detail })
  return t('error.openCheckFailed')
}

export function isStaleFailure(result: RpcResult): boolean {
  return !result.ok && /stale|changed|version|版本/i.test(`${rpcFailureText(result)} ${errorMessage(result)}`)
}

/** Host 在多文件写入中途中断时返回的错误 details（code:'internal'）。 */
export type PartialApplyDetails = {
  partial: true
  appliedPaths: string[]
  recoveryPath?: string
  safetySnapshotId?: string
}

/**
 * 识别"部分写入"失败：此时不能声称零写入，也不能当作完整成功。
 * 返回 null 表示普通失败（调用方按"未能完成"处理，不断言磁盘未动）。
 */
export function partialApplyDetails(result: RpcResult): PartialApplyDetails | null {
  if (result.ok) return null
  const details = result.error.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const raw = details as Record<string, unknown>
  if (raw.partial !== true) return null
  return {
    partial: true,
    appliedPaths: Array.isArray(raw.appliedPaths) ? raw.appliedPaths.filter((path): path is string => typeof path === 'string') : [],
    ...(typeof raw.recoveryPath === 'string' && raw.recoveryPath ? { recoveryPath: raw.recoveryPath } : {}),
    ...(typeof raw.safetySnapshotId === 'string' && raw.safetySnapshotId ? { safetySnapshotId: raw.safetySnapshotId } : {}),
  }
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

export function claimInitialWorkspaceResume(guard: { current: boolean }): boolean {
  if (guard.current) return false
  guard.current = true
  return true
}

/** Startup resume target: the session-bound row, else the most recently updated workspace. */
export function startupResumeWorkspace(
  items: readonly WorkspaceView[],
  selected?: WorkspaceView,
): WorkspaceView | undefined {
  if (selected) return selected
  if (!items.length) return undefined
  return items.reduce((latest, item) => {
    const left = Date.parse(latest.updatedAt) || 0
    const right = Date.parse(item.updatedAt) || 0
    return right > left ? item : latest
  })
}

/** 提交说明使用的本地时间标签（YYYY-MM-DD HH:mm），每次提交自动取当前时间。 */
export function snapshotTimeLabel(time: number): string {
  const date = new Date(time)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function hasVisibleWorkspaceEntries(entries: readonly { name: string }[]): boolean {
  return entries.some((entry) => entry.name !== '.dsh-editor')
}

export function hasRelocatableManuscriptFiles(files: readonly string[]): boolean {
  return files.some((path) => /^正文\/.+\.(md|txt)$/i.test(path))
}

/**
 * 打开作品时要回到的对话：作品下最近更新、且已有内容（非空白、未归档）的会话。
 * 没有可恢复的会话时返回 fallback（刚连上的空白会话），保持原有行为。
 */
export function resumableConversationId<T extends string>(input: {
  sessionIds: readonly T[]
  byId: Record<string, { blank?: boolean; updatedAt?: number } | undefined>
  archivedIds: readonly T[]
  fallback: T
}): T {
  const archived = new Set(input.archivedIds)
  let best: T | undefined
  let bestUpdatedAt = -1
  for (const id of input.sessionIds) {
    if (id === input.fallback || archived.has(id)) continue
    const item = input.byId[id]
    if (!item || item.blank) continue
    const updatedAt = item.updatedAt ?? 0
    if (updatedAt > bestUpdatedAt) {
      best = id
      bestUpdatedAt = updatedAt
    }
  }
  return best ?? input.fallback
}

export function supportedWorkspaceTextPaths(files: readonly string[]): string[] {
  return files.filter((path) => /\.(?:md|txt)$/i.test(path) && !path.split('/').some((part) => part.startsWith('.')))
}

const IMAGE_PATH_PATTERN = /\.(?:jpe?g|png|gif|webp|avif|svg)$/i

/** Tree rows with an image extension open the lightbox preview instead of the text editor. */
export function isImagePath(path: string): boolean {
  return IMAGE_PATH_PATTERN.test(path)
}

export function relocationFailureMessage(cleanupFailed: boolean): string {
  return cleanupFailed ? t('error.relocationCleanupFailed') : t('error.relocationKept')
}

export function isSuccessWorkbenchNote(note: string): boolean {
  return /^(?:已(?:创建|重命名为|移动到|归档|恢复)|(?:Created|Renamed to|Moved to|Archived|Restored))(?:\s|$)/.test(note)
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

export type ResizablePanelSide = 'left' | 'right'

export function clampPanelWidth(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function resizedPanelWidth(side: ResizablePanelSide, start: number, pointerDelta: number, minimum: number, maximum: number): number {
  return clampPanelWidth(start + (side === 'left' ? pointerDelta : -pointerDelta), minimum, maximum)
}

export function storedPanelWidth(key: string, fallback: number, minimum: number, maximum: number): number {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (raw === null || raw === undefined) return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? clampPanelWidth(value, minimum, maximum) : fallback
  } catch {
    return fallback
  }
}

export function storedPanelOpen(key: string, fallback: boolean): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw === null || raw === undefined ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

export type WorkspaceShortcutAction = 'settings' | 'toggle-sidebar' | 'toggle-assistant' | 'toggle-focus' | 'focus-assistant' | 'previous-chapter' | 'next-chapter' | 'search' | 'toggle-typewriter' | 'toggle-focus-paragraph'

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
  if (mod && input.shiftKey && !input.altKey && key === 'f') return 'search'
  if (mod && !input.altKey && !input.shiftKey) {
    if (key === ',') return 'settings'
    if (key === 'b') return 'toggle-sidebar'
    if (key === 'j') return 'toggle-assistant'
    if (key === '\\') return 'toggle-focus'
    if (key === 'l') return 'focus-assistant'
  }
  if (mod && input.altKey && !input.shiftKey) {
    if (key === 't') return 'toggle-typewriter'
    if (key === 'p') return 'toggle-focus-paragraph'
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

export class FlowWorkspaceCleanupError extends Error {
  constructor(options?: ErrorOptions) {
    super('workspace projection failed and its registration could not be removed', options)
    this.name = 'FlowWorkspaceCleanupError'
  }
}

export async function createFlowWorkspace(
  ctx: {
    workspaces: {
      create(input: { path: string }): Promise<WorkspaceView>
      delete(workspaceId: WorkspaceId): Promise<void>
    }
  },
  workspacePath: string,
) {
  let workspace: WorkspaceView | undefined
  try {
    workspace = await ctx.workspaces.create({ path: workspacePath })
    return { workspace, created: true }
  } catch (error) {
    if (workspace) {
      let cleanupFailed = false
      try {
        await ctx.workspaces.delete(workspace.workspaceId)
      } catch {
        cleanupFailed = true
      }
      if (cleanupFailed) throw new FlowWorkspaceCleanupError({ cause: error })
    }
    throw error
  }
}

export function documentName(path: string): string {
  const filename = path.split('/').at(-1) ?? path
  return filename.replace(/\.(md|txt)$/i, '')
}

function closedFrontmatterProjection(text: string): { text: string; offset: number } {
  const bomLength = text.startsWith('\uFEFF') ? 1 : 0
  const source = text.slice(bomLength)
  const close = /\r?\n---(?:\r?\n|$)/g
  close.lastIndex = source.indexOf('\n') + 1
  const match = close.exec(source)
  if (!match) return { text, offset: 0 }
  const offset = bomLength + match.index + match[0].length
  return { text: text.slice(offset), offset }
}

export function isWorldbookPath(path: string): boolean {
  return /^世界书\/.+\.md$/i.test(path)
}

export function worldbookPaperProjection(path: string, text: string): { text: string; offset: number } {
  if (isWorldbookPath(path)) {
    const metadata = worldbookEditorMetadata(path, text)
    if (!metadata.valid || !metadata.explicit) return { text, offset: 0 }
    return closedFrontmatterProjection(text)
  }
  if (isChapterMetaPath(path)) {
    if (stripChapterFrontmatter(text) === text) return { text, offset: 0 }
    return closedFrontmatterProjection(text)
  }
  return { text, offset: 0 }
}

export function replaceWorldbookPaperText(path: string, text: string, paperText: string): string {
  const projection = worldbookPaperProjection(path, text)
  return projection.offset ? `${text.slice(0, projection.offset)}${paperText}` : paperText
}

export function searchSkippedText(skipped: number): string {
  return skipped > 0 ? t('error.searchSkipped', { count: skipped }) : ''
}

export { type ProjectContextReceiptBundle }
