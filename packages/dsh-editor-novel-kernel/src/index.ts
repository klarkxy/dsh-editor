import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { createNovelKnowledgeTool } from './novel-knowledge.ts'
import { createProjectKnowledgeTool, type ProjectKnowledgeReader } from './project-knowledge.ts'
import { createProposalTool, editorToolGuard, EDITOR_PROMPT } from './proposal-tool.ts'
import { createZhihuSearchTool, type ZhihuSearchExecuted } from './zhihu-search.ts'
import {
  createZhihuAskTool,
  createZhihuGlobalSearchTool,
  createZhihuHotListTool,
  createZhihuKnowledgeSearchTool,
} from './zhihu-tools.ts'
import { createNovelSearchTool } from './search-tool.ts'
import {
  listZhihuKnowledgeBases,
  uploadZhihuKnowledgeFile,
} from './zhihu-knowledge.ts'

export const name = 'dsh-editor-novel-kernel'
export const inject = ['tools', 'systemPrompt', 'fs', 'credentials', 'connection'] as const

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
  const onExecuted = makeZhihuMeter(ctx)
  host.tools.register(createZhihuSearchTool({ resolveCredential, onExecuted }))
  host.tools.register(createZhihuGlobalSearchTool({ resolveCredential, onExecuted }))
  host.tools.register(createZhihuHotListTool({ resolveCredential, onExecuted }))
  host.tools.register(createZhihuAskTool({ resolveCredential, onExecuted }))
  host.tools.register(createZhihuKnowledgeSearchTool({ resolveCredential, onExecuted }))
  host.tools.register(createProjectKnowledgeTool({ reader: makeFsReader(host.fs) }))
  host.tools.register(createNovelSearchTool({ fs: host.fs }))
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
