import { afterEach, describe, expect, it } from 'vitest'
import { resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { currentModelNeedsKey, effortDisplay, effortTriggerLabel } from './chat-model-picker.tsx'
import type { ModelsSnapshot } from './settings-models-state.ts'

afterEach(() => {
  resetLocaleForTests()
})

describe('current model configuration hint', () => {
  function snapshot(): ModelsSnapshot {
    return {
      status: 'ready', refreshing: false, error: null, credentialError: null, writable: true,
      namespaces: new Map(),
      rows: [{
        entry: { provider: 'deepseek', settingsNs: 'llm-deepseek', settingsPath: [] },
        configured: true, removable: false, apiKeyEnv: 'DEEPSEEK_API_KEY', credential: { configured: false },
      }],
    }
  }

  it('offers setup only for the selected native provider with a confirmed missing key', () => {
    const state = snapshot()
    expect(currentModelNeedsKey('deepseek', state)).toBe(true)
    expect(currentModelNeedsKey('other', state)).toBe(false)
    state.rows[0]!.credential = { configured: true, source: 'environment', writable: false }
    expect(currentModelNeedsKey('deepseek', state)).toBe(false)
    state.rows[0]!.credential = undefined
    expect(currentModelNeedsKey('deepseek', state)).toBe(false)
    state.rows[0]!.credential = { configured: false }
    state.rows[0]!.apiKeyEnv = undefined
    expect(currentModelNeedsKey('deepseek', state)).toBe(false)
  })

  it('does not mistake unknown, stale or failed reads for a missing credential', () => {
    const state = snapshot()
    for (const patch of [
      { status: 'idle' as const }, { status: 'loading' as const }, { status: 'error' as const },
      { refreshing: true }, { error: 'disconnected' }, { credentialError: 'unavailable' },
    ]) expect(currentModelNeedsKey('deepseek', { ...state, ...patch })).toBe(false)
  })
})

describe('reasoning effort labels', () => {
  it('shows Chinese none/low/medium/high/extra/max names by default', () => {
    expect(effortDisplay('off')).toBe('关')
    expect(effortDisplay('none')).toBe('关')
    expect(effortDisplay('low')).toBe('低')
    expect(effortDisplay('medium')).toBe('中')
    expect(effortDisplay('high')).toBe('高')
    expect(effortDisplay('xhigh')).toBe('极高')
    expect(effortDisplay('max')).toBe('最高')
    expect(effortDisplay('')).toBe('')
  })

  it('prefixes the trigger so Off is readable as a thinking level', () => {
    expect(effortTriggerLabel('')).toBe('思考 关')
    expect(effortTriggerLabel('off')).toBe('思考 关')
    expect(effortTriggerLabel('xhigh')).toBe('思考 极高')
    expect(effortTriggerLabel('high')).not.toBe('思考强度')
  })

  it('switches effort names with the UI locale', () => {
    setLocale('en')
    expect(effortDisplay('off')).toBe('Off')
    expect(effortDisplay('xhigh')).toBe('Extra high')
    expect(effortTriggerLabel('max')).toBe('Think Max')
  })
})
