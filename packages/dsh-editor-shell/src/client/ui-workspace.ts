import { AI_RPC_CHANNEL, type ResolvedRoute, type RpcResult } from '@klarkxy/dsh-ai-services/contracts'
import type { EditorSessionReference, ObservableSource, SessionFace, SessionId, WorkspaceId } from '../dsh-compat.ts'
import { t } from '../i18n/index.ts'
import { errorMessage, isSessionMissing, safeRpcCall, type ShellContext } from './shared.ts'

/**
 * Official ui-conversation waits for `uiWorkspace`. The profile keeps
 * `@deepseek-ai/dsh-client-ui-workspace` disabled so its sidebar/hero chrome
 * does not mount. Provide the public navigation face here instead.
 *
 * Default chat model is applied here, at session creation, so a later picker
 * selectModel is the only writer for an explicit new-conversation choice.
 */
const createdChatModelErrors = new Map<SessionId, string>()

export function takeCreatedChatModelError(sessionId: SessionId): string | undefined {
  const message = createdChatModelErrors.get(sessionId)
  createdChatModelErrors.delete(sessionId)
  return message
}

export function discardCreatedChatModelError(sessionId: SessionId): void {
  createdChatModelErrors.delete(sessionId)
}

export function rememberCreatedChatModelError(sessionId: SessionId, message: string): void {
  createdChatModelErrors.set(sessionId, message)
}

/** Read the durable capability route once, only when creating a conversation. */
export async function applyChatModelDefault(ctx: ShellContext, sessionId: SessionId): Promise<void> {
  try {
    const result = await ctx.connection.rpc.call(AI_RPC_CHANNEL, 'resolve', { purpose: 'chat', sessionId }) as RpcResult<ResolvedRoute>
    if (!result.ok) throw new Error(result.error.message)
    const { provider, model, reasoningEffort } = result.value
    const selected = await ctx.remote.session.selectModel({ sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) })
    if (!selected.ok) throw new Error('selection failed')
    discardCreatedChatModelError(sessionId)
  } catch {
    rememberCreatedChatModelError(sessionId, t('chat.defaultModelFailed'))
  }
}

/**
 * The editor owns the visible session because the upstream workspace UI is not
 * mounted. One completed selection owns one `workspaceOperation` reference. A new
 * selection becomes visible only after its open settles; cancellation, failure
 * and teardown release their provisional references without disturbing a
 * working previous view.
 */
class MainSessionSelection implements ObservableSource<SessionFace | undefined> {
  private currentReference: EditorSessionReference | undefined
  private pending: { token: number; controller: AbortController; reference: EditorSessionReference } | undefined
  private current: SessionFace | undefined
  private readonly listeners = new Set<() => void>()
  private token = 0
  private disposed = false

  constructor(private readonly sessions: ShellContext['sessions']) {}

  getSnapshot = (): SessionFace | undefined => this.current

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async open(sessionId: SessionId, beforeReady?: (sessionId: SessionId) => void): Promise<void> {
    if (this.disposed) throw new Error('main session selection is disposed')
    if (this.currentReference?.sessionId === sessionId && this.current) return
    this.cancelPending()
    const token = ++this.token
    const controller = new AbortController()
    const reference = this.sessions.retain(sessionId, { source: 'workspaceOperation', signal: controller.signal })
    const pending = { token, controller, reference }
    this.pending = pending
    try {
      beforeReady?.(reference.sessionId)
      const binding = await reference.ready
      if (this.disposed || controller.signal.aborted || this.pending !== pending || this.token !== token) {
        reference.release()
        return
      }
      this.pending = undefined
      const previous = this.currentReference
      this.currentReference = reference
      this.current = binding.session
      this.publish()
      previous?.release()
    } catch (error) {
      if (this.pending === pending) this.pending = undefined
      reference.release()
      if (controller.signal.aborted || this.disposed || this.token !== token) return
      throw error
    }
  }

  clear(): void {
    this.token += 1
    this.cancelPending()
    const previous = this.currentReference
    this.currentReference = undefined
    if (this.current !== undefined) {
      this.current = undefined
      this.publish()
    }
    previous?.release()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clear()
    this.listeners.clear()
  }

  private cancelPending(): void {
    const pending = this.pending
    this.pending = undefined
    if (!pending) return
    pending.controller.abort()
    pending.reference.release()
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

export function provideEditorUiWorkspace(ctx: ShellContext): void {
  const connecting = new Map<WorkspaceId, Promise<SessionId>>()
  const selection = new MainSessionSelection(ctx.sessions)
  const workspaceSelection = new MainSessionSelection(ctx.sessions)
  ctx.effect(() => () => {
    selection.dispose()
    workspaceSelection.dispose()
  }, 'dsh-editor-shell retained session selections')

  const createSession = async (workspaceId: WorkspaceId): Promise<SessionId> => {
    const sessionId = await ctx.sessions.create({ workspaceId })
    await applyChatModelDefault(ctx, sessionId)
    return sessionId
  }

  const uiWorkspace = {
    current: selection,
    workspace: workspaceSelection,
    openWorkspaceSession(sessionId: SessionId) {
      return workspaceSelection.open(sessionId)
    },
    async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
      const inflight = connecting.get(workspaceId)
      if (inflight) return inflight
      const listed = ctx.workspaces.list.getSnapshot()
      const workspace = listed.items.find((item) => item.workspaceId === workspaceId)
      const archived = listed.archivedSessionIds ?? []
      const sessions = ctx.sessions.list.getSnapshot()
      if (workspace) {
        for (const id of sessions.ids) {
          const summary = sessions.byId[id]
          if (summary?.blank && summary.cwd === workspace.path && workspace.sessionIds.includes(summary.id) && !archived.includes(summary.id)) {
            if (!ctx.connection?.rpc) return summary.id
            const ping = await safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId: summary.id, path: '.' }))
            if (ping.ok) return summary.id
            if (!isSessionMissing(ping)) throw new Error(errorMessage(ping))
            await ctx.workspaces.archiveSession(summary.id)
          }
        }
      }
      const attempt = createSession(workspaceId).finally(() => {
        connecting.delete(workspaceId)
      })
      connecting.set(workspaceId, attempt)
      return attempt
    },
    createSession,
    openSession(sessionId: SessionId) {
      return selection.open(sessionId)
    },
    clearSession() {
      selection.clear()
      workspaceSelection.clear()
    },
    async openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void) {
      const sessionId = await uiWorkspace.connectWorkspace(workspaceId)
      await selection.open(sessionId, beforeOpen)
    },
    async archiveSession(sessionId: SessionId) {
      await ctx.workspaces.archiveSession(sessionId)
      if (selection.getSnapshot()?.sessionId === sessionId) selection.clear()
    },
    async pickDirectory() {
      const picker = ctx.remote.directoryPicker
      if (!picker) throw new Error('directory picker is unavailable')
      const result = await picker.pick()
      if (!result.ok) throw new Error(result.error.message ?? 'directory picker failed')
      return result.value
    },
  }

  ctx.provide('uiWorkspace', uiWorkspace)
}