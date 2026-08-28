export type ModelInterface = 'deepseek' | 'custom'

export type ModelForm = {
  choice: ModelInterface
  baseURL: string
  apiKey: string
}

export type DiscoveredModel = {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

export type ProviderWrite = {
  provider: string
  settingsNs?: string
  settingsPath?: string[]
  settingsValue?: unknown
  keyRef: string
}

/** NewAPI / OneAPI / LiteLLM reject OpenAI-only fields that pi-ai infers from an unrecognized URL. */
export const CUSTOM_GATEWAY_COMPAT = {
  supportsDeveloperRole: false,
  supportsStore: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
  maxTokensField: 'max_tokens' as const,
}

export function providerWrite(form: ModelForm, models: DiscoveredModel[] = []): ProviderWrite {
  if (form.choice === 'deepseek') {
    return { provider: 'deepseek-official', keyRef: 'DEEPSEEK_API_KEY' }
  }
  return {
    provider: 'dsh-editor-custom',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'dsh-editor-custom'],
    settingsValue: {
      displayName: '自定义接口',
      apiKeyEnv: 'DSH_EDITOR_CUSTOM_API_KEY',
      api: 'openai-completions',
      baseURL: form.baseURL.trim().replace(/\/+$/, ''),
      compat: CUSTOM_GATEWAY_COMPAT,
      models: models.map((model) => ({
        id: model.id,
        ...(model.name ? { name: model.name } : {}),
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
      })),
    },
    keyRef: 'DSH_EDITOR_CUSTOM_API_KEY',
  }
}

export function validateModelForm(form: ModelForm, keyAlreadyConfigured = false): string | undefined {
  const key = form.apiKey.trim()
  if (!key && !keyAlreadyConfigured) return '请输入 API Key。'
  if (key && (/\r|\n|\0/.test(key) || /^['"]|['"]$/.test(key) || /^[A-Z_][A-Z0-9_]*=/i.test(key))) {
    return '请只粘贴 Key 本身，不要包含变量名、引号或换行。'
  }
  if (form.choice === 'custom') {
    let url: URL
    try { url = new URL(form.baseURL.trim()) } catch { return '请输入有效的接口地址。' }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '接口地址必须以 http:// 或 https:// 开头。'
  }
  return undefined
}

export function friendlyModelError(message: string): string {
  if (/401|403|auth|credential|api.?key/i.test(message)) return '密钥无效或没有访问权限，请检查后重试。'
  if (/429|rate.?limit|quota/i.test(message)) return '接口当前限流或额度不足，请稍后重试。'
  if (/timeout|timed out|network|fetch|connect|dns/i.test(message)) return '无法连接到模型接口，请检查地址和网络。'
  if (/settings-conflict|revision|stale/i.test(message)) return '设置刚刚发生变化，请重新打开后再保存。'
  if (/writable|read.only|environment/i.test(message)) return '当前密钥由外部环境管理，不能在应用内替换。'
  return '连接测试失败，请检查接口地址和密钥后重试。'
}
