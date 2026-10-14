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

import { Annotation, RangeSet, StateEffect, StateField, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state'
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

/** Shared with shell / overlay CSS so the header title and first line share an inset. */
export const PAPER_PAD_INLINE = '64px'
export const PAPER_PAD_BLOCK = '36px'

export const paperThemeSpec = {
  '&': {
    height: '100%',
    width: '100%',
    backgroundColor: 'transparent',
    color: 'var(--dsh-ui-text)',
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
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    /* In-document chrome (page header host) anchors inside the scroller. */
    position: 'relative',
  },
  '.cm-content': {
    padding: `calc(var(--paper-pad-block, ${PAPER_PAD_BLOCK}) + var(--paper-header-space, 0px)) var(--paper-pad-inline, ${PAPER_PAD_INLINE}) 32px`,
    caretColor: 'var(--dsh-ui-accent)',
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'var(--paper-max-width, none)',
    marginInline: 'auto',
    flexGrow: '2',
    minWidth: '0',
    textAlign: 'start',
  },
  '.cm-line': {
    paddingBottom: 'var(--paper-paragraph-spacing, 0em)',
    textAlign: 'start',
  },
  /* 页内页眉宿主：绝对定位贴文档起点，随内容滚走（不吸顶）。 */
  '.cm-paper-header-host': {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    height: 'var(--paper-header-space, 0px)',
    overflow: 'visible',
  },
}

export const paperTheme: Extension = EditorView.theme({
  ...paperThemeSpec,
  /* Non-current paragraphs stay secondary text only while typing.
     Blur removes .cm-focused, so those lines fall back to --dsh-ui-text.
     Color, not opacity: a line alpha would also fade links and quotes. */
  '&.cm-focused .cm-paper-dim': {
    color: 'var(--dsh-ui-muted)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dsh-ui-accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--dsh-ui-selected)',
  },
  '.cm-placeholder': {
    color: 'var(--dsh-ui-muted)',
  },
  /* Live-preview decorations. */
  /* 一级标题即章节标题（§4 修订）：display 字、26px、常规字重、居中，
     下方天头细线；二到四级保持无衬线 600。 */
  '.cm-lp-h1': {
    fontSize: 'var(--paper-h1-size, 26px)',
    fontWeight: 'var(--dsh-ui-weight-regular, 400)',
    fontFamily: 'var(--dsh-ui-font-display, var(--paper-font-family))',
    lineHeight: '1.5',
    textAlign: 'center',
    textIndent: '0',
    paddingBottom: '0.4em',
    borderBottom: '1px solid var(--dsh-ui-line)',
  },
  '.cm-lp-h2': { fontSize: 'var(--paper-h2-size, 1.35em)', fontWeight: 'var(--paper-heading-weight, 600)', lineHeight: '1.55' },
  '.cm-lp-h3': { fontSize: 'var(--paper-h3-size, 1.15em)', fontWeight: 'var(--paper-heading-weight, 600)', lineHeight: '1.6' },
  '.cm-lp-h4': { fontSize: 'var(--paper-h4-size, 1.05em)', fontWeight: 'var(--paper-heading-weight, 600)' },
  '.cm-lp-h5, .cm-lp-h6': { fontWeight: 'var(--paper-heading-weight, 600)' },
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-code': {
    fontFamily: 'var(--code-font-family)',
    fontSize: '0.88em',
    backgroundColor: 'var(--dsh-ui-hover)',
    borderRadius: '3px',
    padding: '0 3px',
  },
  '.cm-lp-mark': { color: 'var(--dsh-ui-muted)' },
  '.cm-lp-quote': {
    borderLeft: '3px solid var(--dsh-ui-line-strong)',
    paddingLeft: '12px',
    fontStyle: 'italic',
    color: 'var(--dsh-ui-muted)',
  },
  '.cm-lp-hr-line': { borderTop: '1px solid var(--dsh-ui-line-strong)' },
  '.cm-lp-hr': { color: 'transparent' },
  '.cm-lp-link': {
    color: 'var(--dsh-ui-accent)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    textDecorationThickness: 'from-font',
  },
  '.cm-lp-bullet': {
    color: 'var(--dsh-ui-muted)',
    marginInlineEnd: '0.15em',
  },
  '.cm-lp-task': {
    accentColor: 'var(--dsh-ui-accent)',
    cursor: 'pointer',
    verticalAlign: 'middle',
    marginInlineEnd: '0.15em',
    width: '0.95em',
    height: '0.95em',
  },
  /* FIM ghost inline widget. */
  '.cm-ghost': { color: 'var(--dsh-ui-faint)', whiteSpace: 'pre-wrap' },
  /* 正文段落：firstLineIndent 偏好映射为 --paper-first-indent（0 或 2em）。 */
  '.cm-lp-para': { textIndent: 'var(--paper-first-indent, 0)' },
  /* 分节符 / 中文小节号：居中、上下留白；不改文本。
     中文数字用 display 字；* ＊ ※ ◇ 是符号不是字，走 font-ui 并强制
     font-variant-emoji:text，否则 ※ 会被彩色 emoji 字形接管。 */
  '.cm-lp-section': {
    textAlign: 'center',
    textIndent: '0',
    fontSize: 'var(--paper-section-size, 18px)',
    paddingTop: '1em',
    paddingBottom: '1em',
  },
  '.cm-lp-section--cjk': {
    fontFamily: 'var(--dsh-ui-font-display, var(--paper-font-family))',
  },
  '.cm-lp-section--symbol': {
    fontFamily: 'var(--dsh-ui-font-ui, var(--paper-font-family))',
    fontVariantEmoji: 'text',
    color: 'var(--s-muted, var(--dsh-ui-muted))',
  },
  /* 段间空行（§4）：两个非空行之间的空行收为段距高；光标行恢复原行高。 */
  '.cm-lp-blank': {
    height: 'var(--paper-paragraph-spacing, 0.25em)',
    lineHeight: '0',
    paddingBottom: '0',
    overflow: 'hidden',
  },
})

/* Base syntax colors for markdown tokens the live preview leaves alone
 * (links, raw marks while editing). All token-driven. */
const paperHighlightStyle = HighlightStyle.define([
  { tag: [tags.processingInstruction, tags.punctuation, tags.contentSeparator], color: 'var(--dsh-ui-muted)' },
  { tag: tags.link, color: 'var(--dsh-ui-accent)' },
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

class BulletWidget extends WidgetType {
  override eq(other: BulletWidget): boolean {
    return other instanceof BulletWidget
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-lp-bullet'
    span.textContent = '•'
    return span
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  override eq(other: TaskWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'cm-lp-task'
    input.checked = this.checked
    input.setAttribute('aria-label', '待办')
    input.addEventListener('mousedown', (event) => {
      // Keep the caret where it is; the marker edit is a normal user change.
      event.preventDefault()
      const spec = toggleTaskMarker(view.state, view.posAtDOM(input))
      if (spec) view.dispatch(spec)
    })
    return input
  }
  override ignoreEvent(event: Event): boolean {
    return event.type === 'mousedown' || event.type === 'click'
  }
}

/**
 * Builds the transaction that flips the task marker at `pos` between `[ ]`
 * and `[x]`/`[X]`, or returns null when the text at `pos` is not a task
 * marker or editing is disabled. `pos` may sit anywhere inside the marker.
 */
export function toggleTaskMarker(state: EditorState, pos: number): TransactionSpec | null {
  if (state.readOnly || !state.facet(EditorView.editable)) return null
  for (let start = Math.max(0, pos - 3); start <= pos && start + 3 <= state.doc.length; start++) {
    const text = state.doc.sliceString(start, start + 3)
    if (text === '[ ]' || text === '[x]' || text === '[X]') {
      return {
        changes: { from: start + 1, to: start + 2, insert: text === '[ ]' ? 'x' : ' ' },
        userEvent: 'input',
      }
    }
  }
  return null
}

const bulletDeco = Decoration.replace({ widget: new BulletWidget() })
const paraLine = Decoration.line({ class: 'cm-lp-para' })
const sectionCjkLine = Decoration.line({ class: 'cm-lp-section cm-lp-section--cjk' })
const sectionSymbolLine = Decoration.line({ class: 'cm-lp-section cm-lp-section--symbol' })
const blankCollapsedLine = Decoration.line({ class: 'cm-lp-blank' })

/*
 * 分节符候选字符：中文数字与排版小节符号。段内允许空白（「※ ※ ※」），
 * 但去空白后不能为空，也不能混入其他文字。含小节符号时整体按 symbol
 * 渲染（font-ui + emoji 文本字形），纯中文数字才用 display 字。
 */
const SECTION_NUMERAL_CHARS = new Set([...'〇零一二三四五六七八九十百千万两'])
const SECTION_SYMBOL_CHARS = new Set(['*', '＊', '※', '◇'])
function sectionMarkKind(text: string): 'cjk' | 'symbol' | null {
  let seen = false
  let symbol = false
  for (const char of text) {
    if (char === ' ' || char === '\t' || char === '　') continue
    if (SECTION_SYMBOL_CHARS.has(char)) {
      symbol = true
      seen = true
      continue
    }
    if (!SECTION_NUMERAL_CHARS.has(char)) return null
    seen = true
  }
  return seen ? (symbol ? 'symbol' : 'cjk') : null
}

function listItemHasTask(item: { firstChild: { name: string; nextSibling: unknown } | null }): boolean {
  for (let child = item.firstChild; child; child = child.nextSibling as typeof child) {
    if (child.name === 'Task') return true
  }
  return false
}

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
  hasFocus?: boolean
}

export type LivePreviewOptions = {
  /** 分节符居中 live preview 装饰（写作偏好 centerSectionMarks）。 */
  centerSectionMarks?: boolean
}

export function buildLivePreview(view: LivePreviewHost, options: LivePreviewOptions = {}): DecorationSet {
  const centerSectionMarks = options.centerSectionMarks !== false
  const ranges: { from: number; to: number; deco: Decoration }[] = []
  const selection = view.state.selection
  /* Only a focused editor keeps the caret line raw: on blur the whole paper
   * renders as preview. Spec hosts omit hasFocus and keep raw-at-caret. */
  const focused = view.hasFocus !== false
  const active = (from: number, to: number) =>
    focused && selection.ranges.some((range) => range.from <= to && range.to >= from)
  const pushLineDeco = (from: number, deco: Decoration) => ranges.push({ from, to: from, deco })

  const windows = view.visibleRanges.length > 0 ? view.visibleRanges : [{ from: 0, to: view.state.doc.length }]
  for (const { from: vFrom, to: vTo } of windows) {
    syntaxTree(view.state).iterate({
      from: vFrom,
      to: vTo,
      enter(node) {
        const { name, from, to } = node
        if (name === 'Paragraph') {
          /* 顶层正文段落才参与首行缩进与分节符装饰；列表项、引用块、
             Setext 标题里的 Paragraph 一律跳过（父节点不是 Document）。 */
          if (node.node.parent?.name !== 'Document') return undefined
          const section = centerSectionMarks ? sectionMarkKind(view.state.doc.sliceString(from, to)) : null
          for (let pos = from; pos <= to; ) {
            const line = view.state.doc.lineAt(pos)
            const lineActive = active(line.from, line.to)
            /* 分节符：非光标行渲染为居中装饰；光标行显示原文
               （与标题规则一致，同时保留普通段落缩进类）。 */
            pushLineDeco(
              line.from,
              section && !lineActive ? (section === 'symbol' ? sectionSymbolLine : sectionCjkLine) : paraLine,
            )
            if (line.to >= to) break
            pos = line.to + 1
          }
          return undefined
        }
        if (name in headingLine) {
          const line = view.state.doc.lineAt(from)
          if (active(line.from, line.to)) return false
          pushLineDeco(line.from, headingLine[name]!)
          return undefined
        }
        if (name === 'HeaderMark') {
          // Only reached when the heading line itself is not active. Fold the
          // whitespace next to the mark into the hidden range so headings are
          // not visibly indented (`# t` -> `t`, `t ##` -> `t`).
          const line = view.state.doc.lineAt(from)
          const before = view.state.doc.sliceString(line.from, from)
          if (/^[ \t]*$/.test(before)) {
            let end = to
            while (end < line.to && /[ \t]/.test(view.state.doc.sliceString(end, end + 1))) end++
            ranges.push({ from, to: end, deco: hiddenMark })
          } else {
            let start = from
            while (start > line.from && /[ \t]/.test(view.state.doc.sliceString(start - 1, start))) start--
            ranges.push({ from: start, to, deco: hiddenMark })
          }
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
          ranges.push({ from, to, deco: hiddenMark })
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
          // Backticks vanish in preview; fenced ``` marks stay visible but faded.
          const parent = node.node.parent
          ranges.push({ from, to, deco: parent && parent.name === 'InlineCode' ? hiddenMark : fadedMark })
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
        if (name === 'QuoteMark') {
          const line = view.state.doc.lineAt(from)
          if (!active(line.from, line.to)) {
            let end = to
            if (end < line.to && view.state.doc.sliceString(end, end + 1) === ' ') end++
            ranges.push({ from, to: end, deco: hiddenMark })
          }
          return false
        }
        if (name === 'ListMark') {
          const line = view.state.doc.lineAt(from)
          if (active(line.from, line.to)) return false
          const item = node.node.parent
          const task = item ? listItemHasTask(item) : false
          if (task) {
            // `- [ ] t` -> `☐ t`: the dash and its spacing disappear.
            let end = to
            while (end < line.to && /[ \t]/.test(view.state.doc.sliceString(end, end + 1))) end++
            ranges.push({ from, to: end, deco: hiddenMark })
          } else if (item && item.parent && item.parent.name === 'BulletList') {
            ranges.push({ from, to, deco: bulletDeco })
          } else {
            ranges.push({ from, to, deco: fadedMark })
          }
          return false
        }
        if (name === 'TaskMarker') {
          const line = view.state.doc.lineAt(from)
          if (!active(line.from, line.to)) {
            const checked = /[xX]/.test(view.state.doc.sliceString(from + 1, from + 2))
            ranges.push({ from, to, deco: Decoration.replace({ widget: new TaskWidget(checked) }) })
          }
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
    /* 段间空行（§4）：夹在两个非空行之间的空行收为段距高；空行不进
       语法树，单独按行扫。光标落在空行上时不收（active 判空行 from==to
       仍然成立）。多个连续空行各自看相邻行，只有两端皆非空的才收。 */
    const first = view.state.doc.lineAt(Math.min(vFrom, view.state.doc.length))
    for (let number = first.number; number <= view.state.doc.lines; number += 1) {
      const line = view.state.doc.line(number)
      if (line.from > vTo) break
      if (line.text.trim() !== '' || active(line.from, line.to)) continue
      const prevNonBlank = line.number > 1 && view.state.doc.line(line.number - 1).text.trim() !== ''
      const nextNonBlank = line.number < view.state.doc.lines && view.state.doc.line(line.number + 1).text.trim() !== ''
      if (prevNonBlank && nextNonBlank) pushLineDeco(line.from, blankCollapsedLine)
    }
  }
  // RangeSet.of with sort=true accepts decorations collected in tree order
  // even when line decorations share a position with mark decorations.
  return RangeSet.of(ranges.map((r) => r.deco.range(r.from, r.to)), true)
}

export function livePreviewExtension(options: LivePreviewOptions = {}): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildLivePreview(view, options)
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.focusChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = buildLivePreview(update.view, options)
        }
      }
    },
    { decorations: (value) => value.decorations },
  )
}

export const livePreview: Extension = livePreviewExtension()

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
