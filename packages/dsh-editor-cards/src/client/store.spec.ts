import { describe, expect, it } from 'vitest'
import { closeCardsDetail, closeCardsPanel, getCardsState, openCardsPanel, resetCardsStore, selectCard } from './store.ts'

describe('cards store', () => {
  it('opens, selects, returns from detail, and closes the panel', () => {
    resetCardsStore()
    openCardsPanel('character')
    expect(getCardsState()).toMatchObject({ open: true, kind: 'character', selectedPath: null })
    selectCard('人物卡/林简.md')
    expect(getCardsState().selectedPath).toBe('人物卡/林简.md')
    closeCardsDetail()
    expect(getCardsState()).toMatchObject({ open: true, selectedPath: null })
    selectCard('人物卡/林简.md')
    closeCardsPanel()
    expect(getCardsState()).toMatchObject({ open: false, selectedPath: null })
    resetCardsStore()
  })
})
