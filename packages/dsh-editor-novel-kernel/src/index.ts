import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { createNovelKnowledgeTool } from './novel-knowledge.ts'
import { createProjectKnowledgeTool, type ProjectKnowledgeReader } from './project-knowledge.ts'
import { createProposalTool, editorToolGuard, EDITOR_PROMPT } from './proposal-tool.ts'
import { createZhihuSearchTool } from './zhihu-search.ts'

export const name = 'dsh-editor-novel-kernel'
export const inject = ['tools', 'systemPrompt', 'fs', 'credentials'] as const

type HostContext = Context & {
  tools: {
    register: (tool: unknown) => unknown
    guard: (guard: (exec: { name: string; arguments: Readonly<Record<string, unknown>> }) => string | undefined) => () => void
  }
  systemPrompt: { section: (section: { name: string; order: number; text: string }) => unknown }
  fs: {
    resolve: (path: string, opts?: { cwd?: string; signal?: AbortSignal }) => Promise<{ targetKey: string; displayPath: string }>
    readText: (target: { targetKey: string; displayPath: string }, signal?: AbortSignal) => Promise<string>
  }
  credentials?: {
    resolve: (ref: CredentialRef) => Promise<{ value: string; source: string } | undefined>
  }
}

function makeFsReader(fs: HostContext['fs']): ProjectKnowledgeReader {
  return async ({ path, signal, cwd }) => {
    const target = await fs.resolve(path, { cwd, signal })
    return await fs.readText(target, signal)
  }
}

/** Registers the private editor-only novel tools, guard, and prompt boundary. */
export function apply(ctx: Context): void {
  const host = ctx as HostContext
  // The settings UI writes Access Secret into `ZHIHU_ACCESS_TOKEN`; surface it
  // through the host-managed credential seam so it wins over env/file fallbacks.
  // Tolerate a missing service so unit tests can apply without injecting it.
  const credentials = host.credentials
  const resolveCredential = credentials
    ? async () => (await credentials.resolve(credentialRef('ZHIHU_ACCESS_TOKEN')))?.value
    : undefined
  host.tools.register(createNovelKnowledgeTool())
  host.tools.register(createProposalTool())
  host.tools.register(createZhihuSearchTool({ resolveCredential }))
  host.tools.register(createProjectKnowledgeTool({ reader: makeFsReader(host.fs) }))
  ctx.effect(() => host.tools.guard(editorToolGuard))
  host.systemPrompt.section({ name: 'dsh-editor:novel-kernel', order: 90, text: EDITOR_PROMPT })
}
