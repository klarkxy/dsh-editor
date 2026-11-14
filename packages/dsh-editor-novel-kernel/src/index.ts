import type { Context } from '@deepseek-ai/cordis'
import { installNovelMemoryTool } from 'dsh-editor-workbench'
import { createNovelKnowledgeTool } from './novel-knowledge.ts'

export const name = 'dsh-editor-novel-kernel'
/** `novel_memory_update` resolves the live session workspace. Knowledge cards are bundled files. */
export const inject = ['tools', 'fs', 'sandboxPolicy', 'sessions', 'workspaceRegistry'] as const

/** The only surface. Shipped presets and stored configs may still set this key. */
export const NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE = 'knowledge-only'

const REMOVED_MODES = new Set(['legacy', 'full'])

export type NovelKernelConfig = {
  /** Accepted when it is `knowledge-only` or omitted. `legacy` and `full` are rejected. Other keys are ignored. */
  mode?: string
}

function removedMode(mode: string): Error {
  return new Error(`dsh-editor-novel-kernel mode '${mode}' was removed; only '${NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE}' remains`)
}

/**
 * There is no mode switch. Omitted config and `mode: knowledge-only`
 * (object or string) load the knowledge surface. Other object keys are ignored.
 * Removed mode names fail closed instead of mounting a surface that no longer exists.
 */
export function resolveNovelKernelMode(config: unknown): typeof NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE {
  if (config === undefined || config === null) return NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE
  if (typeof config === 'string') {
    if (config === NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE) return NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE
    if (REMOVED_MODES.has(config)) throw removedMode(config)
    throw new Error(`dsh-editor-novel-kernel rejected unknown mode: ${config}`)
  }
  if (typeof config === 'object' && !Array.isArray(config)) {
    if (!Object.prototype.hasOwnProperty.call(config, 'mode')) return NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE
    const mode = (config as NovelKernelConfig).mode
    if (mode === undefined || mode === NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE) return NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE
    if (typeof mode === 'string' && REMOVED_MODES.has(mode)) throw removedMode(mode)
    throw new Error(`dsh-editor-novel-kernel rejected unknown mode: ${String(mode)}`)
  }
  throw new Error('dsh-editor-novel-kernel config must be an object or the knowledge-only mode string')
}

type KernelHost = Context & {
  tools: { register: (tool: unknown) => unknown }
}

/** Registers `novel_knowledge` and `novel_memory_update`. */
export function apply(ctx: Context, config?: unknown): void {
  resolveNovelKernelMode(config)
  const host = ctx as KernelHost
  host.tools.register(createNovelKnowledgeTool())
  installNovelMemoryTool(ctx)
}
