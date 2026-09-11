import type { SessionId, WorkspaceId } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'

/**
 * Official ui-conversation waits for `uiWorkspace`. The profile keeps
 * `@deepseek-ai/dsh-client-ui-workspace` disabled so its sidebar/hero chrome
 * does not mount. Provide the public navigation face here instead.
 */
export function provideEditorUiWorkspace(ctx: ShellContext): void {
  const connecting = new Map<WorkspaceId, Promise<SessionId>>()

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
            return summary.id
          }
        }
      }
      const attempt = ctx.sessions.create({ workspaceId }).finally(() => {
        connecting.delete(workspaceId)
      })
      connecting.set(workspaceId, attempt)
      return attempt
    },
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
