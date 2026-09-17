import { afterEach, describe, expect, it } from 'vitest'
import { resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { effortDisplay, effortTriggerLabel } from './chat-model-picker.tsx'

afterEach(() => {
  resetLocaleForTests()
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

  it('keeps the trigger on the effort name, not the field label', () => {
    expect(effortTriggerLabel('')).toBe('关')
    expect(effortTriggerLabel('off')).toBe('关')
    expect(effortTriggerLabel('xhigh')).toBe('极高')
    expect(effortTriggerLabel('high')).not.toBe('思考强度')
  })

  it('switches effort names with the UI locale', () => {
    setLocale('en')
    expect(effortDisplay('off')).toBe('Off')
    expect(effortDisplay('xhigh')).toBe('Extra high')
    expect(effortTriggerLabel('max')).toBe('Max')
  })
})
