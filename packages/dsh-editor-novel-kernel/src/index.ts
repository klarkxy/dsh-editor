import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { createNovelKnowledgeTool } from './novel-knowledge.ts'
import { createAuthorObserveTool } from './observe-tool.ts'
import { createProjectKnowledgeTool, type ProjectKnowledgeReader } from './project-knowledge.ts'
import { createIndexWriteTool, type IndexWriter } from './index-write-tool.ts'
import { NOVEL_INDEX_PATH } from './contracts.ts'
import { createProposalTool, editorToolGuard, EDITOR_PROMPT } from './proposal-tool.ts'
import { createZhihuSearchTool, type ZhihuSearchExecuted } from './zhihu-search.ts'
import {
  createZhihuAskTool,
  createZhihuGlobalSearchTool,
  createZhihuHotListTool,
  createZhihuKnowledgeSearchTool,
} from './zhihu-tools.ts'
import { createNovelSearchTool } from './search-tool.ts'
import { collectScratchFiles, createScratchListTool, createScratchReadTool, createScratchWriteTool, type ScratchStore } from './scratch-tool.ts'
import { SCRATCH_DIRECTORY } from './contracts.ts'
import {
  listZhihuKnowledgeBases,
  uploadZhihuKnowledgeFile,
} from './zhihu-knowledge.ts'

export const name = 'dsh-editor-novel-kernel'
export const inject = ['tools', 'systemPrompt', 'fs', 'credentials', 'connection', 'sandboxPolicy'] as const

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
  credentials?: {
    resolve: (ref: CredentialRef) => Promise<{ value: string; source: string } | undefined>
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

function makeFsReader(fs: HostContext['fs']): ProjectKnowledgeReader {
  return async ({ path, signal, cwd }) => {
    const target = await fs.resolve(path, { cwd, signal })
    return await fs.readText(target, signal)
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
  // The settings UI writes Access Secret into `ZHIHU_ACCESS_TOKEN`; surface it
  // through the host-managed credential seam so it wins over env/file fallbacks.
  // Tolerate a missing service so unit tests can apply without injecting it.
  const credentials = host.credentials
  const resolveCredential = credentials
    ? async () => (await credentials.resolve(credentialRef('ZHIHU_ACCESS_TOKEN')))?.value
    : undefined
  host.tools.register(createNovelKnowledgeTool())
  host.tools.register(createProposalTool())
  host.tools.register(createAuthorObserveTool())
  const onExecuted = makeZhihuMeter(ctx)
  host.tools.register(createZhihuSearchTool({ resolveCredential, onExecuted }))
  host.tools.register(createZhihuGlobalSearchTool({ resolveCredential, onExecuted }))
  host.tools.register(createZhihuHotListTool({ resolveCredential, onExecuted }))
  host.tools.register(createZhihuAskTool({ resolveCredential, onExecuted }))
  host.tools.register(createZhihuKnowledgeSearchTool({ resolveCredential, onExecuted }))
  host.tools.register(createProjectKnowledgeTool({ reader: makeFsReader(host.fs) }))
  host.tools.register(createNovelSearchTool({ fs: host.fs }))
  host.tools.register(createIndexWriteTool({ writer: makeIndexWriter(host.fs, host.sandboxPolicy) }))
  const scratch = makeScratchStore(host.fs, host.sandboxPolicy)
  host.tools.register(createScratchWriteTool({ store: scratch }))
  host.tools.register(createScratchReadTool({ store: scratch }))
  host.tools.register(createScratchListTool({ store: scratch }))
  installZhihuKnowledgeRpc(host, resolveCredential, onExecuted)
  ctx.effect(() => host.tools.guard(editorToolGuard))
  host.systemPrompt.section({ name: 'dsh-editor:novel-kernel', order: 90, text: EDITOR_PROMPT })
}

/**
 * 知识库管理 RPC(列表/上传)。只对 loopback 暴露,且只接受界面显式发起的调用;
 * 上传内容经 base64 经 RPC 传入,大小在 uploadZhihuKnowledgeFile 里收口。
 * Tolerate a missing connection service so unit tests can apply without injecting it.
 */
function installZhihuKnowledgeRpc(
  host: HostContext,
  resolveCredential: (() => Promise<string | undefined>) | undefined,
  onExecuted: (event: ZhihuSearchExecuted) => void,
): void {
  const rpc = host.connection?.rpc
  if (!rpc) return
  rpc.handle('/novel-kernel', async (endpoint, payload) => {
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
    try {
      if (endpoint === 'zhihu.knowledge.bases') {
        const list = await listZhihuKnowledgeBases({ resolveCredential })
        onExecuted({ ok: true, results: list.bases.length })
        return { ok: true, value: list }
      }
      if (endpoint === 'zhihu.knowledge.upload') {
        const fileName = typeof body.fileName === 'string' ? body.fileName : ''
        const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : ''
        const knowledgeBaseId = typeof body.knowledgeBaseId === 'string' && body.knowledgeBaseId.trim() ? body.knowledgeBaseId.trim() : undefined
        if (!contentBase64) throw new Error('缺少文件内容。')
        const upload = await uploadZhihuKnowledgeFile({
          fileName,
          data: new Uint8Array(Buffer.from(contentBase64, 'base64')),
          knowledgeBaseId,
        }, { resolveCredential })
        onExecuted({ ok: true, results: 1 })
        return { ok: true, value: { upload } }
      }
      throw new Error(`unknown endpoint ${endpoint}`)
    } catch (error) {
      onExecuted({ ok: false, results: 0 })
      return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } }
    }
  }, { authority: 'loopback' })
}

/** Emit the metering event; a missing/unwilling emitter must not affect search. */
function makeZhihuMeter(ctx: Context): (event: ZhihuSearchExecuted) => void {
  const emit = (ctx as { emit?: (name: string, ...args: unknown[]) => unknown }).emit
  if (typeof emit !== 'function') return () => {}
  return (event) => {
    try {
      emit.call(ctx, ZHIHU_SEARCH_EVENT, event)
    } catch {
      // Best-effort metering; never surface emit failures to the tool path.
    }
  }
}
