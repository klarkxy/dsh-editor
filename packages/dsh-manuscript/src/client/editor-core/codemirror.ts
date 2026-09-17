/*
 * CodeMirror 6 building blocks for the editor-core paper surface.
 *
 * Everything here is React-free so editor.tsx can mount a single EditorView
 * and drive it through effects/dispatches:
 *
 * - `paperTheme` ports the old textarea typography (serif 17/1.9, 36/64
 *   padding, accent caret) into an EditorView.theme, all colors via the
 *   design-token CSS vars so light/dark themes keep working.
 * - `livePreview` is the Typora-style renderer: a ViewPlugin that walks the
 *   lezer markdown syntax tree over the visible ranges and decorates
 *   headings / links / emphasis / code / quotes / list marks — except on
 *   ranges the selection touches, which stay raw source.
 * - `ghostField` + `setGhostEffect` render the FIM ghost as an inline widget
 *   at a document position, replacing the old absolutely-positioned mirror
 *   div (whose padding/font had to match the textarea character-for-character).
 * - `externalSync` annotates transactions that replace the whole document
 *   from React state, so the updateListener in editor.tsx does not echo
 *   them back as user edits.
 */

import { Annotation, RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { defineLanguageFacet, HighlightStyle, Language, LanguageSupport, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { Emoji, GFM, Subscript, Superscript, parser as lezerMarkdownParser } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

/* Markdown language assembled directly from @lezer/markdown. We deliberately
 * do NOT use @codemirror/lang-markdown: that package statically constructs
 * an html() language at module scope, which drags @codemirror/autocomplete,
 * @codemirror/lint and the css/js/html language packages (~600 kB) into the
 * client bundle. The lezer parser provides the same syntax nodes
 * (ATXHeading*, Emphasis, InlineCode, Blockquote, ListMark…) that the live
 * preview below consumes. */
const markdownLanguage = new Language(
  defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } }),
  lezerMarkdownParser.configure([GFM, Subscript, Superscript, Emoji]),
  [],
  'markdown',
)
export const paperMarkdown: Extension = new LanguageSupport(markdownLanguage)

/** Marks full-document replacements pushed from React state (load, discard,
 *  ghost/patch accept). The update listener skips `setText` for these. */
export const externalSync = Annotation.define<boolean>()

/* ── Theme ─────────────────────────────────────────────────────────── */

export const paperTheme: Extension = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--gray-12)',
    fontWeight: '400',
    fontSize: 'var(--paper-font-size)',
    lineHeight: 'var(--paper-line-height, var(--leading-body, 1.9))',
    fontFamily: 'var(--paper-font-family, var(--default-font-family))',
    letterSpacing: '.03em',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-content': {
    padding: '36px 64px 32px',
    caretColor: 'var(--accent-9)',
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'var(--paper-max-width, none)',
    marginInline: 'auto',
  },
  '.cm-line': {
    paddingBottom: 'var(--paper-paragraph-spacing, 0em)',
  },
  '.cm-paper-dim': {
    opacity: 'var(--paper-dim-opacity, 0.35)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-9)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--accent-a4)',
  },
  '.cm-placeholder': {
    color: 'var(--gray-10)',
    fontStyle: 'italic',
  },
  /* Live-preview decorations. */
  '.cm-lp-h1': { fontSize: '1.9em', fontWeight: '700', lineHeight: '1.5' },
  '.cm-lp-h2': { fontSize: '1.5em', fontWeight: '700', lineHeight: '1.55' },
  '.cm-lp-h3': { fontSize: '1.25em', fontWeight: '700', lineHeight: '1.6' },
  '.cm-lp-h4': { fontSize: '1.1em', fontWeight: '700' },
  '.cm-lp-h5, .cm-lp-h6': { fontWeight: '700' },
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-code': {
    fontFamily: 'var(--code-font-family)',
    fontSize: '0.88em',
    backgroundColor: 'var(--gray-a3)',
    borderRadius: '3px',
    padding: '0 3px',
  },
  '.cm-lp-mark': { color: 'var(--gray-10)' },
  '.cm-lp-quote': {
    borderLeft: '3px solid var(--gray-6)',
    paddingLeft: '12px',
    fontStyle: 'italic',
    color: 'var(--gray-11)',
  },
  '.cm-lp-hr-line': { borderTop: '1px solid var(--gray-6)' },
  '.cm-lp-hr': { color: 'transparent' },
  '.cm-lp-link': {
    color: 'var(--accent-11)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    textDecorationThickness: 'from-font',
  },
  /* FIM ghost inline widget. */
  '.cm-ghost': { color: 'var(--gray-9)', whiteSpace: 'pre-wrap' },
})

/* Base syntax colors for markdown tokens the live preview leaves alone
 * (links, raw marks while editing). All token-driven. */
const paperHighlightStyle = HighlightStyle.define([
  { tag: [tags.processingInstruction, tags.punctuation, tags.contentSeparator], color: 'var(--gray-10)' },
  { tag: tags.link, color: 'var(--accent-11)' },
  { tag: tags.monospace, fontFamily: 'var(--code-font-family)' },
])

export const paperHighlight: Extension = syntaxHighlighting(paperHighlightStyle)

/* ── Live preview ──────────────────────────────────────────────────── */

const headingLine: Record<string, Decoration> = {
  ATXHeading1: Decoration.line({ class: 'cm-lp-h1' }),
  ATXHeading2: Decoration.line({ class: 'cm-lp-h2' }),
  ATXHeading3: Decoration.line({ class: 'cm-lp-h3' }),
  ATXHeading4: Decoration.line({ class: 'cm-lp-h4' }),
  ATXHeading5: Decoration.line({ class: 'cm-lp-h5' }),
  ATXHeading6: Decoration.line({ class: 'cm-lp-h6' }),
  SetextHeading1: Decoration.line({ class: 'cm-lp-h1' }),
  SetextHeading2: Decoration.line({ class: 'cm-lp-h2' }),
}
const hiddenMark = Decoration.replace({})
const fadedMark = Decoration.mark({ class: 'cm-lp-mark' })
const strongMark = Decoration.mark({ class: 'cm-lp-strong' })
const emMark = Decoration.mark({ class: 'cm-lp-em' })
const codeMark = Decoration.mark({ class: 'cm-lp-code' })
const linkMark = Decoration.mark({ class: 'cm-lp-link' })
const quoteLine = Decoration.line({ class: 'cm-lp-quote' })
const hrLine = Decoration.line({ class: 'cm-lp-hr-line' })
const hrText = Decoration.mark({ class: 'cm-lp-hr' })

const LINK_SYNTAX = new Set(['LinkMark', 'URL', 'LinkTitle', 'LinkLabel'])

type PreviewRange = { from: number; to: number; deco: Decoration }

function hideInlineLink(node: { firstChild: { name: string; from: number; to: number; nextSibling: unknown } | null }, ranges: PreviewRange[]): void {
  const children: Array<{ name: string; from: number; to: number }> = []
  for (let child = node.firstChild; child; child = child.nextSibling as typeof child) {
    children.push({ name: child.name, from: child.from, to: child.to })
  }
  if (children.length === 0) return
  const open = children[0]!
  let closeBracket: (typeof children)[number] | undefined
  if (open.name === 'LinkMark') {
    for (let index = 1; index < children.length; index++) {
      if (children[index]!.name === 'LinkMark') {
        closeBracket = children[index]
        break
      }
    }
  }
  if (closeBracket && open.to < closeBracket.from) {
    ranges.push({ from: open.to, to: closeBracket.from, deco: linkMark })
  }
  for (const child of children) {
    if (!LINK_SYNTAX.has(child.name) || child.from >= child.to) continue
    if (closeBracket && child.from >= open.to && child.from < closeBracket.from) continue
    ranges.push({ from: child.from, to: child.to, deco: hiddenMark })
  }
}

export type LivePreviewHost = {
  state: EditorState
  visibleRanges: readonly { from: number; to: number }[]
}

export function buildLivePreview(view: LivePreviewHost): DecorationSet {
  const ranges: { from: number; to: number; deco: Decoration }[] = []
  const selection = view.state.selection
  const active = (from: number, to: number) =>
    selection.ranges.some((range) => range.from <= to && range.to >= from)
  const pushLineDeco = (from: number, deco: Decoration) => ranges.push({ from, to: from, deco })

  const windows = view.visibleRanges.length > 0 ? view.visibleRanges : [{ from: 0, to: view.state.doc.length }]
  for (const { from: vFrom, to: vTo } of windows) {
    syntaxTree(view.state).iterate({
      from: vFrom,
      to: vTo,
      enter(node) {
        const { name, from, to } = node
        if (name in headingLine) {
          const line = view.state.doc.lineAt(from)
          if (active(line.from, line.to)) return false
          pushLineDeco(line.from, headingLine[name]!)
          return undefined
        }
        if (name === 'HeaderMark') {
          // Only reached when the heading line itself is not active.
          ranges.push({ from, to, deco: hiddenMark })
          return false
        }
        if (name === 'Link' || name === 'Image') {
          if (active(from, to)) return false
          hideInlineLink(node.node, ranges)
          return false
        }
        if (name === 'Autolink') {
          if (active(from, to)) return false
          ranges.push({ from, to, deco: linkMark })
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'LinkMark' && child.from < child.to) ranges.push({ from: child.from, to: child.to, deco: hiddenMark })
          }
          return false
        }
        if (name === 'StrongEmphasis' || name === 'Emphasis') {
          if (active(from, to)) return false
          ranges.push({ from, to, deco: name === 'StrongEmphasis' ? strongMark : emMark })
          return undefined
        }
        if (name === 'EmphasisMark') {
          ranges.push({ from, to, deco: fadedMark })
          return false
        }
        if (name === 'InlineCode') {
          if (active(from, to)) return false
          return undefined
        }
        if (name === 'CodeText') {
          ranges.push({ from, to, deco: codeMark })
          return false
        }
        if (name === 'CodeMark') {
          ranges.push({ from, to, deco: fadedMark })
          return false
        }
        if (name === 'Blockquote') {
          for (let pos = from; pos <= to; ) {
            const line = view.state.doc.lineAt(pos)
            if (!active(line.from, line.to)) pushLineDeco(line.from, quoteLine)
            if (line.to >= to) break
            pos = line.to + 1
          }
          return undefined
        }
        if (name === 'QuoteMark' || name === 'ListMark') {
          const line = view.state.doc.lineAt(from)
          if (!active(line.from, line.to)) ranges.push({ from, to, deco: fadedMark })
          return false
        }
        if (name === 'HorizontalRule') {
          const line = view.state.doc.lineAt(from)
          if (active(line.from, line.to)) return false
          pushLineDeco(line.from, hrLine)
          ranges.push({ from, to, deco: hrText })
          return false
        }
        return undefined
      },
    })
  }
  // RangeSet.of with sort=true accepts decorations collected in tree order
  // even when line decorations share a position with mark decorations.
  return RangeSet.of(ranges.map((r) => r.deco.range(r.from, r.to)), true)
}

export const livePreview: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildLivePreview(view)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildLivePreview(update.view)
      }
    }
  },
  { decorations: (value) => value.decorations },
)

/* ── Ghost widget ──────────────────────────────────────────────────── */

export type GhostDecorationValue = {
  at: number
  text: string
  testId: string
  className?: string
}

export const setGhostEffect = StateEffect.define<GhostDecorationValue | null>()

class GhostWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly testId: string,
    readonly className?: string,
  ) {
    super()
  }
  override eq(other: GhostWidget): boolean {
    return other.text === this.text && other.testId === this.testId && other.className === this.className
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = ['cm-ghost', this.className].filter(Boolean).join(' ')
    span.setAttribute('data-testid', this.testId)
    span.textContent = this.text
    return span
  }
  override ignoreEvent(): boolean {
    return true
  }
}

export const ghostField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    decorations = decorations.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setGhostEffect)) {
        decorations = effect.value
          ? Decoration.set([
            Decoration.widget({
              widget: new GhostWidget(effect.value.text, effect.value.testId, effect.value.className),
              side: 1,
            }).range(effect.value.at),
          ])
          : Decoration.none
      }
    }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})
