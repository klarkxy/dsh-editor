import type { Context } from '@deepseek-ai/cordis'
import { asHost, type ManuscriptHost } from 'dsh-manuscript/host-api'
import { resolveMemoryAccess } from '../memory/memory-access.ts'
import { createMemoryUpdateTool } from '../memory/memory-tool.ts'

type ManuscriptHostWithTools = ManuscriptHost & {
  tools?: {
    register: (tool: unknown) => unknown
  }
}

/** Registers only novel_memory_update. Called by novel-kernel's knowledge-only mode. */
export function installNovelMemoryTool(ctx: Context): void {
  const host = asHost(ctx) as ManuscriptHostWithTools
  const tools = host.tools
  if (!tools || typeof tools.register !== 'function') return
  tools.register(createMemoryUpdateTool((sessionId, signal) => resolveMemoryAccess(ctx, sessionId, signal)))
}
