import type { ConnectionHandle, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { worldbookEditorMetadata, type ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'
import type { DocumentKind } from '../project-files.ts'
import type { WritingPreferences, WritingSettingsSlots } from '../writing-settings.ts'

export type TreeEntry = { name: string; type: 'file' | 'directory' | 'other' }

export type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message?: string; details?: unknown } }

export type SettingsScope = import('@deepseek-ai/dsh-client-runtime/client').SettingsScope<WritingPreferences>

/* Locally projected subset of `SettingsDescribeFace` from
   `@deepseek-ai/dsh-client-ui-settings/client`. The shell only ever needs the
   face's four operations: the reactive get-snapshot, the subscription, the
   first-use ensure, and the write-answer fold. Defining the shape here keeps
   the page free of the upstream type while staying structurally compatible. */
export interface SettingsDescribeView {
  namespaces: readonly import('@deepseek-ai/dsh-client-connection/client').SettingsNamespaceView[]
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
  acceptView(view: import('@deepseek-ai/dsh-client-connection/client').SettingsNamespaceView): void
}

export interface SettingsScopeBinder {
  bind<T>(spec: { namespace: string; decode?(value: unknown): T | undefined }): import('@deepseek-ai/dsh-client-runtime/client').SettingsScope<T>
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

export type ShellContext = ClientContext & { connection: ConnectionHandle } & WritingSettingsSlots & {
  settingsScope: SettingsScopeBinder
  settingsSchema: SettingsSchemaService
  remote: RemoteEvents
}

export type WorkspaceIntent = 'open' | 'create'

export type WorkspaceOpenState =
  | { kind: 'idle' }
  | { kind: 'checking'; workspaceId?: WorkspaceId; path: string; title: string }
  | { kind: 'ready'; workspaceId: WorkspaceId; sessionId: import('@deepseek-ai/dsh-client-connection/client').SessionId; path: string; warning?: string }
  | { kind: 'needs-relocation'; workspaceId: WorkspaceId; path: string; title: string; message: string }
  | { kind: 'needs-recovery'; workspaceId: WorkspaceId; sessionId: import('@deepseek-ai/dsh-client-connection/client').SessionId; path: string; title: string; recovery: 'import' | 'restore' }
  | { kind: 'needs-intent'; workspaceId: WorkspaceId; path: string; title: string; intent: WorkspaceIntent; message: string }
  | { kind: 'error'; workspaceId?: WorkspaceId; path: string; title: string; message: string }

export type RequestTicket = Readonly<{ scope: string; sequence: number }>

export type PendingWorkspaceOpen = {
  ticket: RequestTicket
  workspace: WorkspaceView
  intent: WorkspaceIntent
  registrationCreated: boolean
  sessionId?: import('@deepseek-ai/dsh-client-connection/client').SessionId
  replaceWorkspaceId?: WorkspaceId
  warning?: string
}

export type ManagedWorkspace = { workspaceId: WorkspaceId; title: string; path: string; removable: boolean }

export type AuthorFlowExample = Readonly<{
  label: string
  description: string
  prompt: string
}>

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

export function treeExpansionPaths(path: string): string[] {
  if (!path.startsWith('正文/')) return []
  const parts = path.split('/').filter(Boolean)
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

/**
 * Top-level workspace directories already represented by static sidebar groups
 * (大纲 / 人物卡 / 世界书) and the manuscript header (正文). The root tree row
 * must hide these to avoid rendering them twice — the static groups own the
 * affordance (expand, + create, label). Nested children of these directories
 * are *not* affected; only the root listing.
 */
export const managedGroupDirectories: readonly string[] = ['大纲', '人物卡', '世界书', '正文']

export function isManagedGroupName(name: string): boolean {
  return managedGroupDirectories.includes(name)
}

export function isChapterDocumentPath(path: string): boolean {
  return /^正文\/.+\.(?:md|txt)$/i.test(path)
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

export function hasVisibleWorkspaceEntries(entries: readonly { name: string }[]): boolean {
  return entries.some((entry) => entry.name !== '.dsh-editor')
}

export function hasRelocatableManuscriptFiles(files: readonly string[]): boolean {
  return files.some((path) => /^正文\/.+\.(md|txt)$/i.test(path))
}

export function supportedWorkspaceTextPaths(files: readonly string[]): string[] {
  return files.filter((path) => /\.(?:md|txt)$/i.test(path) && !path.split('/').some((part) => part.startsWith('.')))
}

export function relocationFailureMessage(cleanupFailed: boolean): string {
  return cleanupFailed
    ? '所选文件夹没有可验证的现有正文；原作品入口已保留。新位置入口未能自动移除，可从最近作品中手动移除。'
    : '所选文件夹没有可验证的现有正文；原作品入口已保留。'
}

export function isSuccessWorkbenchNote(note: string): boolean {
  return /^已(?:创建|重命名为|移动到|归档|恢复)(?:\s|$)/.test(note)
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

export function authorFlowExamples(activePath?: string): readonly AuthorFlowExample[] {
  const chapterTarget = activePath?.startsWith('正文/')
    ? `当前章节《${activePath.split('/').pop()?.replace(/\.(md|txt)$/i, '') ?? ''}》`
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

export class FlowWorkspaceCleanupError extends Error {
  constructor(options?: ErrorOptions) {
    super('workspace projection failed and its registration could not be removed', options)
    this.name = 'FlowWorkspaceCleanupError'
  }
}

export async function createFlowWorkspace(
  ctx: { connection: ConnectionHandle; workspaces: { create(args: { path: string }): Promise<WorkspaceView> } },
  workspacePath: string,
) {
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

export function documentName(path: string): string {
  const filename = path.split('/').at(-1) ?? path
  return filename.replace(/\.(md|txt)$/i, '')
}

export function chapterStatusText(status: 'draft' | 'revising' | 'final'): string {
  if (status === 'revising') return '修订中'
  if (status === 'final') return '已定稿'
  return '草稿'
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

export function searchSkippedText(skipped: number): string {
  return skipped > 0 ? `未搜索 ${skipped} 个隐藏、生成、非文本或过大项目` : ''
}

export { type ProjectContextReceiptBundle }
