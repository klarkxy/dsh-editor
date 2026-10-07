import { describe, expect, it, vi } from 'vitest'
import { saveOpenEditor, type EditorSaveHandle } from './save-before-leave.ts'

function editor() {
  const state = {
    document: { sessionId: 's', path: 'notes.md', version: 'v1', text: '磁盘' },
    text: '新稿', loaded: true, conflict: false, composing: false,
  }
  let finish!: (ok?: boolean) => void
  const handle: EditorSaveHandle = {
    getDocument: () => state.document,
    getText: () => state.text,
    getCommandState: () => ({ loaded: state.loaded, conflict: state.conflict }),
    isComposing: () => state.composing,
    save: vi.fn(() => {
      const text = state.text
      return new Promise<boolean>(resolve => {
        finish = (ok = true) => {
          if (ok) state.document = { ...state.document, text, version: 'v2' }
          resolve(ok)
        }
      })
    }),
  }
  return { state, handle, finish: (ok = true) => finish(ok) }
}

describe('shared save before leaving a manuscript', () => {
  const expected = { sessionId: 's', path: 'notes.md' }

  it('leaves clean documents alone and saves arbitrary dirty text files', async () => {
    const first = editor()
    first.state.text = first.state.document.text
    await expect(saveOpenEditor(first.handle, expected)).resolves.toEqual({ ok: true })
    expect(first.handle.save).not.toHaveBeenCalled()
    first.state.text = ''
    const save = saveOpenEditor(first.handle, expected)
    first.finish()
    await expect(save).resolves.toEqual({ ok: true })
    expect(first.state.document.text).toBe('')
  })

  it('keeps typing received after the write snapshot in the current editor', async () => {
    const first = editor()
    const save = saveOpenEditor(first.handle, expected)
    first.state.text = '新稿。继续输入'
    first.finish()
    await expect(save).resolves.toEqual({ ok: false, reason: 'typing' })
    expect(first.state.document.text).toBe('新稿')
    expect(first.state.text).toBe('新稿。继续输入')
  })

  it.each(['composing', 'conflict', 'identity', 'save'] as const)('blocks %s arriving during a write', async reason => {
    const first = editor()
    const save = saveOpenEditor(first.handle, expected)
    if (reason === 'composing') first.state.composing = true
    if (reason === 'conflict') first.state.conflict = true
    if (reason === 'identity') first.state.loaded = false
    first.finish(reason !== 'save')
    await expect(save).resolves.toEqual({ ok: false, reason })
  })

  it('rejects a changed session or path even when the replacement buffer is clean', async () => {
    const first = editor()
    const save = saveOpenEditor(first.handle, expected)
    first.state.document = { ...first.state.document, sessionId: 'other' }
    first.finish()
    await expect(save).resolves.toEqual({ ok: false, reason: 'identity' })
  })
})
