import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildLivePreview, paperMarkdown, paperThemeSpec, toggleTaskMarker } from './codemirror.ts'

function preview(doc: string, cursor = 0, hasFocus = true) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [paperMarkdown],
  })
  const hidden: string[] = []
  const styled: Array<{ class: string; text: string }> = []
  const widgets: Array<{ text: string; checked: boolean | null }> = []
  buildLivePreview({ state, visibleRanges: [{ from: 0, to: doc.length }], hasFocus }).between(0, doc.length, (from, to, deco) => {
    const cls = typeof deco.spec.class === 'string' ? deco.spec.class : ''
    if (cls) styled.push({ class: cls, text: from < to ? doc.slice(from, to) : '' })
    else if (deco.spec.widget) {
      const widget = deco.spec.widget as { checked?: boolean }
      widgets.push({ text: from < to ? doc.slice(from, to) : '', checked: typeof widget.checked === 'boolean' ? widget.checked : null })
    } else if (from < to) hidden.push(doc.slice(from, to))
  })
  return { hidden, styled, widgets }
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

  it('previews the caret line when the editor is not focused', () => {
    const doc = '# 标题\n正文'
    const unfocused = preview(doc, 0, false)
    expect(unfocused.hidden).toContain('# ')
    expect(unfocused.styled.some((item) => item.class === 'cm-lp-h1')).toBe(true)

    const focused = preview(doc, 0, true)
    expect(focused.hidden.join('')).not.toContain('#')
    expect(focused.styled.some((item) => item.class === 'cm-lp-h1')).toBe(false)
  })

  it('hides the heading mark together with its following space', () => {
    const doc = '前言\n\n## 导航'
    const off = preview(doc, 0)
    expect(off.hidden).toContain('## ')
    expect(off.styled.some((item) => item.class === 'cm-lp-h2')).toBe(true)
  })

  it('hides emphasis marks and keeps bold styling off the caret', () => {
    const doc = '前**粗体**后'
    const off = preview(doc, 0)
    expect(off.hidden.filter((text) => text === '**')).toEqual(['**', '**'])
    expect(off.styled.some((item) => item.class === 'cm-lp-strong' && item.text === '**粗体**')).toBe(true)

    const inside = preview(doc, doc.indexOf('粗体'), true)
    expect(inside.hidden.join('')).not.toContain('**')
  })

  it('hides inline-code backticks but keeps fenced code marks faded', () => {
    const doc = '用 `code` 写'
    const off = preview(doc, 0)
    expect(off.hidden.filter((text) => text === '`')).toEqual(['`', '`'])

    const fenced = preview('```\ncode\n```', 0)
    expect(fenced.hidden.join('')).not.toContain('```')
  })

  it('hides the quote mark and one space off the caret line', () => {
    const doc = '> 引用\n后文'
    const off = preview(doc, doc.length)
    expect(off.hidden).toContain('> ')
    expect(off.styled.some((item) => item.class === 'cm-lp-quote')).toBe(true)
  })

  it('replaces bullet marks with a bullet widget but keeps ordered marks', () => {
    const bullets = preview('- 项目\n其他', 6)
    expect(bullets.widgets).toEqual([{ text: '-', checked: null }])

    const ordered = preview('1. 项目\n其他', 8)
    expect(ordered.widgets).toEqual([])
  })

  it('replaces task markers with checkboxes and hides the list mark', () => {
    const doc = '- [ ] 待办\n- [x] 完成\n尾行'
    const off = preview(doc, doc.length)
    expect(off.widgets.filter((widget) => widget.checked !== null).map((widget) => widget.checked)).toEqual([false, true])
    expect(off.hidden.filter((text) => text === '- ')).toEqual(['- ', '- '])

    const onTask = preview(doc, 0)
    expect(onTask.widgets.some((widget) => widget.text === '[ ]')).toBe(false)
    expect(onTask.hidden.join('')).not.toContain('- [')
    expect(onTask.widgets.some((widget) => widget.text === '[x]')).toBe(true)
  })

  it('toggleTaskMarker flips the marker char and refuses non-markers or readOnly', () => {
    const doc = '- [ ] 待办\n- [X] 完成'
    const state = EditorState.create({ doc })
    const spec = toggleTaskMarker(state, 2)
    expect(spec).not.toBeNull()
    const toggled = state.update(spec!)
    expect(toggled.state.doc.toString()).toBe('- [x] 待办\n- [X] 完成')

    const back = toggleTaskMarker(toggled.state, 11)
    expect(back).not.toBeNull()
    expect(toggled.state.update(back!).state.doc.toString()).toBe('- [x] 待办\n- [ ] 完成')

    expect(toggleTaskMarker(state, 0)).toBeNull()

    const readOnly = EditorState.create({ doc, extensions: [EditorState.readOnly.of(true)] })
    expect(toggleTaskMarker(readOnly, 2)).toBeNull()
  })
})

describe('paper theme alignment', () => {
  it('pins short documents to the start of the scroller instead of floating them', () => {
    expect(paperThemeSpec['.cm-scroller']).toMatchObject({
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
    })
    expect(paperThemeSpec['.cm-content']).toMatchObject({
      width: '100%',
      flexGrow: '2',
      minWidth: '0',
      textAlign: 'start',
    })
    expect(paperThemeSpec['.cm-line']).toMatchObject({ textAlign: 'start' })
  })
})
