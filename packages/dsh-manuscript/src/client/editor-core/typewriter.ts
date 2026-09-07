/*
 * Typewriter scrolling and focus-paragraph dimming for the paper EditorView.
 *
 * Both features are Compartment-friendly: pass `{ enabled: false }` /
 * `focusParagraphExtension(false)` to turn them off without dropping the
 * facet, then `compartment.reconfigure(...)` to toggle at runtime.
 *
 * Typewriter recenters only on document or selection changes — never on
 * scroll / wheel — so it does not fight the reader. Focus-paragraph uses
 * line decorations and does not install keymaps (Tab / Esc / Ctrl+Enter /
 * Ctrl+F stay with ghost, proposal, and the find bar).
 */

import { EditorState, Facet, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

export type TypewriterOptions = {
  enabled?: boolean
  /** Vertical caret placement in the viewport; 0 = top, 1 = bottom. */
  ratio?: number
}

export type TypewriterConfig = {
  enabled: boolean
  ratio: number
}

export const DEFAULT_TYPEWRITER_RATIO = 0.5

export function clampTypewriterRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_TYPEWRITER_RATIO
  return Math.min(1, Math.max(0, ratio))
}

export function resolveTypewriterOptions(options: TypewriterOptions = {}): TypewriterConfig {
  return {
    enabled: options.enabled ?? true,
    ratio: options.ratio == null ? DEFAULT_TYPEWRITER_RATIO : clampTypewriterRatio(options.ratio),
  }
}

export const typewriterConfig = Facet.define<TypewriterConfig, TypewriterConfig>({
  combine(values) {
    return values[values.length - 1] ?? { enabled: false, ratio: DEFAULT_TYPEWRITER_RATIO }
  },
})

export function getTypewriterConfig(state: EditorState): TypewriterConfig {
  return state.facet(typewriterConfig)
}

/** Recenter only when the user typed or moved the caret — not on wheel/scroll. */
export function shouldRecenterTypewriter(update: {
  docChanged: boolean
  selectionSet: boolean
}): boolean {
  return update.docChanged || update.selectionSet
}

export function typewriterScrollTop(input: {
  lineTop: number
  lineHeight: number
  viewportHeight: number
  ratio: number
  maxScroll?: number
}): number {
  const ratio = clampTypewriterRatio(input.ratio)
  const target = input.lineTop + input.lineHeight / 2 - input.viewportHeight * ratio
  const top = Math.max(0, target)
  if (input.maxScroll == null) return top
  return Math.min(input.maxScroll, top)
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function applyTypewriterScroll(view: EditorView, ratio: number): void {
  const head = view.state.selection.main.head
  const block = view.lineBlockAt(head)
  const scroller = view.scrollDOM
  const nextTop = typewriterScrollTop({
    lineTop: block.top,
    lineHeight: block.height,
    viewportHeight: scroller.clientHeight,
    ratio,
    maxScroll: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
  })
  if (Math.abs(scroller.scrollTop - nextTop) < 1) return
  scroller.scrollTo({
    top: nextTop,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  })
}

function typewriterPlugin(ratio: number): Extension {
  return ViewPlugin.fromClass(
    class {
      frame = 0

      constructor(readonly view: EditorView) {
        this.schedule()
      }

      update(update: ViewUpdate) {
        if (!shouldRecenterTypewriter(update)) return
        this.schedule()
      }

      destroy() {
        if (this.frame) cancelAnimationFrame(this.frame)
      }

      schedule() {
        if (this.frame) cancelAnimationFrame(this.frame)
        this.frame = requestAnimationFrame(() => {
          this.frame = 0
          if (!this.view.dom.parentNode) return
          applyTypewriterScroll(this.view, ratio)
        })
      }
    },
    {
      eventHandlers: {
        wheel() {
          if (this.frame) {
            cancelAnimationFrame(this.frame)
            this.frame = 0
          }
          return false
        },
      },
    },
  )
}

export function typewriterExtension(options: TypewriterOptions = {}): Extension {
  const config = resolveTypewriterOptions(options)
  return [
    typewriterConfig.of(config),
    config.enabled ? typewriterPlugin(config.ratio) : [],
  ]
}

/* ── Focus paragraph ──────────────────────────────────────────────── */

export const focusParagraphEnabled = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

export function isFocusParagraphEnabled(state: EditorState): boolean {
  return state.facet(focusParagraphEnabled)
}

const dimLine = Decoration.line({ class: 'cm-paper-dim' })

/** Blank-line-separated block containing `pos`. A blank line is its own block. */
export function activeParagraphRange(doc: Text, pos: number): { from: number; to: number } {
  const safe = Math.max(0, Math.min(doc.length, pos))
  const line = doc.lineAt(safe)
  if (!line.text.trim()) return { from: line.from, to: line.to }
  let fromNumber = line.number
  let toNumber = line.number
  while (fromNumber > 1 && doc.line(fromNumber - 1).text.trim()) fromNumber -= 1
  while (toNumber < doc.lines && doc.line(toNumber + 1).text.trim()) toNumber += 1
  return { from: doc.line(fromNumber).from, to: doc.line(toNumber).to }
}

export function buildFocusParagraphDecorations(state: EditorState): DecorationSet {
  const { from, to } = activeParagraphRange(state.doc, state.selection.main.head)
  const ranges = []
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    if (line.from >= from && line.to <= to) continue
    ranges.push(dimLine.range(line.from))
  }
  return Decoration.set(ranges)
}

const focusParagraphPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildFocusParagraphDecorations(view.state)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = buildFocusParagraphDecorations(update.state)
      }
    }
  },
  { decorations: (value) => value.decorations },
)

export function focusParagraphExtension(enabled = true): Extension {
  return [
    focusParagraphEnabled.of(enabled),
    enabled ? focusParagraphPlugin : [],
  ]
}
