/**
 * Editor-facing 0.1.5-rc.2 shapes.
 *
 * Official client types now live across session-controller / ui-conversation /
 * ui-chat / remotes, and those packages pull the Host graph. The shell only
 * needs the fields it already reads, so the contracts stay local and
 * structurally compatible with the profile-loaded plugins.
 */

export type SessionId = string
export type WorkspaceId = string

export type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message?: string; details?: unknown } }

export type ObservableSource<T> = {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export type ModelSelection = {
  provider: string
  model: string
  reasoningEffort?: string
}

export type ModelCatalogModel = {
  id: string
  name: string
  reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string }
}

export type ModelCatalog = {
  default: ModelSelection
  groups: readonly { id: string; name: string; models: readonly ModelCatalogModel[] }[]
}

export type SessionModels = {
  current: ModelSelection
  groups: ModelCatalog['groups']
}

export type QueuedMessage = {
  id: string
  placement: 'queued' | 'steering' | 'context'
  preview: string
}

export type SessionLifecycle = {
  sessionId: SessionId
  queue: readonly QueuedMessage[]
  running: boolean
  removed?: boolean
  openState: 'cold' | 'loading' | 'open' | 'error'
  promptError: { op?: string; error?: { code?: string; message?: string } } | null
}

export type SessionFace = ObservableSource<SessionLifecycle> & {
  sessionId: SessionId
  projections: { faceOf(key: string): ObservableSource<unknown> }
  prompt(content: Array<{ type: 'text'; text: string }>, mode: 'queue' | 'steer'): Promise<RpcResult<{ accepted: true }>>
  cancel(): Promise<RpcResult<{ accepted: true }>>
  loadOlder(): Promise<void>
  rename(title: string): Promise<RpcResult<{ title: string; seq: number }>>
  command(line: string): Promise<RpcResult<{ matched: boolean }>>
}

export type AssistantBlock = {
  kind?: string
  type?: string
  text?: string
  name?: string
  argsRaw?: string
  content?: unknown[]
}

export type ConversationNode =
  | { kind: 'user' | 'steering'; seq: number; content: readonly unknown[] }
  | { kind: 'assistant'; seq: number; blocks: readonly AssistantBlock[]; interrupted?: true }
  | { kind: 'tool-result'; seq: number; callId: string; call: { name: string; argsRaw?: string } | null; content: readonly unknown[]; isError?: boolean }
  | { kind: 'turn-error'; seq: number }
  | { kind: 'model-retry'; seq: number }
  | { kind: string; seq: number; [key: string]: unknown }

export type RunningToolCall = { callId: string; name: string }

export type ChatTranscript = {
  nodes: readonly ConversationNode[]
  partial?: { blocks: readonly AssistantBlock[] } | null
  runningCalls?: readonly RunningToolCall[]
}

export type ChatView = {
  lifecycle: SessionLifecycle
  transcript: ChatTranscript
  pending: PendingInteraction[]
}

export type WorkspaceView = {
  workspaceId: WorkspaceId
  path: string
  title: string
  sessionIds: readonly SessionId[]
  createdAt: string
  updatedAt: string
}

export type SessionSummary = {
  id: SessionId
  title?: string
  displayTitle?: string
  cwd?: string
  blank?: boolean
  running?: boolean
  updatedAt?: number
}

export type SessionListState = {
  ids: SessionId[]
  byId: Record<string, SessionSummary>
  current?: SessionId
}

export type WorkspaceListState = {
  items: readonly WorkspaceView[]
  archivedSessionIds?: readonly SessionId[]
}

export type SettingsPathOpView = { op: string; path: string[]; value?: unknown }
export type SettingsNamespaceView = {
  ns: string
  value: unknown
  user?: unknown
  base?: unknown
  revision: number
  schema?: unknown
}
export type ConfigurableProviderView = {
  id?: string
  provider?: string
  name?: string
  displayName?: string
  settingsNs: string
  settingsPath: string[]
  [key: string]: unknown
}
export type CredentialView = { configured: boolean; source?: string; writable?: boolean }
export type DiscoveredModelView = { id: string; name?: string; [key: string]: unknown }

export type SettingsScopeSnapshot<T> = {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  base?: unknown
  user?: unknown
  revision?: number
  writable?: boolean
  mode?: 'host' | 'memory'
}

export type SettingsScope<T> = ObservableSource<SettingsScopeSnapshot<T>> & {
  mutate(ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<void>
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

export type RootOwnerProps = { children?: never }

export type ConnectionState = 'connected' | 'disconnected' | 'connecting'

export type ConnectionHandle = {
  isLoopback?: boolean
  rpc: {
    call: (channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<unknown>
    handle?: unknown
  }
  state: ObservableSource<ConnectionState | undefined>
  generation?: ObservableSource<unknown>
  reconnect?: () => void
}

export type EditorRemote = {
  $on(event: string, listener: () => void): unknown
  session: {
    modelCatalog(): Promise<RpcResult<ModelCatalog>>
    selectModel(request: { sessionId: SessionId } & ModelSelection): Promise<RpcResult<{ selected: ModelSelection }>>
  }
  settings: {
    mutate(ns: string, ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<RpcResult<SettingsNamespaceView>>
    openSettingsDocument(signal?: AbortSignal): Promise<RpcResult<{ path?: string }>>
  }
  credentials: {
    describe(refs: string[]): Promise<RpcResult<Record<string, CredentialView>>>
    set(ref: string, value: string): Promise<RpcResult<void>>
    unset(ref: string): Promise<RpcResult<void>>
  }
  llm: {
    listConfigurableProviders(): Promise<RpcResult<ConfigurableProviderView[]>>
    discoverModels(settingsNs: string, request: unknown, signal?: AbortSignal): Promise<RpcResult<DiscoveredModelView[]>>
  }
  workspace: {
    create(request: { path: string }): Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>>
    delete(request: { workspaceId: WorkspaceId }): Promise<RpcResult<unknown>>
  }
  directoryPicker?: {
    pick(): Promise<RpcResult<string | null>>
    list?(path?: string, signal?: AbortSignal): Promise<RpcResult<unknown>>
    createDirectory?(path: string, name: string): Promise<RpcResult<string>>
  }
}

export type EditorSessions = {
  list: ObservableSource<SessionListState>
  open(id: SessionId): void
  clear(): void
  create(opts?: { workspaceId?: WorkspaceId; cwd?: string }): Promise<SessionId>
  binding(id: SessionId): { session: SessionFace } | undefined
}

export type EditorWorkspaces = {
  list: ObservableSource<WorkspaceListState>
  create(input: { path: string }): Promise<WorkspaceView>
  delete(workspaceId: WorkspaceId): Promise<void>
  archiveSession(sessionId: SessionId): Promise<void>
}

export type EditorUiWorkspace = {
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  openSession(sessionId: SessionId): void
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  pickDirectory(): Promise<string | null>
  archiveSession(sessionId: SessionId): Promise<void>
}

export type EditorUiConversation = {
  binding(source: SessionId): {
    target(name: 'chat'): ObservableSource<{ legacy?: ChatTranscript } | undefined>
  }
}

export type EditorUiSession = {
  pendingInteractions?: ObservableSource<ReadonlyMap<SessionId, PendingInteraction> | PendingInteraction[]>
}

export type PendingApproval = {
  kind: 'approval'
  key: string
  sessionId: SessionId
  payload: { approvalId: string }
  respond: (value: { ok: true; value: ApprovalResponsePayload }) => Promise<unknown>
}

export type PendingQuestion = {
  kind: 'question'
  key: string
  sessionId: SessionId
  respond: (value: { ok: true; value: QuestionResponsePayload }) => Promise<unknown>
}

export type PendingInteraction = PendingApproval | PendingQuestion

export type ApprovalResponsePayload = {
  sessionId: SessionId
  approvalId: string
  outcome: string
}

export type QuestionResponsePayload = {
  sessionId: SessionId
  answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> }
}

export function catalogToSessionModels(catalog: ModelCatalog, current?: ModelSelection | null): SessionModels {
  return { current: current ?? catalog.default, groups: catalog.groups }
}

export function modelSelectionOf(value: unknown): ModelSelection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as { next?: ModelSelection | null; pending?: ModelSelection | null; lastUsed?: ModelSelection | null }
  const next = record.next ?? record.pending ?? record.lastUsed
  if (!next || typeof next.provider !== 'string' || typeof next.model !== 'string') return undefined
  return next
}

export function emptyTranscript(): ChatTranscript {
  return { nodes: [], partial: null, runningCalls: [] }
}
