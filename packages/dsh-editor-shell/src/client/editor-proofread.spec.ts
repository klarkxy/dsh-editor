import { describe, expect, it, vi } from 'vitest'
import type { EditorCoreHandle, EditorTargetSnapshot } from 'dsh-manuscript/client/editor-core'
import { locateProofreadOffsets } from './editor.ts'

function snapshot(partial: Partial<EditorTargetSnapshot> = {}): EditorTargetSnapshot {
  return {
    sessionId: 's',
    path: '正文/001.md',
    documentGeneration: 1,
    revision: 2,
    start: 10,
    end: 14,
    selectedText: '选段',
    ...partial,
  }
}

describe('proofread locate mapping', () => {
  it('maps the captured source even when locating has moved the current selection', () => {
    const revealRange = vi.fn()
    const handle = {
      isTargetCurrent: () => true,
      getVisibleSelectionText: () => '文字',
      getVisiblePaperText: () => '前后选段文字之后',
      revealRange,
    } as unknown as EditorCoreHandle
    expect(locateProofreadOffsets({
      handle,
      snapshot: snapshot({ start: 10, end: 14, selectedText: '选段文字' }),
      sentText: '选段文字',
      originStart: 10,
      start: 0,
      end: 2,
    })).toBe(true)
    expect(revealRange).toHaveBeenCalledWith(10, 12)
  })

  it('returns false when the document generation no longer matches', () => {
    const handle = {
      isTargetCurrent: () => false,
      getVisibleSelectionText: () => '选段文字',
      getVisiblePaperText: () => '选段文字',
      revealRange: vi.fn(),
    } as unknown as EditorCoreHandle
    expect(locateProofreadOffsets({
      handle,
      snapshot: snapshot(),
      sentText: '选段文字',
      originStart: 10,
      start: 0,
      end: 2,
    })).toBe(false)
  })
})
