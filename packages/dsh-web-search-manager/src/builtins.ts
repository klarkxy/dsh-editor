import {
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  DeepSeekSearchProvider,
} from '@deepseek-ai/dsh-web-search-deepseek'
import { ExaSearchProvider } from '@deepseek-ai/dsh-web-search-exa'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import { SEARCH_ENGINE_ID, SearchEngineProvider } from './search-engine.ts'
import { BochaSearchProvider, BraveSearchProvider, FirecrawlSearchProvider, SerperSearchProvider } from './rest-search.ts'
import type { WebSearchManager } from './manager.ts'

export function registerBuiltins(manager: WebSearchManager): () => void {
  const offEngine = manager.registerSearchProvider({
    id: SEARCH_ENGINE_ID, label: 'DuckDuckGo', billing: 'none',
    description: '无需注册。默认后端。',
  }, () => new SearchEngineProvider())
  const offDeepSeek = manager.registerSearchProvider({
    id: 'deepseek-official', label: 'DeepSeek 搜索',
    description: '使用已配置的 DeepSeek API Key。可能产生额外搜索费用。',
    defaultBaseURL: DEEPSEEK_DEFAULT_BASE_URL, credentialRef: 'DEEPSEEK_API_KEY',
    credentialShared: true, billing: 'model-and-tools',
    signupUrl: 'https://platform.deepseek.com/api_keys',
  }, options => new DeepSeekSearchProvider(() => ({
    apiKey: options.apiKey, baseURL: options.baseURL ?? DEEPSEEK_DEFAULT_BASE_URL,
    model: DEEPSEEK_DEFAULT_MODEL, apiVersion: DEEPSEEK_DEFAULT_API_VERSION,
    maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS, maxUses: DEEPSEEK_DEFAULT_MAX_USES,
  })))
  const offExa = manager.registerSearchProvider({
    id: 'exa', label: 'Exa', description: '独立 Search API。',
    defaultBaseURL: 'https://api.exa.ai', credentialRef: 'DSH_EDITOR_WEB_EXA_API_KEY', billing: 'request',
    signupUrl: 'https://dashboard.exa.ai/api-keys',
  }, options => new ExaSearchProvider({
    apiKey: options.apiKey ?? '', baseURL: options.baseURL ?? 'https://api.exa.ai',
    searchType: 'auto', highlightsPerResult: 1,
  }))
  const offBrave = manager.registerSearchProvider({
    id: 'brave', label: 'Brave', description: 'Brave Search API。',
    defaultBaseURL: 'https://api.search.brave.com', credentialRef: 'DSH_EDITOR_WEB_BRAVE_API_KEY', billing: 'request',
    signupUrl: 'https://api.search.brave.com',
  }, options => new BraveSearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL }))
  const offBocha = manager.registerSearchProvider({
    id: 'bocha', label: '博查', description: '中文网页搜索 API。',
    defaultBaseURL: 'https://api.bochaai.com', credentialRef: 'DSH_EDITOR_WEB_BOCHA_API_KEY', billing: 'request',
    signupUrl: 'https://open.bochaai.com',
  }, options => new BochaSearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL }))
  const offSerper = manager.registerSearchProvider({
    id: 'serper', label: 'Serper', description: 'Google 结果的 Search API。',
    defaultBaseURL: 'https://google.serper.dev', credentialRef: 'DSH_EDITOR_WEB_SERPER_API_KEY', billing: 'request',
    signupUrl: 'https://serper.dev',
  }, options => new SerperSearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL }))
  const offFirecrawl = manager.registerSearchProvider({
    id: 'firecrawl', label: 'Firecrawl', description: '网页搜索与提取 API。',
    defaultBaseURL: 'https://api.firecrawl.dev', credentialRef: 'DSH_EDITOR_WEB_FIRECRAWL_API_KEY', billing: 'request',
    signupUrl: 'https://www.firecrawl.dev',
  }, options => new FirecrawlSearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL }))
  const offHttp = manager.registerFetchProvider({
    id: 'http', label: 'HTTP 读取', billing: 'none',
    description: '本机直连公开网页，无需 Key，不产生搜索费用。',
  }, options => new HttpFetchProvider({
    maxResponseBytes: 5_000_000, maxBodyChars: options.maxFetchChars,
    timeoutMs: options.timeoutMs, maxRedirects: 5, userAgent: 'dsh-editor/managed-web',
  }))
  return () => {
    offHttp(); offFirecrawl(); offSerper(); offBocha(); offBrave(); offExa(); offDeepSeek(); offEngine()
  }
}
