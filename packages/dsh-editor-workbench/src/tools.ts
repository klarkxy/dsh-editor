import { installProjectContextHooks } from './project-context-hooks.ts'
import type { Context } from '@deepseek-ai/cordis'
import { asHost, type ManuscriptHost } from 'dsh-manuscript/host-api'
import { createAuthorObserveTool } from './observe-tool.ts'
import { createWritingProposeTool } from './writing-propose-tool.ts'
export const name = 'dsh-editor-workbench-tools'
export const inject = ['sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'tools'] as const

/** Host coding tools writing presets must not inherit. Unknown names are skipped. */
const DENIED_INHERITED_TOOLS = ['write', 'edit', 'pwsh', 'bash', 'shell', 'str_replace', 'NotebookEdit'] as const

export function restrictInheritedHostTools(tools: { restrict(filter: { deny: string[] }): () => void }): () => void {
  const disposers: Array<() => void> = []
  for (const name of DENIED_INHERITED_TOOLS) {
    try {
      disposers.push(tools.restrict({ deny: [name] }))
    } catch { /* not inherited in this composition */ }
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** Generic writing tools only. novel_* mounts via installNovelWorkbenchTools from novel-kernel. */
export function apply(ctx: Context): void {
  const host = asHost(ctx) as ManuscriptHostWithTools

  installProjectContextHooks(ctx)
  const tools = host.tools
  if (tools && typeof tools.register === 'function') {
    tools.register(createWritingProposeTool())
    tools.register(createAuthorObserveTool())
  }
  if (tools && typeof tools.restrict === 'function') {
    ctx.effect(() => restrictInheritedHostTools(tools), 'dsh-editor-workbench.tool-restrict')
  }
}

/** apply 里 host.tools 在 cordis 默认注入之外显式依赖；用结构化类型避免无关字段。 */
type ManuscriptHostWithTools = ManuscriptHost & {
  tools?: {
    register: (tool: unknown) => unknown
    restrict?: (filter: { deny: string[] }) => () => void
  }
}
