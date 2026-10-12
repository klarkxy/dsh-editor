import { describe, expect, it } from 'vitest'
import { IME_KEYCODE, isImeEvent } from './ime.ts'

describe('IME enter policy', () => {
  it('treats composing and keyCode 229 as IME independently', () => {
    expect(isImeEvent({ isComposing: true, keyCode: 13 })).toBe(true)
    expect(isImeEvent({ isComposing: false, keyCode: IME_KEYCODE })).toBe(true)
    expect(isImeEvent({ isComposing: false, keyCode: 13 })).toBe(false)
  })
})
