import { createMemoryUpdateTool } from './memory-tool.ts'
import { resolveMemoryAccess } from './memory-access.ts'
import { installProjectContextHooks } from './project-context-hooks.ts'
import type { Context } from '@deepseek-ai/cordis'
import { asHost, WorkspaceAuthorityError, type ManuscriptHost } from 'dsh-manuscript/host-api'
import type { OverviewAccess } from './overview.ts'
import { createWorkbenchTools } from './workbench-tools.ts'
export const name = 'dsh-editor-workbench-tools'
export const inject = ['sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'tools'] as const

export function apply(ctx: Context): void {
  const host = asHost(ctx) as ManuscriptHostWithTools

  installProjectContextHooks(ctx)
  const tools = host.tools
  if (tools && typeof tools.register === 'function') {
    tools.register(createMemoryUpdateTool((sessionId, signal) => resolveMemoryAccess(ctx, sessionId, signal)))
    const resolveOverviewAccess = async (cwd: string): Promise<OverviewAccess> => {
      const workspace = await host.workspaceRegistry.resolveByPath(cwd)
      if (!workspace) throw new WorkspaceAuthorityError('workspace is not registered', 'WORKSPACE_NOT_FOUND', { workspacePath: cwd })
      const session = host.sessions.get(workspace.sessionIds[0] ?? '')
      if (!session) throw new WorkspaceAuthorityError('session is unavailable', 'SESSION_NOT_FOUND', { workspacePath: cwd })
      const policy = host.sandboxPolicy.resolve({ session })
      return {
        path: workspace.path,
        rootKey: workspace.path,
        mode: policy.mode,
        files: { fs: host.fs, cwd: workspace.path, root: { targetKey: workspace.path, displayPath: workspace.path }, policy, signal: undefined },
      }
    }
    for (const tool of createWorkbenchTools({ resolveAccess: resolveOverviewAccess })) {
      tools.register(tool)
    }
  }
}

/** apply 里 host.tools 在 cordis 默认注入之外显式依赖；用结构化类型避免无关字段。 */
type ManuscriptHostWithTools = ManuscriptHost & {
  tools?: { register: (tool: unknown) => unknown }
}
