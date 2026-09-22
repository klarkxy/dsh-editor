import { describe, expect, it } from 'vitest'
import { claimTitleSlot, occupiedProviderId, releaseTitleSlot, type TitleSlot } from './ownership.ts'

function slot(initial?: string): TitleSlot & { current?: string } {
  const state: TitleSlot & { current?: string } = {
    current: initial,
    owner: () => state.current,
    async occupy(id) {
      if (state.current && state.current !== id) {
        throw new Error(`session-title provider "${state.current}" is already registered`)
      }
      state.current = id
      return async () => { if (state.current === id) state.current = undefined }
    },
  }
  return state
}

describe('title provider ownership', () => {
  it('claims an empty exclusive slot and releases only while still the owner', async () => {
    const host = slot()
    const claimed = await claimTitleSlot(host, '@klarkxy/dsh-current-title')
    expect(host.owner()).toBe('@klarkxy/dsh-current-title')
    expect(await releaseTitleSlot(host, claimed)).toBe('released')
    expect(host.owner()).toBeUndefined()
  })

  it('does not release after another provider takes the slot', async () => {
    const host = slot()
    const claimed = await claimTitleSlot(host, '@klarkxy/dsh-current-title')
    host.current = 'other-title-plugin'
    expect(await releaseTitleSlot(host, claimed)).toBe('left-other-owner')
    expect(host.owner()).toBe('other-title-plugin')
  })

  it('reads the occupied provider id from the exclusive native register error', () => {
    expect(occupiedProviderId(new Error('session-title provider "session-title-first-prompt-llm" is already registered')))
      .toBe('session-title-first-prompt-llm')
  })
})
