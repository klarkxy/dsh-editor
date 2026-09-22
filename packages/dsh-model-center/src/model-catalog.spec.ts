import { describe, expect, it } from 'vitest'
import {
  catalogChoices, choiceOf, effortOptions, parseModelCatalog, parseRouteKey, routeKey,
} from './model-catalog.ts'

const catalog = parseModelCatalog({
  default: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' },
  groups: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-chat',
          name: 'Chat',
          reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }], defaultEffort: 'low' },
        },
        {
          id: 'deepseek-reasoner',
          name: 'Reasoner',
          reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
        },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }],
    },
  ],
})

describe('session model catalog', () => {
  it('builds provider/model choices from native groups and advertised reasoning', () => {
    const choices = catalogChoices(catalog)
    expect(choices.map(item => `${item.provider}/${item.model}`)).toEqual([
      'deepseek/deepseek-chat',
      'deepseek/deepseek-reasoner',
      'openai/gpt-4.1',
    ])
    const chat = choiceOf(choices, 'deepseek', 'deepseek-chat')
    expect(chat?.efforts.map(item => item.id)).toEqual(['off', 'low'])
    expect(chat?.defaultEffort).toBe('low')
    expect(chat?.efforts.some(item => item.id === 'off')).toBe(true)
  })

  it('keeps follow-session distinct by not inventing a session group', () => {
    expect(catalog.groups.some(group => group.id === 'session')).toBe(false)
  })

  it('preserves an unlisted current effort instead of treating it as unavailable', () => {
    const reasoner = choiceOf(catalogChoices(catalog), 'deepseek', 'deepseek-reasoner')
    const options = effortOptions(reasoner, 'xhigh')
    expect(options.map(item => item.id)).toEqual(['high', 'xhigh'])
    expect(options.map(item => item.id)).not.toContain('medium')
    expect(options.map(item => item.id)).not.toContain('max')
  })

  it('does not inject a hardcoded reasoning list when metadata is empty', () => {
    const gpt = choiceOf(catalogChoices(catalog), 'openai', 'gpt-4.1')
    expect(effortOptions(gpt).map(item => item.id)).toEqual([])
    expect(effortOptions(gpt, 'off').map(item => item.id)).toEqual(['off'])
  })

  it('keeps a bound route that is missing from the catalog as an extra choice', () => {
    const extra = catalogChoices(catalog, { provider: 'anthropic', model: 'sonnet' })
    expect(extra.at(-1)).toMatchObject({ provider: 'anthropic', model: 'sonnet', efforts: [] })
  })

  it('round-trips catalog route keys', () => {
    expect(parseRouteKey(routeKey('deepseek', 'deepseek-chat'))).toEqual({
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
  })
})
