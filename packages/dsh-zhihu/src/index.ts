import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { executeZhihuSearch, ZHIHU_SEARCH_DEFAULT_COUNT } from './search-api.ts'
import {
  executeZhihuGlobalSearch, executeZhihuHotList, executeZhihuAsk, executeZhihuKnowledgeSearch,
  normalizeRecallScopes, ZHIHU_ASK_MODELS, ZHIHU_ASK_DEFAULT_MODEL,
} from './operations.ts'
import { listZhihuKnowledgeBases, uploadZhihuKnowledgeFile, ZHIHU_KNOWLEDGE_UPLOAD_MAX_BYTES } from './zhihu-knowledge.ts'
import { type ZhihuClientOptions, type ZhihuSearchExecuted, ZhihuSearchError } from './zhihu-client.ts'
import { createZhihuUsageRecorder, resolveDays, zhihuUsageDomainSpec, type ZhihuUsageRecorder } from './usage.ts'
import { ZHIHU_RPC_CHANNEL, ZHIHU_CREDENTIAL_REF, ZHIHU_SEARCH_EVENT, type ZhihuRpcResult } from './contracts.ts'

export const name = 'dsh-zhihu'
export const inject = ['connection', 'credentials', 'storageDomain'] as const
export type ZhihuService = {
  call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ZhihuRpcResult>
  run<T>(execute: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>
  dispose(): Promise<void>
  usageSummary(days: unknown): Promise<{ days: unknown[] }>
  toolOptions: ZhihuClientOptions & { onExecuted: (event: ZhihuSearchExecuted) => void }
}

type Host = Context & {
  credentials: { resolve: (ref: ReturnType<typeof credentialRef>) => Promise<{ value: string } | undefined> }
  connection: { rpc: { handle: (channel: string, handler: ZhihuService['call'], policy: { authority: 'loopback' }) => () => void | Promise<void> } }
}
const fail = (code: string, message: string): ZhihuRpcResult => ({ ok: false, error: { code, message, details: {} } })

/** One shared service for direct UI RPC and optional Tool wrappers. */
export function createZhihuService(options: ZhihuClientOptions, usage: ZhihuUsageRecorder, notify: (event: ZhihuSearchExecuted) => void = () => {}): ZhihuService {
  // Serialize read-modify-write counters; concurrent tools must not lose increments.
  let pendingUsage = Promise.resolve()
  const lifetime = new AbortController()
  const active = new Set<Promise<unknown>>()
  const run: ZhihuService['run'] = (execute, signal) => {
    const combined = AbortSignal.any([signal, lifetime.signal])
    const request = Promise.resolve().then(() => { combined.throwIfAborted(); return execute(combined) })
    active.add(request)
    return request.finally(() => active.delete(request))
  }
  const record = (event: ZhihuSearchExecuted) => {
    pendingUsage = pendingUsage.then(() => usage.record(event)).catch(() => {})
    try { notify(event) } catch { /* observer failure does not change a request */ }
  }
  const service = {
    toolOptions: { ...options, onExecuted: record },
    async usageSummary(days: unknown) { await pendingUsage; return { days: await usage.read(resolveDays(days)) } },
    async call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ZhihuRpcResult> {
      if (signal.aborted) return fail('cancelled', '请求已取消')
      const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
      const client = { ...options, signal }
      let counted = false
      try {
        if (endpoint === 'usage.summary') { await pendingUsage; return { ok: true, value: { days: await usage.read(resolveDays(body.days)) } } }
        const query = typeof body.query === 'string' ? body.query : ''
        if (['search', 'global.search', 'ask', 'knowledge.search'].includes(endpoint) && (!query.trim() || query.length > 4000)) {
          return fail('bad-request', '请输入不超过 4000 字符的查询')
        }
        let value: unknown
        let results = 0
        counted = true
        if (endpoint === 'search') {
          const result = await executeZhihuSearch(query, typeof body.count === 'number' ? body.count : ZHIHU_SEARCH_DEFAULT_COUNT, client)
          value = result; results = result.items.length
        } else if (endpoint === 'global.search') {
          const result = await executeZhihuGlobalSearch(query, typeof body.count === 'number' ? body.count : 10,
            body.searchDb === 'realtime' || body.searchDb === 'static' ? body.searchDb : 'all', client)
          value = result; results = result.items.length
        } else if (endpoint === 'hot.list') {
          const result = await executeZhihuHotList(typeof body.limit === 'number' ? body.limit : 10, client)
          value = result; results = result.items.length
        } else if (endpoint === 'ask') {
          const model = (ZHIHU_ASK_MODELS as readonly unknown[]).includes(body.model) ? body.model as typeof ZHIHU_ASK_MODELS[number] : ZHIHU_ASK_DEFAULT_MODEL
          value = await executeZhihuAsk(query, model, client); results = 1
        } else if (endpoint === 'knowledge.search') {
          const result = await executeZhihuKnowledgeSearch(query, typeof body.limit === 'number' ? body.limit : 5, normalizeRecallScopes(body.recallScopes), client)
          value = result; results = result.items.length
        } else if (endpoint === 'knowledge.bases' || endpoint === 'zhihu.knowledge.bases') {
          const result = await listZhihuKnowledgeBases(client); value = result; results = result.bases.length
        } else if (endpoint === 'knowledge.upload' || endpoint === 'zhihu.knowledge.upload') {
          const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : ''
          if (!contentBase64) throw new Error('缺少文件内容。')
          if (contentBase64.length > Math.ceil(ZHIHU_KNOWLEDGE_UPLOAD_MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) {
            return fail('bad-request', '文件内容无效或超过 20 MB')
          }
          const upload = await uploadZhihuKnowledgeFile({
            fileName: typeof body.fileName === 'string' ? body.fileName : '',
            data: new Uint8Array(Buffer.from(contentBase64, 'base64')),
            knowledgeBaseId: typeof body.knowledgeBaseId === 'string' && body.knowledgeBaseId.trim() ? body.knowledgeBaseId.trim() : undefined,
          }, client)
          value = { upload }; results = 1
        } else {
          counted = false
          return fail('bad-request', `unknown endpoint ${endpoint}`)
        }
        record({ ok: true, results })
        return { ok: true, value }
      } catch (error) {
        if (counted) record({ ok: false, results: 0 })
        if (signal.aborted) return fail('cancelled', '请求已取消')
        const code = error instanceof ZhihuSearchError ? error.code.toLowerCase().replaceAll('_', '-') : 'internal'
        return fail(code, error instanceof Error ? error.message : '知乎请求失败')
      }
    },
  }
  return {
    ...service,
    run,
    async call(endpoint, payload, signal) {
      if (signal.aborted || lifetime.signal.aborted) return fail('cancelled', '请求已取消')
      try { return await run(combined => service.call(endpoint, payload, combined), signal) }
      catch (error) {
        if (signal.aborted || lifetime.signal.aborted) return fail('cancelled', '请求已取消')
        throw error
      }
    },
    async dispose() {
      lifetime.abort()
      await Promise.allSettled([...active])
      await pendingUsage
    },
  }
}

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as Host
  const domain = await ctx.storageDomain.open(zhihuUsageDomainSpec)
  const service = createZhihuService({
    resolveCredential: async () => (await host.credentials.resolve(credentialRef(ZHIHU_CREDENTIAL_REF)))?.value,
  }, createZhihuUsageRecorder(domain.table('daily')), event => {
    const emit = ctx.emit as unknown as (name: string, event: ZhihuSearchExecuted) => void
    emit.call(ctx, ZHIHU_SEARCH_EVENT, event)
  })
  ctx.effect(() => async () => { await service.dispose(); await domain.close() }, 'zhihu.usageDomainClose')
  ctx.provide('zhihu', service)
  ctx.effect(() => host.connection.rpc.handle(ZHIHU_RPC_CHANNEL, service.call, { authority: 'loopback' }))
}
