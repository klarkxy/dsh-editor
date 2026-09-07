import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  SearchQuery,
  clampPaperRange,
  describeMatchCount,
  formatMatchCount,
  getSearchPanelMode,
  nextMatchRange,
  paperEscapePriority,
  paperSearch,
  paperSearchKeymap,
  prevMatchRange,
  replaceAllMatches,
  replaceCurrentOrNext,
  searchShortcut,
  setSearchPanelMode,
} from './editor-core/search.ts'

function editorState(doc: string, selection?: { anchor: number; head?: number }): EditorState {
  return EditorState.create({
    doc,
    selection: selection ? { anchor: selection.anchor, head: selection.head ?? selection.anchor } : undefined,
    extensions: [paperSearch()],
  })
}

describe('paper search shortcuts', () => {
  it('opens find on Ctrl+F and replace on Ctrl+H', () => {
    expect(searchShortcut({ key: 'f', ctrlKey: true, shiftKey: false })).toEqual({ type: 'open', mode: 'find' })
    expect(searchShortcut({ key: 'F', ctrlKey: true, shiftKey: false })).toEqual({ type: 'open', mode: 'find' })
    expect(searchShortcut({ key: 'h', ctrlKey: true, shiftKey: false })).toEqual({ type: 'open', mode: 'replace' })
    expect(searchShortcut({ key: 'h', metaKey: true, ctrlKey: false, shiftKey: false })).toEqual({ type: 'open', mode: 'replace' })
  })

  it('maps panel keys for next, previous, and close', () => {
    expect(searchShortcut({ key: 'Enter', ctrlKey: false, shiftKey: false })).toEqual({ type: 'next' })
    expect(searchShortcut({ key: 'Enter', ctrlKey: false, shiftKey: true })).toEqual({ type: 'prev' })
    expect(searchShortcut({ key: 'Escape', ctrlKey: false, shiftKey: false })).toEqual({ type: 'close' })
  })

  it('does not steal completion or rewrite shortcuts', () => {
    expect(searchShortcut({ key: 'Tab', ctrlKey: false, shiftKey: false })).toBeNull()
    expect(searchShortcut({ key: 'Enter', ctrlKey: true, shiftKey: false })).toBeNull()
    expect(searchShortcut({ key: 's', ctrlKey: true, shiftKey: false })).toBeNull()
  })

  it('binds Mod-f / Mod-h to the matching panel mode', () => {
    const find = paperSearchKeymap.find((binding) => binding.key === 'Mod-f')
    const replace = paperSearchKeymap.find((binding) => binding.key === 'Mod-h')
    expect(find?.run).toBeTruthy()
    expect(replace?.run).toBeTruthy()

    const state = editorState('月光')
    expect(getSearchPanelMode(state)).toBe('find')
    expect(getSearchPanelMode(state.update({ effects: setSearchPanelMode.of('replace') }).state)).toBe('replace')
    expect(getSearchPanelMode(state.update({ effects: setSearchPanelMode.of('find') }).state)).toBe('find')
  })
})

describe('paper search matches', () => {
  it('counts matches and reports the selected index', () => {
    const query = new SearchQuery({ search: '月光', literal: true })
    const idle = editorState('月光落在船舷上，月光再次出现，月光')
    expect(describeMatchCount(idle, query)).toEqual({ current: 0, total: 3 })
    expect(formatMatchCount(describeMatchCount(idle, query))).toBe('0 / 3')

    const onSecond = editorState('月光落在船舷上，月光再次出现，月光', { anchor: 8, head: 10 })
    expect(formatMatchCount(describeMatchCount(onSecond, query))).toBe('2 / 3')
  })

  it('finds next and previous matches with wrap-around', () => {
    const query = new SearchQuery({ search: '月光', literal: true })
    const state = editorState('月光落在船舷上，月光再次出现，月光')
    const first = nextMatchRange(state, query, 0)
    const second = nextMatchRange(state, query, first!.to)
    const third = nextMatchRange(state, query, second!.to)
    const wrappedNext = nextMatchRange(state, query, third!.to)
    expect(first).toEqual({ from: 0, to: 2 })
    expect(second).toEqual({ from: 8, to: 10 })
    expect(third).toEqual({ from: 15, to: 17 })
    expect(wrappedNext).toEqual(first)

    expect(prevMatchRange(state, query, first!.from)).toEqual(third)
    expect(prevMatchRange(state, query, second!.from)).toEqual(first)
    expect(prevMatchRange(state, query, third!.from)).toEqual(second)
  })

  it('respects case-sensitive and whole-word queries', () => {
    const state = editorState('Moon moonlight MOON')
    expect(describeMatchCount(state, new SearchQuery({ search: 'moon', literal: true })).total).toBe(3)
    expect(describeMatchCount(state, new SearchQuery({ search: 'moon', literal: true, caseSensitive: true })).total).toBe(1)
    expect(describeMatchCount(state, new SearchQuery({ search: 'Moon', literal: true, wholeWord: true })).total).toBe(2)
  })
})

describe('paper search replace', () => {
  it('replaces the current match and then the next one', () => {
    const query = new SearchQuery({ search: '月光', replace: '星光', literal: true })
    const selected = editorState('月光落在船舷上，月光再次出现', { anchor: 0, head: 2 })
    const once = replaceCurrentOrNext(selected, query)
    expect(once.doc.toString()).toBe('星光落在船舷上，月光再次出现')
    const twice = replaceCurrentOrNext(once, query)
    expect(twice.doc.toString()).toBe('星光落在船舷上，星光再次出现')
  })

  it('replaces every match in one transaction', () => {
    const query = new SearchQuery({ search: '月光', replace: '星光', literal: true })
    const state = editorState('月光落在船舷上，月光再次出现，月光')
    expect(replaceAllMatches(state, query).doc.toString()).toBe('星光落在船舷上，星光再次出现，星光')
  })
})

describe('paper search escape vs completion', () => {
  it('closes the find bar on Esc before touching completion state', () => {
    expect(paperEscapePriority({ searchPanelFocused: true, completionActive: true })).toBe('close-search')
    expect(paperEscapePriority({ searchPanelFocused: true, completionActive: false })).toBe('close-search')
    expect(paperEscapePriority({ searchPanelFocused: false, completionActive: true })).toBe('cancel-completion')
    expect(paperEscapePriority({ searchPanelFocused: false, completionActive: false })).toBeNull()
  })
})

describe('revealRange mapping', () => {
  it('converts an absolute file range onto the projected paper', () => {
    expect(clampPaperRange(20, 0, 4, 9)).toEqual({ from: 4, to: 9 })
    expect(clampPaperRange(20, 10, 12, 18)).toEqual({ from: 2, to: 8 })
    expect(clampPaperRange(20, 10, 0, 4)).toEqual({ from: 0, to: 0 })
    expect(clampPaperRange(20, 0, 18, 40)).toEqual({ from: 18, to: 20 })
  })
})
