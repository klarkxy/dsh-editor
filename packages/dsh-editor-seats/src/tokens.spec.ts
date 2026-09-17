import { describe, expect, it } from 'vitest'
import { radixFallbackTokens } from './tokens.ts'

describe('radix fallback type scale', () => {
  it('matches chrome caption floor and the full Radix size ladder', () => {
    expect(radixFallbackTokens).toContain('--font-size-1: 13px')
    expect(radixFallbackTokens).toContain('--font-size-2: 14px')
    expect(radixFallbackTokens).toContain('--font-size-3: 16px')
    expect(radixFallbackTokens).toContain('--font-size-4: 18px')
    expect(radixFallbackTokens).toContain('--font-size-5: 20px')
    expect(radixFallbackTokens).toContain('--font-size-6: 24px')
    expect(radixFallbackTokens).toContain('--font-size-7: 28px')
    expect(radixFallbackTokens).toContain('--font-size-8: 35px')
    expect(radixFallbackTokens).toContain('--font-size-9: 60px')
    expect(radixFallbackTokens).not.toContain('--font-size-1: 12px')
  })
})
