import { isolateHistory } from '@codemirror/commands'
import { describe, expect, it, vi } from 'vitest'
import {
  captureEditorTarget,
  contextMenuSource,
  editorCommandState,
  isEditorTargetCurrent,
  isolateReplaceSpec,
  paperRangeToView,
  paperSelectionText,
  runClipboardCopy,
  runClipboardCut,
  runClipboardPaste,
  shouldPreserveSelectionOnContextMouseDown,
  visiblePaperRange,
} from './editor-clipboard.ts'

const live = {
  sessionId: 's1',
  path: '正文/001.md',
  documentGeneration: 4,
  revision: 9,
  text: '---\nbeats: [a]\n---\n可见正文选区',
}

describe('editor target snapshots', () => {
  it('rejects a reload that keeps the same path and text', () => {
    const snapshot = captureEditorTarget({
      ...live,
      start: 18,
      end: 22,
    })
    expect(isEditorTargetCurrent(snapshot, live)).toBe(true)
    expect(isEditorTargetCurrent(snapshot, { ...live, documentGeneration: 5 })).toBe(false)
    expect(isEditorTargetCurrent(snapshot, { ...live, revision: 10 })).toBe(false)
    expect(isEditorTargetCurrent(snapshot, { ...live, sessionId: 's2' })).toBe(false)
    expect(isEditorTargetCurrent(snapshot, { ...live, path: '正文/002.md' })).toBe(false)
  })

  it('rejects a mutated range even when generation and path match', () => {
    const snapshot = captureEditorTarget({ ...live, start: 18, end: 22 })
    expect(isEditorTargetCurrent(snapshot, { ...live, text: live.text.replace('可见', '改写') })).toBe(false)
  })
})

describe('visible paper selection', () => {
  const offset = '---\nbeats: [a]\n---\n'.length

  it('copies and cuts only the visible paper, not frontmatter', () => {
    expect(paperSelectionText({ text: live.text, paperOffset: offset, start: 0, end: live.text.length })).toBe('可见正文选区')
    expect(visiblePaperRange({ text: live.text, paperOffset: offset, start: 0, end: 4 })).toBeUndefined()
    expect(paperSelectionText({ text: live.text, paperOffset: offset, start: offset, end: offset + 2 })).toBe('可见')
  })

  it('maps full-file offsets onto the projected CodeMirror document', () => {
    expect(paperRangeToView({ paperOffset: offset, start: offset, end: offset + 4, docLength: 6 })).toEqual({ from: 0, to: 4 })
    expect(paperRangeToView({ paperOffset: offset, start: 0, end: offset + 2, docLength: 6 })).toEqual({ from: 0, to: 2 })
  })
})

describe('context mousedown protection', () => {
  it('keeps an inside-selection right click and places the caret outside', () => {
    expect(shouldPreserveSelectionOnContextMouseDown({ from: 2, to: 8, clickPos: 2 })).toBe(true)
    expect(shouldPreserveSelectionOnContextMouseDown({ from: 2, to: 8, clickPos: 8 })).toBe(true)
    expect(shouldPreserveSelectionOnContextMouseDown({ from: 2, to: 8, clickPos: 5 })).toBe(true)
    expect(shouldPreserveSelectionOnContextMouseDown({ from: 2, to: 8, clickPos: 1 })).toBe(false)
    expect(shouldPreserveSelectionOnContextMouseDown({ from: 2, to: 8, clickPos: 9 })).toBe(false)
    expect(shouldPreserveSelectionOnContextMouseDown({ from: 4, to: 4, clickPos: 4 })).toBe(false)
    expect(contextMenuSource(2)).toBe('pointer')
    expect(contextMenuSource(0)).toBe('keyboard')
  })
})

describe('command disable rules', () => {
  const base = {
    loaded: true,
    conflict: false,
    busy: false,
    completionEnabled: true,
    enablePatch: true,
    hasVisibleSelection: true,
    collapsed: false,
    dirty: true,
    canUndo: true,
    canRedo: false,
    paperLength: 12,
  }

  it('lets local clipboard continue during conflict but blocks save and AI', () => {
    const state = editorCommandState({ ...base, conflict: true })
    expect(state.canCut).toBe(true)
    expect(state.canCopy).toBe(true)
    expect(state.canPaste).toBe(true)
    expect(state.canSave).toBe(false)
    expect(state.canComplete).toBe(false)
    expect(state.canRewrite).toBe(false)
  })

  it('requires a folded caret for completion and a visible selection for rewrite', () => {
    expect(editorCommandState({ ...base, collapsed: false }).canComplete).toBe(false)
    expect(editorCommandState({ ...base, collapsed: true, hasVisibleSelection: false }).canComplete).toBe(true)
    expect(editorCommandState({ ...base, hasVisibleSelection: false }).canRewrite).toBe(false)
    expect(editorCommandState({ ...base, hasVisibleSelection: false }).canCut).toBe(false)
    expect(editorCommandState({ ...base, completionEnabled: false }).canComplete).toBe(false)
    expect(editorCommandState({ ...base, completionEnabled: false }).canRewrite).toBe(false)
    expect(editorCommandState({ ...base, busy: true }).canRewrite).toBe(false)
    expect(editorCommandState({ ...base, loaded: false }).canPaste).toBe(false)
  })
})

describe('clipboard command sequencing', () => {
  it('does not delete when clipboard write fails', async () => {
    const deleteSelection = vi.fn(() => true)
    const result = await runClipboardCut({
      allowed: true,
      text: '选区',
      writeText: async () => { throw new Error('denied') },
      stillCurrent: () => true,
      deleteSelection,
    })
    expect(result).toBe('write-failed')
    expect(deleteSelection).not.toHaveBeenCalled()
  })

  it('does not delete when a delayed write lands on an expired snapshot', async () => {
    const deleteSelection = vi.fn(() => true)
    let current = true
    const result = await runClipboardCut({
      allowed: true,
      text: '选区',
      writeText: async () => { current = false },
      stillCurrent: () => current,
      deleteSelection,
    })
    expect(result).toBe('expired')
    expect(deleteSelection).not.toHaveBeenCalled()
  })

  it('pastes only after a successful read and a still-current snapshot', async () => {
    const replaceSelection = vi.fn(() => true)
    let current = true
    const expired = await runClipboardPaste({
      allowed: true,
      readText: async () => { current = false; return '粘贴' },
      stillCurrent: () => current,
      replaceSelection,
    })
    expect(expired).toBe('expired')
    expect(replaceSelection).not.toHaveBeenCalled()

    const ok = await runClipboardPaste({
      allowed: true,
      readText: async () => '粘贴',
      stillCurrent: () => true,
      replaceSelection,
    })
    expect(ok).toBe('ok')
    expect(replaceSelection).toHaveBeenCalledWith('粘贴')
  })

  it('does not write when the command is blocked', async () => {
    const writeText = vi.fn(async () => {})
    expect(await runClipboardCopy({ allowed: false, text: 'x', writeText })).toBe('blocked')
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('cut/paste undo isolation', () => {
  it('marks replace transactions as a single isolated history event', () => {
    const spec = isolateReplaceSpec({ from: 2, to: 5, insert: '新' })
    expect(spec.userEvent).toBe('input.paste')
    const pasteMarks = [spec.annotations].flat()
    expect(pasteMarks.some((item) => item?.value === isolateHistory.of('full').value)).toBe(true)
    const cut = isolateReplaceSpec({ from: 2, to: 5, insert: '' })
    expect(cut.userEvent).toBe('delete.cut')
    const cutMarks = [cut.annotations].flat()
    expect(cutMarks.some((item) => item?.value === isolateHistory.of('full').value)).toBe(true)
  })
})

describe('empty and whitespace clipboard text', () => {
  it('does not delete a selection for an empty or non-text clipboard', async () => {
    const replaceSelection = vi.fn(() => true)
    expect(await runClipboardPaste({ allowed: true, readText: async () => '', stillCurrent: () => true, replaceSelection })).toBe('ok')
    expect(replaceSelection).not.toHaveBeenCalled()
  })
  it('preserves intentional whitespace instead of treating it as empty', async () => {
    const replaceSelection = vi.fn(() => true)
    expect(await runClipboardPaste({ allowed: true, readText: async () => ' \n\t', stillCurrent: () => true, replaceSelection })).toBe('ok')
    expect(replaceSelection).toHaveBeenCalledWith(' \n\t')
  })
})
