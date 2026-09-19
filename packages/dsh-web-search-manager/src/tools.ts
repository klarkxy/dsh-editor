import type { Context } from '@deepseek-ai/cordis'
import { applyWebSearchTool, applyWebFetchTool } from '@deepseek-ai/dsh-tool-web'
import type { WebSearchManager } from './manager.ts'
export const name = 'dsh-web-search-manager-tools'
export const inject = ['webSearchManager', 'web', 'tools', 'systemPrompt'] as const
/** Mount official tools in a disposable child scope, only while explicitly authorized. */
export function apply(ctx: Context): void {
  const manager = (ctx as Context & { webSearchManager: WebSearchManager }).webSearchManager
  let current: ReturnType<Context['plugin']> | undefined
  let stamp = ''
  let stopped = false
  let pending = Promise.resolve()
  const reconcile = () => {
    pending = pending.then(async () => {
      const status = manager.status()
      const next = JSON.stringify([status.searchActive, status.fetchActive, status.settings.revision])
      if (stopped || next === stamp) return
      stamp = next
      await current?.dispose()
      current = undefined
      if (stopped || (!status.searchActive && !status.fetchActive)) return
      current = ctx.plugin({
        name: 'managed-web-tool-scope',
        apply(child: Context) {
          const { maxResults, maxQueries, timeoutMs, maxFetchChars } = status.settings
          if (status.searchActive) applyWebSearchTool(child, maxResults, maxQueries, timeoutMs, status.fetchActive)
          if (status.fetchActive) applyWebFetchTool(child, timeoutMs, maxFetchChars)
        },
      })
    }).catch(() => { stamp = ''; /* the provider guard remains fail-closed */ })
  }
  ctx.effect(() => {
    const unsubscribe = manager.subscribe(reconcile)
    reconcile()
    return async () => { stopped = true; unsubscribe(); await pending; await current?.dispose() }
  }, 'web-search-manager.tools')
}
