import { describe, expect, it } from 'vitest'
import { applyGhost, applySelectionPatch, canApplyGhost, isDirty, isSelectionCurrent, saveState, selectionTicket } from './editor-state.ts'

describe('writer editor states', () => {
  const document = { sessionId: 's', path: '正文/01.md', text: '原文', version: 'v1' }
  it('keeps the explicit draft and conflict distinction', () => {
    expect(isDirty(document, '原文')).toBe(false)
    expect(saveState(document, '草稿')).toBe('draft')
    expect(saveState(document, '草稿', true)).toBe('conflict')
  })
  it('only accepts a ghost when the editor is writable', () => {
    expect(canApplyGhost('saved', '续写')).toBe(true)
    expect(canApplyGhost('conflict', '续写')).toBe(false)
    expect(applyGhost('雨还没停。', 4, '她没有开灯。')).toBe('雨还没停她没有开灯。。')
  })
  it('rejects a stale selection before applying a short patch', () => {
    const ticket = selectionTicket(document, '原文需要修改', 2, 2, 6)!
    expect(isSelectionCurrent(ticket, document, '原文需要修改', 2)).toBe(true)
    expect(isSelectionCurrent(ticket, document, '原文已经变化', 3)).toBe(false)
    expect(applySelectionPatch('原文需要修改', ticket, '应当调整')).toBe('原文应当调整')
  })
})
