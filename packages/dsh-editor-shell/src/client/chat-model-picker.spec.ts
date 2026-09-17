import { describe, expect, it } from 'vitest'
import { effortDisplay } from './chat-model-picker.tsx'

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
})
