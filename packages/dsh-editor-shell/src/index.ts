import type { Context } from '@deepseek-ai/cordis'
import { registerEditorFilesRpc } from '../../dsh-manuscript/src/editor-files.ts'
import { createNovelKnowledgeTool } from './novel-knowledge.ts'
import { createProposalTool, editorToolGuard, EDITOR_PROMPT } from './proposal-tool.ts'

export const name = 'dsh-editor-shell'
export const inject = ['tools', 'systemPrompt', 'connection', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy'] as const

type HostContext = Context & {
  tools: {
    register: (tool: unknown) => unknown
    guard: (guard: (exec: { name: string; arguments: Readonly<Record<string, unknown>> }) => string | undefined) => () => void
  }
  systemPrompt: { section: (section: { name: string; order: number; text: string }) => unknown }
}

/** Private product Host: only editor-owned tools and prompt live here. */
export function apply(ctx: Context): void {
  const host = ctx as HostContext
  host.tools.register(createNovelKnowledgeTool())
  host.tools.register(createProposalTool())
  ctx.effect(() => host.tools.guard(editorToolGuard))
  ctx.effect(() => registerEditorFilesRpc(ctx), 'dsh-editor-shell.editorFilesRpc')
  host.systemPrompt.section({ name: 'dsh-editor:novel-kernel', order: 90, text: EDITOR_PROMPT })
}
