import type { Context } from '@deepseek-ai/cordis'
import { createNovelKnowledgeTool } from './novel-knowledge.ts'
import { createAuthorObserveTool } from './observe-tool.ts'
import { createIndexWriteTool, type IndexWriter } from './index-write-tool.ts'
import { NOVEL_INDEX_PATH } from './contracts.ts'
import { createProposalTool, editorToolGuard, EDITOR_PROMPT, MEMORY_MAINTENANCE_PROMPT } from './proposal-tool.ts'
import { collectScratchFiles, createScratchListTool, createScratchReadTool, createScratchWriteTool, type ScratchStore } from './scratch-tool.ts'
import { SCRATCH_DIRECTORY } from './contracts.ts'

export const name = 'dsh-editor-novel-kernel'
export const inject = ['tools', 'systemPrompt', 'fs', 'connection', 'sandboxPolicy'] as const

/** Cross-plugin metering event consumed by dsh-manuscript's zhihu usage recorder. */
export const ZHIHU_SEARCH_EVENT = 'dsh-editor/zhihu-search'

type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

type HostContext = Context & {
  tools: {
    register: (tool: unknown) => unknown
    guard: (guard: (exec: { name: string; arguments: Readonly<Record<string, unknown>> }) => string | undefined) => () => void
  }
  systemPrompt: { section: (section: { name: string; order: number; text: string }) => unknown }
  fs: {
    resolve: (path: string, opts?: { cwd?: string; signal?: AbortSignal }) => Promise<{ targetKey: string; displayPath: string }>
    readText: (target: { targetKey: string; displayPath: string }, signal?: AbortSignal) => Promise<string>
    listDir: (target: { targetKey: string; displayPath: string }, signal?: AbortSignal) => Promise<Array<{ name: string; type: 'file' | 'directory' | 'other' }>>
    writeText: (target: { targetKey: string; displayPath: string }, content: string, expected?: unknown, signal?: AbortSignal, sandboxPolicy?: unknown) => Promise<unknown>
  }
  sandboxPolicy: {
    resolve: (request?: { session?: unknown }) => unknown
  }
  connection?: {
    rpc: {
      handle: (
        channel: string,
        handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult>,
        options: { authority: string },
      ) => () => void
    }
  }
}

/** 索引直写：解析固定路径后，按会话沙箱策略创建或覆盖；父目录由 fs 后端负责创建。 */
function makeIndexWriter(fs: HostContext['fs'], sandboxPolicy: HostContext['sandboxPolicy']): IndexWriter {
  return async ({ text, signal, cwd, session }) => {
    const target = await fs.resolve(NOVEL_INDEX_PATH, { cwd, signal })
    await fs.writeText(target, text, undefined, signal, sandboxPolicy.resolve({ session }))
  }
}

/**
 * scratch store 适配：所有读写限定在 SCRATCH_DIRECTORY 下，写入带会话沙箱策略。
 * 每次写入顺带重写 scratch/.gitignore（内容 `*`），让作者自管的 git 工作区
 * 不跟踪草稿目录；产品自身快照按隐藏目录排除，无需额外处理。
 */
function makeScratchStore(fs: HostContext['fs'], sandboxPolicy: HostContext['sandboxPolicy']): ScratchStore {
  const full = (relative: string) => relative ? `${SCRATCH_DIRECTORY}/${relative}` : SCRATCH_DIRECTORY
  return {
    async read({ path, signal, cwd }) {
      const target = await fs.resolve(full(path), { cwd, signal })
      return await fs.readText(target, signal)
    },
    async write({ path, text, signal, cwd, session }) {
      const policy = sandboxPolicy.resolve({ session })
      const ignore = await fs.resolve(`${SCRATCH_DIRECTORY}/.gitignore`, { cwd, signal })
      await fs.writeText(ignore, '*\n', undefined, signal, policy)
      const target = await fs.resolve(full(path), { cwd, signal })
      await fs.writeText(target, text, undefined, signal, policy)
    },
    async list({ signal, cwd }) {
      return await collectScratchFiles(async (relative) => {
        const target = await fs.resolve(full(relative), { cwd, signal })
        return await fs.listDir(target, signal)
      })
    },
  }
}

/** Registers the private editor-only novel tools, guard, and prompt boundary. */
export function apply(ctx: Context): void {
  const host = ctx as HostContext
  host.tools.register(createNovelKnowledgeTool())
  host.tools.register(createProposalTool())
  host.tools.register(createAuthorObserveTool())
  host.tools.register(createIndexWriteTool({ writer: makeIndexWriter(host.fs, host.sandboxPolicy) }))
  const scratch = makeScratchStore(host.fs, host.sandboxPolicy)
  host.tools.register(createScratchWriteTool({ store: scratch }))
  host.tools.register(createScratchReadTool({ store: scratch }))
  host.tools.register(createScratchListTool({ store: scratch }))
  installLegacyZhihuRpc(ctx)
  ctx.provide('novelKernel', { ready: true })
  ctx.effect(() => host.tools.guard(editorToolGuard))
  host.systemPrompt.section({ name: 'dsh-editor:novel-kernel', order: 90, text: EDITOR_PROMPT + MEMORY_MAINTENANCE_PROMPT })
}

/** Compatibility only: the optional Zhihu service owns execution and metering. */
function installLegacyZhihuRpc(ctx: Context): void {
  const host = ctx as HostContext
  if (!host.connection) return
  ctx.effect(() => host.connection!.rpc.handle('/novel-kernel', async (endpoint, payload, signal) => {
    if (endpoint !== 'zhihu.knowledge.bases' && endpoint !== 'zhihu.knowledge.upload') {
      return { ok: false, error: { code: 'internal', message: `unknown endpoint ${endpoint}`, details: {} } }
    }
    const zhihu = ctx.get?.('zhihu') as { call: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult> } | undefined
    if (!zhihu) return { ok: false, error: { code: 'bad-request', message: '知乎插件未启用', details: {} } }
    return zhihu.call(endpoint, payload, signal)
  }, { authority: 'loopback' }))
}
