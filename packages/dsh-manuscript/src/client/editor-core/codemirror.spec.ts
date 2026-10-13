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
  const styled: Array<{ class: string; text: string; from: number; to: number }> = []
  const widgets: Array<{ text: string; checked: boolean | null }> = []
  buildLivePreview({ state, visibleRanges: [{ from: 0, to: doc.length }], hasFocus }).between(0, doc.length, (from, to, deco) => {
    const cls = typeof deco.spec.class === 'string' ? deco.spec.class : ''
    if (cls) styled.push({ class: cls, text: from < to ? doc.slice(from, to) : '', from, to })
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

  it('centers standalone section-mark lines and keeps them raw at the caret', () => {
    const doc = '前文\n\n一\n\n※ ※ ※\n\n第十章 标题\n\n普通段落\n'
    const off = preview(doc, 0)
    const sections = off.styled.filter((item) => item.class.split(' ').includes('cm-lp-section'))
    /* 「一」与「※ ※ ※」两段居中；「第十章 标题」含非小节字符，不装饰。
       中文数字走 --cjk（display 字），符号行走 --symbol（font-ui + emoji 文本字形）。 */
    expect(sections).toHaveLength(2)
    expect(off.styled.some((item) => item.class === 'cm-lp-section cm-lp-section--cjk')).toBe(true)
    expect(off.styled.some((item) => item.class === 'cm-lp-section cm-lp-section--symbol')).toBe(true)
    expect(off.styled.some((item) => item.class === 'cm-lp-para')).toBe(true)

    const markStart = doc.lastIndexOf('\n', doc.indexOf('一')) + 1
    const onMark = preview(doc, doc.indexOf('一'))
    /* 光标行（一）保持原文；其它小节行（※ ※ ※）仍然装饰。 */
    expect(onMark.styled.filter((item) => item.class.split(' ').includes('cm-lp-section'))).toHaveLength(1)
    expect(onMark.styled.some((item) => item.class.split(' ').includes('cm-lp-section') && item.from === markStart)).toBe(false)

    const onText = preview(doc, doc.indexOf('普通'))
    expect(onText.styled.some((item) => item.class.split(' ').includes('cm-lp-section'))).toBe(true)
  })

  it('leaves section marks raw when centerSectionMarks is disabled', () => {
    const doc = '前文\n\n一\n'
    const state = EditorState.create({ doc, selection: { anchor: 0 }, extensions: [paperMarkdown] })
    const styled: string[] = []
    buildLivePreview(
      { state, visibleRanges: [{ from: 0, to: doc.length }], hasFocus: true },
      { centerSectionMarks: false },
    ).between(0, doc.length, (_from, _to, deco) => {
      if (typeof deco.spec.class === 'string' && deco.spec.class) styled.push(deco.spec.class)
    })
    expect(styled.some((cls) => cls.split(' ').includes('cm-lp-section'))).toBe(false)
    expect(styled).toContain('cm-lp-para')
  })

  it('marks only whole-paragraph marks: inline symbols and mixed text stay plain', () => {
    const doc = '含 * 星号\n\n* \n\n一、二\n\n＊＊＊\n'
    const off = preview(doc, 0)
    /* 段落内混有其他文字的不算；行首「* 」被 markdown 解析为无序列表项
       （非顶层 Paragraph，按规格的列表项排除规则不装饰）；「＊＊＊」算。 */
    expect(off.styled.filter((item) => item.class.split(' ').includes('cm-lp-section'))).toHaveLength(1)
    expect(off.styled.some((item) => item.class === 'cm-lp-section cm-lp-section--symbol' && doc.slice(item.from, item.from + 3) === '＊＊＊')).toBe(true)
  })

  it('collapses blank lines between non-blank lines and restores them at the caret', () => {
    const doc = '甲\n\n乙\n\n\n丙\n\n'
    const off = preview(doc, doc.length)
    /* 第 2 行（甲、乙之间的空行）收起；第 4、5 行是连续空行，两端不同时
       非空，不收；文末第 7 行没有下一行，不收。 */
    const blanks = off.styled.filter((item) => item.class === 'cm-lp-blank')
    expect(blanks).toHaveLength(1)
    expect(doc.slice(blanks[0]!.from, blanks[0]!.to)).toBe('')
    const blankLineStart = doc.indexOf('\n') + 1
    expect(blanks[0]!.from).toBe(blankLineStart)

    const onBlank = preview(doc, blankLineStart)
    expect(onBlank.styled.some((item) => item.class === 'cm-lp-blank')).toBe(false)
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
