import type { ProviderView } from './contracts.ts'

// Public prices checked on 2026-09-21; links remain available for current account terms.
export const PROVIDER_PRICING_CHECKED = '2026-09-21'

interface ProviderInfo {
  description: string
  pricing: string
  pricingUrl?: string
}

const providerInfo: Record<string, ProviderInfo> = {
  ddg: {
    description: '搜索 DuckDuckGo 公开网页，无需注册或 API Key。',
    pricing: '免费使用，不产生搜索 API 费用。',
    pricingUrl: 'https://duckduckgo.com/',
  },
  'zhihu-global': {
    description: '融合知乎问答与全网内容，返回可溯源的搜索结果。',
    pricing: '注册可获 5,000 次/天试用额度；超额价格需向平台咨询。',
    pricingUrl: 'https://developer.zhihu.com/',
  },
  bocha: {
    description: '面向中文内容的网页搜索，返回标题、链接和摘要。',
    pricing: '按调用次数计费，目录价 ¥0.036/次；试用额度以官方活动为准。',
    pricingUrl: 'https://aq6ky2b8nql.feishu.cn/wiki/JYSbwzdPIiFnz4kDYPXcHSDrnZb',
  },
  brave: {
    description: '使用 Brave 独立网页索引，搜索网页、新闻等内容。',
    pricing: '每月赠 $5（约 1,000 次）；超出 $5/千次，激活需绑卡。',
    pricingUrl: 'https://brave.com/search/api/',
  },
  'deepseek-official': {
    description: '由 DeepSeek 模型调用内置搜索，复用模型 API Key。',
    pricing: '默认 Flash 按 tokens 计费：每百万输入 ¥1–2（缓存命中 ¥0.02–0.04）、输出 ¥4–8，随峰谷时段变化；赠送余额和搜索工具费用以平台为准。',
    pricingUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  },
  exa: {
    description: '面向 AI 的网页搜索，提供相关网页与内容片段。',
    pricing: '注册赠 $20，此后每月赠 $10；$7/千次（每次最多 10 条），超过 10 条每多一条加 $1/千次。',
    pricingUrl: 'https://exa.ai/pricing',
  },
  firecrawl: {
    description: '搜索网页，并可配合网页内容提取。',
    pricing: '每月免费 1,000 积分，搜索每 10 条结果扣 2 积分；Hobby 含 5,000 积分/月，年付折合 $16/月，额外 $5/千积分。',
    pricingUrl: 'https://www.firecrawl.dev/pricing',
  },
  serper: {
    description: '获取 Google 的网页搜索结果。',
    pricing: '注册赠 2,500 次（一次性）；充值 $50/5万次（$1/千次），付费额度有效期 6 个月。',
    pricingUrl: 'https://serper.dev/',
  },
  tavily: {
    description: '面向 AI 的网页搜索，当前使用基础搜索。',
    pricing: '每月免费 1,000 积分，基础搜索 1 积分/次；按量付费 $0.008/积分（$8/千次）。',
    pricingUrl: 'https://docs.tavily.com/documentation/api-credits',
  },
}

export function searchProviderInfo(provider: ProviderView): ProviderInfo {
  return (Object.hasOwn(providerInfo, provider.id) ? providerInfo[provider.id] : undefined) ?? {
    description: provider.description,
    pricing: provider.billing === 'none' ? '此后端不收取搜索费用。'
      : provider.billing === 'model-and-tools' ? '按模型用量和工具调用计费；免费额度及单价请查看供应商说明。'
        : '按 API 调用计费；免费额度及单价请查看供应商说明。',
    pricingUrl: provider.signupUrl,
  }
}
