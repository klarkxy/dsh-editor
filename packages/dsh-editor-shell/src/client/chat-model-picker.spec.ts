import { describe, expect, it } from 'vitest'
import { effortDisplay, effortTriggerLabel } from './chat-model-picker.tsx'

describe('reasoning effort labels', () => {
  it('shows the public none/low/medium/high/xhigh/max names', () => {
    expect(effortDisplay('off')).toBe('none')
    expect(effortDisplay('none')).toBe('none')
    expect(effortDisplay('low')).toBe('low')
    expect(effortDisplay('medium')).toBe('medium')
    expect(effortDisplay('high')).toBe('high')
    expect(effortDisplay('xhigh')).toBe('xhigh')
    expect(effortDisplay('max')).toBe('max')
    expect(effortDisplay('')).toBe('')
  })

  it('keeps the trigger on the public token, not the localized reasoning label', () => {
    expect(effortTriggerLabel('')).toBe('none')
    expect(effortTriggerLabel('off')).toBe('none')
    expect(effortTriggerLabel('xhigh')).toBe('xhigh')
  })
})
