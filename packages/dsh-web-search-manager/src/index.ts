import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'
import { WEB_SEARCH_RPC_CHANNEL, type RpcResult } from './contracts.ts'
import { registerBuiltins } from './builtins.ts'
import { registerHostRpc, type HostRpcContext } from './host-rpc.ts'
import { WebSearchManager } from './manager.ts'
import { updateSchema, webSettingsDomain } from './storage.ts'
export { WebSearchManager } from './manager.ts'
export type { ProviderDescriptor, ProviderOptions, SearchProviderFactory, FetchProviderFactory } from './contracts.ts'
export const name = 'dsh-web-search-manager'
export const inject = ['web', 'credentials', 'storageDomain', 'connection', 'webServer'] as const

declare module '@deepseek-ai/cordis' { interface Context { webSearchManager: WebSearchManager } }
type Host = Context & HostRpcContext & {
  credentials: { resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined> }
}
export async function apply(ctx: Context): Promise<void> {
  const host = ctx as Host
  const domain = await ctx.storageDomain.open(webSettingsDomain)
  const table = domain.table('settings')
  const manager = new WebSearchManager({
    web: ctx.web, initial: table.get('global'),
    resolveCredential: async ref => (await host.credentials.resolve(credentialRef(ref)))?.value,
    save: settings => table.put('global', settings),
  })
  ctx.effect(() => async () => { await manager.dispose(); await domain.close() }, 'web-search-manager.dispose')
  ctx.provide('webSearchManager', manager)
  ctx.effect(() => registerBuiltins(manager), 'web-search-manager.providers')
  ctx.effect(() => registerHostRpc(host, WEB_SEARCH_RPC_CHANNEL, async (endpoint, payload, signal): Promise<RpcResult> => {
    try {
      signal.throwIfAborted()
      if (endpoint === 'status') return { ok: true, value: await manager.refresh() }
      if (endpoint === 'update') {
        const parsed = updateSchema.safeParse(payload)
        if (!parsed.success) return { ok: false, error: { code: 'WEB_INVALID_CONFIG', message: '网络搜索设置格式无效。', details: {} } }
        return { ok: true, value: await manager.update(parsed.data.settings, parsed.data.expectedRevision) }
      }
      if (endpoint === 'test') {
        // Testing is explicit, uses the same authorized registry, and sends no manuscript text.
        const result = await ctx.web.search({ query: 'IANA example domains', maxResults: 1 }, signal)
        return { ok: true, value: { sources: result.sources.length } }
      }
      return { ok: false, error: { code: 'WEB_INVALID_REQUEST', message: '未知操作。', details: {} } }
    } catch (error) {
      return { ok: false, error: {
        code: error instanceof WebError ? error.code : 'WEB_REQUEST_FAILED',
        message: error instanceof WebError ? error.message : '网络设置操作失败，请刷新后重试。', details: {},
      } }
    }
  }), 'web-search-manager.rpc')
}
