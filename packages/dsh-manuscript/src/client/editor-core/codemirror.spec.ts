import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildLivePreview, paperMarkdown } from './codemirror.ts'

function preview(doc: string, cursor = 0) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [paperMarkdown],
  })
  const hidden: string[] = []
  const styled: Array<{ class: string; text: string }> = []
  buildLivePreview({ state, visibleRanges: [{ from: 0, to: doc.length }] }).between(0, doc.length, (from, to, deco) => {
    const cls = typeof deco.spec.class === 'string' ? deco.spec.class : ''
    if (cls) styled.push({ class: cls, text: from < to ? doc.slice(from, to) : '' })
    else if (from < to) hidden.push(doc.slice(from, to))
  })
  return { hidden, styled }
}

describe('paper live preview', () => {
  it('hides heading marks off the caret line and leaves them raw on it', () => {
    const doc = '# 世界观\n\n## 导航\n'
    const off = preview(doc, doc.length)
    expect(off.hidden.join('')).toContain('#')
    expect(off.styled.some((item) => item.class === 'cm-lp-h1')).toBe(true)
    expect(off.styled.some((item) => item.class === 'cm-lp-h2')).toBe(true)

    const onHeading = preview(doc, doc.indexOf('导航'))
    expect(onHeading.hidden.join('')).not.toContain('##')
  })

  it('hides link syntax and percent-encoded destinations, keeping the label', () => {
    const doc = '见 [世界观/00 总览.md](世界观/00%20总览.md) 与 [世界观/](世界观)。\n'
    const result = preview(doc, 0)
    expect(result.hidden.join('')).toContain('(世界观/00%20总览.md)')
    expect(result.hidden.join('')).toContain('(世界观)')
    expect(result.hidden.join('')).toContain('[')
    expect(result.styled.filter((item) => item.class === 'cm-lp-link').map((item) => item.text)).toEqual([
      '世界观/00 总览.md',
      '世界观/',
    ])
  })

  it('keeps the raw link when the caret is inside it', () => {
    const doc = '见 [世界观/](世界观)。\n'
    const inside = doc.indexOf('世界观/')
    const result = preview(doc, inside)
    expect(result.hidden.join('')).not.toContain('(世界观)')
    expect(result.styled.some((item) => item.class === 'cm-lp-link')).toBe(false)
  })
})
