import type { Context } from '@deepseek-ai/cordis'
import { asHost, resolveWorkspaceAccess, type ManuscriptHost } from 'dsh-manuscript/host-api'
import { resolveMemoryAccess } from './memory-access.ts'
import { createMemoryUpdateTool } from './memory-tool.ts'
import type { OverviewAccess } from './overview.ts'
import { createNovelOverviewTool } from './workbench-tools.ts'

type ManuscriptHostWithTools = ManuscriptHost & {
  tools?: {
    register: (tool: unknown) => unknown
  }
}

async function resolveOverviewAccess(host: ManuscriptHost, sessionId: string, signal?: AbortSignal): Promise<OverviewAccess> {
  const access = await resolveWorkspaceAccess(host, sessionId, signal)
  return {
    path: access.workspace.path,
    rootKey: access.root.targetKey,
    mode: access.policy.mode,
    files: { fs: host.fs, cwd: access.workspace.path, root: access.root, policy: access.policy, signal },
  }
}

/** Host-only novel tools. Called from novel-kernel apply; not a Cordis entry. */
export function installNovelWorkbenchTools(ctx: Context): void {
  const host = asHost(ctx) as ManuscriptHostWithTools
  const tools = host.tools
  if (!tools || typeof tools.register !== 'function') return
  tools.register(createNovelOverviewTool({
    resolveAccess: (sessionId, signal) => resolveOverviewAccess(host, sessionId, signal),
  }))
  tools.register(createMemoryUpdateTool((sessionId, signal) => resolveMemoryAccess(ctx, sessionId, signal)))
}
