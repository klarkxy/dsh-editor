import { installProjectContextHooks } from './project-context-hooks.ts'
import type { Context } from '@deepseek-ai/cordis'
import { asHost, type ManuscriptHost } from 'dsh-manuscript/host-api'
import { createAuthorObserveTool } from './observe-tool.ts'
import { createWritingProposeTool } from './writing-propose-tool.ts'
export const name = 'dsh-editor-workbench-tools'
export const inject = ['sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'tools'] as const

/** Generic writing tools only. novel_* mounts via installNovelWorkbenchTools from novel-kernel. */
export function apply(ctx: Context): void {
  const host = asHost(ctx) as ManuscriptHostWithTools

  installProjectContextHooks(ctx)
  const tools = host.tools
  if (tools && typeof tools.register === 'function') {
    tools.register(createWritingProposeTool())
    tools.register(createAuthorObserveTool())
  }
}

/** apply 里 host.tools 在 cordis 默认注入之外显式依赖；用结构化类型避免无关字段。 */
type ManuscriptHostWithTools = ManuscriptHost & {
  tools?: {
    register: (tool: unknown) => unknown
  }
}
