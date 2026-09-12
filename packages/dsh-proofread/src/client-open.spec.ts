import { describe, expect, it, vi } from 'vitest'
import { applyProofreadLocateResult, parseProofreadOpenDetail } from './client.ts'

describe('proofread open-text detail', () => {
  it('keeps text and optional locate metadata', () => {
    const locate = () => true
    expect(parseProofreadOpenDetail({ text: '选段', sourceLabel: '当前选段', onLocate: locate })).toEqual({
      text: '选段',
      sourceLabel: '当前选段',
      onLocate: locate,
    })
    expect(parseProofreadOpenDetail({ text: '粘贴' })).toEqual({ text: '粘贴' })
    expect(parseProofreadOpenDetail({ text: 1 })).toBeUndefined()
    expect(parseProofreadOpenDetail(null)).toBeUndefined()
  })

  it('closes the panel only after a successful locate', () => {
    const close = vi.fn()
    const note = vi.fn()
    applyProofreadLocateResult(true, close, note)
    expect(close).toHaveBeenCalledTimes(1)
    expect(note).not.toHaveBeenCalled()
    close.mockReset()
    applyProofreadLocateResult(false, close, note)
    expect(close).not.toHaveBeenCalled()
    expect(note).toHaveBeenCalledWith('原文已变化，请重新校对后再定位。')
  })
})
