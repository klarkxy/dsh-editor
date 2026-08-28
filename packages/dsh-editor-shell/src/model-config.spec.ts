import { describe, expect, it } from 'vitest'
import { friendlyModelError, providerWrite, validateModelForm } from './model-config.ts'

describe('model onboarding contract', () => {
  it('uses fixed internal routes without exposing a provider registry', () => {
    expect(providerWrite({ choice: 'deepseek', baseURL: '', apiKey: 'x' })).toEqual({
      provider: 'deepseek-official', keyRef: 'DEEPSEEK_API_KEY',
    })
    expect(providerWrite({ choice: 'custom', baseURL: 'https://example.com/v1/', apiKey: 'x' }, [{ id: 'writer', name: 'Writer' }])).toMatchObject({
      provider: 'dsh-editor-custom',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'dsh-editor-custom'],
      settingsValue: {
        models: [{ id: 'writer', name: 'Writer' }],
        compat: { maxTokensField: 'max_tokens', supportsStore: false, supportsDeveloperRole: false },
      },
      keyRef: 'DSH_EDITOR_CUSTOM_API_KEY',
    })
  })

  it('rejects pasted environment assignments and invalid custom fields', () => {
    expect(validateModelForm({ choice: 'deepseek', baseURL: '', apiKey: 'DEEPSEEK_API_KEY=secret' })).toContain('Key 本身')
    expect(validateModelForm({ choice: 'custom', baseURL: 'file:///tmp', apiKey: 'secret' })).toContain('http')
    expect(validateModelForm({ choice: 'custom', baseURL: 'https://example.com/v1', apiKey: 'secret' })).toBeUndefined()
    expect(validateModelForm({ choice: 'deepseek', baseURL: '', apiKey: '' }, true)).toBeUndefined()
  })

  it('maps provider failures to author-facing messages', () => {
    expect(friendlyModelError('HTTP 401 AUTH')).toContain('密钥无效')
    expect(friendlyModelError('rate limit 429')).toContain('限流')
    expect(friendlyModelError('secret upstream stack trace')).toBe('连接测试失败，请检查接口地址和密钥后重试。')
  })
})
