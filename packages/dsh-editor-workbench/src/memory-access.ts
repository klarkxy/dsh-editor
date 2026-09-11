import type { Context } from '@deepseek-ai/cordis'
import { asHost, resolveWorkspaceAccess } from 'dsh-manuscript/host-api'
import type { MemoryAccess } from './memory.ts'

function sessionMessageEvents(session: unknown): MemoryAccess['events'] {
  if (session && typeof session === 'object' && 'snapshotEvents' in session && typeof session.snapshotEvents === 'function') {
    return session.snapshotEvents() as MemoryAccess['events']
  }
  return (session as { events?: MemoryAccess['events'] }).events ?? []
}

/** The executing session is the authority; never pick another session attached to the same root. */
export async function resolveMemoryAccess(ctx: Context, sessionId: string, signal?: AbortSignal): Promise<MemoryAccess> {
  const host = asHost(ctx)
  const access = await resolveWorkspaceAccess(host, sessionId, signal)
  const drafts = ctx.get('manuscriptDrafts') as { hasUnsaved(workspacePath: string, relative: string): boolean } | undefined
  return {
    path: access.workspace.path, rootKey: access.root.targetKey, mode: access.policy.mode,
    files: { fs: host.fs, cwd: access.workspace.path, root: access.root, policy: access.policy, signal },
    sessionId: String(access.session.id),
    events: sessionMessageEvents(access.session),
    hasDraft(relative) {
      if (!drafts) throw new Error('草稿保护暂不可用，未执行自动维护。')
      return drafts.hasUnsaved(access.workspace.path, relative)
    },
  }
}
