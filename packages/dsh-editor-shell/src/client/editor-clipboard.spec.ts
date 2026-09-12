import { describe, expect, it, vi } from 'vitest'
import { captureEditorTarget, editorCommandState } from 'dsh-manuscript/client/editor-core'
import { copyEditorSelection, cutEditorSelection, pasteEditorSelection } from './editor-clipboard.ts'

function handleStub(input: {
  text: string
  current: boolean
  visible?: string
}) {
  return {
    getVisibleSelectionText: () => input.visible ?? input.text.slice(2, 4),
    isTargetCurrent: () => input.current,
    replaceSelection: vi.fn(() => input.current),
  }
}

const state = editorCommandState({
  loaded: true,
  conflict: true,
  busy: false,
  completionEnabled: true,
  enablePatch: true,
  hasVisibleSelection: true,
  collapsed: false,
  dirty: true,
  canUndo: true,
  canRedo: false,
  paperLength: 8,
})

const target = captureEditorTarget({
  sessionId: 's',
  path: '正文/001.md',
  documentGeneration: 1,
  revision: 1,
  start: 2,
  end: 4,
  text: 'abcd正文',
})

describe('shell editor clipboard commands', () => {
  it('does not delete on a failed write even during conflict', async () => {
    const handle = handleStub({ text: 'abcd正文', current: true })
    const result = await cutEditorSelection({
      handle: handle as never,
      state,
      target,
      writeText: async () => { throw new Error('ipc') },
    })
    expect(result).toBe('write-failed')
    expect(handle.replaceSelection).not.toHaveBeenCalled()
    expect(state.canCut).toBe(true)
    expect(state.canSave).toBe(false)
  })

  it('drops a delayed cut after the document generation changes', async () => {
    let current = true
    const handle = handleStub({ text: 'abcd正文', current: true })
    handle.isTargetCurrent = () => current
    const result = await cutEditorSelection({
      handle: handle as never,
      state,
      target,
      writeText: async () => { current = false },
    })
    expect(result).toBe('expired')
    expect(handle.replaceSelection).not.toHaveBeenCalled()
  })

  it('copies the locked snapshot even when the live selection moves, and pastes as one replace', async () => {
    const written: string[] = []
    const handle = handleStub({ text: 'abcd正文', current: true, visible: '可见' })
    expect(await copyEditorSelection({
      handle: handle as never,
      state,
      target,
      writeText: async (text) => { written.push(text) },
    })).toBe('ok')
    expect(written).toEqual(['cd'])
    expect(await pasteEditorSelection({
      handle: handle as never,
      state,
      target,
      readText: async () => '粘贴',
    })).toBe('ok')
    expect(handle.replaceSelection).toHaveBeenCalledWith('粘贴', target)
  })
})

describe('locked clipboard targets', () => {
  it('copies and deletes the same original range when the current selection differs', async () => {
    const handle = handleStub({ text: 'abcd正文', current: true, visible: '别的选区' })
    const writeText = vi.fn(async (_text: string) => {})
    expect(await cutEditorSelection({ handle: handle as never, state, target, writeText })).toBe('ok')
    expect(writeText).toHaveBeenCalledWith(target.selectedText)
    expect(handle.replaceSelection).toHaveBeenCalledWith('', target)
  })
  it('does not touch the clipboard for an already expired target', async () => {
    const handle = handleStub({ text: 'abcd正文', current: false })
    const writeText = vi.fn(async (_text: string) => {})
    const readText = vi.fn(async () => 'new')
    expect(await copyEditorSelection({ handle: handle as never, state, target, writeText })).toBe('expired')
    expect(await cutEditorSelection({ handle: handle as never, state, target, writeText })).toBe('expired')
    expect(await pasteEditorSelection({ handle: handle as never, state, target, readText })).toBe('expired')
    expect(writeText).not.toHaveBeenCalled()
    expect(readText).not.toHaveBeenCalled()
  })
})
