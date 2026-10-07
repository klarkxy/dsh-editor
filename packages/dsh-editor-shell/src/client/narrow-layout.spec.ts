import { describe, expect, it } from 'vitest'
import { railAtWidth, railByAuthor, type RailWidthState } from './narrow-layout.ts'

const wide: RailWidthState = { open: true, yielded: null, crowded: false, authored: false }

describe('窄窗让位', () => {
  it('窗口放不下时收起展开中的辅助栏，并记住作者原本的选择', () => {
    expect(railAtWidth(wide, true)).toEqual({ open: false, yielded: true, crowded: true, authored: false })
  })

  it('窗口变宽后恢复作者原本的选择，而不是留下收起状态', () => {
    const crowded = railAtWidth(wide, true)
    expect(railAtWidth(crowded, false)).toEqual({ open: true, yielded: null, crowded: false, authored: false })
  })

  it('作者原本就关着的辅助栏不会在窄窗下被记成让位', () => {
    const state: RailWidthState = { open: false, yielded: null, crowded: false, authored: false }
    expect(railAtWidth(state, true)).toEqual({ ...state, crowded: true })
    expect(railAtWidth({ ...state, crowded: true }, false)).toEqual(state)
  })

  it('让位期间重复结算不会反复记账', () => {
    const crowded = railAtWidth(wide, true)
    expect(railAtWidth(crowded, true)).toBe(crowded)
    expect(railAtWidth(crowded, true)).toEqual({ open: false, yielded: true, crowded: true, authored: false })
  })

  it('作者在窄窗下打开辅助栏时不会被紧随其后的宽度结算立刻关掉', () => {
    // 回归：只清空 yielded 而不记录接管时，这里的结果是被立刻关掉。
    expect(railAtWidth(railByAuthor(true, true), true)).toEqual({ open: true, yielded: null, crowded: true, authored: true })
  })

  it('作者在窄窗下关掉辅助栏后不会因为让位恢复而自己弹回来', () => {
    const crowded = railAtWidth(wide, true)
    expect(railAtWidth(railByAuthor(false, true), false)).toEqual({ open: false, yielded: null, crowded: false, authored: false })
    expect(crowded.yielded).toBe(true)
  })

  it('作者接管在窗口变宽时保持展开，不被窗口替他改回去', () => {
    expect(railAtWidth(railByAuthor(true, true), false)).toEqual({ open: true, yielded: null, crowded: false, authored: false })
  })

  it('窗口换档后让位规则重新接手，作者的接管不会永久钉住面板', () => {
    const widened = railAtWidth(railByAuthor(true, true), false)
    expect(railAtWidth(widened, true)).toEqual({ open: false, yielded: true, crowded: true, authored: false })
  })

  it('窄窗下强制让位可以压过作者接管，让两条栏互斥', () => {
    const authored = railByAuthor(true, true)
    expect(railAtWidth(authored, true, true)).toEqual({ open: false, yielded: true, crowded: true, authored: false })
  })

  it('窗口状态不变时不产生新对象，effect 不会因为空转而反复触发', () => {
    const state = wide
    expect(railAtWidth(state, false)).toBe(state)
    expect(railAtWidth({ open: false, yielded: null, crowded: true, authored: false }, true)).toEqual({
      open: false, yielded: null, crowded: true, authored: false,
    })
    expect(railAtWidth(railByAuthor(true, true), true)).toEqual(railByAuthor(true, true))
  })
})
