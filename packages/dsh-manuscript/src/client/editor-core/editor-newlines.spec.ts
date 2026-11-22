import { EditorState } from '@codemirror/state'
import { history, undoDepth } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { rebaseExternal } from './external-sync.ts'
import {
  detectLineSeparator,
  fromEditorLf,
  toEditorChanges,
  toEditorLf,
} from './editor-newlines.ts'

describe('editor newlines', () => {
  it('round-trips CRLF through the unified LF paper coordinates', () => {
    const crlf = '第一段。\r\n\r\n第二段。\r\n'
    expect(detectLineSeparator(crlf)).toBe('\r\n')
    expect(toEditorLf(crlf)).toBe('第一段。\n\n第二段。\n')
    expect(fromEditorLf(toEditorLf(crlf), crlf)).toBe(crlf)
    expect(EditorState.create({ doc: crlf }).doc.toString()).toBe(toEditorLf(crlf))
  })

  it('maps a CRLF partner edit onto LF paper coordinates so the view can keep history', () => {
    const base = '第一段。\r\n\r\n第二段。\r\n'
    const next = '第一段改。\r\n\r\n第二段。\r\n'
    const rebase = rebaseExternal(base, base, next)
    expect(rebase.kind).toBe('apply')
    if (rebase.kind !== 'apply') return
    const paper = toEditorLf(base)
    const changes = toEditorChanges(base, rebase.changes)
    let simulated = paper
    for (const change of [...changes].sort((a, b) => b.from - a.from)) {
      simulated = simulated.slice(0, change.from) + change.insert + simulated.slice(change.to)
    }
    expect(simulated).toBe(toEditorLf(next))
    const state = EditorState.create({ doc: paper, extensions: [history()] })
    const applied = state.update({ changes }).state
    expect(applied.doc.toString()).toBe(toEditorLf(next))
    expect(undoDepth(applied)).toBeGreaterThan(0)
    expect(fromEditorLf(applied.doc.toString(), base)).toBe(next)
  })
})
