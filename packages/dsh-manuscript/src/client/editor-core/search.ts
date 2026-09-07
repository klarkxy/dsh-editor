/*
 * In-document find / replace for the paper EditorView.
 *
 * Built on `@codemirror/search` (`search`, `SearchQuery`, `findNext` /
 * `findPrevious`, `replaceNext` / `replaceAll`) with a custom Chinese
 * panel so the default English form is never shown. Replacements are
 * ordinary CM transactions (`userEvent: input.replace*`); editor.tsx's
 * update listener feeds them through `setText`, so autosave and
 * version / conflict checks stay on the same path as typing.
 */

import { EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  runScopeHandlers,
  type Command,
  type KeyBinding,
  type Panel,
  type ViewUpdate,
} from '@codemirror/view'
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search'

export type SearchPanelMode = 'find' | 'replace'

export type SearchShortcutAction =
  | { type: 'open'; mode: SearchPanelMode }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'close' }

export type PaperEscapeAction = 'close-search' | 'cancel-completion'

/** Ctrl+F opens find, Ctrl+H opens replace; Enter / Shift+Enter / Esc are panel keys. */
export function searchShortcut(input: {
  key: string
  ctrlKey: boolean
  metaKey?: boolean
  shiftKey: boolean
  altKey?: boolean
}): SearchShortcutAction | null {
  const mod = input.ctrlKey || Boolean(input.metaKey)
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
  if (mod && !input.altKey && !input.shiftKey) {
    if (key === 'f') return { type: 'open', mode: 'find' }
    if (key === 'h') return { type: 'open', mode: 'replace' }
  }
  if (mod || input.altKey) return null
  if (key === 'Enter') return input.shiftKey ? { type: 'prev' } : { type: 'next' }
  if (key === 'Escape') return { type: 'close' }
  return null
}

/**
 * Esc closes a focused find bar before ghost / proposal cancellation.
 * When the bar is open but the editor has focus, completion still wins.
 */
export function paperEscapePriority(input: {
  searchPanelFocused: boolean
  completionActive: boolean
}): PaperEscapeAction | null {
  if (input.searchPanelFocused) return 'close-search'
  if (input.completionActive) return 'cancel-completion'
  return null
}

export const setSearchPanelMode = StateEffect.define<SearchPanelMode>()

const searchPanelModeField = StateField.define<SearchPanelMode>({
  create: () => 'find',
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchPanelMode)) return effect.value
    }
    return value
  },
})

export function getSearchPanelMode(state: EditorState): SearchPanelMode {
  return state.field(searchPanelModeField, false) ?? 'find'
}

export function collectSearchMatches(state: EditorState, query: SearchQuery): { from: number; to: number }[] {
  if (!query.valid) return []
  const matches: { from: number; to: number }[] = []
  const cursor = query.getCursor(state)
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    matches.push({ from: step.value.from, to: step.value.to })
  }
  return matches
}

export function describeMatchCount(state: EditorState, query: SearchQuery): { current: number; total: number } {
  const matches = collectSearchMatches(state, query)
  const sel = state.selection.main
  const current = matches.findIndex((match) => match.from === sel.from && match.to === sel.to)
  return { current: current >= 0 ? current + 1 : 0, total: matches.length }
}

export function formatMatchCount(count: { current: number; total: number }): string {
  return `${count.current} / ${count.total}`
}

/** Next match after `from`, wrapping to the first match. */
export function nextMatchRange(state: EditorState, query: SearchQuery, from: number): { from: number; to: number } | null {
  const matches = collectSearchMatches(state, query)
  if (matches.length === 0) return null
  return matches.find((match) => match.from >= from && match.to > from) ?? matches[0]!
}

/** Previous match before `from`, wrapping to the last match. */
export function prevMatchRange(state: EditorState, query: SearchQuery, from: number): { from: number; to: number } | null {
  const matches = collectSearchMatches(state, query)
  if (matches.length === 0) return null
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index]!.from < from) return matches[index]!
  }
  return matches[matches.length - 1]!
}

export function replaceCurrentOrNext(state: EditorState, query: SearchQuery): EditorState {
  if (!query.valid) return state
  const sel = state.selection.main
  const matches = collectSearchMatches(state, query)
  const current = matches.find((match) => match.from === sel.from && match.to === sel.to)
  const target = current ?? nextMatchRange(state, query, sel.from)
  if (!target) return state
  return state.update({
    changes: { from: target.from, to: target.to, insert: query.replace },
  }).state
}

export function replaceAllMatches(state: EditorState, query: SearchQuery): EditorState {
  if (!query.valid) return state
  const changes = collectSearchMatches(state, query).map((match) => ({
    from: match.from,
    to: match.to,
    insert: query.replace,
  }))
  if (changes.length === 0) return state
  return state.update({ changes }).state
}

/** Map an absolute file range onto the projected paper document. */
export function clampPaperRange(docLength: number, paperOffset: number, start: number, end: number): { from: number; to: number } {
  const rawFrom = Math.min(start, end) - paperOffset
  const rawTo = Math.max(start, end) - paperOffset
  const from = Math.max(0, Math.min(docLength, rawFrom))
  const to = Math.max(0, Math.min(docLength, rawTo))
  return { from, to }
}

/** Select and scroll an absolute document range on the open paper. */
export function revealEditorRange(view: EditorView, paperOffset: number, start: number, end: number): void {
  const { from, to } = clampPaperRange(view.state.doc.length, paperOffset, start, end)
  view.dispatch({
    selection: EditorSelection.single(from, to),
    scrollIntoView: true,
  })
  view.focus()
}

export function isPaperSearchPanelFocused(view: EditorView): boolean {
  const panel = view.dom.querySelector('.cm-paper-search')
  const active = view.root.activeElement
  return Boolean(panel && active && panel.contains(active))
}

export function closeSearchPanelIfFocused(view: EditorView): boolean {
  if (!isPaperSearchPanelFocused(view)) return false
  return closeSearchPanel(view)
}

function openPaperSearch(mode: SearchPanelMode): Command {
  return (view) => {
    if (getSearchPanelMode(view.state) !== mode) {
      view.dispatch({ effects: setSearchPanelMode.of(mode) })
    }
    return openSearchPanel(view)
  }
}

export const openFindPanel = openPaperSearch('find')
export const openReplacePanel = openPaperSearch('replace')

export const paperSearchKeymap: readonly KeyBinding[] = [
  { key: 'Mod-f', run: openFindPanel, preventDefault: true, scope: 'editor search-panel' },
  { key: 'Mod-h', run: openReplacePanel, preventDefault: true, scope: 'editor search-panel' },
  { key: 'F3', run: findNext, shift: findPrevious, preventDefault: true, scope: 'editor search-panel' },
  { key: 'Mod-g', run: findNext, shift: findPrevious, preventDefault: true, scope: 'editor search-panel' },
]

const paperSearchTheme = EditorView.theme({
  '.cm-panels': {
    backgroundColor: 'var(--surface, inherit)',
    color: 'var(--fg, inherit)',
    borderColor: 'var(--border-soft, var(--border, #ccc))',
  },
  '.cm-panels-top': {
    borderBottom: '1px solid var(--border-soft, var(--border, #ccc))',
  },
  '.cm-paper-search': {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px 12px',
    backgroundColor: 'var(--surface, inherit)',
    color: 'var(--fg, inherit)',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    fontSize: 'var(--text-sm, 12px)',
    letterSpacing: '.04em',
  },
  '.cm-paper-search-row': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
  },
  '.cm-paper-search input': {
    minWidth: '10em',
    flex: '1 1 10em',
    minHeight: '28px',
    padding: '4px 8px',
    border: '1px solid var(--border, #ccc)',
    borderRadius: '4px',
    backgroundColor: 'var(--bg, inherit)',
    color: 'var(--fg, inherit)',
    font: '400 var(--text-sm, 12px)/1.4 var(--font-sans, system-ui, sans-serif)',
  },
  '.cm-paper-search input:focus': {
    outline: 'none',
    boxShadow: 'var(--focus-ring, 0 0 0 2px var(--accent-active, #142a48))',
  },
  '.cm-paper-search button': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '28px',
    padding: '4px 10px',
    border: 0,
    borderRadius: '4px',
    background: 'transparent',
    boxShadow: 'var(--elev-ring, 0 0 0 1px var(--border, #ccc))',
    color: 'var(--fg-2, inherit)',
    font: '500 var(--text-xs, 11px)/1 var(--font-sans, system-ui, sans-serif)',
    letterSpacing: '.08em',
    cursor: 'pointer',
  },
  '.cm-paper-search button:hover': {
    backgroundColor: 'var(--bg, rgba(127, 127, 127, 0.08))',
    color: 'var(--fg, inherit)',
  },
  '.cm-paper-search button[aria-pressed="true"]': {
    backgroundColor: 'var(--surface-warm, rgba(127, 127, 127, 0.12))',
    color: 'var(--accent, inherit)',
  },
  '.cm-paper-search-count': {
    minWidth: '4.5em',
    color: 'var(--meta, #888)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
  },
  '.cm-paper-search [name="close"]': {
    minWidth: '28px',
    padding: '4px 8px',
    color: 'var(--meta, #888)',
  },
})

const paperSearchMatchTheme = EditorView.baseTheme({
  '&light .cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent, #1b365d) 22%, transparent)',
  },
  '&dark .cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent, #1b365d) 22%, transparent)',
  },
  '&light .cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent, #1b365d) 40%, transparent)',
  },
  '&dark .cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent, #1b365d) 40%, transparent)',
  },
  '&light .cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent, #1b365d) 12%, transparent)',
  },
  '&dark .cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent, #1b365d) 12%, transparent)',
  },
})

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> | null,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined) node.setAttribute(key, value)
    }
  }
  for (const child of children) node.append(child)
  return node
}

function createPaperSearchPanel(view: EditorView): Panel {
  const query = getSearchQuery(view.state)
  let caseSensitive = query.caseSensitive
  let wholeWord = query.wholeWord

  const searchField = createElement('input', {
    type: 'text',
    name: 'search',
    placeholder: '查找',
    'aria-label': '查找',
    'data-testid': 'paper-search-query',
    'main-field': 'true',
    autocomplete: 'off',
    spellcheck: 'false',
  })
  searchField.value = query.search

  const replaceField = createElement('input', {
    type: 'text',
    name: 'replace',
    placeholder: '替换为',
    'aria-label': '替换为',
    'data-testid': 'paper-search-replace',
    autocomplete: 'off',
    spellcheck: 'false',
  })
  replaceField.value = query.replace

  const count = createElement('span', {
    class: 'cm-paper-search-count',
    'data-testid': 'paper-search-count',
  }, formatMatchCount(describeMatchCount(view.state, query)))

  const caseButton = createElement('button', {
    type: 'button',
    name: 'case',
    title: '区分大小写',
    'aria-label': '区分大小写',
    'data-testid': 'paper-search-case',
    'aria-pressed': caseSensitive ? 'true' : 'false',
  }, 'Aa')

  const wordButton = createElement('button', {
    type: 'button',
    name: 'word',
    title: '全词匹配',
    'aria-label': '全词匹配',
    'data-testid': 'paper-search-word',
    'aria-pressed': wholeWord ? 'true' : 'false',
  }, '词')

  const replaceRow = createElement('div', { class: 'cm-paper-search-row cm-paper-search-replace' },
    replaceField,
    createElement('button', { type: 'button', name: 'replace', 'data-testid': 'paper-search-replace-one' }, '替换'),
    createElement('button', { type: 'button', name: 'replaceAll', 'data-testid': 'paper-search-replace-all' }, '全部替换'),
  )

  const dom = createElement('div', {
    class: 'cm-paper-search',
    role: 'search',
    'aria-label': '在本文中查找',
    'data-testid': 'paper-search',
  },
    createElement('div', { class: 'cm-paper-search-row' },
      searchField,
      count,
      createElement('button', { type: 'button', name: 'prev', title: '上一处', 'aria-label': '上一处', 'data-testid': 'paper-search-prev' }, '上一处'),
      createElement('button', { type: 'button', name: 'next', title: '下一处', 'aria-label': '下一处', 'data-testid': 'paper-search-next' }, '下一处'),
      caseButton,
      wordButton,
      createElement('button', { type: 'button', name: 'close', title: '关闭', 'aria-label': '关闭', 'data-testid': 'paper-search-close' }, '×'),
    ),
    replaceRow,
  )

  const syncMode = (mode: SearchPanelMode) => {
    dom.dataset.mode = mode
    replaceRow.hidden = mode !== 'replace'
  }
  syncMode(getSearchPanelMode(view.state))

  const commit = () => {
    const next = new SearchQuery({
      search: searchField.value,
      replace: replaceField.value,
      caseSensitive,
      wholeWord,
      literal: true,
    })
    if (!next.eq(getSearchQuery(view.state))) {
      view.dispatch({ effects: setSearchQuery.of(next) })
    }
  }

  searchField.addEventListener('input', commit)
  replaceField.addEventListener('input', commit)
  caseButton.addEventListener('click', () => {
    caseSensitive = !caseSensitive
    caseButton.setAttribute('aria-pressed', caseSensitive ? 'true' : 'false')
    commit()
  })
  wordButton.addEventListener('click', () => {
    wholeWord = !wholeWord
    wordButton.setAttribute('aria-pressed', wholeWord ? 'true' : 'false')
    commit()
  })
  dom.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest('button')
    if (!button || !dom.contains(button)) return
    if (button.name === 'next') findNext(view)
    else if (button.name === 'prev') findPrevious(view)
    else if (button.name === 'replace') replaceNext(view)
    else if (button.name === 'replaceAll') replaceAll(view)
    else if (button.name === 'close') closeSearchPanel(view)
  })
  dom.addEventListener('keydown', (event) => {
    if (runScopeHandlers(view, event, 'search-panel')) {
      event.preventDefault()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeSearchPanel(view)
      return
    }
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) findPrevious(view)
      else findNext(view)
      return
    }
    if (event.key === 'Tab') {
      event.stopPropagation()
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.stopPropagation()
    }
  })

  return {
    dom,
    top: true,
    mount() {
      searchField.focus()
      searchField.select()
    },
    update(update: ViewUpdate) {
      syncMode(getSearchPanelMode(update.state))
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) {
            const next = effect.value
            if (searchField.value !== next.search) searchField.value = next.search
            if (replaceField.value !== next.replace) replaceField.value = next.replace
            caseSensitive = next.caseSensitive
            wholeWord = next.wholeWord
            caseButton.setAttribute('aria-pressed', caseSensitive ? 'true' : 'false')
            wordButton.setAttribute('aria-pressed', wholeWord ? 'true' : 'false')
          }
        }
      }
      count.textContent = formatMatchCount(describeMatchCount(update.state, getSearchQuery(update.state)))
    },
  }
}

export function paperSearch(): Extension {
  return [
    searchPanelModeField,
    search({
      top: true,
      literal: true,
      createPanel: createPaperSearchPanel,
    }),
    highlightSelectionMatches(),
    paperSearchTheme,
    paperSearchMatchTheme,
    Prec.high(keymap.of(paperSearchKeymap)),
  ]
}

export { searchPanelOpen, closeSearchPanel, findNext, findPrevious, replaceNext, replaceAll, SearchQuery, setSearchQuery, getSearchQuery }
