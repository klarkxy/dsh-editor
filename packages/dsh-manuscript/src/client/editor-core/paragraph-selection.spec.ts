import { describe, expect, it, vi } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { selectParagraphInView } from './paragraph-selection.ts'

function fixture(text: string, at: number, composing = false) {
  let state = EditorState.create({ doc: text, selection: { anchor: at } })
  return {
    get state() { return state },
    composing,
    dispatch: vi.fn((spec: TransactionSpec) => { state = state.update(spec).state }),
    focus: vi.fn(),
  }
}

function select(view: ReturnType<typeof fixture>) {
  return selectParagraphInView(view as unknown as Parameters<typeof selectParagraphInView>[0])
}

describe('explicit paragraph selection', () => {
  it('reuses focus-paragraph boundaries without changing text', () => {
    const text = '上一段。\n\n当前段第一行。\n当前段第二行。\n\n下一段。'
    const view = fixture(text, text.indexOf('第二行'))
    expect(select(view)).toBe(true)
    const { from, to } = view.state.selection.main
    expect(view.state.doc.sliceString(from, to)).toBe('当前段第一行。\n当前段第二行。')
    expect(view.state.doc.toString()).toBe(text)
    expect(view.focus).toHaveBeenCalledOnce()
  })

  it.each(['', '   ', '\n', '甲\n\n乙'])('does not select a blank paragraph in %j', (text) => {
    const at = text === '甲\n\n乙' ? 2 : 0
    const view = fixture(text, at)
    expect(select(view)).toBe(false)
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('does not interrupt IME composition', () => {
    const view = fixture('中文输入中', 2, true)
    expect(select(view)).toBe(false)
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('selects only the visible paper passed by the existing projection', () => {
    const view = fixture('可见正文。\n\n另一段。', 2)
    expect(select(view)).toBe(true)
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe('可见正文。'.length)
  })
})
