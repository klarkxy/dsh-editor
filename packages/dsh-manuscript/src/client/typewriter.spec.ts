import { Compartment, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { paperEscapePriority, paperSearch, paperSearchKeymap } from './editor-core/search.ts'
import {
  activeParagraphRange,
  buildFocusParagraphDecorations,
  clampTypewriterRatio,
  focusParagraphEnabled,
  focusParagraphExtension,
  getTypewriterConfig,
  isFocusParagraphEnabled,
  shouldRecenterTypewriter,
  typewriterExtension,
  typewriterScrollTop,
} from './editor-core/typewriter.ts'

function dimmedLineStarts(state: EditorState): number[] {
  const starts: number[] = []
  buildFocusParagraphDecorations(state).between(0, state.doc.length, (from) => {
    starts.push(from)
  })
  return starts
}

describe('typewriter extension', () => {
  it('constructs an enabled extension with the default 0.5 ratio', () => {
    const state = EditorState.create({
      doc: '月光',
      extensions: [typewriterExtension()],
    })
    expect(getTypewriterConfig(state)).toEqual({ enabled: true, ratio: 0.5 })
  })

  it('reconfigures through a Compartment when the prop flips', () => {
    const compartment = new Compartment()
    let state = EditorState.create({
      doc: '月光',
      extensions: [compartment.of(typewriterExtension({ enabled: false }))],
    })
    expect(getTypewriterConfig(state)).toEqual({ enabled: false, ratio: 0.5 })

    state = state.update({
      effects: compartment.reconfigure(typewriterExtension({ enabled: true, ratio: 0.4 })),
    }).state
    expect(getTypewriterConfig(state)).toEqual({ enabled: true, ratio: 0.4 })

    state = state.update({
      effects: compartment.reconfigure(typewriterExtension({ enabled: false })),
    }).state
    expect(getTypewriterConfig(state).enabled).toBe(false)
  })

  it('recenters only on document or selection changes', () => {
    expect(shouldRecenterTypewriter({ docChanged: true, selectionSet: false })).toBe(true)
    expect(shouldRecenterTypewriter({ docChanged: false, selectionSet: true })).toBe(true)
    expect(shouldRecenterTypewriter({ docChanged: true, selectionSet: true })).toBe(true)
    expect(shouldRecenterTypewriter({ docChanged: false, selectionSet: false })).toBe(false)
  })

  it('places the caret line at the requested viewport ratio', () => {
    expect(typewriterScrollTop({
      lineTop: 400,
      lineHeight: 40,
      viewportHeight: 600,
      ratio: 0.5,
    })).toBe(400 + 20 - 300)
    expect(typewriterScrollTop({
      lineTop: 40,
      lineHeight: 20,
      viewportHeight: 400,
      ratio: 0.5,
    })).toBe(0)
    expect(typewriterScrollTop({
      lineTop: 800,
      lineHeight: 20,
      viewportHeight: 400,
      ratio: 0.25,
      maxScroll: 500,
    })).toBe(500)
    expect(clampTypewriterRatio(1.8)).toBe(1)
    expect(clampTypewriterRatio(-0.2)).toBe(0)
  })
})

describe('focus paragraph decorations', () => {
  it('dims every block except the paragraph that contains the caret', () => {
    const doc = '第一段文字。\n仍是第一段。\n\n第二段。\n\n第三段。'
    const inFirst = EditorState.create({
      doc,
      selection: { anchor: 2 },
      extensions: [focusParagraphExtension()],
    })
    expect(isFocusParagraphEnabled(inFirst)).toBe(true)
    expect(activeParagraphRange(inFirst.doc, 2)).toEqual({ from: 0, to: inFirst.doc.line(2).to })
    expect(dimmedLineStarts(inFirst)).toEqual([
      inFirst.doc.line(3).from,
      inFirst.doc.line(4).from,
      inFirst.doc.line(5).from,
      inFirst.doc.line(6).from,
    ])

    const inSecond = inFirst.update({ selection: { anchor: inFirst.doc.line(4).from + 1 } }).state
    expect(activeParagraphRange(inSecond.doc, inSecond.selection.main.head)).toEqual({
      from: inSecond.doc.line(4).from,
      to: inSecond.doc.line(4).to,
    })
    expect(dimmedLineStarts(inSecond)).toEqual([
      inSecond.doc.line(1).from,
      inSecond.doc.line(2).from,
      inSecond.doc.line(3).from,
      inSecond.doc.line(5).from,
      inSecond.doc.line(6).from,
    ])
  })

  it('treats a blank line as its own active block', () => {
    const state = EditorState.create({
      doc: '上段\n\n下段',
      selection: { anchor: 3 },
    })
    expect(state.doc.line(2).from).toBe(3)
    expect(activeParagraphRange(state.doc, 3)).toEqual({ from: 3, to: 3 })
    expect(dimmedLineStarts(state)).toEqual([0, state.doc.line(3).from])
  })

  it('reconfigures the focus-paragraph compartment without a DOM', () => {
    const compartment = new Compartment()
    let state = EditorState.create({
      doc: '甲\n\n乙',
      extensions: [compartment.of(focusParagraphExtension(false))],
    })
    expect(state.facet(focusParagraphEnabled)).toBe(false)

    state = state.update({
      effects: compartment.reconfigure(focusParagraphExtension(true)),
    }).state
    expect(state.facet(focusParagraphEnabled)).toBe(true)

    state = state.update({
      effects: compartment.reconfigure(focusParagraphExtension(false)),
    }).state
    expect(state.facet(focusParagraphEnabled)).toBe(false)
  })
})

describe('writing extensions vs existing shortcuts', () => {
  it('does not steal find, ghost, or proposal keys', () => {
    const state = EditorState.create({
      doc: '月光',
      extensions: [
        paperSearch(),
        typewriterExtension({ enabled: true }),
        focusParagraphExtension(true),
      ],
    })
    expect(getTypewriterConfig(state).enabled).toBe(true)
    expect(isFocusParagraphEnabled(state)).toBe(true)
    expect(paperSearchKeymap.some((binding) => binding.key === 'Mod-f')).toBe(true)
    expect(paperSearchKeymap.some((binding) => binding.key === 'Mod-h')).toBe(true)
    expect(paperEscapePriority({ searchPanelFocused: true, completionActive: true })).toBe('close-search')
    expect(paperEscapePriority({ searchPanelFocused: false, completionActive: true })).toBe('cancel-completion')
  })
})
