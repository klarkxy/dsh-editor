import type { SessionId, WorkspaceId } from '../dsh-compat.ts'
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
type CreatedChatModelError = { sessionId: SessionId; message: string }
let createdChatModelError: CreatedChatModelError | undefined

export function takeCreatedChatModelError(sessionId: SessionId): string | undefined {
  if (createdChatModelError?.sessionId !== sessionId) return undefined
  const message = createdChatModelError.message
  createdChatModelError = undefined
  return message
}

export function discardCreatedChatModelError(sessionId: SessionId): void {
  if (createdChatModelError?.sessionId === sessionId) createdChatModelError = undefined
}

export function rememberCreatedChatModelError(sessionId: SessionId, message: string): void {
  createdChatModelError = { sessionId, message }
}

export function provideEditorUiWorkspace(ctx: ShellContext, options?: {
  defaultChatModel?(): { provider?: string; model?: string } | undefined
}): void {
  const connecting = new Map<WorkspaceId, Promise<SessionId>>()

  const createSession = async (workspaceId: WorkspaceId): Promise<SessionId> => {
    const sessionId = await ctx.sessions.create({ workspaceId })
    const route = options?.defaultChatModel?.()
    const provider = route?.provider?.trim() ?? ''
    const model = route?.model?.trim() ?? ''
    if (!provider || !model) return sessionId
    try {
      const selected = await ctx.remote.session.selectModel({ sessionId, provider, model })
      if (!selected.ok) {
        createdChatModelError = { sessionId, message: t('chat.defaultModelFailed') }
      }
    } catch {
      createdChatModelError = { sessionId, message: t('chat.defaultModelFailed') }
    }
    return sessionId
  }

  const uiWorkspace = {
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
      ctx.sessions.open(sessionId)
    },
    async openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void) {
      const sessionId = await uiWorkspace.connectWorkspace(workspaceId)
      beforeOpen?.(sessionId)
      uiWorkspace.openSession(sessionId)
    },
    async archiveSession(sessionId: SessionId) {
      await ctx.workspaces.archiveSession(sessionId)
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
