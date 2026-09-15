import type { Context } from '@deepseek-ai/cordis'
import { installNovelWorkbenchTools } from 'dsh-editor-workbench'
import { asHost } from 'dsh-manuscript/host-api'
import { createNovelKnowledgeTool } from './novel-knowledge.ts'
import { createIndexWriteTool, type IndexWriter } from './index-write-tool.ts'
import { NOVEL_INDEX_PATH, SCRATCH_DIRECTORY, SCRATCH_MAX_FILES } from './contracts.ts'
import {
  assertSameWorkspaceRoot,
  resolveInternalWorkspaceAccess,
  withInternalWorkspaceWrite,
} from './internal-workspace-access.ts'
import { createProposalTool, editorToolGuard, EDITOR_PROMPT, MEMORY_MAINTENANCE_PROMPT } from './proposal-tool.ts'
import { collectScratchFiles, createScratchListTool, createScratchReadTool, createScratchWriteTool, ScratchError, type ScratchStore } from './scratch-tool.ts'

export const name = 'dsh-editor-novel-kernel'
export const inject = ['tools', 'systemPrompt', 'fs', 'sandboxPolicy', 'sessions', 'workspaceRegistry'] as const

/** Historical full surface. Omitted/`full` resolve here so legacy `dsh-editor` stays compatible. */
export const NOVEL_KERNEL_LEGACY_MODE = 'legacy'
/** Read-only surface: `novel_knowledge` only. New `dsh-editor-novel` must pass this explicitly. */
export const NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE = 'knowledge-only'

export type NovelKernelMode = typeof NOVEL_KERNEL_LEGACY_MODE | typeof NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE

export type NovelKernelConfig = {
  mode?: NovelKernelMode | 'full'
}

function parseNovelKernelMode(mode: unknown): NovelKernelMode {
  if (mode === NOVEL_KERNEL_LEGACY_MODE || mode === 'full') return NOVEL_KERNEL_LEGACY_MODE
  if (mode === NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE) return NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE
  throw new Error(`dsh-editor-novel-kernel rejected unknown mode: ${String(mode)}`)
}

/** Default/omitted config stays the historical full novel-kernel. Unknown values fail closed. */
export function resolveNovelKernelMode(config: unknown): NovelKernelMode {
  if (config === undefined || config === null) return NOVEL_KERNEL_LEGACY_MODE
  if (typeof config === 'string') return parseNovelKernelMode(config)
  if (typeof config === 'object' && !Array.isArray(config)) {
    const mode = (config as NovelKernelConfig).mode
    if (mode === undefined) return NOVEL_KERNEL_LEGACY_MODE
    return parseNovelKernelMode(mode)
  }
  throw new Error('dsh-editor-novel-kernel config must be an object or mode string')
}

type KernelHost = ReturnType<typeof asHost> & {
  tools: {
    register: (tool: unknown) => unknown
    guard: (guard: (exec: { name: string; arguments: Readonly<Record<string, unknown>> }) => string | undefined) => () => void
  }
  systemPrompt: { section: (section: { name: string; order: number; text: string }) => unknown }
}

/** 索引直写：live session 解析出的 root 上写固定路径；父目录由 fs 后端负责创建。 */
function makeIndexWriter(ctx: Context): IndexWriter {
  return async ({ text, signal, sessionId }) => {
    await withInternalWorkspaceWrite(ctx, sessionId, signal, async (access) => {
      const host = asHost(ctx)
      const target = await host.fs.resolve(NOVEL_INDEX_PATH, { cwd: access.workspace.path, signal })
      signal.throwIfAborted()
      await host.fs.writeText(target, text, undefined, signal, access.policy)
    })
  }
}

/**
 * scratch store 适配：所有读写限定在 SCRATCH_DIRECTORY 下，写入带会话沙箱策略。
 * 每次写入顺带重写 scratch/.gitignore（内容 `*`），让作者自管的 git 工作区
 * 不跟踪草稿目录；产品自身快照按隐藏目录排除，无需额外处理。
 * 文件数检查、.gitignore 与目标写入同属一次写队列操作。
 */
function makeScratchStore(ctx: Context): ScratchStore {
  const host = asHost(ctx)
  const full = (relative: string) => relative ? `${SCRATCH_DIRECTORY}/${relative}` : SCRATCH_DIRECTORY
  const listFiles = async (cwd: string, signal: AbortSignal) => collectScratchFiles(async (relative) => {
    const target = await host.fs.resolve(full(relative), { cwd, signal })
    return await host.fs.listDir(target, signal)
  })
  return {
    async read({ path, signal, sessionId }) {
      const access = await resolveInternalWorkspaceAccess(ctx, sessionId, signal)
      const target = await host.fs.resolve(full(path), { cwd: access.workspace.path, signal })
      return await host.fs.readText(target, signal)
    },
    async write({ path, text, signal, sessionId }) {
      await withInternalWorkspaceWrite(ctx, sessionId, signal, async (access) => {
        const files = await listFiles(access.workspace.path, signal)
        if (!files.includes(path) && files.length >= SCRATCH_MAX_FILES) {
          throw new ScratchError('LIMIT', `临时工作区最多 ${SCRATCH_MAX_FILES} 个文件，请覆盖现有文件或先清理`)
        }
        const confirmed = await resolveInternalWorkspaceAccess(ctx, sessionId, signal)
        assertSameWorkspaceRoot(access, confirmed, sessionId)
        signal.throwIfAborted()
        const ignore = await host.fs.resolve(`${SCRATCH_DIRECTORY}/.gitignore`, { cwd: confirmed.workspace.path, signal })
        await host.fs.writeText(ignore, '*\n', undefined, signal, confirmed.policy)
        signal.throwIfAborted()
        const target = await host.fs.resolve(full(path), { cwd: confirmed.workspace.path, signal })
        await host.fs.writeText(target, text, undefined, signal, confirmed.policy)
      })
    },
    async list({ signal, sessionId }) {
      const access = await resolveInternalWorkspaceAccess(ctx, sessionId, signal)
      return await listFiles(access.workspace.path, signal)
    },
  }
}

/**
 * Registers novel tools for this composition.
 * knowledge-only: `novel_knowledge` only (persona + Skill own workflow).
 * Default/legacy: full historical surface, guard, and prompt sections.
 */
export function apply(ctx: Context, config?: unknown): void {
  const mode = resolveNovelKernelMode(config)
  const host = ctx as KernelHost
  host.tools.register(createNovelKnowledgeTool())
  if (mode === NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE) return
  host.tools.register(createProposalTool())
  host.tools.register(createIndexWriteTool({ writer: makeIndexWriter(ctx) }))
  const scratch = makeScratchStore(ctx)
  host.tools.register(createScratchWriteTool({ store: scratch }))
  host.tools.register(createScratchReadTool({ store: scratch }))
  host.tools.register(createScratchListTool({ store: scratch }))
  installNovelWorkbenchTools(ctx)
  ctx.effect(() => host.tools.guard(editorToolGuard))
  host.systemPrompt.section({ name: 'dsh-editor:novel-kernel', order: 90, text: EDITOR_PROMPT + MEMORY_MAINTENANCE_PROMPT })
}
