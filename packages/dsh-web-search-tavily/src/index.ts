import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchManager } from 'dsh-web-search-manager'
import { TavilySearchProvider } from './provider.ts'
export { TavilySearchProvider } from './provider.ts'
export const name = 'dsh-web-search-tavily'
export const inject = ['webSearchManager'] as const
export function apply(ctx: Context): void {
  const manager = (ctx as Context & { webSearchManager: WebSearchManager }).webSearchManager
  ctx.effect(() => manager.registerSearchProvider({
    id: 'tavily', label: 'Tavily', defaultBaseURL: 'https://api.tavily.com',
    description: '独立 Search API；固定 basic 检索，不自动升级搜索深度。',
    credentialRef: 'DSH_EDITOR_WEB_TAVILY_API_KEY', billing: 'request',
    signupUrl: 'https://app.tavily.com',
  }, options => new TavilySearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL })), 'tavily.provider')
}
